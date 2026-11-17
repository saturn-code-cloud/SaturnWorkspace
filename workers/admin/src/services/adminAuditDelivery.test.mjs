import assert from "node:assert/strict";
import test from "node:test";
import worker from "../index.js";
import { deliverAdminAudit, loadLegacyAdminAudit, replayPendingAdminAudit } from "./adminAuditDelivery.js";

const prefix = "internal/admin-audit-pending/";
const at = "2026-11-13T12:00:00.000Z";
const fixture = (sequence, channel = "beta") => ({ type: "publish", actor: "fixture@example.invalid", channel, version: "fixture-" + sequence, at });

function memoryBucket(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const calls = [];
  return {
    objects, calls,
    async get(key) {
      calls.push(["get", key]);
      const raw = objects.get(key);
      return raw === undefined ? null : { text: async () => raw, json: async () => JSON.parse(raw) };
    },
    async put(key, value) { calls.push(["put", key]); objects.set(key, value); return { key }; },
    async delete(key) { calls.push(["delete", key]); objects.delete(key); },
    async list(options) {
      calls.push(["list", options.prefix]);
      const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
      return { objects: keys.slice(0, options.limit).map((key) => ({ key, size: Buffer.byteLength(objects.get(key)) })), truncated: keys.length > options.limit };
    },
  };
}

function database() {
  const rows = new Map();
  const state = { offline: false, loseReply: false, malformed: false };
  return { rows, state, async request(_env, table, method, options) {
    assert.equal(table, "admin_activity");
    assert.ok(options.signal instanceof AbortSignal);
    if (state.offline) throw new Error("fixture-private-upstream");
    if (state.malformed) return {};
    if (method === "POST") {
      assert.equal(options.prefer, "resolution=ignore-duplicates,return=representation");
      assert.equal(options.query, "select=id");
      const row = options.body;
      if (rows.has(row.id)) return [];
      rows.set(row.id, row);
      if (state.loseReply) throw new Error("fixture-response-lost");
      return [{ id: row.id }];
    }
    const query = new URLSearchParams(options.query);
    if (query.get("id")) {
      const id = query.get("id").replace(/^eq\./, "");
      return rows.has(id) ? [{ id }] : [];
    }
    assert.equal(query.get("payload->>audit_writer_version"), "eq.2");
    const channel = query.get("payload->>channel")?.replace(/^eq\./, "");
    return [...rows.values()].filter((row) => !channel || row.payload.channel === channel).slice(0, Number(query.get("limit")));
  } };
}

const makeEnv = (OTA_BUCKET) => ({
  OTA_BUCKET, SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-audit-test-key",
});

test("concurrent successful audit writes never read or overwrite the OTA archive", async () => {
  const bucket = memoryBucket({ "updates/audit.json": [fixture("legacy")] });
  const env = makeEnv(bucket);
  const db = database();
  await Promise.all(Array.from({ length: 60 }, (_, index) => deliverAdminAudit(env, db.request, {
    ...fixture(index),
    payload: { request_id: "request-" + index, result: "success", unprojected: "private fixture" },
  })));
  assert.deepEqual(bucket.calls, []);
  assert.equal(db.rows.size, 60);
  assert.equal(new Set([...db.rows.values()].map((row) => row.entity_id)).size, 60);
  const row = [...db.rows.values()][0];
  assert.equal(row.payload.request_id, "request-0");
  assert.equal(row.payload.outcome, "success");
  assert.equal(row.happened_at, at);
});

test("parallel outages preserve every event; replay is bounded and clears only confirmed records", async (t) => {
  const logs = [];
  t.mock.method(console, "warn", (value) => logs.push(JSON.parse(value)));
  const bucket = memoryBucket();
  const env = makeEnv(bucket);
  const db = database();
  db.state.offline = true;
  await Promise.all(Array.from({ length: 18 }, (_, index) => deliverAdminAudit(env, db.request, fixture(index))));
  assert.equal(bucket.objects.size, 18);
  assert.ok([...bucket.objects.keys()].every((key) => key.startsWith(prefix)));
  await replayPendingAdminAudit(env, db.request);
  assert.equal(bucket.objects.size, 18);
  db.state.malformed = true;
  db.state.offline = false;
  await replayPendingAdminAudit(env, db.request);
  assert.equal(bucket.objects.size, 18);
  db.state.malformed = false;
  await replayPendingAdminAudit(env, db.request);
  assert.equal(db.rows.size, 15);
  assert.equal(bucket.objects.size, 3);
  await replayPendingAdminAudit(env, db.request);
  assert.equal(db.rows.size, 18);
  assert.equal(bucket.objects.size, 0);
  assert.ok(!JSON.stringify(logs).includes("private-upstream"));
});

test("a lost commit response and a failed cleanup do not duplicate admin events", async (t) => {
  t.mock.method(console, "warn", () => {});
  const bucket = memoryBucket();
  const env = makeEnv(bucket);
  const db = database();
  db.state.loseReply = true;
  await deliverAdminAudit(env, db.request, fixture("lost"));
  assert.equal(bucket.objects.size, 1);
  assert.equal(db.rows.size, 1);
  db.state.loseReply = false;
  const remove = bucket.delete;
  bucket.delete = async () => { throw new Error("fixture-delete"); };
  await replayPendingAdminAudit(env, db.request);
  assert.equal(bucket.objects.size, 1);
  bucket.delete = remove;
  await Promise.all([replayPendingAdminAudit(env, db.request), replayPendingAdminAudit(env, db.request)]);
  assert.equal(bucket.objects.size, 0);
  assert.equal(db.rows.size, 1);
});

test("malformed recovery objects are preserved outside the retry queue and dual failure is logged without data", async (t) => {
  const warnings = [];
  const errors = [];
  t.mock.method(console, "warn", (value) => warnings.push(JSON.parse(value)));
  t.mock.method(console, "error", (value) => errors.push(JSON.parse(value)));
  const bucket = memoryBucket();
  const env = makeEnv(bucket);
  const db = database();
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  bucket.objects.set(prefix + id, "broken fixture");
  await replayPendingAdminAudit(env, db.request);
  assert.equal(bucket.objects.size, 1);
  assert.equal(bucket.objects.get("internal/admin-audit-quarantine/" + id), "broken fixture");
  assert.equal(db.rows.size, 0);
  assert.deepEqual(warnings[0], { event: "admin_audit_pending_invalid", audit_id: id });
  db.state.offline = true;
  bucket.put = async () => { throw new Error("fixture-private-storage-error"); };
  await deliverAdminAudit(env, db.request, fixture("failed"));
  assert.equal(errors[0].event, "admin_audit_unrecorded");
  assert.deepEqual(Object.keys(errors[0]).sort(), ["audit_id", "event"]);
});

test("legacy state and release history keep old and new records without rewriting the archive", async (t) => {
  const older = { ...fixture("excluded"), at: "2026-11-01T12:00:00.000Z" };
  const recent = { ...fixture("legacy"), at: "2026-11-12T12:00:00.000Z" };
  const bucket = memoryBucket({
    "updates/latest.json": { history_reset_at: "2026-11-05T12:00:00.000Z" },
    "updates/audit.json": [older, recent],
  });
  const env = { ...makeEnv(bucket), ADMIN_API_TOKEN: "synthetic-legacy-audit-token" };
  const db = database();
  await deliverAdminAudit(env, db.request, fixture("beta"));
  await deliverAdminAudit(env, db.request, fixture("stable", "stable"));
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/rest/v1/admin_activity");
    return db.request(env, "admin_activity", init.method, { query: url.searchParams.toString(), signal: init.signal })
      .then((rows) => Response.json(rows));
  });
  const get = (path) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/" + path, {
    headers: { Authorization: "Bearer synthetic-legacy-audit-token" },
  }), env);
  const release = await get("history?channel=beta");
  assert.equal(release.status, 200);
  assert.equal(release.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual((await release.json()).events.map(({ version }) => version), ["fixture-beta", "fixture-legacy"]);
  const state = await get("state");
  assert.equal(state.status, 200);
  assert.equal((await state.json()).recent_events.length, 3);
  assert.ok(bucket.calls.every(([operation]) => operation === "get"));
  assert.deepEqual(JSON.parse(bucket.objects.get("updates/audit.json")), [older, recent]);
  db.state.malformed = true;
  assert.equal((await get("history?channel=beta")).status, 503);
});

test("legacy history pages with an exact cursor and never projects its writer marker", async () => {
  const bucket = memoryBucket();
  const items = Array.from({ length: 501 }, (_, index) => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(501 - index).padStart(12, "0"),
    happened_at: "2026-11-13T12:00:00.123456+00:00",
    payload: { ...fixture(index), audit_writer_version: "2" },
  }));
  const pages = [];
  const events = await loadLegacyAdminAudit(bucket, async (_env, _table, _method, { query }) => {
    const params = new URLSearchParams(query);
    pages.push(params);
    return params.has("or") ? items.slice(500) : items.slice(0, 500);
  }, makeEnv(bucket), { channel: "beta", resetAt: "", limit: 501 });
  assert.equal(pages.length, 2);
  assert.match(pages[1].get("or"), /12:00:00\.123456\+00:00/);
  assert.ok(pages[1].get("or").includes(items[499].id));
  assert.equal(events.length, 501);
  assert.ok(events.every((entry) => !Object.hasOwn(entry, "audit_writer_version")));
});

test("the scheduled worker replays pending audits without running diagnostic retention", async (t) => {
  t.mock.method(console, "warn", () => {});
  const bucket = memoryBucket();
  const env = makeEnv(bucket);
  const { rows, request } = database();
  await deliverAdminAudit(env, async () => { throw new Error("fixture-offline"); }, fixture("scheduled"));
  const methods = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    methods.push([url.pathname, init.method]);
    if (url.pathname.endsWith("/crash_logs")) return new Response(null, { status: 204 });
    const data = await request(env, "admin_activity", init.method, {
      query: url.searchParams.toString(), prefer: init.headers.Prefer, signal: init.signal, body: JSON.parse(init.body),
    });
    return Response.json(data);
  });
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  await worker.scheduled({ cron: "*/15 * * * *" }, env, ctx);
  await Promise.all(pending.splice(0));
  assert.deepEqual(methods, [["/rest/v1/admin_activity", "POST"]]);
  assert.equal(rows.size, 1);
  assert.equal(bucket.objects.size, 0);
  await worker.scheduled({ cron: "17 3 * * *" }, env, ctx);
  await Promise.all(pending.splice(0));
  assert.deepEqual(methods.at(-1), ["/rest/v1/crash_logs", "DELETE"]);
  assert.equal(methods.length, 2);
  await worker.scheduled({ cron: "unknown" }, env, ctx);
  assert.equal(pending.length, 0);
});
