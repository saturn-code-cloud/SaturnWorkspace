import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { cloudflareWorkersTestShim } from './esbuild-cloudflare-test-shim.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(path.join(root, 'node_modules', '.saturnws-policy-admin-test-'))
let mf
try {
  await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(temp, 'worker.mjs'), logLevel: 'silent', plugins: [cloudflareWorkersTestShim] })
  const token = 'fixture-local-global-policy-admin-token'
  mf = new Miniflare({ rootPath: temp, modules: true, modulesRoot: temp, scriptPath: 'worker.mjs', compatibilityDate: '2026-05-28', d1Databases: ['DB'], bindings: { ADMIN_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'), POLICY_SIGNING_SEED_B64: Buffer.alloc(32, 5).toString('base64') } })
  const db = await mf.getD1Database('DB')
  for (const name of (await readdir(path.join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) await db.exec((await readFile(path.join(root, 'migrations', name), 'utf8')).replace(/^\s*--.*$/gm, '').replace(/\r?\n/g, ' '))
  const readRow = () => db.prepare("SELECT * FROM global_policy WHERE id='global'").first()
  async function request(body, { authenticated = true, actor = 'fixture-admin@example.test', raw, headerKey, path = '/global-policy' } = {}) {
    const response = await mf.dispatchFetch('https://api.saturnws.com/v1/admin' + path, { method: body || raw ? 'POST' : 'GET', headers: { ...(authenticated ? { Authorization: 'Bearer ' + token, 'X-Saturn-Admin-Actor': actor } : {}), ...(body || raw ? { 'Content-Type': 'application/json', 'Idempotency-Key': headerKey ?? body?.request_id ?? '' } : {}) }, ...(body || raw ? { body: raw ?? JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }
  assert.equal((await request(undefined, { authenticated: false })).status, 401)
  assert.equal((await mf.dispatchFetch('https://api.saturnws.com/admin')).status, 404)
  await db.prepare("UPDATE global_policy SET blocked_actions_json=?,features_json=?,limits_json=? WHERE id='global'").bind('["fixture_action"]', '{"fixture_feature":false}', '{"fixture_limit":37}').run()
  const first = await request(); assert.equal(first.status, 200)
  assert.deepEqual(Object.keys(first.data.policy).sort(), ['kill_switch_enabled', 'mandatory_update_enabled', 'minimum_supported_version', 'revision', 'update_mode', 'updated_at'])
  assert.doesNotMatch(JSON.stringify(first.data), /fixture_action|fixture_feature|fixture_limit|features_json|users|support_threads/)
  const input = { request_id: 'fixture-global-policy-001', expected_revision: first.data.policy.revision, kill_switch_enabled: false, mandatory_update_enabled: true, minimum_supported_version: '1.2.32', update_mode: 'optional', reason: 'Synthetic update review' }
  const original = await readRow()
  for (const body of [{ ...input, features: {} }, { ...input, kill_switch_enabled: 'false' }, { ...input, update_mode: 'typo' }, { ...input, minimum_supported_version: 'not a version' }, { ...input, expected_revision: '' }, { ...input, reason: '' }, { reason: 'Legacy client' }]) assert.equal((await request(body)).status, 400)
  assert.equal((await request(undefined, { raw: '{broken' })).status, 400)
  assert.equal((await request(undefined, { raw: JSON.stringify({ padding: 'x'.repeat(5000) }) })).status, 400)
  assert.equal((await request(input, { headerKey: 'different-key' })).status, 400)
  assert.deepEqual(await readRow(), original)
  const simultaneous = await Promise.all([request(input), request(input)])
  assert.deepEqual(simultaneous.map((result) => result.status), [200, 200]); assert.equal(simultaneous.filter((result) => !result.data.replay).length, 1)
  assert.equal(simultaneous[0].data.revision, simultaneous[1].data.revision)
  const updated = await readRow()
  for (const column of ['features_json', 'limits_json', 'blocked_actions_json']) assert.equal(updated[column], original[column])
  assert.equal(updated.minimum_supported_version, '1.2.32'); assert.equal(updated.mandatory_update_enabled, 1)
  assert.equal((await db.prepare("SELECT count(*) AS n FROM policy_audit WHERE requested_action='policy.global.update'").first()).n, 1)
  assert.equal((await request({ ...input, reason: 'Different values under same key' })).status, 409)
  assert.equal((await request(input, { actor: 'other-admin@example.test' })).status, 409)
  assert.equal((await request({ ...input, request_id: 'fixture-global-policy-stale' })).data.error, 'policy_state_changed')
  const latest = (await request()).data.policy
  assert.equal(latest.revision, simultaneous[0].data.revision)
  const competing = await Promise.all([request({ ...input, expected_revision: latest.revision, request_id: 'fixture-global-policy-002', kill_switch_enabled: true }), request({ ...input, expected_revision: latest.revision, request_id: 'fixture-global-policy-003', update_mode: 'mandatory' })])
  assert.deepEqual(competing.map((result) => result.status).sort(), [200, 409])
  const beforeReplay = await readRow()
  assert.equal((await request(input)).data.replay, true); assert.deepEqual(await readRow(), beforeReplay)
  const next = (await request()).data.policy
  const rollback = { ...input, request_id: 'fixture-global-policy-rollback', expected_revision: next.revision, kill_switch_enabled: !Boolean(next.kill_switch_enabled), mandatory_update_enabled: !Boolean(next.mandatory_update_enabled) }
  await db.exec("CREATE TRIGGER fixture_policy_audit_failure BEFORE INSERT ON policy_audit WHEN NEW.requested_action='policy.global.update' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;")
  const failed = await request(rollback); assert.equal(failed.status, 503); assert.equal(failed.data.error, 'policy_write_unconfirmed')
  assert.deepEqual(await readRow(), beforeReplay)
  await db.exec('DROP TRIGGER fixture_policy_audit_failure')
  assert.equal((await request(rollback)).status, 200)
  await db.exec("UPDATE global_policy SET kill_switch_enabled=0,mandatory_update_enabled=0,minimum_supported_version='',update_mode='optional'")
  const versionState = async (version) => (await request(undefined, { path: '/disabled-versions?version=' + encodeURIComponent(version) })).data
  const stampCount = async () => (await db.prepare('SELECT count(*) AS n FROM disabled_version_revisions').first()).n
  const initialStamps = await stampCount()
  const absent = await versionState('1.2.33'); assert.equal(absent.disabled, false); assert.equal(absent.item, null)
  assert.equal(await stampCount(), initialStamps)
  await db.prepare("INSERT INTO policy_audit (id,requested_action,decision,reason,created_at) VALUES ('fixture-runtime-event','policy.version.update','allow',?,'2099-01-01')").bind(JSON.stringify({ version: '1.2.33' })).run()
  assert.equal((await versionState('1.2.33')).revision, absent.revision)
  const versionInput = { version: '1.2.33', disabled: true, expected_revision: absent.revision, request_id: 'fixture-version-disable-001', reason: 'Synthetic faulty version' }
  const versionRequest = (body, options = {}) => request(body, { ...options, path: '/disabled-versions' })
  const disabled = await Promise.all([versionRequest(versionInput), versionRequest(versionInput)])
  assert.deepEqual(disabled.map((result) => result.status), [200, 200]); assert.equal(disabled.filter((result) => !result.data.replay).length, 1)
  let snapshot = await versionState('1.2.33'); assert.equal(snapshot.disabled, true); assert.equal(snapshot.revision, disabled[0].data.revision)
  const stamp = async () => (await db.prepare("SELECT revision FROM disabled_version_revisions WHERE version='1.2.33'").first()).revision
  assert.equal(await stamp(), 1); assert.equal(await stampCount(), initialStamps + 1)
  const lookupPlan = await db.prepare("EXPLAIN QUERY PLAN SELECT d.version,r.revision FROM (SELECT '1.2.33' AS version) s LEFT JOIN disabled_versions d ON lower(d.version)=s.version LEFT JOIN disabled_version_revisions r ON r.version=s.version").all()
  assert.match(JSON.stringify(lookupPlan.results), /idx_disabled_versions_lookup/); assert.match(JSON.stringify(lookupPlan.results), /sqlite_autoindex_disabled_version_revisions/)
  const evaluated = await mf.dispatchFetch('https://api.saturnws.com/v1/policy/check', { method: 'POST', body: JSON.stringify({ app_version: '1.2.33', requested_action: 'app_start' }), headers: { 'Content-Type': 'application/json' } })
  assert.equal((await evaluated.json()).decision, 'disabled_version')
  const enable = { ...versionInput, disabled: false, expected_revision: snapshot.revision, request_id: 'fixture-version-enable-001', reason: 'Synthetic recovery' }
  await db.exec("CREATE TRIGGER fixture_version_audit_failure BEFORE INSERT ON policy_audit WHEN NEW.requested_action='policy.version.update' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;")
  assert.equal((await versionRequest(enable)).status, 503); assert.equal((await versionState('1.2.33')).disabled, true)
  assert.equal(await stamp(), 1)
  await db.exec('DROP TRIGGER fixture_version_audit_failure')
  assert.equal((await versionRequest(enable)).status, 200); snapshot = await versionState('1.2.33'); assert.equal(snapshot.disabled, false)
  assert.equal(await stamp(), 2)
  assert.notEqual(snapshot.revision, absent.revision)
  assert.equal((await versionRequest({ ...versionInput, request_id: 'fixture-version-stale-absence' })).status, 409)
  assert.equal((await versionRequest(versionInput)).data.replay, true); assert.equal((await versionState('1.2.33')).disabled, false)
  assert.equal((await versionRequest({ ...versionInput, reason: 'Changed same request' })).status, 409)
  const rivals = await Promise.all([versionRequest({ ...versionInput, request_id: 'fixture-version-rival-001', expected_revision: snapshot.revision }), versionRequest({ ...versionInput, request_id: 'fixture-version-rival-002', expected_revision: snapshot.revision })])
  assert.deepEqual(rivals.map((result) => result.status).sort(), [200, 409])
  snapshot = await versionState('1.2.33')
  await db.prepare('UPDATE disabled_versions SET reason=? WHERE version=?').bind('External change', '1.2.33').run()
  assert.equal(await stamp(), 4)
  assert.equal((await versionRequest({ ...enable, request_id: 'fixture-version-external-change', expected_revision: snapshot.revision })).status, 409)
  for (let n = 0; n < 60; n++) await db.prepare('INSERT INTO disabled_versions (version,reason) VALUES (?,?)').bind('1.3.' + n, n === 0 ? 'Literal %_ reason' : 'Synthetic ' + n).run()
  const seen = []
  for (let page = 1; page <= 3; page++) { const result = await request(undefined, { path: '/disabled-versions?page=' + page }); assert.equal(result.status, 200); seen.push(...result.data.items.map((row) => row.version)) }
  const versionCount = (await db.prepare('SELECT count(*) AS n FROM disabled_versions').first()).n
  assert.equal(new Set(seen).size, versionCount); assert.equal(seen.length, versionCount)
  assert.equal((await request(undefined, { path: '/disabled-versions?query=%25_' })).data.items.length, 1)
  for (const query of ['page=1.5', 'page=5001', 'version=bad']) assert.equal((await request(undefined, { path: '/disabled-versions?' + query })).status, 400)
  assert.equal((await versionRequest({ version: '1.3.1', disabled: false })).status, 400)
  const planList = await request(undefined, { path: '/plan-features' }); assert.equal(planList.status, 200); assert.equal(planList.data.items.length, 3)
  assert.ok(planList.data.items.every((row) => row.valid)); assert.doesNotMatch(JSON.stringify(planList.data), /features_json|blocked_actions_json|limits_json/)
  await db.prepare("UPDATE plan_features SET features_json=? WHERE plan_id='starter'").bind('{broken').run()
  const invalidPlan = (await request(undefined, { path: '/plan-features?query=starter' })).data.items[0]
  assert.equal(invalidPlan.valid, false); assert.equal(invalidPlan.features_count, null)
  const detail = (await request(undefined, { path: '/plan-features?plan=pro' })).data
  assert.equal(detail.plan_id, 'pro'); assert.equal(detail.rules.features.cloud_sync, true); assert.deepEqual(detail.global_rules.features, { fixture_feature: false })
  assert.equal((await request(undefined, { path: '/plan-features?plan=missing' })).status, 404)
  assert.equal((await request(undefined, { path: '/plan-features', authenticated: false })).status, 401)
  for (let n = 0; n < 30; n++) await db.prepare("INSERT INTO plan_features (plan_id,features_json,limits_json,blocked_actions_json) VALUES (?,'{}','{}','[]')").bind('fixture-plan-' + String(n).padStart(2, '0')).run()
  assert.equal((await request(undefined, { path: '/plan-features' })).data.has_more, true); assert.equal((await request(undefined, { path: '/plan-features?page=2' })).data.items.length, 8)
  assert.equal((await request(undefined, { path: '/plan-features?query=%25_' })).data.items.length, 0)
  await db.prepare("INSERT INTO disabled_versions (version,reason) VALUES ('9.8.7','rename fixture')").run()
  await db.prepare("UPDATE disabled_versions SET version='9.8.8' WHERE version='9.8.7'").run()
  assert.equal((await db.prepare("SELECT revision FROM disabled_version_revisions WHERE version='9.8.7'").first()).revision, 2)
  assert.equal((await db.prepare("SELECT revision FROM disabled_version_revisions WHERE version='9.8.8'").first()).revision, 1)
  const stableState = (await versionState('1.2.33')).revision
  await db.exec("DELETE FROM policy_audit WHERE requested_action='policy.version.update'")
  assert.equal((await versionState('1.2.33')).revision, stableState)
  assert.equal((await versionRequest(versionInput)).status, 409)
  await db.exec('DROP TABLE disabled_version_revisions')
  assert.equal((await request(undefined, { path: '/disabled-versions?version=1.2.33' })).status, 503)
  assert.equal((await versionRequest({ ...versionInput, request_id: 'fixture-missing-version-schema' })).status, 503)
  await db.exec('DROP TABLE global_policy')
  const partial = await request(undefined, { path: '/plan-features?plan=pro' }); assert.equal(partial.status, 200); assert.equal(partial.data.global_rules, null); assert.equal(partial.data.rules.valid, true)
  await db.exec('DROP TABLE plan_features')
  assert.equal((await request(undefined, { path: '/plan-features' })).data.error, 'policy_records_unavailable')
  assert.equal((await request()).data.error, 'policy_state_unavailable')
  assert.equal((await request({ ...rollback, request_id: 'fixture-global-policy-missing' })).status, 503)
  console.log('Policy administration runtime checks passed: scoped reads, bounded inputs, hidden-field preservation, version evaluation, atomic audits, same-key replay, concurrent/stale edits including enable/disable cycles, literal search, pagination, malformed rules, and partial-source recovery.')
} finally {
  await mf?.dispose()
  await rm(temp, { recursive: true, force: true })
}
