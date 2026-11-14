export const SCREENSHOT_MAX_BYTES = 1024 * 1024;
export const SCREENSHOT_RETENTION_MS = 7 * 86400000;
const HASH = /^[a-f0-9]{64}$/;
const keyFor = (row) => `screenshots/${row.id}.jpg`;
const extraFor = (row) => row?.raw_payload?.extra || {};

async function digest(value) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function expiresAt(row) {
  return Date.parse(row?.happened_at || "") + SCREENSHOT_RETENTION_MS;
}

export async function diagnosticScreenshotInfo(row, env) {
  const extra = extraFor(row);
  if (!HASH.test(extra.capture_proof_hash || "") || !HASH.test(extra.capture_image_sha256 || "")) return null;
  const expires = expiresAt(row);
  if (!Number.isFinite(expires) || expires <= Date.now()) return { status: "expired" };
  const common = { expires_at: new Date(expires).toISOString(), captured_at: extra.capture_at || row.happened_at };
  try {
    if (!env.DIAGNOSTIC_MEDIA) return { ...common, status: "unavailable" };
    const item = await env.DIAGNOSTIC_MEDIA.head(keyFor(row));
    return { ...common, status: item ? "available" : "pending" };
  } catch {
    return { ...common, status: "unavailable" };
  }
}

async function readImage(request) {
  if (request.headers.get("Content-Type") !== "image/jpeg") throw new Error("invalid_diagnostic_image");
  if (Number(request.headers.get("Content-Length")) > SCREENSHOT_MAX_BYTES) throw new Error("diagnostic_payload_too_large");
  if (!request.body) throw new Error("invalid_diagnostic_image");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > SCREENSHOT_MAX_BYTES) {
        await reader.cancel();
        throw new Error("diagnostic_payload_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
    throw new Error("invalid_diagnostic_image");
  }
  return bytes;
}

export async function enforceDiagnosticMediaRateLimit(request, env) {
  const limiter = env.ADMIN_RATE_LIMIT_DIAGNOSTIC_MEDIA;
  if (!limiter?.limit) throw new Error("rate_limit_unavailable");
  const limited = await limiter.limit({ key: await digest(`diagnostic-media:${request.headers.get("CF-Connecting-IP") || "anonymous"}`) }).catch(() => null);
  if (!limited) throw new Error("rate_limit_unavailable");
  if (!limited.success) throw new Error("rate_limited");
}

export async function uploadDiagnosticScreenshot(request, env, row) {
  if (!env.DIAGNOSTIC_MEDIA) throw new Error("diagnostic_media_unavailable");
  const extra = extraFor(row);
  const proof = request.headers.get("X-Diagnostic-Proof") || "";
  if (!HASH.test(proof) || !HASH.test(extra.capture_proof_hash || "") || await digest(proof) !== extra.capture_proof_hash) {
    throw new Error("diagnostic_media_forbidden");
  }
  if (!Number.isFinite(expiresAt(row)) || expiresAt(row) <= Date.now()) throw new Error("diagnostic_image_expired");
  const image = await readImage(request);
  if (!HASH.test(extra.capture_image_sha256 || "") || await digest(image) !== extra.capture_image_sha256) {
    throw new Error("diagnostic_image_mismatch");
  }
  // The immutable report binds both the producer's one-use capability and the exact image.
  const existing = await env.DIAGNOSTIC_MEDIA.head(keyFor(row));
  if (!existing) {
    await env.DIAGNOSTIC_MEDIA.put(keyFor(row), image, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "image/jpeg", cacheControl: "no-store" },
      customMetadata: { expires_at: new Date(expiresAt(row)).toISOString() },
      sha256: extra.capture_image_sha256,
    });
  }
  return { success: true, accepted: true, event_id: row.raw_payload.event_id };
}

export async function readDiagnosticScreenshot(env, row, headers = {}) {
  if (!env.DIAGNOSTIC_MEDIA) throw new Error("diagnostic_media_unavailable");
  if (!Number.isFinite(expiresAt(row)) || expiresAt(row) <= Date.now()) throw new Error("diagnostic_image_expired");
  const item = await env.DIAGNOSTIC_MEDIA.get(keyFor(row));
  if (!item) throw new Error("diagnostic_image_not_found");
  return new Response(item.body, { headers: {
    ...headers, "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="phone-error.jpg"',
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
