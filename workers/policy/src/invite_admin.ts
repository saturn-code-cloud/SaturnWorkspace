type InviteRow = {
  id: string; status: string; expires_at: string | null; max_uses: number | null; used_count: number
  note: string | null; scope_json: string | null; restrictions_json: string | null
  created_by: string | null; created_at: string; updated_at: string
  revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null
  effective_status?: string
}
type Database = { DB: D1Database }
const FIELDS = 'id,status,expires_at,max_uses,used_count,note,scope_json,restrictions_json,created_by,created_at,updated_at,revoked_at,revoked_by,revoke_reason'
const EFFECTIVE_STATUS = "CASE WHEN status='revoked' THEN 'revoked' WHEN status NOT IN ('active','enabled') THEN 'blocked' WHEN expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now') THEN 'expired' WHEN max_uses > 0 AND used_count >= max_uses THEN 'exhausted' ELSE 'active' END"
const STATES = new Set(['active', 'expired', 'exhausted', 'revoked', 'blocked'])
class InviteError extends Error { constructor(message: string, readonly status: number) { super(message) } }
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
function integer(value: string | null, fallback: number, max: number, min = 1) {
  if (value === null) return fallback
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new InviteError('invalid_invite_query', 400)
  return Number(value)
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new InviteError('invalid_invite_restrictions', 400)
  return value as Record<string, unknown>
}
function publicInvite(row: InviteRow) {
  let scope: Record<string, unknown>; let restrictions: Record<string, unknown>
  try { scope = object(row.scope_json ? JSON.parse(row.scope_json) : {}); restrictions = object(row.restrictions_json ? JSON.parse(row.restrictions_json) : {}) }
  catch { throw new Error('invalid_invite_record') }
  if (!row.id || !row.created_at || !row.updated_at || !Number.isInteger(row.used_count) || row.used_count < 0) throw new Error('invalid_invite_record')
  return { id: row.id, status: row.status, effective_status: row.effective_status, expires_at: row.expires_at, max_uses: row.max_uses, used_count: row.used_count, note: row.note,
    scope, restrictions, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at, revoked_at: row.revoked_at, revoked_by: row.revoked_by, revoke_reason: row.revoke_reason }
}
async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>()
  if (!result.success || !Array.isArray(result.results)) throw new Error('invite_read_failed')
  return result.results
}
async function directory(request: Request, env: Database) {
  const params = new URL(request.url).searchParams
  const management = params.get('view') === 'management'
  const limit = integer(params.get('limit'), management ? 25 : 50, 100)
  const page = integer(params.get('page'), 1, 5000)
  const offset = management ? (page - 1) * limit : integer(params.get('offset'), 0, 500000, 0)
  const status = (params.get('status') || '').trim().toLowerCase()
  const query = (params.get('query') || '').trim()
  if (query.length > 100 || (management && status && !STATES.has(status))) throw new InviteError('invalid_invite_query', 400)
  const clauses: string[] = []; const values: (string | number)[] = []
  if (status) { clauses.push(`${management ? `(${EFFECTIVE_STATUS})` : 'status'}=?`); values.push(status) }
  if (query) { clauses.push("(instr(lower(coalesce(note,'')),lower(?))>0 OR instr(lower(id),lower(?))>0)"); values.push(query, query) }
  const found = await rows<InviteRow>(env.DB.prepare(`SELECT ${FIELDS},${EFFECTIVE_STATUS} AS effective_status FROM invite_codes${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY datetime(created_at) DESC,id DESC LIMIT ? OFFSET ?`).bind(...values, limit + 1, offset))
  return reply({ success: true, items: found.slice(0, limit).map(publicInvite), limit, offset, page, query, status, has_more: found.length > limit, generated_at: new Date().toISOString() })
}
async function usage(request: Request, env: Database) {
  const params = new URL(request.url).searchParams
  const id = (params.get('invite_id') || '').trim()
  if (!id || id.length > 160) throw new InviteError('invite_id_required', 400)
  const page = integer(params.get('page'), 1, 5000)
  const limit = integer(params.get('limit'), params.get('view') === 'management' ? 25 : 200, 200)
  const found = await rows<InviteRow>(env.DB.prepare(`SELECT ${FIELDS},${EFFECTIVE_STATUS} AS effective_status FROM invite_codes WHERE id=? LIMIT 1`).bind(id))
  if (!found[0]) throw new InviteError('invite_not_found', 404)
  const items = await rows<Record<string, unknown>>(env.DB.prepare('SELECT id,user_id,email,install_id,device_id,app_version,channel,result,created_at FROM invite_code_validations WHERE invite_code_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(id, limit + 1, (page - 1) * limit))
  return reply({ success: true, item: publicInvite(found[0]), items: items.slice(0, limit), page, limit, has_more: items.length > limit, generated_at: new Date().toISOString() })
}
function strings(source: Record<string, unknown>, key: string, max: number, size: number, lower = false) {
  const value = source[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > size || /[\u0000-\u001f\u007f]/.test(entry))) throw new InviteError('invalid_invite_restrictions', 400)
  return [...new Set(value.map((entry: string) => lower ? entry.trim().toLowerCase() : entry.trim()))]
}
function flag(source: Record<string, unknown>, key: string) {
  if (source[key] !== undefined && typeof source[key] !== 'boolean') throw new InviteError('invalid_invite_restrictions', 400)
  return source[key] === true
}
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}
async function create(request: Request, env: Database, actor: string) {
  const input = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InviteError('invalid_invite_request', 400)
  const body = object(input)
  if (Object.keys(body).some((key) => !['request_id', 'expires_at', 'max_uses', 'note', 'scope', 'restrictions'].includes(key))) throw new InviteError('invalid_invite_request', 400)
  const requestId = String(body.request_id || request.headers.get('Idempotency-Key') || '').trim()
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId) || (body.request_id && request.headers.has('Idempotency-Key') && body.request_id !== request.headers.get('Idempotency-Key'))) throw new InviteError('request_id_required', 400)
  const maxUses = body.max_uses === null || body.max_uses === undefined || body.max_uses === '' ? null : body.max_uses
  if (maxUses !== null && (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000)) throw new InviteError('invalid_max_uses', 400)
  const expiry = body.expires_at === undefined || body.expires_at === null || body.expires_at === '' ? null : body.expires_at
  if (expiry !== null && (typeof expiry !== 'string' || !Number.isFinite(Date.parse(expiry)))) throw new InviteError('invalid_expiry', 400)
  const expiresAt = expiry ? new Date(expiry as string).toISOString() : null
  const note = typeof body.note === 'string' ? body.note.trim() || null : null
  if ((body.note !== undefined && typeof body.note !== 'string') || (note && note.length > 1000)) throw new InviteError('invalid_invite_note', 400)
  const scopeInput = object(body.scope); const restrictionsInput = object(body.restrictions)
  if (Object.keys(scopeInput).some((key) => !['channels', 'app_versions'].includes(key)) || Object.keys(restrictionsInput).some((key) => !['user_ids', 'emails', 'device_ids', 'install_ids', 'one_per_user', 'one_per_device'].includes(key))) throw new InviteError('invalid_invite_restrictions', 400)
  const scope = { channels: strings(scopeInput, 'channels', 20, 80, true), app_versions: strings(scopeInput, 'app_versions', 50, 80) }
  const restrictions = { user_ids: strings(restrictionsInput, 'user_ids', 100, 160), emails: strings(restrictionsInput, 'emails', 100, 254, true), device_ids: strings(restrictionsInput, 'device_ids', 100, 160), install_ids: strings(restrictionsInput, 'install_ids', 100, 160), one_per_user: flag(restrictionsInput, 'one_per_user'), one_per_device: flag(restrictionsInput, 'one_per_device') }
  if (restrictions.emails.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new InviteError('invalid_invite_restrictions', 400)
  const scopeJson = JSON.stringify(scope); const restrictionsJson = JSON.stringify(restrictions)
  const sameRequest = (row: InviteRow) => row.created_by === actor && row.expires_at === expiresAt && row.max_uses === maxUses && (row.note || null) === note && JSON.stringify(object(row.scope_json ? JSON.parse(row.scope_json) : {})) === scopeJson && JSON.stringify(object(row.restrictions_json ? JSON.parse(row.restrictions_json) : {})) === restrictionsJson
  const previous = await rows<InviteRow>(env.DB.prepare(`SELECT ${FIELDS},${EFFECTIVE_STATUS} AS effective_status FROM invite_codes WHERE creation_request_id=?1 LIMIT 1`).bind(requestId))
  if (previous[0]) {
    if (!sameRequest(previous[0])) throw new InviteError('invite_request_conflict', 409)
    return reply({ success: true, item: publicInvite(previous[0]), code: null, shown_once: false, replay: true })
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new InviteError('invalid_expiry', 400)
  const code = generateInviteCode(); const id = crypto.randomUUID(); const now = new Date().toISOString()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO invite_codes (id,code_hash,status,expires_at,max_uses,used_count,note,scope_json,restrictions_json,creation_request_id,created_by,created_at,updated_at) VALUES (?,?,'active',?,?,0,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").bind(id, hash, expiresAt, maxUses, note, scopeJson, restrictionsJson, requestId, actor, now, now),
    env.DB.prepare("INSERT INTO policy_audit (id,email,requested_action,decision,reason,created_at) SELECT ?,?,'invite.create','allow',?,? WHERE changes()=1").bind(crypto.randomUUID(), actor, JSON.stringify({ invite_id: id }), now),
    env.DB.prepare(`SELECT ${FIELDS},${EFFECTIVE_STATUS} AS effective_status FROM invite_codes WHERE creation_request_id=? LIMIT 1`).bind(requestId),
  ])
  if (result.some((part) => !part.success)) throw new Error('invite_write_failed')
  const saved = result[2].results?.[0] as InviteRow | undefined
  if (!saved) throw new Error('invite_write_unconfirmed')
  if (!sameRequest(saved)) throw new InviteError('invite_request_conflict', 409)
  const created = Number(result[0].meta.changes) === 1
  return reply({ success: true, item: publicInvite(saved), code: created ? code : null, shown_once: created, replay: !created })
}
async function revoke(request: Request, env: Database, actor: string) {
  const body = object(await request.json().catch(() => null))
  const id = typeof body.invite_id === 'string' ? body.invite_id.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!id || id.length > 160) throw new InviteError('invite_id_required', 400)
  if (reason.length < 3 || reason.length > 1000) throw new InviteError('reason_required', 400)
  const now = new Date().toISOString()
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE invite_codes SET status='revoked',revoked_at=?,revoked_by=?,revoke_reason=?,updated_at=? WHERE id=? AND status IN ('active','enabled')").bind(now, actor, reason, now, id),
    env.DB.prepare("INSERT INTO policy_audit (id,email,requested_action,decision,reason,created_at) SELECT ?,?,'invite.revoke','allow',?,? WHERE changes()=1").bind(crypto.randomUUID(), actor, JSON.stringify({ invite_id: id, reason }), now),
    env.DB.prepare(`SELECT ${FIELDS},${EFFECTIVE_STATUS} AS effective_status FROM invite_codes WHERE id=? LIMIT 1`).bind(id),
  ])
  if (result.some((part) => !part.success)) throw new Error('invite_write_failed')
  const item = result[2].results?.[0] as InviteRow | undefined
  if (!item) throw new InviteError('invite_not_found', 404)
  if (item.status !== 'revoked') throw new InviteError('invite_not_active', 409)
  return reply({ success: true, invite_id: id, status: 'revoked', item: publicInvite(item), replay: Number(result[0].meta.changes) === 0 })
}
export async function handleAdminInvite(request: Request, env: Database, actor: string): Promise<Response> {
  const path = new URL(request.url).pathname
  try {
    if (request.method === 'GET' && path === '/v1/admin/invites') return await directory(request, env)
    if (request.method === 'GET' && path === '/v1/admin/invites/usage') return await usage(request, env)
    if (request.method === 'POST' && path === '/v1/admin/invites/create') return await create(request, env, actor)
    if (request.method === 'POST' && path === '/v1/admin/invites/revoke') return await revoke(request, env, actor)
    return reply({ success: false, error: 'invite_not_found' }, 404)
  } catch (error) {
    if (error instanceof InviteError) return reply({ success: false, error: error.message }, error.status)
    console.error(JSON.stringify({ event: 'admin_invite_operation_failed', operation: path, error: error instanceof Error ? error.message : 'unknown' }))
    return reply({ success: false, error: request.method === 'GET' ? 'invite_read_unavailable' : 'invite_write_unconfirmed' }, 503)
  }
}
