function baseUrl(env) {
  const raw = String(env.SUPABASE_API_URL || env.SUPABASE_URL || "").replace(/\/+$/, "")
  if (!raw) return ""
  return raw.endsWith("/rest/v1") ? raw : `${raw}/rest/v1`
}

function serviceHeaders(env, extra = {}) {
  return {
    "Content-Type": "application/json",
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  }
}

export async function supabaseJson(env, path, init = {}) {
  const root = baseUrl(env)
  if (!root || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_not_configured")
  const response = await fetch(`${root}${path}`, {
    ...init,
    headers: serviceHeaders(env, init.headers || {}),
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && payload.message ? String(payload.message) : `supabase_${response.status}`
    throw new Error(message)
  }
  return payload
}

export async function supabasePage(env, path, init = {}) {
  const root = baseUrl(env)
  if (!root || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_not_configured")
  const response = await fetch(`${root}${path}`, {
    ...init,
    headers: serviceHeaders(env, {
      ...(init.headers || {}),
      Prefer: "count=exact",
    }),
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && payload.message ? String(payload.message) : `supabase_${response.status}`
    throw new Error(message)
  }
  const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(response.headers.get("Content-Range") || "")
  const total = match ? Number(match[1]) : NaN
  if (!Number.isSafeInteger(total)) throw new Error("supabase_exact_count_unavailable")
  if (init.method !== "HEAD" && !Array.isArray(payload)) throw new Error("invalid_supabase_page")
  return { items: payload, total }
}

export function encodeFilterValue(value) {
  return encodeURIComponent(String(value || ""))
}
