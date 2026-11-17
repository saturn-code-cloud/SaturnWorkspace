export async function readBoundedRequestText(request, maxBytes, errorCode, strictUtf8 = false) {
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) throw new Error(errorCode);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error(errorCode); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: strictUtf8, ignoreBOM: false }).decode(bytes); }
    catch { throw new Error(errorCode); }
  } finally { reader.releaseLock(); }
}
