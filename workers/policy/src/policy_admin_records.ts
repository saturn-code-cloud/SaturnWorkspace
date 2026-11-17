import { PolicyAdminError, policyAdminJson as reply, policyRevision as digest, readPolicyAdminInput, POLICY_VERSION } from './policy_admin_common'
type Database = { DB: D1Database }
type VersionRow = { version: string; reason: string | null; created_at: string }
type PlanRow = { plan_id: string; features_json: string | null; limits_json: string | null; blocked_actions_json: string | null; updated_at: string }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
const VERSION_FIELDS = 'version,reason,created_at'
const PLAN_FIELDS = 'plan_id,features_json,limits_json,blocked_actions_json,updated_at'
const strictVersion = (value: string) => { const version = value.trim().toLowerCase(); if (version.length > 80 || !POLICY_VERSION.test(version)) throw new PolicyAdminError('invalid_policy_version', 400); return version }
async function rows<T>(statement: D1PreparedStatement): Promise<T[]> { const result = await statement.all<T>(); if (!result.success || !Array.isArray(result.results)) throw new PolicyAdminError('policy_records_unavailable', 503); return result.results }
function pagination(url: URL) {
  const raw = url.searchParams.get('page') || '1'; const query = (url.searchParams.get('query') || '').trim()
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 5000 || query.length > 100) throw new PolicyAdminError('invalid_policy_query', 400)
  return { page: Number(raw), query, limit: 25 }
}
async function versionState(env: Database, version: string) {
  const found = await rows<{ version: string | null; reason: string | null; created_at: string | null; stamp: number | null }>(env.DB.prepare('SELECT d.version,d.reason,d.created_at,r.revision AS stamp FROM (SELECT ? AS version) s LEFT JOIN disabled_versions d ON lower(d.version)=s.version LEFT JOIN disabled_version_revisions r ON r.version=s.version LIMIT 2').bind(version))
  if (found.length !== 1 || found[0].stamp !== null && (!Number.isSafeInteger(found[0].stamp) || found[0].stamp < 1)) throw new PolicyAdminError('policy_records_unavailable', 503)
  const row = found[0].version === null ? null : { version: found[0].version, reason: found[0].reason, created_at: found[0].created_at! }
  const stamp = found[0].stamp || 0
  return { row, stamp, revision: await digest([version, row, stamp]) }
}
async function versionRead(request: Request, env: Database) {
  const url = new URL(request.url)
  if (url.searchParams.has('version')) { const version = strictVersion(url.searchParams.get('version') || ''); const state = await versionState(env, version); return reply({ success: true, version, disabled: Boolean(state.row), item: state.row, revision: state.revision }) }
  const query = pagination(url)
  const found = await rows<VersionRow>(env.DB.prepare(`SELECT ${VERSION_FIELDS} FROM disabled_versions WHERE instr(lower(version),lower(?))>0 OR instr(lower(coalesce(reason,'')),lower(?))>0 ORDER BY julianday(created_at) DESC,version ASC LIMIT 26 OFFSET ?`).bind(query.query, query.query, (query.page - 1) * query.limit))
  return reply({ success: true, view: 'versions', ...query, items: found.slice(0, 25), has_more: found.length > 25 })
}
async function versionWrite(request: Request, env: Database, actor: string) {
  const body = await readPolicyAdminInput(request)
  if (Object.keys(body).some((key) => !['version', 'disabled', 'expected_revision', 'request_id', 'reason'].includes(key)) || typeof body.version !== 'string' || typeof body.disabled !== 'boolean' || typeof body.expected_revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expected_revision) || typeof body.request_id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id) || request.headers.get('Idempotency-Key') !== body.request_id || typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 1000) throw new PolicyAdminError('invalid_policy_change', 400)
  const version = strictVersion(body.version); const reason = body.reason.trim(); const auditId = 'admin-version:' + body.request_id
  const fingerprint = await digest([actor, version, body.disabled, body.expected_revision, reason])
  const auditRead = () => env.DB.prepare("SELECT email,reason FROM policy_audit WHERE id=? AND requested_action='policy.version.update'").bind(auditId)
  const replay = (audit: { email: string | null; reason: string } | null) => {
    if (!audit) return null
    let saved: { fingerprint?: string; revision?: string }
    try { saved = JSON.parse(audit.reason) } catch { throw new PolicyAdminError('policy_write_unconfirmed', 503) }
    if (audit.email !== actor || saved.fingerprint !== fingerprint || !/^[a-f0-9]{64}$/.test(saved.revision || '')) throw new PolicyAdminError('policy_request_conflict', 409)
    return { success: true, version, disabled: body.disabled, request_id: body.request_id, revision: saved.revision, replay: true }
  }
  const prior = replay(await auditRead().first<{ email: string | null; reason: string }>())
  if (prior) return reply(prior)
  const state = await versionState(env, version)
  if (state.revision !== body.expected_revision || Boolean(state.row) === body.disabled) throw new PolicyAdminError('policy_state_changed', 409)
  const now = new Date().toISOString()
  const next = body.disabled ? { version, reason, created_at: now } : null
  const revision = await digest([version, next, state.stamp + 1])
  const currentStamp = 'coalesce((SELECT revision FROM disabled_version_revisions WHERE version=?),0)=?'
  const change = body.disabled
    ? env.DB.prepare(`INSERT INTO disabled_versions (version,reason,created_at) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM disabled_versions WHERE lower(version)=?) AND ${currentStamp}`).bind(version, reason, now, version, version, state.stamp)
    : env.DB.prepare(`DELETE FROM disabled_versions WHERE version=? AND reason IS ? AND created_at=? AND ${currentStamp}`).bind(state.row!.version, state.row!.reason, state.row!.created_at, version, state.stamp)
  const result = await env.DB.batch([
    change,
    env.DB.prepare("INSERT INTO policy_audit (id,email,requested_action,decision,reason,created_at) SELECT ?,?,'policy.version.update','allow',?,? WHERE changes()=1").bind(auditId, actor, JSON.stringify({ version, fingerprint, revision, reason, before: state.row, after: next }), now),
    auditRead(),
  ])
  if (result.some((item) => !item.success)) throw new PolicyAdminError('policy_write_unconfirmed', 503)
  const confirmation = replay((result[2].results[0] || null) as { email: string | null; reason: string } | null)
  if (!confirmation) throw new PolicyAdminError('policy_state_changed', 409)
  return reply({ ...confirmation, replay: result[0].meta.changes === 0 })
}
function rules(row: Pick<PlanRow, 'features_json' | 'limits_json' | 'blocked_actions_json'>) {
  let nodes = 0
  const valid = (value: Json, depth = 0): boolean => {
    if (++nodes > 1000 || depth > 10) return false
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
    if (typeof value === 'number') return Number.isFinite(value)
    return typeof value === 'object' && (Array.isArray(value) ? value : Object.values(value)).every((item) => valid(item, depth + 1))
  }
  try {
    if ([row.features_json, row.limits_json, row.blocked_actions_json].some((value) => value != null && value.length > 65536)) throw new Error('oversized')
    const features = JSON.parse(row.features_json ?? '{}'); const limits = JSON.parse(row.limits_json ?? '{}'); const blocked_actions = JSON.parse(row.blocked_actions_json ?? '[]')
    if (!features || typeof features !== 'object' || Array.isArray(features) || !limits || typeof limits !== 'object' || Array.isArray(limits) || !Array.isArray(blocked_actions) || blocked_actions.some((item) => typeof item !== 'string') || !valid(features) || !valid(limits) || !valid(blocked_actions)) throw new Error('invalid')
    return { valid: true as const, features: features as Record<string, Json>, limits: limits as Record<string, Json>, blocked_actions: blocked_actions as string[] }
  } catch { return { valid: false as const, features: null, limits: null, blocked_actions: null } }
}
async function planRead(request: Request, env: Database) {
  const url = new URL(request.url)
  if (url.searchParams.has('plan')) {
    const id = (url.searchParams.get('plan') || '').trim()
    if (!id || id.length > 160) throw new PolicyAdminError('invalid_policy_query', 400)
    const plan = await env.DB.prepare(`SELECT ${PLAN_FIELDS} FROM plan_features WHERE plan_id=?`).bind(id).first<PlanRow>()
    if (!plan) throw new PolicyAdminError('policy_plan_not_found', 404)
    const global = await env.DB.prepare("SELECT features_json,limits_json,blocked_actions_json FROM global_policy WHERE id='global'").first<PlanRow>().catch(() => null)
    return reply({ success: true, plan_id: id, updated_at: plan.updated_at, rules: rules(plan), global_rules: global ? rules(global) : null })
  }
  const query = pagination(url)
  const found = await rows<PlanRow>(env.DB.prepare(`SELECT ${PLAN_FIELDS} FROM plan_features WHERE instr(lower(plan_id),lower(?))>0 ORDER BY plan_id ASC LIMIT 26 OFFSET ?`).bind(query.query, (query.page - 1) * query.limit))
  return reply({ success: true, view: 'plans', ...query, has_more: found.length > 25, items: found.slice(0, 25).map((row) => { const config = rules(row); return { plan_id: row.plan_id, updated_at: row.updated_at, valid: config.valid, features_count: config.valid ? Object.keys(config.features).length : null, limits_count: config.valid ? Object.keys(config.limits).length : null, blocked_actions_count: config.valid ? config.blocked_actions.length : null } }) })
}
export async function handleAdminPolicyRecords(request: Request, env: Database, actor: string): Promise<Response> {
  try { return new URL(request.url).pathname.endsWith('/disabled-versions') ? request.method === 'GET' ? await versionRead(request, env) : await versionWrite(request, env, actor) : await planRead(request, env) }
  catch (error) { return reply({ success: false, error: error instanceof PolicyAdminError ? error.message : request.method === 'GET' ? 'policy_records_unavailable' : 'policy_write_unconfirmed' }, error instanceof PolicyAdminError ? error.status : 503) }
}
