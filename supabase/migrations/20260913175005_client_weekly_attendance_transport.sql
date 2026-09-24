-- Recurring attendance intent and transport demand, never attendance evidence or dispatch.
begin;
set local lock_timeout = '5s';
create table private.client_weekly_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 version integer not null check(version>0), effective_from date not null, effective_to date, plan jsonb not null,
 created_by uuid not null references public.profiles(id) on delete restrict, created_at timestamptz not null default now(),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(client_id,version), check(effective_to is null or effective_to>=effective_from), check(jsonb_typeof(plan)='object')
);
create index client_weekly_scope_idx on private.client_weekly_versions(organization_id,branch_id,client_id,effective_from,version desc);
create index client_weekly_creator_idx on private.client_weekly_versions(created_by);
create table private.client_weekly_exceptions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 service_date date not null, version integer not null check(version>0), day jsonb not null, reason text not null,
 created_by uuid not null references public.profiles(id) on delete restrict, created_at timestamptz not null default now(),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(client_id,service_date,version), check(jsonb_typeof(day)='object'), check(char_length(reason) between 3 and 300)
);
create index client_weekly_exceptions_scope_idx on private.client_weekly_exceptions(organization_id,branch_id,service_date,client_id,version desc);
create index client_weekly_exception_creator_idx on private.client_weekly_exceptions(created_by);
create table private.client_weekly_operations (
 organization_id uuid not null references public.organizations(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict, idempotency_key uuid not null,
 input_hash text not null, receipt jsonb not null, primary key(organization_id,actor_id,idempotency_key)
);
create index client_weekly_operation_actor_idx on private.client_weekly_operations(actor_id);
alter table private.client_weekly_versions enable row level security;
alter table private.client_weekly_versions force row level security;
alter table private.client_weekly_exceptions enable row level security;
alter table private.client_weekly_exceptions force row level security;
alter table private.client_weekly_operations enable row level security;
alter table private.client_weekly_operations force row level security;
revoke all on private.client_weekly_versions,private.client_weekly_exceptions,private.client_weekly_operations from public,anon,authenticated,service_role;
create function private.client_weekly_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='weekly plan history is immutable'; end; $$;
create trigger client_weekly_versions_immutable before update or delete on private.client_weekly_versions for each row execute function private.client_weekly_append_only();
create trigger client_weekly_exceptions_immutable before update or delete on private.client_weekly_exceptions for each row execute function private.client_weekly_append_only();
create trigger client_weekly_operations_immutable before update or delete on private.client_weekly_operations for each row execute function private.client_weekly_append_only();

create function private.validate_client_weekly_day(p_day jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare v_t jsonb; v_direction text;
begin
 if p_day is null or jsonb_typeof(p_day)<>'object' or not(p_day?&array['weekday','attending','startsAt','endsAt','outbound','inbound'])
 or p_day-array['weekday','attending','startsAt','endsAt','outbound','inbound']<>'{}'::jsonb
 or jsonb_typeof(p_day->'weekday')<>'number' or (p_day->>'weekday')!~'^[1-7]$'
 or jsonb_typeof(p_day->'attending')<>'boolean' then return false; end if;
 if p_day->'attending'='false'::jsonb then
  return p_day->'startsAt'='null'::jsonb and p_day->'endsAt'='null'::jsonb and p_day->'outbound'='null'::jsonb and p_day->'inbound'='null'::jsonb;
 end if;
 if jsonb_typeof(p_day->'startsAt') is distinct from 'string' or jsonb_typeof(p_day->'endsAt') is distinct from 'string'
 or (p_day->>'startsAt')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (p_day->>'endsAt')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or p_day->>'startsAt'>=p_day->>'endsAt' then return false; end if;
 foreach v_direction in array array['outbound','inbound'] loop
  v_t:=p_day->v_direction;
  if v_t='null'::jsonb then continue; end if;
  if jsonb_typeof(v_t)<>'object' or not(v_t?&array['location','windowStart','windowEnd','wheelchair','contact'])
  or v_t-array['location','windowStart','windowEnd','wheelchair','contact']<>'{}'::jsonb
  or jsonb_typeof(v_t->'location') is distinct from 'string' or jsonb_typeof(v_t->'contact') is distinct from 'string'
  or jsonb_typeof(v_t->'windowStart') is distinct from 'string' or jsonb_typeof(v_t->'windowEnd') is distinct from 'string'
  or jsonb_typeof(v_t->'wheelchair') is distinct from 'boolean'
  or char_length(btrim(v_t->>'location')) not between 1 and 300 or char_length(btrim(v_t->>'contact')) not between 1 and 300
  or (v_t->>'location')~'[[:cntrl:]]' or (v_t->>'contact')~'[[:cntrl:]]'
  or (v_t->>'windowStart')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_t->>'windowEnd')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or v_t->>'windowStart'>v_t->>'windowEnd' then return false; end if;
  if (v_direction='outbound' and v_t->>'windowEnd'>p_day->>'startsAt') or (v_direction='inbound' and v_t->>'windowStart'<p_day->>'endsAt') then return false; end if;
 end loop;
 return true;
end; $$;

create function private.save_client_weekly_guarded(p_organization_id uuid,p_branch_id uuid,p_input jsonb)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_client uuid; v_key uuid; v_action text; v_date date; v_until date; v_plan jsonb;
 v_expected integer; v_version integer; v_hash text; v_prior private.client_weekly_operations; v_latest date;
 v_id uuid; v_receipt jsonb; v_today date:=(now() at time zone 'Asia/Taipei')::date;
begin
 if v_actor is null or not private.has_permission(p_organization_id,p_branch_id,'clients.read')
 or not private.has_permission(p_organization_id,p_branch_id,'staff_scheduling.manage') or not private.has_recent_aal2(15)
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 then raise exception using errcode='42501',message='weekly plan modification denied'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&array['action','clientId','expectedVersion','idempotency_key'])
 or jsonb_typeof(p_input->'action') is distinct from 'string' or p_input->>'action' not in ('save_plan','save_exception')
 or jsonb_typeof(p_input->'clientId') is distinct from 'string' or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string'
 or jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or (p_input->>'expectedVersion')!~'^[0-9]{1,7}$'
 then raise exception using errcode='22023',message='invalid weekly input'; end if;
 v_client:=(p_input->>'clientId')::uuid; v_key:=(p_input->>'idempotency_key')::uuid; v_action:=p_input->>'action'; v_expected:=(p_input->>'expectedVersion')::integer;
 if v_expected>1000000 or not exists(select 1 from public.clients c where c.id=v_client and c.organization_id=p_organization_id and c.branch_id=p_branch_id)
 or not private.can_staff_access_client(v_client,'clients.read') then raise exception using errcode='42501',message='client outside weekly scope'; end if;
 if v_action='save_plan' then
  if p_input-array['action','clientId','expectedVersion','idempotency_key','plan']<>'{}'::jsonb or jsonb_typeof(p_input->'plan') is distinct from 'object' then raise exception using errcode='22023',message='invalid weekly plan'; end if;
  v_plan:=p_input->'plan';
  if not(v_plan?&array['effectiveFrom','effectiveTo','days','reason']) or v_plan-array['effectiveFrom','effectiveTo','days','reason']<>'{}'::jsonb
  or jsonb_typeof(v_plan->'effectiveFrom') is distinct from 'string' or jsonb_typeof(v_plan->'effectiveTo') not in ('string','null')
  or (v_plan->>'effectiveFrom')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or (v_plan->>'effectiveTo')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(v_plan->'days') is distinct from 'array' or jsonb_array_length(v_plan->'days')<>7
  or jsonb_typeof(v_plan->'reason') is distinct from 'string' or char_length(btrim(v_plan->>'reason')) not between 3 and 300 or (v_plan->>'reason')~'[[:cntrl:]]'
  then raise exception using errcode='22023',message='invalid weekly plan'; end if;
  if exists(select 1 from jsonb_array_elements(v_plan->'days') d where not private.validate_client_weekly_day(d))
  or (select count(distinct d->>'weekday') from jsonb_array_elements(v_plan->'days') d)<>7 then raise exception using errcode='22023',message='invalid weekly days'; end if;
  v_date:=(v_plan->>'effectiveFrom')::date; v_until:=(v_plan->>'effectiveTo')::date;
  if to_char(v_date,'YYYY-MM-DD')<>v_plan->>'effectiveFrom' or (v_until is not null and (to_char(v_until,'YYYY-MM-DD')<>v_plan->>'effectiveTo' or v_until<v_date)) then raise exception using errcode='22023',message='invalid effective dates'; end if;
 else
  if not(p_input?&array['serviceDate','day','reason']) or p_input-array['action','clientId','expectedVersion','idempotency_key','serviceDate','day','reason']<>'{}'::jsonb
  or jsonb_typeof(p_input->'serviceDate') is distinct from 'string' or (p_input->>'serviceDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_input->'reason') is distinct from 'string' or char_length(btrim(p_input->>'reason')) not between 3 and 300 or (p_input->>'reason')~'[[:cntrl:]]'
  or not private.validate_client_weekly_day(p_input->'day') then raise exception using errcode='22023',message='invalid daily exception'; end if;
  v_date:=(p_input->>'serviceDate')::date;
  if to_char(v_date,'YYYY-MM-DD')<>p_input->>'serviceDate' or extract(isodow from v_date)::integer<>(p_input->'day'->>'weekday')::integer then raise exception using errcode='22023',message='date and weekday mismatch'; end if;
 end if;
 -- Replays are checked before temporal cutoffs, so retrying an acknowledged prior-day operation is safe.
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch_id,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||v_actor::text||v_key::text,0));
 select * into v_prior from private.client_weekly_operations where organization_id=p_organization_id and actor_id=v_actor and idempotency_key=v_key;
 if found then
  if v_prior.input_hash<>v_hash then raise exception using errcode='23505',message='weekly operation conflict'; end if;
  return query select v_prior.receipt||jsonb_build_object('replayed',true); return;
 end if;
 if v_date<v_today or v_date>v_today+366 then raise exception using errcode='22023',message='new weekly intent must start today or within one year'; end if;
 perform pg_advisory_xact_lock(hashtextextended('client-weekly:'||v_client::text,0));
 if v_action='save_plan' then
  select coalesce(max(version),0),max(effective_from) into v_version,v_latest from private.client_weekly_versions where client_id=v_client;
  if v_latest>v_date then raise exception using errcode='22023',message='weekly effective date cannot precede latest version'; end if;
 else
  select coalesce(max(version),0) into v_version from private.client_weekly_exceptions where client_id=v_client and service_date=v_date;
 end if;
 if v_expected<>v_version then raise exception using errcode='40001',message='weekly version changed'; end if;
 if v_action='save_plan' then
  insert into private.client_weekly_versions(organization_id,branch_id,client_id,version,effective_from,effective_to,plan,created_by)
  values(p_organization_id,p_branch_id,v_client,v_version+1,v_date,v_until,v_plan,v_actor) returning id into v_id;
 else
  insert into private.client_weekly_exceptions(organization_id,branch_id,client_id,service_date,version,day,reason,created_by)
  values(p_organization_id,p_branch_id,v_client,v_date,v_version+1,p_input->'day',btrim(p_input->>'reason'),v_actor) returning id into v_id;
 end if;
 v_receipt:=jsonb_build_object('id',v_id,'clientId',v_client,'action',v_action,'version',v_version+1,'replayed',false,'persisted',true);
 insert into private.client_weekly_operations values(p_organization_id,v_actor,v_key,v_hash,v_receipt);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,v_actor,'insert',case when v_action='save_plan' then 'client_weekly_versions' else 'client_weekly_exceptions' end,v_id::text,array['version'],jsonb_build_object('version',v_version+1));
 return query select v_receipt;
end; $$;

create function private.client_weekly_days(p_client uuid,p_from date,p_count integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_c public.clients; v_p private.client_weekly_versions; v_e private.client_weekly_exceptions; v_date date; v_day jsonb; v_state text; v_rows jsonb:='[]'; v_i integer;
begin
 select * into v_c from public.clients where id=p_client;
 for v_i in 0..p_count-1 loop
  v_date:=p_from+v_i;
  select * into v_p from private.client_weekly_versions where client_id=p_client and effective_from<=v_date order by version desc limit 1;
  select * into v_e from private.client_weekly_exceptions where client_id=p_client and service_date=v_date order by version desc limit 1;
  v_day:=null; v_state:='not_scheduled';
  if v_p.id is not null then select d into v_day from jsonb_array_elements(v_p.plan->'days') d where (d->>'weekday')::integer=extract(isodow from v_date)::integer; end if;
  if v_e.id is not null then v_day:=v_e.day; end if;
  if v_c.status<>'active' or (v_c.ended_on is not null and v_date>v_c.ended_on) then v_state:='inactive'; v_day:=null;
  elsif v_c.admitted_on is null or v_date<v_c.admitted_on then v_state:='not_admitted'; v_day:=null;
  elsif v_e.id is not null then v_state:=case when v_e.day->'attending'='true'::jsonb then 'scheduled' else 'cancelled' end;
  elsif v_p.effective_to is not null and v_date>v_p.effective_to then v_state:='plan_expired'; v_day:=null;
  elsif v_day->'attending'='true'::jsonb then v_state:='scheduled'; end if;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('date',v_date,'status',v_state,'day',v_day,'planVersion',coalesce(v_p.version,0),'exceptionVersion',coalesce(v_e.version,0),'transportStatus','unassigned_demand'));
 end loop;
 return v_rows;
end; $$;
create function private.client_weekly_snapshot_guarded(p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_from date)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_plan jsonb; v_version integer; v_exceptions jsonb;
begin
 if auth.uid() is null or p_from is null or p_from<'2000-01-01' or p_from>'2100-01-01'
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 or not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=p_organization_id and c.branch_id=p_branch_id)
 or not private.care_roster_can_read(p_client_id,'clients.read') then raise exception using errcode='42501',message='weekly snapshot denied'; end if;
 select p.plan||jsonb_build_object('id',p.id,'version',p.version),p.version into v_plan,v_version from private.client_weekly_versions p where p.client_id=p_client_id order by p.version desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('serviceDate',e.service_date,'version',e.version,'day',e.day,'reason',e.reason) order by e.service_date),'[]') into v_exceptions
 from (select distinct on(service_date) * from private.client_weekly_exceptions where client_id=p_client_id and service_date between p_from and p_from+27 order by service_date,version desc)e;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,auth.uid(),'select','client_weekly_snapshot',p_client_id::text,array['bounded_snapshot'],jsonb_build_object('days',28));
 return query select jsonb_build_object('clientId',p_client_id,'from',p_from,'generatedAt',now(),'version',coalesce(v_version,0),'plan',v_plan,'exceptions',v_exceptions,'days',private.client_weekly_days(p_client_id,p_from,28));
end; $$;
-- Read model for the daily expected-client roster and transport demand queue.
-- Existing actual attendance and vehicle dispatch tables are intentionally untouched.
create function private.client_weekly_projection_guarded(p_organization_id uuid,p_branch_id uuid,p_date date)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_rows jsonb; v_count integer;
begin
 if auth.uid() is null or p_date is null or p_date<'2000-01-01' or p_date>'2100-01-01'
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 or not(private.has_permission(p_organization_id,p_branch_id,'clients.read') or private.has_executive_read_permission(p_organization_id,p_branch_id,'clients.read'))
 then raise exception using errcode='42501',message='weekly projection denied'; end if;
 select count(*) into v_count from public.clients c where c.organization_id=p_organization_id and c.branch_id=p_branch_id and private.care_roster_can_read(c.id,'clients.read');
 if v_count>500 then raise exception using errcode='54000',message='weekly projection scope exceeds limit'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('clientId',c.id,'day',private.client_weekly_days(c.id,p_date,1)->0) order by c.id),'[]') into v_rows
 from public.clients c where c.organization_id=p_organization_id and c.branch_id=p_branch_id and private.care_roster_can_read(c.id,'clients.read');
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,auth.uid(),'select','client_weekly_projection',p_branch_id::text,array['bounded_projection'],jsonb_build_object('row_count',v_count));
 return query select jsonb_build_object('serviceDate',p_date,'generatedAt',now(),'rows',v_rows,'evidenceKind','planned_not_attended','transportStatus','unassigned_demand');
end; $$;
create function public.save_client_weekly(p_organization_id uuid,p_branch_id uuid,p_input jsonb) returns table(receipt jsonb)
language sql volatile security invoker set search_path='' as $$ select * from private.save_client_weekly_guarded(p_organization_id,p_branch_id,p_input); $$;
create function public.client_weekly_snapshot(p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_from date) returns table(payload jsonb)
language sql volatile security invoker set search_path='' as $$ select * from private.client_weekly_snapshot_guarded(p_organization_id,p_branch_id,p_client_id,p_from); $$;
create function public.client_weekly_projection(p_organization_id uuid,p_branch_id uuid,p_date date) returns table(payload jsonb)
language sql volatile security invoker set search_path='' as $$ select * from private.client_weekly_projection_guarded(p_organization_id,p_branch_id,p_date); $$;
revoke all on function private.client_weekly_append_only(),private.validate_client_weekly_day(jsonb),private.client_weekly_days(uuid,date,integer),
 private.save_client_weekly_guarded(uuid,uuid,jsonb),private.client_weekly_snapshot_guarded(uuid,uuid,uuid,date),private.client_weekly_projection_guarded(uuid,uuid,date),
 public.save_client_weekly(uuid,uuid,jsonb),public.client_weekly_snapshot(uuid,uuid,uuid,date),public.client_weekly_projection(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.save_client_weekly_guarded(uuid,uuid,jsonb),private.client_weekly_snapshot_guarded(uuid,uuid,uuid,date),private.client_weekly_projection_guarded(uuid,uuid,date),
 public.save_client_weekly(uuid,uuid,jsonb),public.client_weekly_snapshot(uuid,uuid,uuid,date),public.client_weekly_projection(uuid,uuid,date) to authenticated;
commit;
