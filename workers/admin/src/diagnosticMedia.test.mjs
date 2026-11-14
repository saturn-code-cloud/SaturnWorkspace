import assert from "node:assert/strict";
import test from "node:test";
import worker, { ingestCrashLog, getCrashLog } from "./index.js";
import { diagnosticScreenshotInfo, uploadDiagnosticScreenshot, readDiagnosticScreenshot, enforceDiagnosticMediaRateLimit } from "./diagnosticMedia.js";

const hash = async (data) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data))].map(x => x.toString(16).padStart(2, "0")).join("");
const image = new Uint8Array([255,216,255,217]);
const proof = "a".repeat(64);
async function fixture() {
  const objects = new Map();
  const bucket = {
    async head(key) { return objects.get(key) || null; },
    async put(key, data, options) { if (!objects.has(key)) objects.set(key, { body: data, ...options }); },
    async get(key) { return objects.get(key) || null; },
  };
  const row = { id: "d94858e2-e3f9-4839-8dd9-1391af5fb47c", happened_at: new Date().toISOString(),
    raw_payload: { event_id: "f3c4339b-d99d-4129-b1ec-d9d6ef76541e", extra: {
      capture_proof_hash: await hash(proof), capture_image_sha256: await hash(image),
    } } };
  const env = { DIAGNOSTIC_MEDIA: bucket, ADMIN_RATE_LIMIT_DIAGNOSTIC_MEDIA: { async limit() { return { success: true }; } } };
  const request = (body = image, secret = proof, type = "image/jpeg") => new Request("https://admin-api.example.test/image", {
    method: "POST", body, headers: { "Content-Type": type, "X-Diagnostic-Proof": secret },
  });
  return { env, row, request, objects };
}

test("only the report's capture capability can attach its exact image", async () => {
  const { env, row, request, objects } = await fixture();
  assert.equal((await diagnosticScreenshotInfo(row, env)).status, "pending");
  await assert.rejects(uploadDiagnosticScreenshot(request(image, "b".repeat(64)), env, row), /forbidden/);
  assert.equal(objects.size, 0);
  const reply = await uploadDiagnosticScreenshot(request(), env, row);
  assert.equal(reply.event_id, row.raw_payload.event_id);
  assert.equal((await diagnosticScreenshotInfo(row, env)).status, "available");
  await uploadDiagnosticScreenshot(request(), env, row);
  assert.equal(objects.size, 1);
});

test("wrong image, MIME and oversized bodies never enter storage", async () => {
  const { env, row, request, objects } = await fixture();
  await assert.rejects(uploadDiagnosticScreenshot(request(image, proof, "image/svg+xml"), env, row), /invalid_diagnostic_image/);
  await assert.rejects(uploadDiagnosticScreenshot(request(new Uint8Array([255,216,1,255,217])), env, row), /mismatch/);
  await assert.rejects(uploadDiagnosticScreenshot(request(new Uint8Array(1024 * 1024 + 1)), env, row), /too_large/);
  assert.equal(objects.size, 0);
});

test("expired screenshots cannot be uploaded or read; legacy reports have no image", async () => {
  const { env, row, request } = await fixture();
  row.happened_at = new Date(Date.now() - 7 * 86400000 - 1).toISOString();
  assert.equal((await diagnosticScreenshotInfo(row, env)).status, "expired");
  await assert.rejects(uploadDiagnosticScreenshot(request(), env, row), /expired/);
  await assert.rejects(readDiagnosticScreenshot(env, row), /expired/);
  assert.equal(await diagnosticScreenshotInfo({ raw_payload: {} }, env), null);
});

test("binary response is JPEG, private and uncached, with no public bucket URL", async () => {
  const { env, row, request } = await fixture();
  await uploadDiagnosticScreenshot(request(), env, row);
  const response = await readDiagnosticScreenshot(env, row);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), image);
});

test("anonymous callers cannot read an image from the administrator route", async () => {
  const response = await worker.fetch(new Request("https://admin-api.saturnws.com/api/admin/crash-logs/d94858e2-e3f9-4839-8dd9-1391af5fb47c/screenshot"), {});
  assert.notEqual(response.status, 200);
  assert.notEqual(response.headers.get("Content-Type"), "image/jpeg");
});

test("upload limits use the request IP, not client-supplied metadata", async () => {
  const { env } = await fixture();
  const keys = [];
  env.ADMIN_RATE_LIMIT_DIAGNOSTIC_MEDIA.limit = async ({key}) => { keys.push(key); return { success: true }; };
  for (const suffix of ["1", "2"]) {
    await enforceDiagnosticMediaRateLimit(new Request(`https://example.test/${suffix}`, { headers: { "CF-Connecting-IP": "203.0.113.5" } }), env);
  }
  assert.equal(keys[0], keys[1]);
  env.ADMIN_RATE_LIMIT_DIAGNOSTIC_MEDIA.limit = async () => ({ success: false });
  await assert.rejects(enforceDiagnosticMediaRateLimit(new Request("https://example.test"), env), /rate_limited/);
});

test("real ingest preserves capture hashes and private media routes attach to the same event", async (context) => {
  const { env, request: imageRequest, row, objects } = await fixture();
  env.SUPABASE_URL = "https://database.example.test";
  env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  env.ADMIN_RATE_LIMIT_CRASH_INGEST = { async limit() { return { success: true }; } };
  env.ADMIN_API_TOKEN = "fixture-admin-only";
  let stored;
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://database.example.test");
    if (init.method === "POST") {
      const candidate = JSON.parse(init.body);
      if (stored) return Response.json([]);
      stored = candidate;
      return Response.json([candidate], { status: 201 });
    }
    return Response.json(stored ? [stored] : []);
  });
  const result = await ingestCrashLog(new Request("https://admin-api.saturnws.com/api/crash-logs/ingest", {
    method: "POST", body: JSON.stringify({
      event_id: row.raw_payload.event_id, happened_at: row.happened_at,
      error_type: "OperationalFailure", message: "mises_foreground_failed", stack_trace: "work_session: mises_foreground_failed",
      app_version: "2026.11.05.2", tool_channel: "android-beta",
      raw_payload: { component: "saturn-android", source: "saturn-android", context: "android.work_session", extra: row.raw_payload.extra },
    }),
  }), env);
  assert.equal(result.accepted, true);
  assert.equal(stored.raw_payload.extra.capture_proof_hash, row.raw_payload.extra.capture_proof_hash);
  const image = imageRequest();
  const response = await worker.fetch(new Request(`https://admin-api.saturnws.com/api/crash-logs/${row.raw_payload.event_id}/screenshot`, {
    method: "POST", body: image.body, duplex: "half", headers: image.headers,
  }), env);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(objects.size, 1);
  const detail = await getCrashLog(result.item.id, env);
  assert.equal(detail.item.screenshot.status, "available");
  const read = await worker.fetch(new Request(`https://admin-api.saturnws.com/api/admin/crash-logs/${result.item.id}/screenshot`, {
    headers: { Authorization: "Bearer fixture-admin-only" },
  }), env);
  assert.equal(read.status, 200, await read.clone().text());
  assert.equal(read.headers.get("Content-Type"), "image/jpeg");
});
