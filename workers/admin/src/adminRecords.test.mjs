import assert from "node:assert/strict";
import test from "node:test";

import worker, { subscriptionRowsWithProjection } from "./index.js";
import { adminContext, hasPermission } from "./routes/adminOperations.js";

test("subscription directories page in the database, preserve full-owner truth, and reject unconfirmed results", async (t) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const oldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const currentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const row = { id, firebase_user_id: "fixture-owner", user_email: "literal%_@example.test", status: "active", lifecycle_state: "active", is_current: true,
    starts_at: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", plan: "monthly", metadata: { private_fixture: "must-not-project" } };
  let mode = "ok";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (mode === "failed") return Response.json({ message: "private-fixture-source-detail" }, { status: 503 });
    if (url.pathname.endsWith("/admin_subscription_directory")) {
      assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_search, "literal%_");
      assert.equal(payload.p_page, 3);
      const values = { as_of: "2026-11-13T12:00:00Z", total: 51, items: [row], witnesses: [{ ...row, id: currentId }, { ...row, id: oldId }] };
      if (mode === "bad-total") values.total = 50;
      if (mode === "bad-view") values.witnesses[0].firebase_user_id = "another-owner";
      return Response.json(values);
    }
    assert.equal(url.pathname, "/rest/v1/pending_subscription_grants");
    assert.equal(url.searchParams.get("offset"), "5");
    assert.equal(url.searchParams.get("status"), "eq.pending");
    assert.equal(url.searchParams.get("order"), "created_at.desc,id.asc");
    assert.ok(!url.searchParams.get("select").includes("reason_note"));
    return Response.json([{ id, normalized_email: "fixture@example.test", status: "pending" }], { headers: { "Content-Range": mode === "bad-total" ? "*/0" : "5-5/6" } });
  });
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-directory-service",
    ADMIN_EMAIL_ALLOWLIST: "fixture@example.invalid,support@example.invalid",
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ "fixture@example.invalid": "read_only", "support@example.invalid": "support" }) };
  const request = (path, actor = "fixture@example.invalid") => worker.fetch(new Request("https://admin.saturnws.com/api/admin/" + path, {
    headers: { "cf-access-authenticated-user-email": actor },
  }), env);
  const directory = "subscriptions?view=directory&search=literal%25_&page=3&limit=25";
  const pending = "subscriptions/pending-grants?view=directory&status=pending&page=2&limit=5";
  for (const path of [directory, pending]) assert.equal((await request(path, "support@example.invalid")).status, 403);
  assert.equal(calls.length, 0);
  const result = await request(directory);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.total, 51);
  assert.equal(data.items[0].is_current_record, true);
  assert.equal(data.items[0].effective_lifecycle, "active");
  assert.equal(data.items[0].integrity_warning, "multiple_current_subscriptions");
  assert.equal(data.items[0].metadata, undefined);
  assert.equal(data.items[0].subscription_projection.entitlement, "integrity_conflict");
  assert.doesNotMatch(JSON.stringify(data), /must-not-project|private_fixture/);
  assert.equal((await (await request(pending)).json()).total, 6);
  for (const modeValue of ["bad-total", "bad-view", "failed"]) {
    mode = modeValue;
    const failure = await request(directory);
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { success: false, error: "subscriptions_unavailable" });
  }
  mode = "bad-total";
  assert.equal((await request(pending)).status, 503);
  const count = calls.length;
  assert.equal((await request(directory.replace("page=3", "page=-1"))).status, 400);
  assert.equal(calls.length, count);
});

test("an exact subscription read preserves owner witnesses and cannot return another record or bypass read access", async (t) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const email = "fixture-subscription-reader@example.invalid";
  const row = { id, firebase_user_id: "fixture-owner", user_email: "fixture@example.test", plan: "monthly",
    lifecycle_state: "suspended", is_current: false, expires_at: "2099-01-01T00:00:00Z", starts_at: "2026-01-01T00:00:00Z" };
  let mode = "ok", calls = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    calls++;
    assert.equal(String(input), "https://supabase.example.invalid/rest/v1/rpc/admin_subscription_directory");
    assert.equal(JSON.parse(init.body).p_record_id, id);
    const item = mode === "wrong" ? { ...row, id: other } : row;
    return Response.json({ as_of: "2026-11-14T00:00:00Z", total: mode === "missing" ? 0 : 1,
      items: mode === "missing" ? [] : [item], witnesses: mode === "missing" ? [] : [{ ...row, id: other, lifecycle_state: "active", is_current: true }] });
  });
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-read-key",
    ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }) };
  const request = (value, role = "read_only") => worker.fetch(new Request("https://admin.saturnws.com/api/admin/subscriptions?view=directory&limit=1&id=" + value,
    { headers: { "cf-access-authenticated-user-email": email } }), { ...env, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: role }) });
  assert.equal((await request(id, "support")).status, 403);
  assert.equal((await request("invalid")).status, 400);
  assert.equal(calls, 0);
  const result = await (await request(id.toUpperCase())).json();
  assert.equal(result.items[0].id, id);
  assert.equal(result.items[0].is_current_record, false);
  assert.equal(result.items[0].subscription_projection.entitlement, "entitled");
  mode = "missing";
  assert.equal((await (await request(id)).json()).total, 0);
  mode = "wrong";
  assert.equal((await request(id)).status, 503);
});

test("account directory resolves pages and exact email inside the database without widening access", async (t) => {
  const email = "fixture-directory-admin@example.invalid";
  const account = { firebase_uid: "fixture-a", email: "a%_+literal@example.test", account_status: "active", subscription_presence: "history_only", session_count: 2, device_count: 1, created_at: "2026-01-01T00:00:00Z" };
  const readEnv = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-directory-key", ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }) };
  const read = (query, env = readEnv, actor = email) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/users?" + query, { headers: { "cf-access-authenticated-user-email": actor } }), env);
  const calls = [];
  let fault = "";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://supabase.example.invalid/rest/v1/rpc/admin_user_directory");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer fixture-directory-key");
    assert.ok(init.signal instanceof AbortSignal);
    const parameters = JSON.parse(init.body);
    calls.push(parameters);
    if (fault === "offline") throw new Error("fixture-private-upstream-error");
    if (fault === "missing-rpc") return Response.json({ message: "fixture-private-unavailable-rpc" }, { status: 404 });
    if (fault === "wrong-owner") return Response.json({ total: 1, items: [{ ...account, email: "other@example.test" }] });
    if (fault === "short-page") return Response.json({ total: 2, items: [account] });
    if (fault === "wrong-status") return Response.json({ total: 1, items: [{ ...account, account_status: "suspended" }] });
    if (fault === "invalid-count") return Response.json({ total: 1, items: [{ ...account, device_count: null }] });
    if (parameters.p_exact_email) return Response.json(parameters.p_search === account.email ? { total: 1, items: [account] } : { total: 0, items: [] });
    return Response.json({ total: 1001, items: [account] });
  });
  const params = new URLSearchParams({ page: "41", limit: "25", search: '%_+ حرف (,"', account_status: "active", verification: "verified", subscription: "history_only", sort: "activity_desc" });
  let response = await read(params);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, directory_version: 1, items: [account], total: 1001, page: 41, limit: 25, exact_email: null });
  assert.deepEqual(calls[0], { p_search: params.get("search"), p_exact_email: false, p_account_status: "active", p_verification: "verified", p_subscription: "history_only", p_sort: "activity_desc", p_page: 41, p_limit: 25 });
  const exact = new URLSearchParams({ search: account.email.toUpperCase(), limit: "8", exact_email: "true" });
  response = await read(exact);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).exact_email, account.email);
  assert.equal(calls.at(-1).p_search, account.email);
  const missing = await read("exact_email=true&limit=8&search=missing%40example.test");
  assert.equal(missing.status, 200);
  assert.deepEqual((await missing.json()).items, []);
  const before = calls.length;
  for (const value of ["page=5001", "page=1.2", "limit=101", "account_status=unknown", "sort=unknown", "verification=false", "subscription=unknown", "exact_email=false", "exact_email=true&search=incomplete", "exact_email=true&search=a%40example.test&page=2"]) {
    assert.equal((await read(value)).status, 400, value);
  }
  assert.equal((await read("", readEnv, "fixture-unauthorized@example.invalid")).status, 401);
  const releaseEnv = { ...readEnv, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "release_manager" }) };
  assert.equal((await read("", releaseEnv)).status, 403);
  assert.equal(calls.length, before);
  for (fault of ["offline", "missing-rpc", "wrong-owner", "short-page", "invalid-count"]) {
    const failed = await read(exact);
    assert.equal(failed.status, 503, fault);
    assert.deepEqual(await failed.json(), { success: false, error: "admin_users_unavailable" });
  }
  fault = "wrong-status";
  assert.equal((await read("account_status=active")).status, 503);
});

test("admin identity outages are unavailable, invalid credentials require sign-in, and denied accounts stay denied", async (t) => {
  const email = "access-check@example.invalid";
  const env = { ADMIN_EMAIL_ALLOWLIST: email, FIREBASE_WEB_API_KEY: "fixture-identity-api-key", ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }) };
  let mode = "ok"; const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(String(url).startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup?"));
    assert.deepEqual(JSON.parse(init.body), { idToken: "fixture-synthetic-admin-token" });
    assert.ok(init.signal instanceof AbortSignal); calls.push(init.signal);
    if (mode === "network") throw new TypeError("fixture-private-network-details");
    if (mode === "oversized") return new Response(' '.repeat(65537));
    if (mode === "html") return new Response('<html>fixture</html>', { status: 502 });
    if (mode === "rate" || mode === "server") return Response.json({ error: { message: "INVALID_ID_TOKEN" } }, { status: mode === "rate" ? 429 : 503 });
    if (mode === "invalid" || mode === "config") return Response.json({ error: { message: mode === "invalid" ? "INVALID_ID_TOKEN" : "API_KEY_INVALID" } }, { status: 400 });
    if (mode === "empty") return Response.json({ users: [] });
    if (mode === "malformed") return Response.json({ users: [{ localId: "fixture-uid", email, emailVerified: "false" }] });
    return Response.json({ users: [{ localId: "fixture-uid", email: mode === "denied" ? "denied@example.invalid" : email, emailVerified: mode !== "unverified", disabled: mode === "disabled" }] });
  });
  const read = (configuration = env, headers = {}) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/session", { headers: { Authorization: "Bearer fixture-synthetic-admin-token", ...headers } }), configuration);
  let response = await read(); assert.equal(response.status, 200); let body = await response.json(); assert.equal(body.email, email); assert.equal(body.role, "read_only");
  for (mode of ["network", "oversized", "html", "rate", "server", "config", "empty", "malformed"]) {
    response = await read(); assert.equal(response.status, 503, mode); body = await response.json(); assert.equal(body.error, "admin_identity_unavailable", mode); assert.ok(!body.email); assert.doesNotMatch(JSON.stringify(body), /fixture-private|denied@example|fixture-synthetic/);
  }
  for (mode of ["invalid", "disabled"]) { response = await read(); assert.equal(response.status, 401); assert.equal((await response.json()).error, "firebase_token_invalid"); }
  for (mode of ["denied", "unverified"]) { response = await read(); assert.equal(response.status, 403); assert.equal((await response.json()).error, mode === "denied" ? "admin_email_not_allowed" : "firebase_email_not_verified"); }
  assert.equal((await read({ ...env, ADMIN_EMAIL_ALLOWLIST: "" })).status, 503);
  assert.equal((await read({ ...env, FIREBASE_WEB_API_KEY: "" })).status, 503);
  const count = calls.length;
  response = await read({ ...env, ADMIN_LAYER1_USERNAME: "fixture", ADMIN_LAYER1_PASSWORD: "fixture", ADMIN_LAYER1_SESSION_SECRET: "fixture-only-preauth-secret" });
  assert.equal(response.status, 401); assert.equal((await response.json()).error, "preauth_required"); assert.equal(calls.length, count);
  mode = "ok"; assert.equal((await read()).status, 200);
});

test("admin identity verification has a deadline that also aborts response body reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(controller) { signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }); } }));
  });
  const result = worker.fetch(new Request("https://admin.saturnws.com/api/admin/session", { headers: { Authorization: "Bearer fixture-synthetic-admin-token" } }), { ADMIN_EMAIL_ALLOWLIST: "fixture@example.invalid", FIREBASE_WEB_API_KEY: "fixture-identity-api-key" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal.aborted, false); t.mock.timers.tick(10000);
  const response = await result; assert.equal(signal.aborted, true); assert.equal(response.status, 503); assert.equal((await response.json()).error, "admin_identity_unavailable");
});

test("global policy proxy keeps the trusted actor and request identity and rejects unauthorized writes", async () => {
  const email = 'policy-reader@example.invalid'; const calls = [];
  let upstreamStatus = 200; let payload = { success: true, policy: { revision: 'a'.repeat(64) } };
  const env = { POLICY_ADMIN_TOKEN: 'fixture-policy-server-token', ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: 'read_only' }), POLICY_WORKER: { fetch: async (request) => { calls.push({ path: new URL(request.url).pathname, method: request.method, actor: request.headers.get('X-Saturn-Admin-Actor'), key: request.headers.get('Idempotency-Key'), body: request.method === 'POST' ? await request.json() : null }); return Response.json(payload, { status: upstreamStatus }); } } };
  const call = (body, settings = env) => worker.fetch(new Request('https://admin.saturnws.com/api/admin/policy/global-policy', { method: body ? 'POST' : 'GET', headers: { 'cf-access-authenticated-user-email': email, 'X-Saturn-Admin-Actor': 'untrusted@example.invalid', 'Idempotency-Key': 'fixture-policy-request' }, ...(body ? { body: JSON.stringify(body) } : {}) }), settings);
  assert.equal((await call()).status, 200); assert.equal(calls[0].path, '/v1/admin/global-policy'); assert.equal(calls[0].actor, email);
  const before = calls.length; assert.equal((await call({ request_id: 'fixture-policy-request' })).status, 403); assert.equal(calls.length, before);
  const writer = { ...env, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: 'super_admin' }) };
  const beforeLarge = calls.length;
  const oversized = await worker.fetch(new Request('https://admin.saturnws.com/api/admin/policy/global-policy', { method: 'POST', headers: { 'cf-access-authenticated-user-email': email, 'Content-Length': '1' }, body: JSON.stringify({ reason: 'ع'.repeat(3000) }) }), writer);
  assert.equal(oversized.status, 400); assert.equal((await oversized.json()).error, 'invalid_policy_change'); assert.equal(calls.length, beforeLarge);
  const invalidEncoding = await worker.fetch(new Request('https://admin.saturnws.com/api/admin/policy/global-policy', { method: 'POST', headers: { 'cf-access-authenticated-user-email': email }, body: new Uint8Array([123, 255, 125]) }), writer);
  assert.equal(invalidEncoding.status, 400); assert.equal((await invalidEncoding.json()).error, 'invalid_policy_change'); assert.equal(calls.length, beforeLarge);
  payload = { success: true, request_id: 'fixture-policy-request', revision: 'b'.repeat(64), replay: true };
  assert.equal((await call({ request_id: 'fixture-policy-request' }, writer)).status, 200); assert.equal(calls.at(-1).key, 'fixture-policy-request'); assert.equal(calls.at(-1).actor, email);
  for (const [error, status] of [['policy_state_unavailable', 503], ['policy_write_unconfirmed', 503], ['policy_state_changed', 409], ['policy_request_conflict', 409]]) { payload = { success: false, error }; upstreamStatus = status; assert.equal((await call({ request_id: 'fixture-policy-request' }, writer)).status, status); }
});

test("commerce directories page exact filtered records and reject unavailable or incomplete sources", async (t) => {
  const email = "commerce-reader@example.invalid";
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-commerce-key", ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "billing" }), STRIPE_SECRET_KEY: "fixture-configured-not-ready" };
  const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
  const order = { id: id(1), firebase_uid: "fixture-uid", user_email: "fixture@example.test", plan_id: "monthly", plan_version: 1, status: "paid", currency: "USD", amount_minor: 3500, provider: "stripe", provider_order_id: "fixture-provider-order", created_at: "2026-11-11T12:00:00Z", updated_at: "2026-11-11T12:00:00Z", expires_at: "2026-11-12T12:00:00Z", metadata: { private: true }, hosted_url: "https://private.example.invalid", idempotency_key_hash: "fixture-private-hash" };
  let source = "orders"; let mode = "ok"; const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: new URL(url), init });
    assert.equal(init.method, undefined); assert.equal(init.headers.Prefer, "count=exact"); assert.ok(init.signal instanceof AbortSignal);
    if (mode === "network") throw new Error("fixture-private-database-error");
    const row = source === "orders" ? order : source === "plans" ? { plan_id: "monthly", version: 1, display_name: "Monthly", term: "monthly", price_minor: 3500, currency: "USD", active: true, public_visible: true, purchasable: true, provider: "stripe", provider_price_id: "private-provider-price" } : { id: id(1), code: "fixture_integrity", severity: "warning", source: "reconcile", created_at: order.created_at, details: { private: true } };
    const rows = Array.from({ length: mode === "clamped" ? 1 : 25 }, (_, n) => ({ ...row, id: id(n + 1), ...(source === "plans" ? { version: n + 1 } : {}) }));
    return Response.json(mode === "malformed" ? {} : rows, { headers: mode === "no-count" ? {} : { "Content-Range": "25-49/206" } });
  });
  const read = (path, identity = email) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/commerce/" + path, { headers: { "cf-access-authenticated-user-email": identity } }), env);
  let result = await read("orders?page=2&status=paid&query=" + encodeURIComponent('fixture%_*(),"@example.test'));
  assert.equal(result.status, 200); let payload = await result.json();
  assert.equal(payload.total, 206); assert.equal(payload.items.length, 25); assert.equal(payload.has_more, true);
  assert.doesNotMatch(JSON.stringify(payload), /metadata|hosted_url|idempotency_key_hash|fixture-private/);
  const params = requests[0].url.searchParams;
  assert.equal(params.get("offset"), "25"); assert.equal(params.get("limit"), "25"); assert.equal(params.get("order"), "created_at.desc,id.desc"); assert.equal(params.get("status"), "eq.paid");
  assert.ok(params.get("user_email").startsWith('ilike."%fixture')); assert.ok(params.get("user_email").includes('\\\\%')); assert.ok(!params.has("or"));
  const before = requests.length;
  for (const query of ['orders?page=1.5', 'orders?page=5001', 'orders?status=unknown', 'plans?status=unknown', 'integrity?status=unknown']) assert.equal((await read(query)).status, 400);
  assert.equal((await read("orders", "unauthorized@example.invalid")).status, 401); assert.equal(requests.length, before);
  source = "plans"; result = await read("plans?page=2&status=visible"); payload = await result.json(); assert.equal(result.status, 200);
  assert.ok(payload.items.every((row) => row.checkout_available === false)); assert.doesNotMatch(JSON.stringify(payload), /provider_price_id/);
  assert.equal(requests.at(-1).url.searchParams.get("active"), "eq.true"); assert.equal(requests.at(-1).url.searchParams.get("public_visible"), "eq.true");
  source = "integrity"; result = await read("integrity?page=2&query=fixture-uid"); payload = await result.json(); assert.equal(result.status, 200); assert.equal(payload.status, "open"); assert.doesNotMatch(JSON.stringify(payload), /details/);
  assert.equal(requests.at(-1).url.searchParams.get("resolved_at"), "is.null");
  for (mode of ['network', 'malformed', 'no-count', 'clamped']) { assert.equal((await read("integrity?page=2")).status, 503); }
  const count = requests.length; payload = await (await read("configuration")).json();
  assert.equal(requests.length, count); assert.equal(payload.checkout_available, false); assert.deepEqual(payload.providers.stripe, { configured: true, implemented: false, available: false }); assert.doesNotMatch(JSON.stringify(payload), /fixture-configured|SECRET/);
});

test("commerce order detail scopes each related page and preserves the order when related records fail", async (t) => {
  const email = "commerce-detail@example.invalid"; const id = "11111111-1111-4111-8111-111111111111";
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-commerce-key", ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "billing" }) };
  const order = { id, firebase_uid: "fixture-uid", user_email: "fixture@example.test", plan_id: "monthly", plan_version: 1, status: "awaiting_payment", currency: "USD", amount_minor: 3500, created_at: "2026-11-11T12:00:00Z", updated_at: "2026-11-11T12:00:00Z", expires_at: "2026-11-12T12:00:00Z" };
  let mode = "ok"; const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const parsed = new URL(url); requests.push(parsed);
    if (parsed.pathname.endsWith("commercial_orders")) return Response.json(mode === "missing-order" ? [] : [order]);
    assert.equal(parsed.searchParams.get("order_id"), 'eq.' + id);
    assert.equal(init.headers.Prefer, "count=exact");
    if (mode === "related-failed") return Response.json({ message: "private-provider-error" }, { status: 503 });
    let row = { id: "22222222-2222-4222-8222-222222222222", order_id: mode === "wrong-owner" ? "other-order" : id, created_at: order.created_at, metadata: { private: true } };
    if (parsed.pathname.endsWith("payment_attempts")) row = { ...row, status: "awaiting_payment", requested_amount_minor: 3500, received_amount_minor: null, currency: "USD" };
    if (parsed.pathname.endsWith("payment_provider_events")) row = { ...row, received_at: order.created_at, event_type: "fixture.event", processing_status: "received", signature_verified: false };
    if (parsed.pathname.endsWith("payment_receipts")) row = { ...row, document_type: "receipt", document_url: "https://private-document.example.invalid" };
    return Response.json([row], { headers: { "Content-Range": "0-0/1" } });
  });
  const read = (view) => worker.fetch(new Request(`https://admin.saturnws.com/api/admin/commerce/orders/${id}?view=${view}`, { headers: { "cf-access-authenticated-user-email": email } }), env);
  for (const view of ['attempts', 'events', 'receipts']) {
    const result = await read(view); const payload = await result.json(); assert.equal(result.status, 200); assert.equal(payload.order.id, id); assert.equal(payload.items.length, 1); assert.equal(payload.total, 1); assert.equal(payload.unavailable, false);
    assert.doesNotMatch(JSON.stringify(payload), /metadata|document_url|private-document/);
  }
  for (mode of ['related-failed', 'wrong-owner']) { const result = await read('events'); const payload = await result.json(); assert.equal(result.status, 200); assert.equal(payload.order.id, id); assert.equal(payload.items, null); assert.equal(payload.total, null); assert.equal(payload.unavailable, true); }
  const count = requests.length; assert.equal((await read('unknown')).status, 400); assert.equal(requests.length, count);
  mode = "missing-order"; assert.equal((await read('attempts')).status, 404);
});

test("invitation proxy preserves paging, trusted actor and retry identity while enforcing read/write permissions", async () => {
  const email = "invite-admin@example.invalid";
  const forwarded = [];
  let upstreamStatus = 200;
  let upstreamBody = { success: true, items: [], has_more: false };
  const env = { ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }), POLICY_ADMIN_TOKEN: "fixture-policy-invite-token", POLICY_WORKER: { fetch: async (request) => { forwarded.push({ url: new URL(request.url), actor: request.headers.get("X-Saturn-Admin-Actor"), key: request.headers.get("Idempotency-Key"), body: request.method === "POST" ? await request.json() : null }); return Response.json(upstreamBody, { status: upstreamStatus }); } } };
  const call = (path, body, configuration = env, identity = email) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/policy/invites" + path, { method: body ? "POST" : "GET", headers: { "cf-access-authenticated-user-email": identity, "X-Saturn-Admin-Actor": "forged@example.invalid", "Content-Type": "application/json", "Idempotency-Key": "fixture-stable-request" }, ...(body ? { body: JSON.stringify(body) } : {}) }), configuration);
  assert.equal((await call("?view=management&page=2&query=fixture&status=expired")).status, 200);
  assert.equal(forwarded[0].url.pathname, "/v1/admin/invites");
  assert.equal(forwarded[0].url.searchParams.get("page"), "2");
  assert.equal(forwarded[0].actor, email);
  assert.equal((await call("/usage?view=management&invite_id=fixture&page=3")).status, 200);
  assert.equal(forwarded[1].url.searchParams.get("page"), "3");
  const before = forwarded.length;
  assert.equal((await call("/create", { request_id: "fixture-stable-request" })).status, 403);
  assert.equal((await call("/revoke", { invite_id: "fixture", reason: "Fixture reason" })).status, 403);
  assert.equal((await call("", undefined, env, "unauthorized@example.invalid")).status, 401);
  assert.equal(forwarded.length, before);
  const writer = { ...env, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "super_admin" }) };
  upstreamBody = { success: true, item: { id: "fixture" }, code: null, replay: true };
  assert.equal((await call("/create", { request_id: "fixture-stable-request" }, writer)).status, 200);
  assert.equal(forwarded.at(-1).key, "fixture-stable-request");
  assert.equal(forwarded.at(-1).actor, email);
  upstreamBody = { success: false, error: "invite_write_unconfirmed" }; upstreamStatus = 503;
  assert.equal((await call("/create", { request_id: "fixture-stable-request" }, writer)).status, 503);
  upstreamBody = { success: false, error: "invite_request_conflict" }; upstreamStatus = 409;
  assert.equal((await call("/create", { request_id: "fixture-stable-request" }, writer)).status, 409);
  upstreamBody = { success: false, error: "invite_not_found" }; upstreamStatus = 404;
  assert.equal((await call("/usage?view=management&invite_id=fixture")).status, 404);
});

test("promotion directory pages and filters all lifecycle states without exposing internal fields", async (t) => {
  const email = "promo-reader@example.invalid";
  const requests = [];
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }) };
  const row = { id: "11111111-1111-4111-8111-111111111111", code: "PROMO%_*", is_active: true, effective_status: "exhausted", discount_type: "percent", discount_value: 10, private_feature_payload: { fixture: "private" }, metadata: { fixture: "private" } };
  let response = [row, { ...row, id: "22222222-2222-4222-8222-222222222222" }];
  t.mock.method(globalThis, "fetch", async (input, init) => { requests.push({ url: new URL(input), init }); return Response.json(response); });
  const read = (query, identity = email) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/promo-codes?view=management&" + query, { headers: { "cf-access-authenticated-user-email": identity } }), env);
  let result = await read("query=" + encodeURIComponent("PROMO%_*") + "&status=exhausted&page=2&limit=1");
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.has_more, true);
  assert.equal(body.page, 2);
  assert.doesNotMatch(JSON.stringify(body), /private_feature_payload|metadata|fixture-service-key/);
  const upstream = requests[0].url;
  assert.equal(upstream.pathname, "/rest/v1/admin_promo_code_directory");
  assert.equal(upstream.searchParams.get("code"), "ilike.%PROMO\\%\\_\\*%");
  assert.equal(upstream.searchParams.get("effective_status"), "eq.exhausted");
  assert.equal(upstream.searchParams.get("offset"), "1");
  assert.equal(upstream.searchParams.get("limit"), "2");
  assert.equal(upstream.searchParams.get("order"), "created_at.desc,id.desc");
  for (const query of ["status=unknown", "limit=101", "limit=0", "page=1.5", "query=" + "x".repeat(101)]) assert.equal((await read(query)).status, 400);
  assert.equal(requests.length, 1);
  assert.equal((await read("", "unauthorized@example.invalid")).status, 401);
  response = [];
  assert.equal((await (await read("")).json()).items.length, 0);
  for (const invalid of [{ unexpected: true }, [{ id: "invalid", code: "bad", effective_status: "active" }], null]) {
    response = invalid;
    result = await read("");
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error, "promo_codes_unavailable");
  }
});

test("promotion writes validate before storage and require the reviewed record version", async (t) => {
  const email = "promo-admin@example.invalid";
  const id = "11111111-1111-4111-8111-111111111111";
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "super_admin" }) };
  const requests = [];
  let failure = "";
  const row = { id, code: "FIXTURE", discount_type: "percent", discount_value: 10, is_active: false, updated_at: "2026-11-11T12:00:00.123456Z", metadata: { private: true } };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input); const body = JSON.parse(init.body || "{}"); requests.push({ url, body, method: init.method });
    assert.equal(init.method, "POST");
    assert.ok(url.pathname.startsWith("/rest/v1/rpc/admin_"));
    if (failure) return Response.json({ code: failure === "duplicate" ? "23505" : "P0001", message: failure === "changed" ? "promo_code_changed" : "private_fixture_failure" }, { status: 400 });
    return Response.json(url.pathname.endsWith("admin_create_promo_code") ? { ...row, is_active: true } : row);
  });
  const post = (path, body, configuration = env) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/promo-codes" + path, { method: "POST", headers: { "cf-access-authenticated-user-email": email, "Content-Type": "application/json" }, body: JSON.stringify(body) }), configuration);
  const create = { code: "FIXTURE", discount_type: "percent", discount_value: 10 };
  for (const patch of [{ discount_value: 101 }, { discount_value: -1 }, { discount_value: 0 }, { discount_value: 0.001 }, { discount_type: "other" }, { max_uses: 0 }, { max_uses: 1.5 }, { expires_at: "invalid" }, { expires_at: "2020-01-01T00:00:00Z" }, { is_active: "false" }, { code: "x".repeat(65) }]) assert.equal((await post("", { ...create, ...patch })).status, 400);
  assert.equal(requests.length, 0);
  let result = await post("", create);
  assert.equal(result.status, 200);
  assert.doesNotMatch(JSON.stringify(await result.json()), /metadata|private_fixture/);
  assert.equal(requests[0].body.p_actor, email);
  assert.equal(requests[0].body.p_data.code, create.code);
  failure = "duplicate";
  result = await post("", create);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error, "promo_code_exists");
  failure = "storage";
  result = await post("", create);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "promo_save_unconfirmed");
  failure = "";
  const before = requests.length;
  assert.equal((await post(`/${id}/state`, { active: false, reason: "Fixture reason" })).status, 400);
  assert.equal(requests.length, before);
  const state = { active: false, reason: "Fixture reason", expected_updated_at: "2026-11-11T12:00:00.123456Z" };
  result = await post(`/${id}/state`, state);
  assert.equal(result.status, 200);
  assert.deepEqual(requests.at(-1).body, { p_id: id, p_active: false, p_expected_updated_at: state.expected_updated_at, p_actor: email, p_reason: state.reason });
  failure = "changed";
  result = await post(`/${id}/state`, state);
  assert.equal(result.status, 409);
  const readOnly = { ...env, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }) };
  const deniedBefore = requests.length;
  assert.equal((await post("", create, readOnly)).status, 403);
  assert.equal((await post(`/${id}/state`, state, readOnly)).status, 403);
  assert.equal(requests.length, deniedBefore);
});

test("email metadata reads preserve filters and scope without granting email writes", async () => {
  const email = "email-reader@example.invalid";
  const requests = [];
  const env = {
    ADMIN_EMAIL_ALLOWLIST: email,
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }),
    POLICY_ADMIN_TOKEN: "fixture-policy-admin-token",
    POLICY_WORKER: { async fetch(request) {
      requests.push(request);
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("Authorization"), "Bearer fixture-policy-admin-token");
      return Response.json({ success: true, fixture: true });
    } },
  };
  const get = (path, identity = email) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/policy/email/" + path, { headers: { "cf-access-authenticated-user-email": identity } }), env);
  for (const path of ["activity?view=outbound&query=user%40example.test&status=failed&page=2&limit=25", "activity?view=events&job_id=fixture-job", "jobs/fixture-job", "status?view=configuration"]) {
    assert.equal((await get(path)).status, 200);
    const upstream = new URL(requests.at(-1).url);
    const expected = new URL("https://fixture.invalid/v1/admin/email/" + path);
    assert.equal(upstream.pathname, expected.pathname);
    assert.equal(upstream.search, expected.search);
  }
  assert.equal((await get("activity", "unauthorized@example.invalid")).status, 401);
  assert.equal((await get("jobs/fixture-job", "unauthorized@example.invalid")).status, 401);
  assert.equal(requests.length, 4);
  const forbiddenWrite = await worker.fetch(new Request("https://admin.saturnws.com/api/admin/policy/email/retry", {
    method: "POST", headers: { "cf-access-authenticated-user-email": email, "Content-Type": "application/json" }, body: JSON.stringify({ job_id: "fixture-job" }),
  }), env);
  assert.equal(forbiddenWrite.status, 403);
  assert.equal(requests.length, 4);
});

test("readiness distinguishes table reads from configuration and never reports a missing schema as ready", async (t) => {
  const email = "readiness-reader@example.invalid";
  const env = {
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-private-service-key",
    ADMIN_EMAIL_ALLOWLIST: email,
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "read_only" }),
    POLICY_WORKER: { fetch: async () => assert.fail("Readiness must not call the policy service") },
    OTA_BUCKET: { get: async () => assert.fail("Readiness must not read release files"), put: async () => assert.fail("Readiness must not write release files") },
    STRIPE_SECRET_KEY: "fixture-private-payment-key", EMAIL_AUTH_ENABLED: "true",
  };
  let scenario = {};
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    const table = url.pathname.split("/").at(-1);
    requests.push(table);
    assert.equal(init.method, "GET");
    assert.equal(url.searchParams.get("limit"), "1");
    assert.ok(init.signal instanceof AbortSignal);
    const failure = scenario[table];
    if (failure === "malformed") return Response.json({ unexpected: true });
    if (failure === "network") throw new Error("fixture-private-network-error");
    if (failure === "timeout") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    if (failure) return Response.json({ code: failure.code, message: "fixture-private-provider-error" }, { status: failure.status });
    return Response.json([]);
  });
  const read = (configuration = env, identity = email) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/readiness", { headers: { "cf-access-authenticated-user-email": identity } }), configuration);
  let body = await (await read()).json();
  const check = (id) => body.checks.find((item) => item.id === id);
  assert.equal(body.checks.length, 10);
  assert.ok(body.checks.filter((item) => item.kind === "read").every((item) => item.status === "passed"));
  assert.equal(check("policy_worker_binding").status, "configured");
  assert.equal(check("payment_provider").status, "disabled");
  assert.equal(check("payment_provider").reason, "configuration_present_disabled");
  assert.doesNotMatch(JSON.stringify(body), /fixture-private|readiness-reader@example/);
  for (const failure of [{ code: "PGRST205", status: 404 }, { code: "42P01", status: 404 }]) {
    scenario = { admin_operation_requests: failure };
    body = await (await read()).json();
    assert.equal(check("admin_operation_requests").status, "missing");
    assert.equal(check("admin_operation_requests").reason, "schema_missing");
    assert.equal(body.services.admin_operations_schema, "migration_pending");
    assert.equal(check("account_profiles").status, "passed");
  }
  for (const failure of [{ code: "42501", status: 403 }, { status: 500 }, "malformed", "network"]) {
    scenario = { admin_operation_requests: failure };
    body = await (await read()).json();
    assert.equal(check("admin_operation_requests").status, "unavailable");
    assert.equal(body.services.admin_operations_schema, "unavailable");
    assert.doesNotMatch(JSON.stringify(body), /fixture-private/);
  }
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 5000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Fixture timeout", "TimeoutError")), 5);
    return controller.signal;
  });
  scenario = { account_profiles: "timeout" };
  body = await (await read()).json();
  assert.equal(check("account_profiles").status, "unavailable");
  const before = requests.length;
  body = await (await read({ ...env, SUPABASE_SERVICE_ROLE_KEY: "", ADMIN_ROLE_ASSIGNMENTS: "", POLICY_WORKER: {}, OTA_BUCKET: { get() {} } })).json();
  assert.equal(requests.length, before);
  assert.ok(body.checks.filter((item) => item.kind === "read").every((item) => item.reason === "not_configured"));
  assert.equal(check("role_assignments").status, "review");
  assert.equal(check("policy_worker_binding").status, "missing");
  assert.equal(check("ota_bucket_binding").status, "missing");
  assert.equal((await read(env, "not-authorized@example.invalid")).status, 401);
  assert.equal((await read({ ...env, ADMIN_LAYER1_USERNAME: "fixture-private-username", ADMIN_LAYER1_PASSWORD: "fixture-private-password", ADMIN_LAYER1_SESSION_SECRET: "fixture-private-session-secret" })).status, 401);
  assert.equal(requests.length, before);
});

test("release, policy, and commerce reads enforce their declared roles before reading any source", async (t) => {
  const sourceReads = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    sourceReads.push(new URL(input).pathname);
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  });
  const roles = ["support", "billing", "release_manager", "security_auditor", "read_only", "super_admin"];
  const env = {
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-capability-service-key",
    ADMIN_EMAIL_ALLOWLIST: roles.map((role) => role + "@example.invalid").join(","),
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify(Object.fromEntries(roles.map((role) => [role + "@example.invalid", role]))),
    POLICY_ADMIN_TOKEN: 'fixture-policy-server-token',
    POLICY_WORKER: { fetch: async (request) => { sourceReads.push(new URL(request.url).pathname); return Response.json({ success: true }); } },
    OTA_BUCKET: { get: async (key) => { sourceReads.push(key); return null; }, put: async () => { throw new Error("unexpected fixture write"); } },
  };
  const paths = [
    ["/state", ["*"]],
    ["/history?channel=beta", ["releases:read", "audit:read"]],
    ["/ota-updates?channel=beta", ["releases:read"]],
    ["/releases/current?channel=beta", ["releases:read"]],
    ["/releases/staged?channel=beta&version=2.0.0", ["releases:write"]],
    ["/remote-config?channel=beta", ["policies:read"]],
    ["/policy/state", ["*"]],
    ["/policy/global-policy", ["policies:read"]],
    ["/policy/disabled-versions?page=2", ["policies:read"]],
    ["/policy/plan-features?plan=pro", ["policies:read"]],
    ["/commerce/overview", ["commerce:read"]],
    ["/commerce/configuration", ["commerce:read"]],
    ["/commerce/orders", ["commerce:read"]],
    ["/commerce/plans", ["commerce:read"]],
    ["/commerce/integrity", ["commerce:read"]],
  ];
  for (const role of roles) {
    const email = role + "@example.invalid";
    const context = adminContext(env, email);
    for (const [path, permissions] of paths) {
      sourceReads.length = 0;
      const response = await worker.fetch(new Request("https://admin.saturnws.com/api/admin" + path, {
        headers: { "cf-access-authenticated-user-email": email },
      }), env);
      if (!permissions.every((permission) => hasPermission(context, permission))) {
        assert.equal(response.status, 403, role + path);
        assert.deepEqual(sourceReads, [], role + path);
      } else {
        assert.equal(response.status, 200, role + path + " " + await response.clone().text());
      }
    }
  }
});

test("release readers see only release fields for the selected channel", async () => {
  const env = {
    ADMIN_EMAIL_ALLOWLIST: "release-reader@example.invalid",
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ "release-reader@example.invalid": "release_manager" }),
    OTA_BUCKET: {
      get: async () => ({ json: async () => ({
        remote_config: { private_setting: "fixture-private-setting" },
        channels: {
          stable: { version: "2.0.0", notes: "fixture-other-channel" },
          beta: { version: "2.1.0", notes: "Fixture beta notes", available: true,
            target_user_emails: ["fixture-private-target@example.invalid"], remote_config: { fixture: true },
            artifacts: { installed: { sha256: "fixture-checksum", filename: "fixture.zip", private_metadata: "fixture-private-artifact" } } },
        },
      }) }),
      put: async () => { throw new Error("unexpected fixture write"); },
    },
  };
  const response = await worker.fetch(new Request("https://admin.saturnws.com/api/admin/releases/current?channel=beta", {
    headers: { "cf-access-authenticated-user-email": "release-reader@example.invalid" },
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.item.version, "2.1.0");
  assert.equal(body.item.artifacts.installed.sha256, "fixture-checksum");
  assert.doesNotMatch(JSON.stringify(body), /fixture-private|fixture-other-channel|remote_config|target_user_emails/);
});

test("release reads retain disabled records and distinguish invalid or unavailable storage from an empty channel", async () => {
  const email = "release-reader@example.invalid";
  const baseEnv = { ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "release_manager" }) };
  const read = (bucket) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/releases/current?channel=beta", {
    headers: { "cf-access-authenticated-user-email": email },
  }), { ...baseEnv, OTA_BUCKET: bucket });
  const manifest = { channels: { beta: { version: "2.1.0", available: false, disabled: true,
    disabled_reason: "Fixture operational pause", published_at: "2026-11-14T12:00:00Z", notes: "Fixture release notes",
    artifacts: { installed: { filename: "fixture.zip", sha256: "fixture-checksum" } } } } };
  const bucket = (value) => ({ get: async () => ({ json: async () => value }), put: async () => { throw new Error("unexpected write"); } });
  const response = await read(bucket(manifest));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const { item } = await response.json();
  assert.equal(item.version, "2.1.0");
  assert.equal(item.disabled, true);
  assert.equal(item.available, false);
  assert.equal(item.disabled_reason, "Fixture operational pause");
  assert.equal(item.published_at, "2026-11-14T12:00:00Z");
  assert.equal(item.artifacts.installed.filename, "fixture.zip");
  const missing = await read({ get: async () => null, put: async () => { throw new Error("unexpected write"); } });
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).item.available, false);
  for (const invalid of [null, [], { channels: [] }, { channels: { beta: null } }, { channels: { beta: { available: "false" } } },
    { channels: { beta: { disabled: "true" } } }, { channels: { beta: { notes: {} } } },
    { channels: { beta: { published_at: "not-a-time" } } },
    { channels: { beta: { artifacts: { installed: { filename: {} } } } } }]) {
    const failure = await read(bucket(invalid));
    assert.equal(failure.status, 503, JSON.stringify(invalid));
    assert.deepEqual(await failure.json(), { success: false, error: "release_channel_unavailable" });
  }
  for (const unavailable of [undefined, { get: async () => { throw new Error("fixture-storage-offline"); }, put: async () => {} },
    { get: async () => ({ json: async () => { throw new SyntaxError("fixture-invalid-json"); } }), put: async () => {} }]) {
    assert.equal((await read(unavailable)).status, 503);
  }
});

test("administrative release writes never replace an unreadable manifest with a default baseline", async () => {
  const email = "super-admin@example.invalid";
  let writes = 0;
  const response = await worker.fetch(new Request("https://admin.saturnws.com/api/admin/remote-config", {
    method: "POST", headers: { "cf-access-authenticated-user-email": email, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "beta", update_mode: "optional" }),
  }), {
    ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "super_admin" }),
    OTA_BUCKET: { get: async () => ({ json: async () => { throw new SyntaxError("fixture-invalid-json"); } }), put: async () => { writes += 1; } },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, error: "release_channel_unavailable" });
  assert.equal(writes, 0);
});

test("release history cannot report an empty successful history when its archive source is unavailable", async () => {
  const email = "release-auditor@example.invalid";
  const response = await worker.fetch(new Request("https://admin.saturnws.com/api/admin/history?channel=beta", {
    headers: { "cf-access-authenticated-user-email": email },
  }), { ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "super_admin" }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, error: "release_channel_unavailable" });
});

test("public update checks retain their signed empty-baseline fallback without modifying storage", async () => {
  const signingKey = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const privateKey = await crypto.subtle.exportKey("pkcs8", signingKey.privateKey);
  let writes = 0;
  for (const bucket of [undefined, { get: async () => ({ json: async () => { throw new SyntaxError("fixture-invalid-json"); } }), put: async () => { writes += 1; } }]) {
    const response = await worker.fetch(new Request("https://updates.saturnws.com/latest.json"), {
      UPDATE_MANIFEST_PRIVATE_KEY_PEM: Buffer.from(privateKey).toString("base64"), OTA_BUCKET: bucket,
    });
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.equal(manifest.available, false);
    assert.ok(manifest.manifest_signature.length > 0);
  }
  assert.equal(writes, 0);
});

test("reviewed publication signs only the staged files that matched the review", async () => {
  const email = "release-manager@example.invalid";
  const objects = new Map();
  const writes = [];
  const signingKey = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = await crypto.subtle.exportKey("pkcs8", signingKey.privateKey);
  const env = {
    ADMIN_EMAIL_ALLOWLIST: email,
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "release_manager" }),
    UPDATE_MANIFEST_PRIVATE_KEY_PEM: Buffer.from(privateKey).toString("base64"),
    OTA_BUCKET: {
      get: async (key) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)) } : null,
      put: async (key, value) => { writes.push(key); objects.set(key, value); },
    },
  };
  const request = (path, body) => {
    const headers = { "cf-access-authenticated-user-email": email };
    const init = body === undefined ? { headers } : {
      headers, method: "POST", body: body instanceof FormData ? body : JSON.stringify(body),
    };
    return worker.fetch(new Request("https://admin.saturnws.com/api/admin" + path, init), env);
  };
  const stagedPath = "/releases/staged?channel=beta&version=2.0.0";
  const publishPath = "/releases/publish-reviewed";
  const payload = { channel: "beta", version: "2.0.0", notes: "Fixture release" };
  const revisionOf = (artifacts) => ({
    installed: artifacts.installed?.revision ?? null, portable: artifacts.portable?.revision ?? null,
  });
  const stage = async () => {
    const response = await request(stagedPath);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return (await response.json()).artifacts;
  };
  const upload = async (kind, name, bytes) => {
    const form = new FormData();
    form.set("channel", "beta");
    form.set("version", "2.0.0");
    form.set("artifact_type", kind);
    form.set("file", new File([Uint8Array.from(bytes)], name));
    const response = await request("/upload", form);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  assert.deepEqual(await stage(), { installed: null, portable: null });
  objects.set("meta/beta/1.9.0.json", JSON.stringify({
    key: "releases/beta/1.9.0/portable/old_fixture.exe", filename: "old_fixture.exe", sha256: "a".repeat(64), size: 3,
  }));
  const legacy = await (await request(stagedPath.replace("2.0.0", "1.9.0"))).json();
  assert.equal(legacy.artifacts.portable.filename, "old_fixture.exe");
  assert.equal(legacy.artifacts.installed, null);
  assert.equal((await request(stagedPath.replace("beta", "invalid"))).status, 400);
  assert.equal((await request(publishPath, payload)).status, 400);
  assert.equal((await request(publishPath, { ...payload, reviewed_artifacts: { installed: null } })).status, 400);
  assert.deepEqual(writes, []);

  const installed = await upload("installed", "fixture.zip", [80, 75, 3, 4, 0]);
  const initial = await stage();
  assert.deepEqual(initial.installed, installed.staged_artifact);
  assert.deepEqual(Object.keys(initial.installed).sort(), ["filename", "revision", "size_bytes"]);
  assert.doesNotMatch(JSON.stringify(initial), /release-manager|releases\//);
  const portable = await upload("portable", "fixture.exe", [77, 90, 1]);
  const beforeConflict = writes.length;
  let response = await request(publishPath, { ...payload, reviewed_artifacts: revisionOf(initial) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "reviewed_release_artifacts_changed");
  assert.equal(writes.length, beforeConflict, "an added file is rejected before any write");

  const reviewed = await stage();
  const replacement = await upload("installed", "fixture.zip", [80, 75, 3, 4, 1]);
  assert.notEqual(replacement.release.key, installed.release.key);
  assert.notEqual(replacement.staged_artifact.revision, installed.staged_artifact.revision);
  response = await request(publishPath, { ...payload, reviewed_artifacts: revisionOf(reviewed) });
  assert.equal(response.status, 409, "same filename with different content also requires review");
  assert.equal(objects.has("updates/latest.json"), false);

  const current = await stage();
  response = await request(publishPath, { ...payload, update_mode: "required", reviewed_artifacts: revisionOf(current) });
  assert.equal(response.status, 200, await response.clone().text());
  const manifest = (await response.json()).manifest;
  assert.ok(manifest.manifest_signature);
  assert.equal(manifest.channels.beta.mandatory, true);
  assert.equal(manifest.channels.beta.artifacts.installed.sha256, replacement.release.sha256);
  assert.equal(manifest.channels.beta.artifacts.portable.sha256, portable.release.sha256);
  assert.ok(manifest.channels.beta.artifacts.installed.url.endsWith(encodeURIComponent(replacement.release.key)));
});

test("dashboard distinguishes unavailable sources from confirmed zero counts", async (t) => {
  const reads = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    const table = url.pathname.split("/").at(-1);
    reads.push(table);
    if (table === "account_profiles") {
      return Response.json({ message: "Could not find public.account_profiles in the schema cache" }, { status: 404 });
    }
    if (table === "app_sessions") {
      return new Response(null, { headers: { "Content-Range": "*/*" } });
    }
    assert.notEqual(table, "crash_logs", "overview does not load diagnostics without its separate permission");
    const headers = { "Content-Range": "*/0" };
    return init.method === "HEAD" ? new Response(null, { headers }) : Response.json([], { headers });
  });
  const env = {
    ADMIN_API_TOKEN: "synthetic-dashboard-token",
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-dashboard-service-key",
  };
  const url = "https://admin.saturnws.com/api/admin/dashboard";
  const denied = await worker.fetch(new Request(url), env);
  assert.notEqual(denied.status, 200);
  assert.deepEqual(reads, []);

  const response = await worker.fetch(new Request(url, {
    headers: { Authorization: "Bearer synthetic-dashboard-token" },
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.degraded_resources, ["profiles", "sessions"]);
  assert.deepEqual(body.kpis, {
    total_users: null,
    total_active_users: 0,
    active_sessions: null,
    active_tampering_alerts: 0,
    total_revenue: null,
  });
  assert.equal(reads.length, 5);
});

test("audit history searches the canonical source and uses the exact timestamp and ID cursor", async (t) => {
  const sameTime = "2026-11-09T12:00:00.123456+00:00";
  const one = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", happened_at: sameTime, action: "account_suspend", admin_email: "synthetic-admin@example.invalid", request_id: "req_1", reason_code: "security_review" };
  const two = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", happened_at: sameTime, action: "account_restore", outcome: "completed" };
  let mode = "first";
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    assert.equal(url.pathname, "/rest/v1/admin_activity");
    assert.equal(url.searchParams.get("order"), "happened_at.desc,id.desc");
    assert.equal(url.searchParams.get("limit"), "2");
    assert(!url.searchParams.get("select").split(",").includes("payload"));
    const query = url.searchParams.get("and");
    assert(query.includes("payload->>request_id.ilike."));
    assert(query.includes(JSON.stringify("%req\\_1%")));
    reads++;
    if (mode === "failed") return Response.json({ message: "private-synthetic-source-detail" }, { status: 503 });
    if (mode === "empty") return Response.json([]);
    if (mode === "next") {
      assert(query.includes("happened_at.lt." + sameTime));
      assert(query.includes("id.lt." + one.id));
      return Response.json([two]);
    }
    return Response.json([one, two]);
  });
  const env = {
    ADMIN_API_TOKEN: "synthetic-audit-token",
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-audit-service-key",
    ADMIN_EMAIL_ALLOWLIST: "support@example.invalid",
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ "support@example.invalid": "support" }),
    OTA_BUCKET: { get: () => assert.fail("audit reads must not fall back to the OTA backup"), put() {}, delete() {} },
  };
  const base = "https://admin.saturnws.com/api/admin/audit-log";
  const headers = { Authorization: "Bearer synthetic-audit-token" };
  const read = (extra = {}) => worker.fetch(new Request(base + "?" + new URLSearchParams({ search: "req_1", limit: "1", ...extra }), { headers }), env);
  const denied = await worker.fetch(new Request(base, { headers: { "cf-access-authenticated-user-email": "support@example.invalid" } }), env);
  assert.equal(denied.status, 403);
  assert.equal((await read({ cursor: "invalid" })).status, 400);
  assert.equal(reads, 0);
  const first = await (await read()).json();
  assert.equal(first.items[0].id, one.id);
  assert.equal(first.items[0].outcome, undefined, "the absence of an outcome is not success");
  assert.equal(first.has_more, true);
  mode = "next";
  const next = await (await read({ cursor: first.next_cursor })).json();
  assert.equal(next.items[0].id, two.id);
  assert.equal(next.items[0].outcome, "completed");
  assert.equal(next.next_cursor, null);
  mode = "empty";
  assert.deepEqual((await (await read()).json()).items, []);
  mode = "failed";
  const failed = await read();
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { success: false, error: "audit_unavailable" });
});

test("dashboard omits audit activity and tamper counts without their permissions", async (t) => {
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.notEqual(url.pathname, "/rest/v1/admin_activity");
    assert.notEqual(url.pathname, "/rest/v1/tamper_alerts");
    const headers = { "Content-Range": "*/0" };
    return init.method === "HEAD" ? new Response(null, { headers }) : Response.json([], { headers });
  });
  const env = {
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-dashboard-service-key",
    ADMIN_EMAIL_ALLOWLIST: "support@example.invalid",
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ "support@example.invalid": "support" }),
  };
  const response = await worker.fetch(new Request("https://admin.saturnws.com/api/admin/dashboard", {
    headers: { "cf-access-authenticated-user-email": "support@example.invalid" },
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.recent_activity, []);
  assert.equal(body.kpis.active_tampering_alerts, null);
});

test("account detail reads only audit entries for that account and only with audit permission", async (t) => {
  let auditReads = 0;
  let unavailable = false;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    if (url.pathname.endsWith("/account_profiles")) return Response.json([{ firebase_uid: "synthetic-account", normalized_email: "account@example.invalid" }]);
    if (url.pathname.endsWith("/admin_activity")) {
      auditReads++;
      assert.equal(url.searchParams.get("limit"), "50");
      assert.equal(url.searchParams.get("or"), '(entity_id.eq."synthetic-account",payload->>firebase_uid.eq."synthetic-account",payload->>target_firebase_uid.eq."synthetic-account")');
      if (unavailable) return Response.json({}, { status: 503 });
      return Response.json([{ id: "fixture-audit-id", action: "account_suspend", entity_id: "synthetic-account" }]);
    }
    return Response.json([]);
  });
  const env = {
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-audit-service-key",
    ADMIN_EMAIL_ALLOWLIST: "support@example.invalid,auditor@example.invalid",
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ "support@example.invalid": "support", "auditor@example.invalid": "security_auditor" }),
  };
  const read = (role) => worker.fetch(new Request("https://admin.saturnws.com/api/admin/users/synthetic-account", {
    headers: { "cf-access-authenticated-user-email": role + "@example.invalid" },
  }), env);
  const support = await read("support");
  assert.equal(support.status, 200);
  assert.equal((await support.json()).audit, null);
  assert.equal(auditReads, 0);
  const auditor = await read("auditor");
  assert.equal(auditor.status, 200);
  assert.equal((await auditor.json()).audit[0].id, "fixture-audit-id");
  assert.equal(auditReads, 1);
  unavailable = true;
  assert.equal((await (await read("auditor")).json()).audit, null);
});

test("dashboard counts existing records beyond old caps and never projects incomplete subscription rows", async (t) => {
  const totals = { account_profiles: 1203, app_sessions: 2100, tamper_alerts: 321 };
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const subscription = (id, uid, fields = {}) => ({ id, firebase_user_id: uid, status: "active", starts_at: past, expires_at: future, ...fields });
  const records = [
    subscription("active", "synthetic-active"),
    subscription("grace", "synthetic-grace", { lifecycle_state: "past_due", meta_grace_ends_at: future }),
    subscription("paid-later", "synthetic-not-in-grace", { lifecycle_state: "past_due", grace_ends_at: past }),
    subscription("future", "synthetic-future", { period_start_at: future }),
    subscription("expired", "synthetic-expired", { period_end_at: past }),
    subscription("ambiguous-1", "synthetic-conflict"),
    subscription("ambiguous-2", "synthetic-conflict"),
    subscription("legacy", "synthetic-legacy", { expires_at: past, meta_is_unlimited: true }),
  ];
  let incomplete = false;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    const table = url.pathname.split("/").at(-1);
    if (table === "admin_activity") {
      assert.equal(url.searchParams.get("limit"), "20");
      return Response.json([]);
    }
    assert.equal(new Headers(init.headers).get("Prefer"), "count=exact");
    if (table === "account_subscriptions") {
      assert.equal(init.method ?? "GET", "GET");
      assert.equal(url.searchParams.get("firebase_user_id"), "not.is.null");
      assert.equal(url.searchParams.get("limit"), "1000");
      assert.match(url.searchParams.get("select"), /meta_grace_ends_at:metadata->grace_ends_at/);
      assert(!url.searchParams.get("select").split(",").includes("metadata"));
      return Response.json(records, { status: incomplete ? 206 : 200, headers: { "Content-Range": `0-${records.length - 1}/${incomplete ? 1100 : records.length}` } });
    }
    assert.equal(init.method, "HEAD");
    assert.equal(url.searchParams.get("limit"), "1");
    assert.ok(table in totals);
    if (table === "app_sessions") {
      assert.equal(url.searchParams.get("revoked_at"), "is.null");
      assert.match(url.searchParams.get("expires_at"), /^gt\.\d{4}-\d{2}-\d{2}T/);
    }
    if (table === "tamper_alerts") assert.equal(url.searchParams.get("resolved"), "is.false");
    return new Response(null, { status: 206, headers: { "Content-Range": `0-0/${totals[table]}` } });
  });
  const env = {
    ADMIN_API_TOKEN: "synthetic-dashboard-token",
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-dashboard-service-key",
  };
  const request = () => new Request("https://admin.saturnws.com/api/admin/dashboard", {
    headers: { Authorization: "Bearer synthetic-dashboard-token" },
  });
  const available = await (await worker.fetch(request(), env)).json();
  assert.deepEqual(available.kpis, { total_users: 1203, total_active_users: 3, active_sessions: 2100, active_tampering_alerts: 321, total_revenue: null });
  assert.deepEqual(available.degraded_resources, []);
  assert.equal(available.subscription_count_limited, false);
  assert.doesNotMatch(JSON.stringify(available), /synthetic-(?:active|grace|legacy)/);

  incomplete = true;
  const limited = await (await worker.fetch(request(), env)).json();
  assert.equal(limited.kpis.total_active_users, null);
  assert.equal(limited.kpis.active_sessions, 2100);
  assert.equal(limited.subscription_count_limited, true);
  assert.deepEqual(limited.degraded_resources, []);
});

test("data coverage returns only aggregate recent diagnostic counts and an exact report-window size", async (t) => {
  const parent = "11111111-1111-4111-8111-111111111111";
  const run = "22222222-2222-4222-8222-222222222222";
  const now = new Date().toISOString();
  const row = (n, overrides = {}) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`,
    happened_at: now, app_version: "1.2.32", tool_channel: "beta", message: "synthetic", error_type: "SyntheticFailure",
    ...overrides,
  });
  const rows = [
    row(1, { message: "private-synthetic-message", stack_trace: "private-synthetic-stack" }),
    row(2, { stack_trace: "WinError 10060", occurrence_count: 50 }),
    row(3, { app_version: "2026.11.05.1", tool_channel: "android-beta" }),
    row(4, { message: "account_not_found" }),
    row(5, { error_type: "DiagnosticTraceFollowup", trace_format: "saturnws.technical-trace.v1", trace_run: run, trace_parent: parent }),
    row(6, { app_version: "private-synthetic-token", tool_channel: "private-synthetic-channel" }),
  ];
  let readCount = 0;
  let mode = "sample";
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    assert.equal(url.pathname, "/rest/v1/crash_logs");
    assert.equal(new Headers(init.headers).get("Prefer"), "count=exact");
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.searchParams.get("order"), "happened_at.desc,id.desc");
    const [from, to] = url.searchParams.getAll("happened_at");
    assert.match(from, /^gte\./);
    assert.match(to, /^lte\./);
    assert.equal(Date.parse(to.slice(4)) - Date.parse(from.slice(4)), 30 * 86400000);
    assert.doesNotMatch(url.searchParams.get("select"), /\b(user_id|hwid|device_name|operator_id|occurrences)\b/);
    readCount++;
    if (mode === "missing-range") return Response.json([]);
    if (mode === "empty") return Response.json([], { headers: { "Content-Range": "*/0" } });
    return Response.json(rows, { status: 206, headers: { "Content-Range": "0-5/126" } });
  });
  const env = { ADMIN_API_TOKEN: "synthetic-coverage-token", SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-coverage-service-key" };
  const base = "https://admin.saturnws.com/api/admin/diagnostic-coverage";
  const headers = { Authorization: "Bearer synthetic-coverage-token" };
  const read = (params = "days=30") => worker.fetch(new Request(`${base}?${params}`, { headers }), env);
  assert.equal((await worker.fetch(new Request(base), env)).status, 401);
  assert.equal((await read("days=365")).status, 400);
  assert.equal(readCount, 0);
  const response = await read();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.totals, { errors: 3, warnings: 1 });
  assert.equal(body.window.days, 30);
  assert.equal(body.window.scanned_reports, 6);
  assert.equal(body.window.total_records, 126);
  assert.equal(body.window.limited, true);
  assert.equal(body.window.oldest_scanned_at, now);
  assert.deepEqual(body.versions.map(({ tool_channel, app_version, errors, warnings, latest_report_id }) =>
    [tool_channel, app_version, errors, warnings, latest_report_id]), [
    ["beta", "1.2.32", 1, 1, row(1).id],
    ["android-beta", "2026.11.05.1", 1, 0, row(3).id],
    [null, null, 1, 0, row(6).id],
  ]);
  assert.doesNotMatch(JSON.stringify(body), /private-synthetic|account_not_found|WinError/);
  mode = "missing-range";
  assert.equal((await read()).status, 503);
  mode = "empty";
  const empty = await (await read()).json();
  assert.deepEqual(empty.totals, { errors: 0, warnings: 0 });
  assert.equal(empty.window.limited, false);
  assert.deepEqual(empty.versions, []);
});

test("diagnostic coverage honors custom UTC boundaries without reading expired or future records", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T14:00:00.000Z") });
  const periods = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/rest/v1/crash_logs");
    periods.push(url.searchParams.getAll("happened_at"));
    return Response.json([], { headers: { "Content-Range": "*/0" } });
  });
  const env = { ADMIN_API_TOKEN: "synthetic-coverage-token", SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-coverage-service-key" };
  const base = "https://admin.saturnws.com/api/admin/diagnostic-coverage";
  const headers = { Authorization: "Bearer synthetic-coverage-token" };
  const read = (params) => worker.fetch(new Request(`${base}?${new URLSearchParams(params)}`, { headers }), env);
  const sameDay = await read({ from: "2026-11-07T22:00:00.000Z", to: "2026-11-08T22:00:00.000Z" });
  assert.equal(sameDay.status, 200);
  assert.deepEqual(periods.pop(), ["gte.2026-11-07T22:00:00.000Z", "lt.2026-11-08T22:00:00.000Z"]);

  const clamped = await read({ from: "2026-08-01T22:00:00.000Z", to: "2026-11-10T22:00:00.000Z" });
  assert.equal(clamped.status, 200);
  assert.equal((await clamped.json()).window.retention_limited, true);
  assert.deepEqual(periods.pop(), ["gte.2026-08-12T14:00:00.000Z", "lte.2026-11-10T14:00:00.000Z"]);

  for (const params of [
    { from: "2026-11-09T22:00:00.000Z" },
    { from: "2026-11-09", to: "2026-11-10" },
    { from: "2026-11-10T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" },
    { from: "2026-11-11T00:00:00.000Z", to: "2026-11-11T22:00:00.000Z" },
    { from: "2026-08-11T00:00:00.000Z", to: "2026-08-12T00:00:00.000Z" },
    { from: "2026-11-10T00:00:00.000Z", to: "2026-11-10T22:00:00.000Z", days: "7" },
  ]) {
    assert.equal((await read(params)).status, 400);
  }
  assert.deepEqual(periods, []);
});

test("diagnostic triage separates recent activity from review status in the same bounded report window", async (t) => {
  const fp = { open: "a".repeat(64), resolved: "b".repeat(64), ignored: "c".repeat(64) };
  const asOf = new Date(Date.now() - 5000).toISOString();
  const now = new Date(Date.now() - 10000).toISOString();
  const uid = "synthetic-operator";
  const row = (n, overrides = {}) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`,
    error_type: "SyntheticFailure", message: "synthetic", happened_at: now, fingerprint: fp.open,
    ...overrides,
  });
  const rows = [
    row(1, { auth_source: "app_session", attribution: "verified", operator_id: uid, occurrences: "3" }),
    row(2, { auth_source: "app_session", attribution: "verified", operator_id: uid, occurrences: "2", last_seen: asOf }),
    row(3, { fingerprint: fp.resolved }),
    row(4, { fingerprint: fp.ignored }),
    row(5, { fingerprint: null, component: "saturn-android", context: "android.work_session" }),
    row(6, { message: "account_not_found" }),
    row(7, { error_type: "DiagnosticTraceFollowup", trace_format: "saturnws.technical-trace.v1", trace_run: row(8).id, trace_parent: row(9).id }),
    ...Array.from({ length: 94 }, (_, n) => row(100 + n, { severity: "warning" })),
  ];
  let failure = "";
  let readCount = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    readCount++;
    if (url.pathname.endsWith("/crash_logs")) {
      if (failure === "reports") return Response.json({ message: "missing public.crash_logs in schema cache" }, { status: 404 });
      assert.equal(url.searchParams.get("limit"), "101");
      assert.deepEqual(url.searchParams.getAll("happened_at").map((value) => value.slice(0, 4)), ["lte.", "gte."]);
      assert.equal(url.searchParams.getAll("happened_at")[0], `lte.${asOf}`);
      assert.match(url.searchParams.get("select"), /trace_parent:raw_payload->trace->>parent_event_id/);
      assert(!url.searchParams.get("select").split(",").includes("raw_payload"));
      return Response.json(rows);
    }
    assert.ok(url.pathname.endsWith("/admin_crash_group_state"));
    if (failure === "states") return Response.json({ message: "missing public.admin_crash_group_state in schema cache" }, { status: 404 });
    return Response.json([{ fingerprint: fp.open, status: "investigating" }, { fingerprint: fp.resolved, status: "resolved" }, { fingerprint: fp.ignored, status: "ignored" }]);
  });
  const env = { ADMIN_API_TOKEN: "synthetic-triage-token", SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-triage-service-key" };
  const endpoint = "https://admin.saturnws.com/api/admin/diagnostic-triage";
  const request = (extra = "") => worker.fetch(new Request(`${endpoint}?as_of=${encodeURIComponent(asOf)}${extra}`, { headers: { Authorization: "Bearer synthetic-triage-token" } }), env);
  assert.equal((await worker.fetch(new Request(endpoint), env)).status, 401);
  assert.equal(readCount, 0);
  const summary = await (await request("&summary=true")).json();
  const details = await (await request()).json();
  assert.deepEqual(summary.counts, { recent: 4, attention: 2 });
  assert.deepEqual(summary.counts, details.counts);
  assert.deepEqual(summary.items, []);
  assert.deepEqual(details.window, { as_of: asOf, scan_limit: 100, scanned_reports: 100, matched_error_reports: 5, has_older: true });
  const investigating = details.items.find((item) => item.fingerprint === fp.open);
  assert.equal(investigating.latest_report_id, row(2).id);
  assert.equal(investigating.count, 5);
  assert.equal(investigating.affected_user_count, 1);
  assert(!JSON.stringify(details).includes(uid));
  for (const source of ["states", "reports"]) {
    failure = source;
    const response = await request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, error: "diagnostics_unavailable" });
  }
});

test("support inbox forwards filters only after authorization and rejects old or unavailable responses", async () => {
  const seen = [];
  let upstream = () => Response.json({ success: true, threads: [], page: 2, limit: 5, has_more: false });
  const env = {
    ADMIN_API_TOKEN: "synthetic-admin-inbox-token",
    POLICY_ADMIN_TOKEN: "synthetic-policy-inbox-token",
    POLICY_WORKER: { fetch: async (request) => {
      seen.push(new URL(request.url));
      assert.equal(request.headers.get("Authorization"), "Bearer synthetic-policy-inbox-token");
      return upstream();
    } },
  };
  const url = "https://admin.saturnws.com/api/admin/policy/support?view=inbox&scope=waiting&page=2&limit=5";
  const headers = { Authorization: "Bearer synthetic-admin-inbox-token" };
  assert.equal((await worker.fetch(new Request(url), env)).status, 401);
  assert.equal(seen.length, 0);

  const response = await worker.fetch(new Request(url, { headers }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(seen[0].pathname, "/v1/admin/support");
  assert.equal(seen[0].search, new URL(url).search);

  upstream = () => Response.json({ success: true, threads: [] });
  assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 503);
  upstream = () => Response.json({ success: false, error: "support_inbox_unavailable" }, { status: 503 });
  assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 503);
  upstream = () => Response.json({ success: false, error: "thread_not_found" }, { status: 404 });
  assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 404);
  upstream = () => new Response("<html>Service unavailable</html>", { status: 502 });
  const unavailable = await worker.fetch(new Request(`${url}&query=private-example`, { headers }), env);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { success: false, error: "support_inbox_unavailable" });
});

test("support history and receipts are authorized, private, scoped, and fail explicitly", async () => {
  const root = "https://admin.saturnws.com/api/admin/policy/support/";
  const seen = [];
  let failure = false;
  const env = {
    ADMIN_API_TOKEN: "synthetic-support-admin",
    POLICY_ADMIN_TOKEN: "synthetic-support-policy",
    POLICY_WORKER: { fetch: async (request) => {
      assert.equal(request.headers.get("Authorization"), "Bearer synthetic-support-policy");
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : null;
      seen.push({ url, body });
      if (failure) return new Response("<html>upstream private fixture</html>", { status: 502 });
      return Response.json({ success: true, ...(url.pathname.endsWith("/history") ? { events: [] } : { unread_message_ids: [] }) });
    } },
  };
  const receipt = { thread_id: "fixture-thread", message_ids: ["fixture-message"] };
  const post = { method: "POST", body: JSON.stringify(receipt) };
  const paths = ["conversation?thread_id=fixture-thread", "history?thread_id=fixture-thread&cursor=fixture-event"];
  for (const path of paths) assert.equal((await worker.fetch(new Request(root + path), env)).status, 401);
  assert.equal((await worker.fetch(new Request(root + "read", post), env)).status, 401);
  assert.equal(seen.length, 0);
  const headers = { Authorization: "Bearer synthetic-support-admin" };
  for (const path of paths) {
    const response = await worker.fetch(new Request(root + path, { headers }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(seen.at(-1).url.pathname + seen.at(-1).url.search, "/v1/admin/support/" + path);
  }
  assert.equal((await worker.fetch(new Request(root + "read", { ...post, headers }), env)).status, 200);
  assert.deepEqual(seen.at(-1).body, receipt);
  assert.equal((await worker.fetch(new Request(root + "read", { method: "POST", headers, body: "x".repeat(20_001) }), env)).status, 400);
  assert.equal(seen.length, 3);
  failure = true;
  for (const [path, init, error] of [
    [paths[0], { headers }, "support_inbox_unavailable"],
    [paths[1], { headers }, "support_history_unavailable"],
    ["read", { ...post, headers }, "support_read_unavailable"],
  ]) {
    const response = await worker.fetch(new Request(root + path, init), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, error });
  }
});

test("device request reads page deterministically, load exact historical IDs, and do not disclose private fields", async (t) => {
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const item = { id, firebase_uid: "fixture-user", status: "approved", requested_hwid_hash: "private-fixture", resolution_request_id: "private-operation" };
  const reads = [];
  let fail = false;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    assert.equal(init.method, "GET");
    reads.push(url);
    if (url.pathname.endsWith("account_profiles")) return Response.json([{ firebase_uid: "fixture-user", normalized_email: "fixture@example.test" }]);
    if (fail) return Response.json({ message: "provider-internal-fixture" }, { status: 503 });
    if (url.searchParams.has("id")) return Response.json(url.searchParams.get("id") === `eq.${id}` ? [item] : []);
    return Response.json([item, { ...item, id: otherId }]);
  });
  const env = { ADMIN_API_TOKEN: "fixture-device-reader", SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" };
  const endpoint = "https://admin.saturnws.com/api/admin/device-change-requests";
  const headers = { Authorization: "Bearer fixture-device-reader" };
  assert.equal((await worker.fetch(new Request(`${endpoint}/${id}`), env)).status, 401);
  assert.equal((await worker.fetch(new Request(`${endpoint}/not-an-id`, { headers }), env)).status, 404);
  assert.equal(reads.length, 0);

  const detail = await worker.fetch(new Request(`${endpoint}/${id}`, { headers }), env);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("Cache-Control"), "no-store");
  const { item: details } = await detail.json();
  assert.equal(details.id, id);
  assert.equal(details.status, "approved");
  assert.equal(details.account.normalized_email, "fixture@example.test");
  assert(!("requested_hwid_hash" in details) && !("resolution_request_id" in details));
  assert.equal(reads[0].searchParams.get("id"), `eq.${id}`);
  assert(!reads[0].searchParams.has("status"));

  const list = await worker.fetch(new Request(`${endpoint}?status=approved&page=2&limit=1`, { headers }), env);
  const page = await list.json();
  assert.equal(page.items.length, 1);
  assert.equal(page.has_more, true);
  assert(!("requested_hwid_hash" in page.items[0]) && !("resolution_request_id" in page.items[0]));
  assert.equal(reads[2].searchParams.get("order"), "requested_at.desc,id.desc");
  assert.equal(reads[2].searchParams.get("limit"), "2");
  assert.equal(reads[2].searchParams.get("offset"), "1");
  assert.equal((await worker.fetch(new Request(`${endpoint}/${otherId}`, { headers }), env)).status, 404);

  fail = true;
  const unavailable = await worker.fetch(new Request(`${endpoint}/${id}`, { headers }), env);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { success: false, error: "device_change_requests_unavailable" });
});

test("device change decisions reject stale previews and replay a completed operation without another write", async (t) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let record = {
    id, firebase_uid: "fixture-device-owner", status: "pending",
    current_binding_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    requested_device_key: "0123456789abcdef", updated_at: "2026-11-14T10:00:00Z",
  };
  const resolutions = [];
  let auditWrites = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://supabase.example.invalid");
    if (url.pathname.endsWith("/account_device_change_requests")) {
      assert.equal(init.method, "GET");
      assert.equal(url.searchParams.get("id"), "eq." + id);
      return Response.json([record]);
    }
    if (url.pathname.endsWith("/account_profiles")) return Response.json([{ firebase_uid: record.firebase_uid, normalized_email: "owner@example.test" }]);
    if (url.pathname.endsWith("/rpc/resolve_account_device_change")) {
      const body = JSON.parse(init.body);
      resolutions.push(body);
      assert.equal(body.p_expected_updated_at, record.updated_at);
      record = { ...record, status: body.p_action === "approve" ? "approved" : "rejected",
        resolution_request_id: body.p_resolution_request_id, resolved_by: body.p_actor,
        resolution_note: body.p_resolution_note, updated_at: "2026-11-14T12:00:00Z" };
      return Response.json([record]);
    }
    if (url.pathname.endsWith("/admin_activity")) {
      assert.equal(init.method, "POST");
      auditWrites += 1;
      return Response.json([{ id: JSON.parse(init.body).id }]);
    }
    throw new Error("Unexpected fixture request: " + url.pathname);
  });
  const env = { ADMIN_API_TOKEN: "synthetic-device-decider", SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-device-service" };
  const headers = { Authorization: "Bearer synthetic-device-decider", "Content-Type": "application/json" };
  const endpoint = "https://admin.saturnws.com/api/admin/device-change-requests/" + id;
  const post = (step, body) => worker.fetch(new Request(endpoint + "/" + step, {
    method: "POST", headers, body: JSON.stringify(body),
  }), env);
  const input = { action: "approve", reason: "Owner confirmed the replacement." };
  const initial = await post("preview", input);
  assert.equal(initial.status, 200);
  const { preview } = await initial.json();
  assert.match(preview.preview_hash, /^[a-f0-9]{64}$/);
  assert.equal(resolutions.length, 0);
  const operation = { ...input, preview_hash: preview.preview_hash, request_id: "synthetic-device-decision-one" };
  record.updated_at = "2026-11-14T11:00:00Z";
  const stale = await post("execute", operation);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "preview_changed");
  assert.equal(resolutions.length, 0);
  const current = await (await post("preview", input)).json();
  operation.preview_hash = current.preview.preview_hash;
  const executed = await post("execute", operation);
  assert.equal(executed.status, 200);
  const { result } = await executed.json();
  assert.equal(result.item.status, "approved");
  assert.equal(result.idempotent, false);
  assert.equal(resolutions.length, 1);
  assert.equal(auditWrites, 1);
  assert.equal("resolution_request_id" in result.item, false);
  const replayed = await post("execute", operation);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).result.idempotent, true);
  assert.equal(resolutions.length, 1);
  assert.equal(auditWrites, 1);
  const otherOperation = await post("execute", { ...operation, request_id: "synthetic-device-decision-two" });
  assert.equal(otherOperation.status, 409);
  assert.equal((await otherOperation.json()).error, "device_change_request_not_pending");
  assert.equal(resolutions.length, 1);
});

test("device unlink checks the reviewed binding atomically, counts exact unexpired sessions, and replays only the same operation", async (t) => {
  const binding = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", firebase_uid: "fixture-device-owner", device_name: "Fixture PC", status: "active", updated_at: "2026-11-09T09:00:00.123456+00:00" };
  const uid = binding.firebase_uid;
  const calls = [];
  let mode = "normal";
  let completed = null;
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const table = url.pathname.split("/").at(-1);
    calls.push({ table, method: init.method || "GET" });
    if (table === "account_device_events") {
      assert.equal(url.searchParams.get("firebase_uid"), "eq." + uid);
      assert.equal(url.searchParams.get("details->>request_id"), "eq.fixture-unlink-operation");
      return Response.json(completed ? [completed] : []);
    }
    if (table === "account_device_bindings") return Response.json([binding]);
    if (table === "app_sessions") {
      assert.equal(init.method, "HEAD");
      assert.equal(url.searchParams.get("user_id"), "eq." + uid);
      assert.equal(url.searchParams.get("revoked_at"), "is.null");
      assert.match(url.searchParams.get("expires_at"), /^gt\.\d{4}-/);
      if (mode === "count-unavailable") return new Response(null, { headers: { "Content-Range": "*/*" } });
      return new Response(null, { headers: { "Content-Range": "*/513" } });
    }
    assert.equal(table, "reset_account_device");
    const body = JSON.parse(init.body);
    assert.equal(body.p_firebase_uid, uid);
    assert.equal(body.p_expected_binding_id, binding.id);
    assert.equal(body.p_expected_binding_updated_at, binding.updated_at);
    assert.match(body.p_preview_hash, /^[a-f0-9]{64}$/);
    if (mode === "binding-replaced") return Response.json({ message: "preview_changed" }, { status: 400 });
    completed = { id: "fixture-completed", binding_id: binding.id, actor_id: body.p_actor,
      details: { reason: body.p_reason, request_id: body.p_request_id, preview_hash: body.p_preview_hash } };
    return Response.json({ reset: true, idempotent: false });
  });
  const env = { ADMIN_API_TOKEN: "fixture-unlink-token", SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" };
  const post = (path, body, authenticated = true) => worker.fetch(new Request("https://admin.saturnws.com/api/admin" + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer fixture-unlink-token" } : {}) },
    body: JSON.stringify(body),
  }), env);
  const endpoint = `/users/${uid}/device/reset`;
  assert.equal((await post(endpoint + "/preview", {}, false)).status, 401);
  for (const legacy of ["/subscriptions/fixture-sub/reset-hwid", "/licenses/fixture-sub/reset-hwid"]) {
    const refused = await post(legacy, {});
    assert.equal(refused.status, 410);
    assert.equal((await refused.json()).error, "account_device_workflow_required");
  }
  assert.deepEqual(calls, []);
  const reviewed = await post(endpoint + "/preview", { reason: "Customer request" });
  assert.equal(reviewed.status, 200);
  const { preview } = await reviewed.json();
  assert.equal(preview.active_session_count, 513);
  const input = { reason: "Customer request", preview_hash: preview.preview_hash, request_id: "fixture-unlink-operation" };
  mode = "binding-replaced";
  assert.equal((await post(endpoint + "/execute", input)).status, 409);
  assert.equal(completed, null);
  mode = "normal";
  assert.deepEqual((await (await post(endpoint + "/execute", input)).json()).result, { reset: true, idempotent: false });
  const afterSuccess = calls.length;
  binding.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const replay = await post(endpoint + "/execute", input);
  assert.deepEqual((await replay.json()).result, { reset: true, idempotent: true });
  assert.deepEqual(calls.slice(afterSuccess), [{ table: "account_device_events", method: "GET" }]);
  assert.equal((await post(endpoint + "/execute", { ...input, reason: "Different request" })).status, 409);
  assert.equal((await post(endpoint + "/execute", { ...input, preview_hash: "f".repeat(64) })).status, 409);
  mode = "count-unavailable";
  const unavailable = await post(endpoint + "/preview", { reason: "Customer request" });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { success: false, error: "device_reset_unavailable" });
});

test("durable current subscription state is separate from entitlement projection", () => {
  const rows = subscriptionRowsWithProjection([
    {
      id: "11111111-1111-4111-8111-111111111111",
      firebase_user_id: "firebase-user-1",
      is_current: true,
      lifecycle_state: "active",
      status: "active",
      plan_term: "monthly",
      starts_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-02-01T00:00:00.000Z",
      period_end_at: "2026-02-01T00:00:00.000Z",
      integrity_state: "ok",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      firebase_user_id: "firebase-user-1",
      is_current: false,
      lifecycle_state: "cancelled",
      status: "canceled",
      plan_term: "monthly",
      starts_at: "2025-01-01T00:00:00.000Z",
      expires_at: "2025-02-01T00:00:00.000Z",
      period_end_at: "2025-02-01T00:00:00.000Z",
      integrity_state: "ok",
      created_at: "2025-01-01T00:00:00.000Z",
    },
  ]);

  assert.equal(rows[0].is_current_record, true);
  assert.equal(rows[1].is_current_record, false);
  assert.equal(rows[0].is_current_projection, false);
});

test("account detail is independent of diagnostics and never exposes them without permission", async (t) => {
  const diagnosticReads = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    const table = url.pathname.split("/").at(-1);
    if (table === "account_profiles") return Response.json([{ firebase_uid: "synthetic-account", normalized_email: "account@example.invalid" }]);
    if (table === "admin_subscription_directory") return Response.json({ as_of: "2026-11-14T00:00:00Z", items: [], witnesses: [], total: 0 });
    if (["crash_logs", "tamper_alerts"].includes(table)) {
      diagnosticReads.push(table);
      return Response.json({ message: "fixture error" }, { status: 503 });
    }
    return Response.json([]);
  });
  const env = {
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    ADMIN_EMAIL_ALLOWLIST: "support@example.invalid,auditor@example.invalid",
    ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ "support@example.invalid": "support", "auditor@example.invalid": "security_auditor" }),
  };
  const read = (role, path) => worker.fetch(new Request(`https://admin.saturnws.com/api/admin${path}`, {
    headers: { "cf-access-authenticated-user-email": `${role}@example.invalid` },
  }), env);
  for (const role of ["support", "auditor"]) {
    const response = await read(role, "/users/synthetic-account?view=account");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile.firebase_uid, "synthetic-account");
    for (const field of ["crashes", "last_crash", "tamper_alerts"]) assert(!(field in body));
  }
  const legacySupport = await (await read("support", "/users/synthetic-account")).json();
  assert.deepEqual(legacySupport.crashes, []);
  assert.deepEqual(legacySupport.tamper_alerts, []);
  assert.equal((await read("support", "/tamper-alerts?user=synthetic-account")).status, 403);
  assert.deepEqual(diagnosticReads, []);

  const legacyAuditor = await read("auditor", "/users/synthetic-account");
  assert.equal(legacyAuditor.status, 200);
  assert.equal((await legacyAuditor.json()).profile.firebase_uid, "synthetic-account");
  assert.deepEqual(diagnosticReads.sort(), ["crash_logs", "tamper_alerts"]);
});

test("the account view resolves subscription access from the full-owner snapshot, not its recent history sample", async (t) => {
  const uid = "fixture-owner";
  const account = { firebase_uid: uid, normalized_email: "account@example.test", account_status: "active" };
  const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const row = (n, state = "expired") => ({ id: id(n), firebase_user_id: uid, user_email: account.normalized_email,
    plan: "monthly", plan_term: "monthly", is_current: state === "active", lifecycle_state: state,
    starts_at: "2020-01-01T00:00:00Z", expires_at: state === "active" ? "2099-01-01T00:00:00Z" : "2021-01-01T00:00:00Z" });
  let mode = "ok", legacyReads = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const table = new URL(input).pathname.split("/").at(-1);
    if (table === "account_profiles") return Response.json([account]);
    if (table === "account_subscriptions") { legacyReads++; return Response.json([]); }
    if (table === "admin_subscription_directory") {
      const request = JSON.parse(init.body);
      assert.equal(request.p_owner_uid, uid);
      assert.equal(request.p_limit, 100);
      if (mode === "unavailable") return Response.json({ message: "synthetic-source-outage" }, { status: 503 });
      return Response.json({ as_of: "2026-11-14T00:00:00Z", total: 2006, items: Array.from({ length: 100 }, (_, n) => row(n + 1)),
        witnesses: [{ ...row(999, "active"), ...(mode === "wrong-owner" ? { firebase_user_id: "another-owner" } : {}) }] });
    }
    return Response.json([]);
  });
  const email = "fixture-account-reader@example.invalid";
  const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-read-key",
    ADMIN_EMAIL_ALLOWLIST: email, ADMIN_ROLE_ASSIGNMENTS: JSON.stringify({ [email]: "support" }) };
  const read = () => worker.fetch(new Request("https://admin.saturnws.com/api/admin/users/" + uid + "?view=account",
    { headers: { "cf-access-authenticated-user-email": email } }), env);
  const response = await read();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.item.id, id(999));
  assert.equal(body.subscription_projection.entitlement, "entitled");
  assert.equal(body.subscription_history.length, 100);
  assert.equal(body.audit, null);
  assert.equal(legacyReads, 0);
  for (const fault of ["wrong-owner", "unavailable"]) {
    mode = fault;
    const failed = await read();
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { success: false, error: "subscriptions_unavailable" });
  }
  assert.equal(legacyReads, 0, "an unavailable snapshot must not fall back to a capped history and claim no subscription");
});

test("tamper history uses exact subscription ownership, pages safely, and reports source failure", async (t) => {
  const queries = [];
  let unavailable = false;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/rest/v1/tamper_alerts");
    queries.push(url.searchParams);
    if (unavailable) return Response.json({ message: "private upstream fixture" }, { status: 503 });
    return Response.json([
      { id: "first", hwid: "raw-fixture-device", user_id: "private-fixture-user", details: { raw: "private-fixture-detail" }, severity: "warning", reason: "fixture_reason", resolved: false },
      { id: "second" },
    ]);
  });
  const env = { ADMIN_API_TOKEN: "fixture-tamper-reader", SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" };
  const url = "https://admin.saturnws.com/api/admin/tamper-alerts?user=synthetic-account&resolved=false&page=2&limit=1";
  const read = () => worker.fetch(new Request(url, { headers: { Authorization: "Bearer fixture-tamper-reader" } }), env);
  const response = await read();
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.page, 2);
  assert.equal(page.has_more, true);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "first");
  assert.equal(page.items[0].reason, "fixture_reason");
  assert.match(page.items[0].device_key, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(page), /raw-fixture-device|private-fixture|"hwid"|"user_id"|"details"/);
  assert.equal(queries[0].get("owner.firebase_user_id"), "eq.synthetic-account");
  assert.equal(queries[0].get("owner"), "not.is.null");
  assert.match(queries[0].get("select"), /owner:account_subscriptions\(\)$/);
  assert.equal(queries[0].get("resolved"), "is.false");
  assert.equal(queries[0].get("order"), "happened_at.desc,id.desc");
  assert.equal(queries[0].get("limit"), "2");
  assert.equal(queries[0].get("offset"), "1");

  unavailable = true;
  const failure = await read();
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { success: false, error: "diagnostics_unavailable" });
});
