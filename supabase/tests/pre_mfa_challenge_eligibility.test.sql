begin;
select plan(42);

-- All identities are synthetic local fixtures. This file is never a hosted
-- account/bootstrap script; auth metadata mirrors the verified hosted schema.
insert into auth.users (id, email_confirmed_at, banned_until, deleted_at, is_anonymous)
select ('58100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 5 then null else clock_timestamp() - interval '1 day' end,
  case when n = 4 then clock_timestamp() + interval '1 day' else null end,
  case when n = 3 then clock_timestamp() - interval '1 hour' else null end,
  n = 2
from generate_series(1, 22) n;

insert into public.organizations (id, code, name, is_active) values
  ('58200000-0000-4000-8000-000000000001', 'pre_mfa_active', '合成 MFA 測試機構', true),
  ('58200000-0000-4000-8000-000000000002', 'pre_mfa_inactive', '合成停用 MFA 測試機構', false);
insert into public.branches (id, organization_id, code, name, is_active) values
  ('58300000-0000-4000-8000-000000000001', '58200000-0000-4000-8000-000000000001', 'main', '合成 MFA 分支', true),
  ('58300000-0000-4000-8000-000000000002', '58200000-0000-4000-8000-000000000001', 'inactive', '合成停用分支', false),
  ('58300000-0000-4000-8000-000000000003', '58200000-0000-4000-8000-000000000002', 'main', '合成停用機構分支', true);
insert into public.profiles (id, display_name, kind, is_active)
select ('58100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '合成 MFA 使用者 ' || n,
  (case n when 7 then 'family' when 8 then 'platform' when 22 then 'professional' else 'staff' end)::public.profile_kind,
  n <> 6
from generate_series(1, 22) n;
insert into public.memberships (id, organization_id, branch_id, profile_id, status, starts_at, ends_at)
select ('58400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case when n = 14 then '58200000-0000-4000-8000-000000000002' else '58200000-0000-4000-8000-000000000001' end)::uuid,
  (case n when 14 then '58300000-0000-4000-8000-000000000003' when 15 then '58300000-0000-4000-8000-000000000002'
    when 16 then null else '58300000-0000-4000-8000-000000000001' end)::uuid,
  ('58100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case when n = 9 then 'invited' else 'active' end)::public.membership_status,
  case when n = 10 then clock_timestamp() + interval '1 hour' else clock_timestamp() - interval '2 days' end,
  case when n = 11 then clock_timestamp() - interval '1 day' else null end
from generate_series(1, 22) n;
insert into public.roles (id, organization_id, role_key, name, is_active) values
  ('58500000-0000-4000-8000-000000000001', '58200000-0000-4000-8000-000000000001', 'pre_mfa_inactive', '合成停用角色', false),
  ('58500000-0000-4000-8000-000000000002', '58200000-0000-4000-8000-000000000002', 'pre_mfa_foreign', '合成他機構角色', true);
insert into public.membership_roles (membership_id, role_id, assigned_at)
select ('58400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 7 then '10000000-0000-4000-8000-000000000010' when 8 then '10000000-0000-4000-8000-000000000001'
    when 13 then '58500000-0000-4000-8000-000000000001' else '10000000-0000-4000-8000-000000000003' end)::uuid,
  case when n = 17 then clock_timestamp() + interval '1 hour' else clock_timestamp() - interval '1 day' end
from generate_series(1, 22) n where n <> 12;
insert into auth.sessions (id, user_id, created_at, not_after)
select ('58600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('58100000-0000-4000-8000-' || lpad((case when n = 21 then 22 else n end)::text, 12, '0'))::uuid,
  case when n = 20 then null else clock_timestamp() - interval '1 day' end,
  case when n = 19 then clock_timestamp() - interval '1 second' else null end
from generate_series(1, 22) n where n <> 18;

create function pg_temp.pre_mfa_result(p_n integer, p_overrides jsonb default '{}')
returns boolean language plpgsql security invoker as $$
begin
  perform set_config('request.jwt.claims', (jsonb_build_object(
    'sub', '58100000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
    'session_id', '58600000-0000-4000-8000-' || lpad(p_n::text, 12, '0'),
    'role', 'authenticated', 'aal', 'aal1',
    'iat', floor(extract(epoch from clock_timestamp() - interval '1 minute')),
    'exp', floor(extract(epoch from clock_timestamp() + interval '30 minutes'))
  ) || p_overrides)::text, true);
  return public.can_begin_staff_mfa();
end;
$$;

select ok(not has_function_privilege('anon', 'public.can_begin_staff_mfa()', 'execute')
  and not has_function_privilege('service_role', 'public.can_begin_staff_mfa()', 'execute'), 'anonymous and service-role cannot invoke the self-only public helper');
select ok(not has_function_privilege('anon', 'private.can_begin_staff_mfa()', 'execute')
  and not has_function_privilege('service_role', 'private.can_begin_staff_mfa()', 'execute'), 'anonymous and service-role cannot invoke the private helper');
select ok(has_function_privilege('authenticated', 'public.can_begin_staff_mfa()', 'execute')
  and has_function_privilege('authenticated', 'private.can_begin_staff_mfa()', 'execute'), 'authenticated has only the helper execution path');
select ok(not has_table_privilege('authenticated', 'auth.sessions', 'select')
  and not has_table_privilege('service_role', 'auth.sessions', 'select'), 'session table SELECT is not granted');
select ok(not has_table_privilege('authenticated', 'auth.users', 'select'), 'authenticated cannot read auth users');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'private.can_begin_staff_mfa()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.can_begin_staff_mfa()'::regprocedure), 'only the private helper is SECURITY DEFINER with empty search path');

set local role authenticated;
select is(pg_temp.pre_mfa_result(1), true, 'valid AAL1 employee may begin MFA');
select is((select count(*)::integer from public.active_memberships), 0, 'AAL1 employee still cannot read tenant context');
select is(pg_temp.pre_mfa_result(1, '{"aal":"aal2"}'), true, 'valid AAL2 employee may begin fresh reauthentication');
select is(pg_temp.pre_mfa_result(2), false, 'anonymous Auth users cannot begin employee MFA');
select is(pg_temp.pre_mfa_result(3), false, 'deleted Auth account is rejected');
select is(pg_temp.pre_mfa_result(4), false, 'banned Auth account is rejected');
select is(pg_temp.pre_mfa_result(5), false, 'unconfirmed employee email is rejected');
select is(pg_temp.pre_mfa_result(6), false, 'inactive profile is rejected');
select is(pg_temp.pre_mfa_result(7), false, 'valid family role cannot obtain employee MFA eligibility');
select is(pg_temp.pre_mfa_result(8), false, 'platform identity cannot become a tenant employee');
select is(pg_temp.pre_mfa_result(9), false, 'invited membership is not active membership');
select is(pg_temp.pre_mfa_result(10), false, 'future membership is rejected');
select is(pg_temp.pre_mfa_result(11), false, 'expired membership is rejected');
select is(pg_temp.pre_mfa_result(12), false, 'active membership without a role is rejected');
select is(pg_temp.pre_mfa_result(13), false, 'inactive assigned role is rejected');
select is(pg_temp.pre_mfa_result(14), false, 'inactive organization is rejected');
select is(pg_temp.pre_mfa_result(15), false, 'inactive assigned branch is rejected');
select is(pg_temp.pre_mfa_result(16), true, 'organization-wide member needs an active branch and may begin MFA');
select is(pg_temp.pre_mfa_result(17), false, 'future role assignment is rejected');
select is(pg_temp.pre_mfa_result(18), false, 'missing or revoked session is rejected');
select is(pg_temp.pre_mfa_result(19), false, 'session not_after expiry is enforced');
select is(pg_temp.pre_mfa_result(20), false, 'session with unknown creation time fails closed');
select is(pg_temp.pre_mfa_result(21), false, 'another user session cannot be used');
select is(pg_temp.pre_mfa_result(22), true, 'active professional is an employee audience');
select is(pg_temp.pre_mfa_result(1, '{"session_id":null}'), false, 'missing session claim fails closed');
select is(pg_temp.pre_mfa_result(1, '{"sub":"invalid"}'), false, 'malformed user UUID returns false, not a cast failure');
select is(pg_temp.pre_mfa_result(1, '{"iat":null}'), false, 'missing issue time fails closed');
select is(pg_temp.pre_mfa_result(1, '{"exp":1}'), false, 'expired JWT fails closed');
select is(pg_temp.pre_mfa_result(1, '{"aal":"invalid"}'), false, 'unknown AAL is rejected');
select is(pg_temp.pre_mfa_result(1, jsonb_build_object('iat', floor(extract(epoch from clock_timestamp() + interval '10 minutes')))), false, 'future JWT issue time is rejected');
select is(pg_temp.pre_mfa_result(1, jsonb_build_object('iat', floor(extract(epoch from clock_timestamp() - interval '2 hours')))), false, 'stale JWT issue time is rejected');
select is(pg_temp.pre_mfa_result(1, '{"role":"service_role"}'), false, 'non-authenticated JWT role is rejected');
select is(pg_temp.pre_mfa_result(1, '{"is_anonymous":true}'), false, 'anonymous claim is rejected even if account metadata is not anonymous');
reset role;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$insert into public.membership_roles (membership_id, role_id) values (
  '58400000-0000-4000-8000-000000000012', '58500000-0000-4000-8000-000000000002')$$,
  '23514', 'tenant role and membership must belong to the same organization', 'foreign organization role cannot be assigned to bypass eligibility');
select throws_ok($$update public.memberships set branch_id = '58300000-0000-4000-8000-000000000003'
  where id = '58400000-0000-4000-8000-000000000001'$$,
  '23514', 'immutable key branch_id cannot be changed on public.memberships', 'foreign organization branch cannot replace the assigned branch');
select is((select count(*)::integer from private.reauth_challenges), 0, 'the boolean helper never issues a challenge or reauth evidence');

select * from finish();
rollback;
