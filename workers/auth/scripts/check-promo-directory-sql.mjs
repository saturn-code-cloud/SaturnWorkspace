import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2] ? pathToFileURL(process.argv[2]).href : import.meta.resolve('@electric-sql/pglite');
const { PGlite } = await import(modulePath);
const db = new PGlite();
try {
  const schema = await fs.readFile(new URL('../../admin/supabase/schema.sql', import.meta.url), 'utf8');
  const table = schema.slice(schema.indexOf('create table if not exists public.promo_codes ('), schema.indexOf('create table if not exists public.ota_updates ('));
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create type public.promo_discount_type as enum ('percent','fixed');");
  await db.exec(table);
  const audit = schema.slice(schema.indexOf('create table if not exists public.admin_activity ('), schema.indexOf('create or replace function public.touch_updated_at()'));
  await db.exec(audit);
  const touchFunction = /create or replace function public\.touch_updated_at\(\)[\s\S]*?\$\$;/i.exec(schema)?.[0];
  const touchTrigger = /create trigger promo_codes_touch_updated_at[\s\S]*?;/i.exec(schema)?.[0];
  assert.ok(touchFunction && touchTrigger);
  await db.exec(touchFunction + '\n' + touchTrigger);
  await db.exec(`alter table public.admin_activity add column admin_email text;
    alter table public.promo_codes enable row level security;
    grant select on public.promo_codes to service_role, anon, authenticated;
    grant insert,update on public.promo_codes to service_role;
    grant insert on public.admin_activity to service_role;`);
  await db.exec(await fs.readFile(new URL('../migrations/20261111155417_admin_promo_code_directory.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.promo_codes(code,discount_type,discount_value,is_active,max_uses,used_count,starts_at,expires_at) values
    ('ACTIVE','percent',10,true,5,0,null,null),
    ('PAUSED','percent',10,false,5,0,null,null),
    ('SCHEDULED','percent',10,true,5,0,now()+interval '1 day',null),
    ('EXPIRED','percent',10,true,5,0,null,now()-interval '1 second'),
    ('EXHAUSTED','percent',10,true,5,5,null,null),
    ('EXPIRED-AND-EXHAUSTED','percent',10,true,5,5,null,now()-interval '1 second'),
    ('PAUSED-AND-EXPIRED','percent',10,false,5,0,null,now()-interval '1 second'),
    ('UNLIMITED','fixed',20,true,null,500,null,null);
    insert into public.promo_codes(code,discount_type,discount_value,created_at)
      select 'PAGE-'||lpad(n::text,3,'0'),'percent',10,'2026-01-01T00:00:00Z'::timestamptz from generate_series(1,130) n;`);
  const scalar = async (query, parameters = []) => (await db.query(query, parameters)).rows[0];
  const states = Object.fromEntries((await db.query("select code,effective_status from admin_promo_code_directory where code not like 'PAGE-%'")).rows.map((row) => [row.code, row.effective_status]));
  assert.deepEqual(states, { ACTIVE: 'active', PAUSED: 'paused', SCHEDULED: 'scheduled', EXPIRED: 'expired', EXHAUSTED: 'exhausted', 'EXPIRED-AND-EXHAUSTED': 'expired', 'PAUSED-AND-EXPIRED': 'paused', UNLIMITED: 'active' });
  await db.exec("update promo_codes set is_active=true where code='PAUSED-AND-EXPIRED';");
  assert.equal((await scalar("select effective_status from admin_promo_code_directory where code='PAUSED-AND-EXPIRED'")).effective_status, 'expired');
  assert.equal((await scalar("select used_count from admin_promo_code_directory where code='UNLIMITED'")).used_count, 500);
  const ids = [];
  for (let offset = 0; offset < 130; offset += 25) ids.push(...(await db.query("select code from admin_promo_code_directory where code like 'PAGE-%' order by created_at desc,id desc limit 25 offset $1", [offset])).rows.map((row) => row.code));
  assert.equal(ids.length, 130);
  assert.equal(new Set(ids).size, 130);
  const columns = (await db.query("select column_name from information_schema.columns where table_name='admin_promo_code_directory'")).rows.map((row) => row.column_name);
  assert.ok(!columns.includes('metadata') && !columns.includes('private_feature_payload') && !columns.includes('created_by'));
  for (const role of ['anon', 'authenticated']) assert.equal((await scalar("select has_table_privilege($1,'public.admin_promo_code_directory','SELECT') as allowed", [role])).allowed, false);
  assert.equal((await scalar("select has_table_privilege('service_role','public.admin_promo_code_directory','SELECT') as allowed")).allowed, true);
  for (const action of ['INSERT', 'UPDATE', 'DELETE']) assert.equal((await scalar("select has_table_privilege('service_role','public.admin_promo_code_directory',$1) as allowed", [action])).allowed, false);
  await db.exec('grant select on admin_promo_code_directory to anon; set role anon;');
  assert.equal((await scalar('select count(*)::int as count from admin_promo_code_directory')).count, 0, 'An accidental view grant must not bypass the underlying RLS');
  await db.exec('reset role; set role service_role;');
  assert.equal((await scalar('select count(*)::int as count from admin_promo_code_directory')).count, 138);
  const create = async (code) => (await scalar('select public.admin_create_promo_code($1,$2) as item', [JSON.stringify({ code, title: null, discount_type: 'percent', discount_value: 10, max_uses: 3, expires_at: null, is_active: true, is_private_tier_trigger: false, metadata: {}, private_feature_payload: {} }), 'fixture-admin@example.invalid'])).item;
  const created = await create('CREATED-BY-ADMIN');
  assert.equal(created.effective_status, 'active');
  assert.equal(created.metadata, undefined);
  const setState = (item, active, expected = item.updated_at) => scalar('select public.admin_set_promo_code_state($1,$2,$3,$4,$5) as item', [item.id, active, expected, 'fixture-admin@example.invalid', 'Fixture state change']);
  const paused = (await setState(created, false)).item;
  assert.equal(paused.effective_status, 'paused');
  await assert.rejects(setState(created, true), /promo_code_changed/);
  const resumed = (await setState(paused, true)).item;
  assert.equal(resumed.is_active, true);
  assert.equal(resumed.max_uses, 3);
  assert.equal(resumed.used_count, 0);
  assert.equal(resumed.expires_at, null);
  await db.exec('begin;');
  const sameTransaction = await create('SAME-TRANSACTION');
  const sameTransactionPaused = (await setState(sameTransaction, false)).item;
  const sameTransactionResumed = (await setState(sameTransactionPaused, true)).item;
  assert.notEqual(sameTransaction.updated_at, sameTransactionPaused.updated_at);
  assert.notEqual(sameTransactionPaused.updated_at, sameTransactionResumed.updated_at);
  await db.exec('commit;');
  await db.exec('reset role;');
  assert.equal((await scalar("select count(*)::int as count from admin_activity where entity_id=$1", [created.id])).count, 3);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await scalar("select has_function_privilege($1,'public.admin_create_promo_code(jsonb,text)','EXECUTE') as allowed", [role])).allowed, false);
    assert.equal((await scalar("select has_function_privilege($1,'public.admin_set_promo_code_state(uuid,boolean,timestamptz,text,text)','EXECUTE') as allowed", [role])).allowed, false);
  }
  await db.exec("create function fixture_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture_audit_unavailable'; end; $$; create trigger fixture_fail_audit before insert on admin_activity for each row execute function fixture_audit_failure(); set role service_role;");
  await assert.rejects(create('ROLLBACK-ON-AUDIT-FAILURE'), /fixture_audit_unavailable/);
  assert.equal((await scalar("select count(*)::int as count from admin_promo_code_directory where code='ROLLBACK-ON-AUDIT-FAILURE'")).count, 0);
  await assert.rejects(setState(resumed, false), /fixture_audit_unavailable/);
  assert.equal((await scalar('select is_active from admin_promo_code_directory where id=$1', [resumed.id])).is_active, true);
  console.log('PASS Promo directory SQL: lifecycle, 130-row paging, projection, RLS, service-only mutation, exact reviewed version, preserved limits, and atomic audit rollback.');
} finally { await db.close(); }
