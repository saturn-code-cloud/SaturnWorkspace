import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { resolveSubscriptionTruth } from '../../shared/subscriptions/resolver.js'

const db = new PGlite()
const migration = (name) => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')
const signature = 'public.admin_user_directory(text,boolean,text,text,text,text,integer,integer)'
const query = async (inputs = {}) => {
  const { search = '', exact = false, status = '', verification = '', subscription = '', sort = 'created_desc', page = 1, limit = 25 } = inputs
  const result = await db.query('select public.admin_user_directory($1,$2,$3,$4,$5,$6,$7,$8) as directory', [search, exact, status, verification, subscription, sort, page, limit])
  return result.rows[0].directory
}
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create function public.touch_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = current_timestamp; return new; end;
    $$;
  `)
  for (const name of ['004_device_login_sessions.sql', '005_account_subscriptions.sql', '009_account_profiles.sql']) {
    const sql = await migration(name)
    await db.exec(sql.replace(/^create extension if not exists pgcrypto;\s*/m, ''))
  }
  const commercial = await migration('20260622094706_phase_e_commercial_truth.sql')
  const alter = commercial.slice(commercial.indexOf('alter table public.account_subscriptions'), commercial.indexOf('update public.account_subscriptions'))
  await db.exec(alter)
  await db.exec('grant select on public.account_subscriptions, public.app_sessions, public.device_login_sessions to service_role;')
  await db.exec(await migration('20261113141600_admin_user_directory.sql'))
  await db.exec(`
    insert into account_profiles(firebase_uid, normalized_email, display_name, created_at)
      select 'bulk-' || lpad(n::text,4,'0'), 'bulk-' || n || '@example.test', 'Bulk account', '2026-01-01'
      from generate_series(1, 1075) n;
    insert into account_profiles(firebase_uid, normalized_email, display_name, created_at, email_verified_at, account_status)
      values ('target', 'a%_+literal@example.test', 'حساب تجريبي', '2025-12-31', '2026-01-01', 'active'),
             ('other', 'other@example.test', 'a%_+literal@example.test', '2026-01-02', null, 'suspended'),
             ('plain', 'a12+literal@example.test', 'Plain', '2026-01-02', null, 'active');
    insert into app_sessions(session_token_hash,user_id,hwid,expires_at,created_at,last_seen_at,revoked_at)
      select 'fixture-noise-' || n, 'other', 'fixture-other-device', now()+interval '1 hour', now(), now(), null
      from generate_series(1, 2100) n;
    insert into app_sessions(session_token_hash,user_id,hwid,expires_at,created_at,last_seen_at,revoked_at)
      values ('fixture-active','target','fixture-device-one',now()+interval '1 hour', now()-interval '4 days', now()-interval '2 days',null),
             ('fixture-expired','target','fixture-device-two',now()-interval '1 hour', now()-interval '5 days',null,null),
             ('fixture-revoked','target','fixture-device-one',now()+interval '1 hour', now()-interval '3 days',null,now());
    insert into device_login_sessions(device_code,user_code,user_id,hwid,expires_at,created_at,authorized_at,consumed_at)
      values ('fixture-device-secret','fixture-user-secret','target','fixture-device-one',now()+interval '1 hour',now()-interval '4 days',now()-interval '3 days',now()-interval '1 day'),
             ('fixture-device-alt','fixture-user-alt','target','fixture-device-three',now()+interval '1 hour',now()-interval '5 days',null,null);
  `)
  const fixtures = [
    ['none', []],
    ['active', [{ state: 'active' }]],
    ['history', [{ state: 'active', past: true }]],
    ['lifetime', [{ state: 'active', past: true, metadata: { is_unlimited: 'TRUE' } }]],
    ['scheduled', [{ state: 'active', future: true }]],
    ['malformed', [{ state: 'unknown', past: true }]],
    ['conflict', [{ state: 'active' }, { state: 'trialing' }]],
    ['trial', [{ state: 'trial' }]],
    ['renewal', [{ state: 'past_due', metadata: { cancel_at_period_end: true } }]],
    ['cancelled', [{ state: 'canceled' }]],
    ['legacy', [{ state: null }]],
    ['mismatch', [{ state: 'active', owner: 'different-owner' }]],
    ['email-only', [{ state: 'active', owner: null }]],
  ]
  const now = new Date()
  const iso = (days) => new Date(now.getTime() + days * 86400000).toISOString()
  for (const [uid, states] of fixtures) {
    await db.query('insert into account_profiles(firebase_uid,normalized_email,display_name) values($1,$2,$3)', [uid, uid + '@fixture.test', 'Subscription parity'])
    for (const row of states) {
      await db.query(`insert into account_subscriptions(firebase_user_id,user_email,status,lifecycle_state,starts_at,expires_at,metadata)
        values($1,$2,'active',$3,$4,$5,$6)`,
      [Object.hasOwn(row, 'owner') ? row.owner : uid, uid + '@fixture.test', row.state, iso(row.future ? 1 : -14), iso(row.past ? -1 : 15), row.metadata || {}])
    }
  }
  await db.query("insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at) values('target','a%_+literal@example.test',$1,$2)", [iso(-14), iso(15)])
  await db.query(`insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,created_at)
    select 'other','other@example.test',$1,$2,now() from generate_series(1,1100)`, [iso(-15), iso(-1)])
  const { rows: subscriptionRows } = await db.query('select * from account_subscriptions')
  for (const role of ['anon', 'authenticated']) {
    const { rows: [row] } = await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, signature])
    assert.equal(row.allowed, false)
    await db.exec('set role ' + role)
    await assert.rejects(query(), /permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  const first = await query({ search: 'Bulk account', limit: 100 })
  const eleventh = await query({ search: 'bulk ACCOUNT', limit: 100, page: 11 })
  assert.deepEqual([first.total, first.items.length, eleventh.total, eleventh.items.length], [1075, 100, 1075, 75])
  assert.equal(eleventh.items[0].firebase_uid, 'bulk-1001')
  assert.deepEqual(await query({ search: 'Bulk account', limit: 100, page: 12 }), { total: 1075, items: [] })
  const direct = await query({ search: 'A%_+LITERAL@EXAMPLE.TEST', exact: true })
  assert.equal(direct.total, 1)
  assert.equal(direct.items[0].firebase_uid, 'target')
  assert.equal(direct.items[0].subscription_presence, 'active')
  assert.equal(direct.items[0].session_count, 1)
  assert.equal(direct.items[0].device_count, 3)
  assert.doesNotMatch(JSON.stringify(direct), /hwid|fixture-device|session_token|device_code|user_code|metadata|activity_sort/)
  assert.deepEqual((await query({ search: '%_+' })).items.map((row) => row.firebase_uid), ['other', 'target'])
  assert.deepEqual((await query({ search: 'حساب', verification: 'verified', subscription: 'active' })).items.map((row) => row.firebase_uid), ['target'])
  assert.equal((await query({ search: 'حساب', verification: 'unverified' })).total, 0)
  assert.equal((await query({ verification: 'verified' })).total, 1)
  assert.deepEqual((await query({ status: 'suspended', subscription: 'history_only' })).items.map((row) => row.firebase_uid), ['other'])
  assert.deepEqual((await query({ sort: 'activity_desc', limit: 2 })).items.map((row) => row.firebase_uid), ['other', 'target'])
  assert.deepEqual(await query({ search: 'missing@example.test', exact: true }), { total: 0, items: [] })
  const parity = await query({ search: 'Subscription parity' })
  assert.equal(parity.total, fixtures.length)
  for (const row of parity.items) {
    const truth = resolveSubscriptionTruth(subscriptionRows, { firebaseUid: row.firebase_uid, email: row.email }, { now })
    const expected = truth.diagnostics.integrity !== 'ok' ? 'integrity_conflict' : truth.currentRow ? 'active' : truth.history.length ? 'history_only' : 'none'
    assert.equal(row.subscription_presence, expected, row.firebase_uid)
  }
  console.log('PASS User directory SQL: pages beyond 1,000, literal and exact search, live subscription parity, device/session aggregation, and service-only access.')
} finally {
  await db.close()
}
