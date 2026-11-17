import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { cloudflareWorkersTestShim } from './esbuild-cloudflare-test-shim.mjs'

const source = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const adminSource = fs.readFileSync(new URL('../src/invite_admin.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../migrations/0015_invite_atomic_claims.sql', import.meta.url), 'utf8')

assert.match(adminSource, /generateInviteCode\(\)/, 'invite codes must use the centralized secure generator')
assert.match(adminSource, /crypto\.subtle\.digest\('SHA-256'/, 'only the code hash may be persisted')
assert.match(adminSource, /shown_once:\s*created/, 'new plaintext codes must be marked as shown once')
assert.match(adminSource, /creation_request_id=\?1/, 'invite creation must be idempotent')
assert.match(source, /env\.DB\.batch\(\[\.\.\.claimStatements, consumeStatement\]\)/, 'scope claims and consumption must share a D1 transaction')
assert.match(source, /used_count = used_count \+ 1/, 'max-use consumption must be atomic')
assert.match(migration, /PRIMARY KEY \(invite_code_id, claim_type, claim_value\)/, 'scope claims require a unique key')
assert.match(source, /INSERT INTO invite_code_claims[\s\S]+WHERE EXISTS \(SELECT 1 FROM invite_codes/, 'claims must only be inserted while capacity is available')
assert.doesNotMatch(source, /SELECT[^\n]+code_hash[^\n]+FROM invite_codes[^\n]+\/v1\/admin/i, 'admin list must not expose code hashes')

console.log('Invite security contract checks passed.')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(path.join(root, 'node_modules', '.saturnws-invite-test-'))
let mf
try {
  await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(temp, 'worker.mjs'), logLevel: 'silent', plugins: [cloudflareWorkersTestShim] })
  const token = 'fixture-local-invite-admin-token'
  mf = new Miniflare({ rootPath: temp, modules: true, modulesRoot: temp, scriptPath: 'worker.mjs', compatibilityDate: '2026-05-28', d1Databases: ['DB'], bindings: { ADMIN_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'), POLICY_SIGNING_SEED_B64: Buffer.alloc(32, 3).toString('base64') } })
  const db = await mf.getD1Database('DB')
  for (const name of (await readdir(path.join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(path.join(root, 'migrations', name), 'utf8')).replace(/^\s*--.*$/gm, '').replace(/\r?\n/g, ' '))
  }
  async function request(route, body, authenticated = true) {
    const response = await mf.dispatchFetch('https://api.saturnws.com/v1/admin/invites' + route, { method: body ? 'POST' : 'GET', headers: { ...(authenticated ? { Authorization: 'Bearer ' + token, 'X-Saturn-Admin-Actor': 'fixture-admin@example.test' } : {}), ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': body.request_id || 'not-applicable' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }
  assert.equal((await request('?view=management', undefined, false)).status, 401)
  const input = { request_id: 'fixture-request-0001', note: 'Synthetic rollout', max_uses: 3, scope: { channels: ['beta'] }, restrictions: { one_per_user: true, emails: ['fixture@example.test'] } }
  const concurrent = await Promise.all([request('/create', input), request('/create', input)])
  assert.deepEqual(concurrent.map((r) => r.status), [200, 200])
  const created = concurrent.find((r) => r.data.code)
  const replay = concurrent.find((r) => !r.data.code)
  assert.ok(created); assert.ok(replay)
  assert.equal(created.data.item.id, replay.data.item.id); assert.equal(replay.data.replay, true); assert.equal(replay.data.shown_once, false)
  const id = created.data.item.id
  const stored = await db.prepare('SELECT * FROM invite_codes WHERE id=?').bind(id).first()
  assert.equal(stored.code_hash, createHash('sha256').update(created.data.code).digest('hex'))
  assert.ok(!JSON.stringify(stored).includes(created.data.code))
  assert.equal((await db.prepare("SELECT count(*) AS n FROM policy_audit WHERE requested_action='invite.create'").first()).n, 1)
  assert.equal((await request('/create', { ...input, note: 'Changed values' })).status, 409)
  assert.equal((await request('/create', { ...input, request_id: 'fixture-invalid-scope', scope: { channels: Array.from({ length: 21 }, (_, i) => 'channel' + i) } })).status, 400)
  assert.equal((await request('/create', { ...input, request_id: 'fixture-invalid-bool', restrictions: { one_per_user: 'true' } })).status, 400)
  assert.equal((await request('/create', { ...input, request_id: 'fixture-unknown-scope', scope: { typo_channels: ['beta'] } })).status, 400)
  assert.equal((await request('/create', { ...input, request_id: 'fixture-unknown-body', restriction: { emails: ['fixture@example.test'] } })).status, 400)
  const malformedBody = await mf.dispatchFetch('https://api.saturnws.com/v1/admin/invites/create', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': 'fixture-malformed-body', 'Content-Type': 'application/json' }, body: '{invalid' })
  assert.equal(malformedBody.status, 400)
  assert.equal((await request('/create', { ...input, request_id: 'fixture-invalid-expiry', expires_at: '2020-01-01' })).status, 400)
  for (let n = 0; n < 105; n++) {
    await db.prepare("INSERT INTO invite_codes (id,code_hash,status,note,used_count,max_uses,expires_at) VALUES (?,?,'active',?,?,?,?)").bind(`fixture-${String(n).padStart(3, '0')}`, `fixture-hash-${n}`, n === 0 ? 'Literal %_ value' : 'Synthetic ' + n, n === 2 ? 1 : 0, n === 2 ? 1 : null, n === 1 ? '2020-01-01' : null).run()
  }
  const list = await request('?view=management')
  assert.equal(list.data.items.length, 25); assert.equal(list.data.has_more, true)
  assert.ok(!JSON.stringify(list.data).includes('code_hash')); assert.ok(!JSON.stringify(list.data).includes('creation_request_id'))
  assert.equal((await request('?view=management&query=' + id)).data.items[0].restrictions.one_per_user, true)
  const pages = []
  for (let page = 1; page <= 5; page++) pages.push(...(await request('?view=management&page=' + page)).data.items.map((r) => r.id))
  assert.equal(pages.length, 106); assert.equal(new Set(pages).size, 106)
  assert.equal((await request('?view=management&status=expired')).data.items[0].id, 'fixture-001')
  assert.equal((await request('?view=management&status=exhausted')).data.items[0].id, 'fixture-002')
  assert.equal((await request('?view=management&query=%25_')).data.items.length, 1)
  for (const query of ['page=1.5', 'page=5001', 'limit=101', 'status=typo']) assert.equal((await request('?view=management&' + query)).status, 400)
  for (let n = 0; n < 31; n++) await db.prepare("INSERT INTO invite_code_validations (id,invite_code_id,email,result,created_at) VALUES (?,?,?,'valid','2026-11-10 10:00:00')").bind('use-' + n.toString().padStart(2, '0'), id, 'fixture@example.test').run()
  const detail = await request('/usage?view=management&invite_id=' + id)
  assert.equal(detail.data.item.id, id); assert.equal(detail.data.items.length, 25); assert.equal(detail.data.has_more, true)
  assert.equal((await request('/usage?view=management&invite_id=' + id + '&page=2')).data.items.length, 6)
  assert.equal((await request('/usage?view=management&invite_id=missing')).status, 404)
  await db.exec("CREATE TRIGGER fixture_fail_invite_audit BEFORE INSERT ON policy_audit WHEN NEW.requested_action LIKE 'invite.%' BEGIN SELECT RAISE(ABORT,'fixture audit unavailable'); END;")
  const failedInput = { ...input, request_id: 'fixture-audit-rollback' }
  assert.equal((await request('/create', failedInput)).status, 503)
  assert.equal((await db.prepare('SELECT count(*) AS n FROM invite_codes WHERE creation_request_id=?').bind(failedInput.request_id).first()).n, 0)
  assert.equal((await request('/revoke', { invite_id: id, reason: 'Fixture revoke' })).status, 503)
  assert.equal((await db.prepare('SELECT status FROM invite_codes WHERE id=?').bind(id).first()).status, 'active')
  await db.exec('DROP TRIGGER fixture_fail_invite_audit')
  const revocations = await Promise.all([request('/revoke', { invite_id: id, reason: 'Fixture revoke' }), request('/revoke', { invite_id: id, reason: 'Fixture revoke' })])
  assert.deepEqual(revocations.map((r) => r.status), [200, 200])
  assert.equal((await db.prepare("SELECT count(*) AS n FROM policy_audit WHERE requested_action='invite.revoke'").first()).n, 1)
  assert.equal((await request('/create', input)).data.code, null)
  assert.equal((await request('?view=management&status=revoked')).data.items[0].id, id)
  assert.equal((await db.prepare('SELECT count(*) AS n FROM invite_code_validations WHERE invite_code_id=?').bind(id).first()).n, 31)
  await db.exec('DROP TABLE invite_code_validations')
  const unavailable = await request('/usage?view=management&invite_id=' + id)
  assert.equal(unavailable.status, 503); assert.equal(unavailable.data.error, 'invite_read_unavailable')
  console.log('Invite runtime checks passed: roles, literal search, paging, effective states, restrictions, same-request concurrency, hash-only storage, one-time replay, usage history, audit rollback, idempotent revoke, and unavailable reads.')
} finally {
  await mf?.dispose()
  await rm(temp, { recursive: true, force: true })
}
