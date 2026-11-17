import { PolicyAdminError, policyAdminJson as reply, policyRevision as digest, readPolicyAdminInput, POLICY_VERSION } from './policy_admin_common'
type Database = { DB: D1Database }
type PolicyRow = {
  id: string; kill_switch_enabled: number; mandatory_update_enabled: number
  minimum_supported_version: string | null; update_mode: string
  blocked_actions_json: string | null; features_json: string | null; limits_json: string | null; updated_at: string
}
type Editable = Pick<PolicyRow, 'kill_switch_enabled' | 'mandatory_update_enabled' | 'minimum_supported_version' | 'update_mode'>
const COLUMNS = 'id,kill_switch_enabled,mandatory_update_enabled,minimum_supported_version,update_mode,blocked_actions_json,features_json,limits_json,updated_at'
const MODES = new Set(['optional', 'mandatory', 'required', 'force'])
const editable = (row: PolicyRow): Editable => ({ kill_switch_enabled: row.kill_switch_enabled, mandatory_update_enabled: row.mandatory_update_enabled, minimum_supported_version: row.minimum_supported_version, update_mode: row.update_mode })
async function read(env: Database) {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM global_policy WHERE id='global'`).first<PolicyRow>()
  if (!row || row.id !== 'global' || ![0, 1].includes(row.kill_switch_enabled) || ![0, 1].includes(row.mandatory_update_enabled) || !MODES.has(row.update_mode) || !Number.isFinite(Date.parse(row.updated_at)) || (row.minimum_supported_version !== null && typeof row.minimum_supported_version !== 'string')) throw new PolicyAdminError('policy_state_unavailable', 503)
  return row
}
async function publicState(row: PolicyRow) {
  return { ...editable(row), updated_at: row.updated_at, revision: await digest(row) }
}
async function write(request: Request, env: Database, actor: string) {
  const body = await readPolicyAdminInput(request)
  const fields = ['kill_switch_enabled', 'mandatory_update_enabled', 'minimum_supported_version', 'update_mode', 'reason', 'expected_revision', 'request_id']
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key)) || typeof body.kill_switch_enabled !== 'boolean' || typeof body.mandatory_update_enabled !== 'boolean' || typeof body.minimum_supported_version !== 'string' || typeof body.update_mode !== 'string' || !MODES.has(body.update_mode) || typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 1000 || typeof body.expected_revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expected_revision) || typeof body.request_id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id) || request.headers.get('Idempotency-Key') !== body.request_id) throw new PolicyAdminError('invalid_policy_change', 400)
  const version = body.minimum_supported_version.trim()
  if (version && (!POLICY_VERSION.test(version) || version.length > 80)) throw new PolicyAdminError('invalid_policy_version', 400)
  const next: Editable = { kill_switch_enabled: body.kill_switch_enabled ? 1 : 0, mandatory_update_enabled: body.mandatory_update_enabled ? 1 : 0, minimum_supported_version: version, update_mode: body.update_mode }
  const fingerprint = await digest([actor, body.expected_revision, next, body.reason.trim()])
  const auditId = 'admin-policy:' + body.request_id
  const replay = (audit: { reason: string; email: string | null } | null) => {
    if (!audit) return null
    let saved: { fingerprint?: string; revision?: string }
    try { saved = JSON.parse(audit.reason) } catch { throw new PolicyAdminError('policy_write_unconfirmed', 503) }
    if (audit.email !== actor || saved.fingerprint !== fingerprint || !/^[a-f0-9]{64}$/.test(saved.revision || '')) throw new PolicyAdminError('policy_request_conflict', 409)
    return { success: true, request_id: body.request_id, revision: saved.revision, replay: true }
  }
  const auditStatement = () => env.DB.prepare("SELECT email,reason FROM policy_audit WHERE id=? AND requested_action='policy.global.update'").bind(auditId)
  const previous = replay(await auditStatement().first<{ email: string | null; reason: string }>())
  if (previous) return reply(previous)
  const current = await read(env)
  if (await digest(current) !== body.expected_revision) throw new PolicyAdminError('policy_state_changed', 409)
  if (JSON.stringify(editable(current)) === JSON.stringify(next)) throw new PolicyAdminError('policy_change_empty', 400)
  const now = new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString()
  const revision = await digest({ ...current, ...next, updated_at: now })
  const audit = JSON.stringify({ fingerprint, revision, reason: body.reason.trim(), before: editable(current), after: next })
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE global_policy SET kill_switch_enabled=?,mandatory_update_enabled=?,minimum_supported_version=?,update_mode=?,updated_at=? WHERE id='global' AND kill_switch_enabled IS ? AND mandatory_update_enabled IS ? AND minimum_supported_version IS ? AND update_mode IS ? AND updated_at IS ? AND blocked_actions_json IS ? AND features_json IS ? AND limits_json IS ?`).bind(next.kill_switch_enabled, next.mandatory_update_enabled, next.minimum_supported_version, next.update_mode, now, current.kill_switch_enabled, current.mandatory_update_enabled, current.minimum_supported_version, current.update_mode, current.updated_at, current.blocked_actions_json, current.features_json, current.limits_json),
    env.DB.prepare("INSERT INTO policy_audit (id,email,requested_action,decision,reason,created_at) SELECT ?,?,'policy.global.update','allow',?,? WHERE changes()=1").bind(auditId, actor, audit, now),
    auditStatement(),
  ])
  if (result.some((item) => !item.success)) throw new PolicyAdminError('policy_write_unconfirmed', 503)
  const confirmation = replay((result[2].results[0] || null) as { email: string | null; reason: string } | null)
  if (!confirmation) throw new PolicyAdminError('policy_state_changed', 409)
  return reply({ ...confirmation, replay: result[0].meta.changes !== 1 })
}
export async function handleAdminGlobalPolicy(request: Request, env: Database, actor: string): Promise<Response> {
  try {
    if (request.method === 'GET') return reply({ success: true, policy: await publicState(await read(env)) })
    return await write(request, env, actor)
  } catch (error) {
    const known = error instanceof PolicyAdminError
    return reply({ success: false, error: known ? error.message : request.method === 'GET' ? 'policy_state_unavailable' : 'policy_write_unconfirmed' }, known ? error.status : 503)
  }
}
