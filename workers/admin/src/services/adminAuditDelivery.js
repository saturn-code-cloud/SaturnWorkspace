const PENDING_PREFIX = "internal/admin-audit-pending/";
const QUARANTINE_PREFIX = "internal/admin-audit-quarantine/";
const WRITER_VERSION = "2";
const REPLAY_BATCH_SIZE = 15;
const MAX_PENDING_BYTES = 65536;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const exactTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function auditRow(event) {
  const at = event.at || new Date().toISOString();
  const observed = event.payload ?? {};
  const context = Object.fromEntries(Object.entries({
    request_id: event.request_id || observed.request_id,
    outcome: event.outcome || observed.outcome || observed.result,
    actor_role: event.actor_role || observed.actor_role,
    reason_code: event.reason_code || observed.reason_code,
    reason_note: event.reason_note || observed.reason_note,
  }).filter(([, value]) => typeof value === "string" && value.trim()));
  return {
    id: crypto.randomUUID(),
    action: String(event.type || "admin_action").trim(),
    entity: String(event.entity || event.channel || "admin").trim(),
    entity_id: event.entity_id || event.version || event.key || null,
    payload: { ...event, ...context, at, audit_writer_version: WRITER_VERSION },
    admin_email: event.actor || null,
    happened_at: at,
  };
}

function reportDelivery(event, id) {
  const log = event === "admin_audit_unrecorded" ? console.error : console.warn;
  log(JSON.stringify({ event, audit_id: id }));
}

async function storeRow(requestDb, env, row) {
  const signal = AbortSignal.timeout(5000);
  const inserted = await requestDb(env, "admin_activity", "POST", {
    query: "select=id",
    body: row,
    prefer: "resolution=ignore-duplicates,return=representation",
    signal,
  });
  if (Array.isArray(inserted) && inserted.length === 1 && inserted[0]?.id === row.id) return;
  if (Array.isArray(inserted) && inserted.length === 0) {
    const prior = await requestDb(env, "admin_activity", "GET", {
      query: "select=id&id=eq." + row.id + "&limit=1",
      signal,
    });
    if (Array.isArray(prior) && prior.length === 1 && prior[0]?.id === row.id) return;
  }
  throw new Error("admin_audit_insert_unconfirmed");
}

export async function deliverAdminAudit(env, requestDb, event) {
  const row = auditRow(event);
  try {
    await storeRow(requestDb, env, row);
    return;
  } catch {
    try {
      const raw = JSON.stringify(row);
      if (new TextEncoder().encode(raw).byteLength > MAX_PENDING_BYTES) {
        throw new Error("admin_audit_pending_too_large");
      }
      const stored = await env.OTA_BUCKET?.put(PENDING_PREFIX + row.id, raw, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });
      if (!stored) throw new Error("admin_audit_pending_unavailable");
      reportDelivery("admin_audit_pending", row.id);
    } catch {
      reportDelivery("admin_audit_unrecorded", row.id);
    }
  }
}

function validPendingRow(row, id) {
  return row?.id === id && uuid.test(id) &&
    typeof row.action === "string" && typeof row.entity === "string" &&
    row.payload?.audit_writer_version === WRITER_VERSION &&
    typeof row.happened_at === "string" && exactTime.test(row.happened_at) && Number.isFinite(Date.parse(row.happened_at));
}

async function recoverPendingRow(bucket, env, requestDb, { key, size }) {
  const id = key.slice(PENDING_PREFIX.length);
  if (!uuid.test(id) || !Number.isSafeInteger(size) || size > MAX_PENDING_BYTES) {
    reportDelivery("admin_audit_pending_invalid", uuid.test(id) ? id : undefined);
    return;
  }
  try {
    const object = await bucket.get(key);
    if (!object) return;
    if (object.size > MAX_PENDING_BYTES) throw new Error("admin_audit_pending_too_large");
    const raw = await object.text();
    let row;
    try { row = JSON.parse(raw); } catch { row = null; }
    if (!validPendingRow(row, id)) {
      reportDelivery("admin_audit_pending_invalid", id);
      const preserved = await bucket.put(QUARANTINE_PREFIX + id, raw);
      if (preserved) await bucket.delete(key);
      return;
    }
    await storeRow(requestDb, env, row);
    await bucket.delete(key);
  } catch {
    reportDelivery("admin_audit_pending_replay_failed", id);
  }
}

export async function replayPendingAdminAudit(env, requestDb) {
  const bucket = env.OTA_BUCKET;
  if (!bucket?.list || !bucket?.delete || !bucket?.get || !bucket?.put || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let page;
  try {
    page = await bucket.list({ prefix: PENDING_PREFIX, limit: REPLAY_BATCH_SIZE });
    if (!Array.isArray(page?.objects) || page.objects.length > REPLAY_BATCH_SIZE) throw new Error("admin_audit_pending_list_invalid");
  } catch {
    reportDelivery("admin_audit_pending_list_failed");
    return;
  }
  for (let offset = 0; offset < page.objects.length; offset += 3) {
    await Promise.all(page.objects.slice(offset, offset + 3).map((object) =>
      recoverPendingRow(bucket, env, requestDb, object)));
  }
}

export async function loadLegacyAdminAudit(bucket, requestDb, env, { channel, resetAt, limit }) {
  const archive = Promise.resolve().then(() => bucket.get("updates/audit.json")).then(async (object) => {
    if (!object) return [];
    const old = await object.json();
    if (!Array.isArray(old)) throw new Error("audit_unavailable");
    return old.filter((event) => typeof event?.at === "string" && Number.isFinite(Date.parse(event.at)) && (!channel || event.channel === channel) &&
      (!resetAt || Date.parse(event.at) >= Date.parse(resetAt)));
  });
  const fresh = (async () => {
    const events = [];
    let after = null;
    const deadline = AbortSignal.timeout(7000);
    while (events.length < limit) {
      const pageSize = Math.min(limit - events.length, 500);
      const query = new URLSearchParams({
        select: "id,happened_at,payload", order: "happened_at.desc,id.desc", limit: String(pageSize),
        "payload->>audit_writer_version": "eq." + WRITER_VERSION,
      });
      if (channel) query.set("payload->>channel", "eq." + channel);
      if (resetAt) query.set("happened_at", "gte." + resetAt);
      if (after) query.set("or", `(happened_at.lt.${after.happened_at},and(happened_at.eq.${after.happened_at},id.lt.${after.id}))`);
      const rows = await requestDb(env, "admin_activity", "GET", { query: query.toString(), signal: deadline });
      if (!Array.isArray(rows) || rows.length > pageSize || rows.some((row) =>
        !uuid.test(row?.id) || !exactTime.test(row.happened_at) || !Number.isFinite(Date.parse(row.happened_at)) ||
        !exactTime.test(row.payload?.at) || row.payload?.audit_writer_version !== WRITER_VERSION)) {
        throw new Error("audit_unavailable");
      }
      for (const row of rows) {
        const { audit_writer_version: _version, ...event } = row.payload;
        events.push(event);
      }
      if (rows.length < pageSize) break;
      const next = rows.at(-1);
      if (next.id === after?.id) throw new Error("audit_unavailable");
      after = next;
    }
    return events;
  })();
  try {
    const [oldEvents, newEvents] = await Promise.all([archive, fresh]);
    return [...newEvents, ...oldEvents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
  } catch {
    throw new Error("audit_unavailable");
  }
}
