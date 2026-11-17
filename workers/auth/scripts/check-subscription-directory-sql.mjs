import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { resolveSubscriptionTruth, subscriptionLifecycle, subscriptionPlanTerm } from '../../shared/subscriptions/resolver.js';

const db = new PGlite();
const migration = (name) => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
const call = async ({ search = '', lifecycle = '', term = '', source = '', current = '', integrity = '', page = 1, limit = 25, id = null, owner = null } = {}) =>
  (await db.query('select public.admin_subscription_directory($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
    [search, lifecycle, term, source, current, integrity, page, limit, id, owner])).rows[0].result;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;`);
  for (const name of ['004_device_login_sessions.sql', '005_account_subscriptions.sql']) {
    await db.exec((await migration(name)).replace(/^create extension if not exists pgcrypto;\s*/m, ''));
  }
  const commercial = await migration('20260622094706_phase_e_commercial_truth.sql');
  await db.exec(commercial.slice(commercial.indexOf('alter table public.account_subscriptions'), commercial.indexOf('update public.account_subscriptions')));
  await db.exec('grant select on account_subscriptions to service_role;');
  await db.exec(await migration('20261113160805_admin_subscription_directory.sql'));
  await db.exec(`insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,period_start_at,period_end_at,lifecycle_state,is_current,created_at,updated_at)
    select 'bulk-'||n,'bulk-'||n||'@example.test',now()-interval '5 days',now()+interval '5 days',now()-interval '5 days',now()+interval '5 days',
      'active',true,'2026-01-01','2026-01-01' from generate_series(1,1305) n;`);
  const variants = [
    ['active', 'active', -1, 1, true, 'monthly', {}],
    ['expired-current', 'active', -2, -1, true, 'monthly', {}],
    ['scheduled', 'active', 1, 2, true, 'monthly', {}],
    ['lifetime', 'active', -2, -1, true, 'lifetime', {}],
    ['legacy-lifetime', 'active', -2, -1, false, '', { is_unlimited: 'TRUE' }],
    ['trial', 'trial', -1, 1, true, '', {}],
    ['cancelled', 'canceled', -1, 1, false, '', {}],
    ['suspended', 'suspended', -1, 1, true, 'annual', {}],
    ['malformed', 'unknown', -2, -1, false, 'monthly', {}],
    ['grace', 'past_due', -1, 1, true, 'monthly', { grace_ends_at: new Date(Date.now() + 86400000).toISOString() }],
    ['ending', 'active', -1, 1, true, 'monthly', { cancel_at_period_end: true }],
    ['conflict', 'active', -1, 1, false, 'monthly', {}],
    ['conflict', 'trialing', -1, 1, false, 'annual', {}],
    ['email-only', 'active', -1, 1, true, 'monthly', {}],
    ['literal%_', 'active', -1, 1, true, 'monthly', {}],
  ];
  for (const [owner, lifecycle, start, end, current, term, metadata] of variants) {
    await db.query(`insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,period_start_at,period_end_at,lifecycle_state,is_current,plan_term,metadata)
      values($1,$2,now()+($3||' days')::interval,now()+($4||' days')::interval,now()+($3||' days')::interval,now()+($4||' days')::interval,$5,$6,$7,$8)`,
      [owner === 'email-only' ? null : owner, owner+'@example.test', String(start), String(end), lifecycle, current, term, JSON.stringify(metadata)]);
  }
  await db.exec('set role service_role;');
  const allRows = (await db.query('select * from account_subscriptions')).rows;
  const allIds = [];
  for (let page = 1; page <= 14; page++) {
    const result = await call({ page, limit: 100 });
    assert.equal(result.total, 1320);
    assert.equal(result.items.length, page === 14 ? 20 : 100);
    assert.ok(result.witnesses.length <= result.items.length * 3);
    allIds.push(...result.items.map(({ id }) => id));
    for (const row of result.items) {
      const uid = (row.firebase_user_id || '').trim();
      const full = allRows.filter((entry) => entry.firebase_user_id === uid);
      const now = new Date(result.as_of);
      const expected = resolveSubscriptionTruth(full, { firebaseUid: uid }, { now });
      const actual = resolveSubscriptionTruth(result.witnesses, { firebaseUid: uid }, { now });
      assert.equal(actual.currentRow?.id, expected.currentRow?.id, uid);
      assert.equal(actual.diagnostics.code, expected.diagnostics.code, uid);
      assert.equal(actual.projection.entitlement, expected.projection.entitlement, uid);
      assert.equal(actual.projection.plan_term, expected.projection.plan_term, uid);
    }
  }
  assert.equal(new Set(allIds).size, 1320);
  assert.equal((await call({ search: 'literal%_' })).total, 1);
  assert.equal((await call({ page: 500, limit: 25 })).items.length, 0);
  const raw = allRows;
  const exact = await call({ id: raw[1000].id, limit: 1 });
  assert.equal(exact.total, 1);
  assert.equal(exact.items[0].id, raw[1000].id);
  assert.equal((await call({ id: '00000000-0000-4000-8000-000000000000' })).total, 0);
  for (const lifecycle of ['active', 'expired', 'cancelled', 'trialing', 'past_due', 'suspended', 'integrity_conflict']) {
    const result = await call({ lifecycle, limit: 100 });
    assert.equal(result.total, raw.filter((row) => subscriptionLifecycle(row, new Date(result.as_of)) === lifecycle).length, lifecycle);
  }
  for (const term of ['annual', 'lifetime', 'custom']) {
    const result = await call({ term });
    assert.equal(result.total, raw.filter((row) => subscriptionPlanTerm(row) === term).length, term);
  }
  assert.equal((await call({ current: 'history' })).total, raw.filter((row) => !row.is_current).length);
  assert.equal((await call({ source: 'unknown' })).total, 0);
  const conflicts = await call({ integrity: 'conflict' });
  assert.deepEqual(conflicts.items.map(({ firebase_user_id }) => firebase_user_id).sort(), [null, 'conflict', 'conflict', 'malformed'].sort());
  await db.exec('reset role');
  await db.exec(`insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,lifecycle_state,is_current,updated_at)
    select 'long-history','long-history@example.test',now()-interval '5 days',now()-interval '4 days','expired',false,'2026-01-01'
    from generate_series(1,2005);
    insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,lifecycle_state,is_current)
    values('long-history','long-history@example.test',now()-interval '1 day',now()+interval '1 day','active',true);`);
  await db.exec('set role service_role');
  const longHistory = await call({ search: 'long-history', limit: 1 });
  assert.equal(longHistory.total, 2006);
  assert.equal(longHistory.witnesses.length, 1);
  const historical = (await db.query("select id from account_subscriptions where firebase_user_id='long-history' and not is_current limit 1")).rows[0];
  const directHistory = await call({ id: historical.id, limit: 1 });
  assert.equal(directHistory.items[0].id, historical.id);
  assert.equal(directHistory.total, 1);
  assert.equal(directHistory.witnesses[0].id, longHistory.witnesses[0].id, "an exact historical read keeps the actual current owner record");
  await db.exec("reset role");
  await db.query("delete from account_subscriptions where id=$1", [longHistory.witnesses[0].id]);
  await db.query(`insert into account_subscriptions(id,firebase_user_id,user_email,starts_at,expires_at,lifecycle_state,is_current,created_at,updated_at)
    values($1,'long-history','long-history@example.test',now()-interval '1 day',now()+interval '1 day','active',true,'2020-01-01','2020-01-01')`,
    [longHistory.witnesses[0].id]);
  await db.exec("set role service_role");
  const accountSnapshot = await call({ owner: "long-history", limit: 100 });
  assert.equal(accountSnapshot.total, 2006);
  assert.equal(accountSnapshot.items.length, 100);
  assert.ok(accountSnapshot.items.every((row) => row.firebase_user_id === "long-history"));
  assert.ok(!accountSnapshot.items.some((row) => row.id === longHistory.witnesses[0].id));
  assert.equal(accountSnapshot.witnesses[0].id, longHistory.witnesses[0].id);
  assert.equal((await call({ owner: "history" })).total, 0, "the owner filter is exact, not a substring search");
  assert.equal(resolveSubscriptionTruth(longHistory.witnesses, { firebaseUid: 'long-history' }, { now: new Date(longHistory.as_of) }).currentRow.id, longHistory.items[0].id);
  await db.exec('set role anon');
  await assert.rejects(call(), /permission denied/i);
  await db.exec('set role authenticated');
  await assert.rejects(call(), /permission denied/i);
  await db.exec('reset role');
  const properties = (await db.query("select prosecdef,proconfig from pg_proc where oid='public.admin_subscription_directory(text,text,text,text,text,text,integer,integer,uuid,text)'::regprocedure")).rows[0];
  assert.equal(properties.prosecdef, false);
  assert.ok(properties.proconfig.includes('search_path=""'));
  const operations = await migration('20260622152129_phase_f_admin_operations.sql');
  const beginOperation = operations.indexOf('create or replace function public.admin_begin_operation');
  await db.exec(operations.slice(0, operations.indexOf('create table if not exists public.subscription_recovery_ledger')));
  await db.exec(operations.slice(beginOperation, operations.indexOf('\n$$;', beginOperation) + 4));
  await db.exec('create table public.admin_activity(action text,entity text,entity_id text,payload jsonb,admin_email text)');
  await db.exec(await migration('20260717135012_fix_admin_identity_and_subscription_transition.sql'));
  const original = (await call({ search: 'active@example.test' })).items[0];
  const transition = (action, row, suffix = '') => db.query('select public.admin_subscription_transition($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [row.id, action, 'admin_action', null, 'fixture-admin@example.test', 'super_admin', 'fixture-transition-' + action + suffix, row.updated_at]);
  await transition('suspend', original);
  const suspended = await call({ search: original.user_email, lifecycle: 'suspended' });
  assert.equal(suspended.items.length, 1);
  assert.equal(suspended.items[0].id, original.id);
  assert.equal(suspended.items[0].is_current, false);
  assert.equal(resolveSubscriptionTruth(suspended.witnesses, { firebaseUid: original.firebase_user_id }).projection.existence, 'none');
  assert.equal((await call({ search: original.user_email, current: 'current' })).total, 0);
  await transition('resume', suspended.items[0]);
  const resumed = await call({ search: original.user_email, current: 'current' });
  assert.equal(resumed.items[0].id, original.id);
  assert.equal(resumed.items[0].lifecycle_state, 'active');
  assert.equal(resumed.items[0].is_current, true);
  await transition('suspend', resumed.items[0], '-replacement');
  const old = (await call({ search: original.user_email, lifecycle: 'suspended' })).items[0];
  await db.query(`insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,lifecycle_state,is_current)
    values($1,$2,now()-interval '1 day',now()+interval '5 days','active',true)`, [old.firebase_user_id, old.user_email]);
  const replaced = await call({ search: original.user_email, lifecycle: 'suspended' });
  assert.equal(resolveSubscriptionTruth(replaced.witnesses, { firebaseUid: old.firebase_user_id }).projection.existence, 'present');
  await assert.rejects(transition('resume', old, '-replacement'), /subscription_integrity_conflict/, 'a replacement current record must block resuming the old one');
  const expiredSuspension = (await db.query(`insert into account_subscriptions(firebase_user_id,user_email,starts_at,expires_at,lifecycle_state,is_current,plan_term)
    values('expired-suspension','expired-suspension@example.test',now()-interval '5 days',now()-interval '1 day','suspended',false,'monthly') returning *`)).rows[0];
  await assert.rejects(transition('resume', expiredSuspension, '-expired'), /subscription_expired/, 'a past expiry must block resuming a suspension');
  console.log('Subscription transition SQL passed: suspension leaves the original record available without its current flag; resuming restores that record.');
  console.log('Subscription directory SQL passed: 1320 paged records, 2006-record owner history, exact filtered counts, literal search, resolver parity, service-only permissions.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await db.close(); }
