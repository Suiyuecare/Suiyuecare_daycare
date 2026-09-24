begin;
select plan(15);

select ok(
  not exists(
    select 1 from (values ('public.meeting_minute_versions'),('public.meeting_action_updates')) t(name)
    cross join (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
    where has_table_privilege('service_role',t.name,p.privilege)
  ),
  'service role has no append-only bypass or maintenance privileges on meeting streams'
);
select ok(
  (select bool_and(has_table_privilege('service_role',t.name,p.privilege))
   from (values ('public.meeting_minute_versions'),('public.meeting_action_updates')) t(name)
   cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege)),
  'existing service CRUD grants are preserved for both meeting streams'
);
select ok(
  not exists(
    select 1 from (values ('public.meeting_minute_versions'),('public.meeting_action_updates')) t(name)
    cross join (values ('anon'),('authenticated')) r(name)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
    where has_table_privilege(r.name,t.name,p.privilege)
  ),
  'client roles still cannot directly access either guarded meeting stream'
);
select ok(
  not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('anon'),('authenticated'),('service_role')) r(name)
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
      and has_table_privilege(r.name,c.oid,'MAINTAIN')),
  'no public table-like object gives the three application roles MAINTAIN'
);
select ok(
  has_table_privilege('authenticated','public.organizations','SELECT')
  and has_table_privilege('authenticated','public.profiles','SELECT')
  and has_table_privilege('service_role','public.organizations','SELECT'),
  'pre-existing business read grants outside meetings are preserved'
);
select ok(
  exists(select 1 from pg_trigger where tgname='meeting_minute_versions_append_only' and tgenabled<>'D')
  and exists(select 1 from pg_trigger where tgname='meeting_action_updates_append_only' and tgenabled<>'D'),
  'row-level append-only guards remain enabled'
);

-- Synthetic rows make destructive-denial assertions meaningful. These live
-- only in this local test transaction and are rolled back at the end.
insert into auth.users(id) values ('75f10000-0000-4000-8000-000000000001');
insert into public.organizations(id,code,name) values ('75f20000-0000-4000-8000-000000000001','meeting_acl_test','合成權限回歸機構');
insert into public.branches(id,organization_id,code,name) values
 ('75f30000-0000-4000-8000-000000000001','75f20000-0000-4000-8000-000000000001','main','合成權限分支');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at)
values('75f40000-0000-4000-8000-000000000001','75f10000-0000-4000-8000-000000000001','75f41000-0000-4000-8000-000000000001',repeat('f',64),'75f42000-0000-4000-8000-000000000001',now(),now(),now()+interval '5 minutes');
insert into public.meeting_minute_versions(
 id,organization_id,branch_id,meeting_key,version,meeting_type,title,starts_at,ends_at,staff_attendees,external_attendees,
 agenda_items,decisions,action_items,signed_at,signed_by,signer_display_name,signer_role_keys,signature_purpose,
 signature_reauth_challenge_id,content_hash,created_at
) values (
 '75f50000-0000-4000-8000-000000000001','75f20000-0000-4000-8000-000000000001','75f30000-0000-4000-8000-000000000001','75f51000-0000-4000-8000-000000000001',1,
 '合成測試類型','合成不可變會議','2026-09-08 09:00:00+08','2026-09-08 10:00:00+08','[{}]','[]','[{}]','[]','[]',
 now(),'75f10000-0000-4000-8000-000000000001','合成簽署人',array['organization_manager'],'會議紀錄簽署',
 '75f40000-0000-4000-8000-000000000001',repeat('a',64),now()
);
insert into public.meeting_action_updates(id,organization_id,branch_id,meeting_key,minute_version_id,action_id,sequence,progress_status,recorded_by,recorded_at)
values('75f60000-0000-4000-8000-000000000001','75f20000-0000-4000-8000-000000000001','75f30000-0000-4000-8000-000000000001','75f51000-0000-4000-8000-000000000001',
 '75f50000-0000-4000-8000-000000000001','75f61000-0000-4000-8000-000000000001',1,'not_started','75f10000-0000-4000-8000-000000000001',now());

set local role service_role;
select throws_ok($$truncate table public.meeting_minute_versions$$,'42501',null,'actual service-role TRUNCATE of minutes is denied');
select throws_ok($$truncate table public.meeting_action_updates$$,'42501',null,'actual service-role TRUNCATE of actions is denied');
select throws_ok($$truncate table public.meeting_minute_versions,public.meeting_action_updates cascade$$,'42501',null,'multi-table cascading TRUNCATE is denied before removing any record');
select throws_ok($$update public.meeting_minute_versions set title='forbidden' where id='75f50000-0000-4000-8000-000000000001'$$,
 '23514','meeting_minute_versions is append-only; create a correction or action update','preserved CRUD cannot bypass row update guard');
select throws_ok($$delete from public.meeting_action_updates where id='75f60000-0000-4000-8000-000000000001'$$,
 '23514','meeting_action_updates is append-only; create a correction or action update','preserved CRUD cannot bypass row delete guard');
select is((select title from public.meeting_minute_versions where id='75f50000-0000-4000-8000-000000000001'),'合成不可變會議','minute content is unchanged after denied destructive operations');
select is((select count(*) from public.meeting_action_updates where id='75f60000-0000-4000-8000-000000000001'),1::bigint,'action evidence survives denied destructive operations');
reset role;

-- Verify actual future-table privileges, not just pg_default_acl text. This
-- table also disappears on rollback and receives no application grants.
create table public.meeting_acl_default_probe(id integer primary key);
select ok(not exists(
 select 1 from (values ('anon'),('authenticated'),('service_role')) r(name)
 cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
 where has_table_privilege(r.name,'public.meeting_acl_default_probe',p.privilege)
),'new postgres-owned public tables have no implicit application grants, including MAINTAIN');
select ok(has_table_privilege('postgres','public.meeting_acl_default_probe','SELECT')
 and has_table_privilege('postgres','public.meeting_acl_default_probe','INSERT'),
 'object owner retains maintenance and explicit grant administration ability');
select * from finish();
rollback;
