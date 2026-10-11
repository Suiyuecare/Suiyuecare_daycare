begin;
set local lock_timeout = '5s';

insert into public.permissions(permission_key,description,risk_level)
values('quality_monthly.export','Freeze and export internal quality monthly snapshots',3),
 ('reports.read','Read reporting entry points without widening source-record permissions',1)
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.is_system and r.role_key in ('organization_manager','branch_supervisor','branch_director')
and p.permission_key in('quality_monthly.export','reports.read') on conflict do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.is_system and r.role_key='branch_director' and p.permission_key in('audit.view','quality_events.read') on conflict do nothing;

-- Narrow operational authority for individually approved Google staff. Global
-- clinical/financial roots remain unchanged. A director only sees her own site.
create function private.has_operations_evidence_permission(p_org uuid,p_branch uuid,p_key text) returns boolean
language sql volatile security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
 and p_key in('audit.view','reports.read','clients.read','attendance.read','quality_events.read','quality_monthly.export')
 and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
  where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
 and ((private.data_inventory_authorized(p_org,p_branch) and exists(
  select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
  join public.roles r on r.id=mr.role_id and r.is_active and r.is_system
  join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id and p.permission_key=p_key
  where m.profile_id=auth.uid() and m.organization_id=p_org and (m.branch_id=p_branch or(m.branch_id is null and r.role_key='organization_manager'))
  and m.status='active' and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
  and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp()))
 or exists(select 1 from private.routine_staff_scope() s join public.roles r on r.id=s.role_id and r.is_system
  join public.role_permissions rp on rp.role_id=r.id and rp.granted_at<=clock_timestamp()
  join public.permissions p on p.id=rp.permission_id and p.permission_key=p_key
  where s.organization_id=p_org and r.role_key in('organization_manager','branch_supervisor','branch_director')
  and(s.branch_id=p_branch or(s.branch_id is null and r.role_key='organization_manager')))),false);
$$;
revoke all on function private.has_operations_evidence_permission(uuid,uuid,text) from public,anon,authenticated,service_role;
create or replace function private.evaluation_preparation_authorized(p_org uuid,p_branch uuid) returns boolean
language sql volatile security definer set search_path='' as $$select private.has_operations_evidence_permission(p_org,p_branch,'audit.view');$$;

create table private.quality_monthly_snapshots(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 branch_id uuid not null, month text not null check(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 payload jsonb not null, payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 idempotency_key uuid not null, request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 unique(actor_user_id,idempotency_key)
);
create index quality_monthly_scope_idx on private.quality_monthly_snapshots(organization_id,branch_id,month,created_at desc);
alter table private.quality_monthly_snapshots enable row level security;
alter table private.quality_monthly_snapshots force row level security;
revoke all on private.quality_monthly_snapshots from public,anon,authenticated,service_role;
create trigger quality_monthly_snapshots_immutable before update or delete on private.quality_monthly_snapshots
 for each row execute function private.evaluation_preparation_append_only();

create function private.quality_monthly_authorized(p_org uuid,p_branch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.evaluation_preparation_authorized(p_org,p_branch)
 and private.has_operations_evidence_permission(p_org,p_branch,'reports.read')
 and private.has_operations_evidence_permission(p_org,p_branch,'clients.read')
 and private.has_operations_evidence_permission(p_org,p_branch,'attendance.read')
 and private.has_operations_evidence_permission(p_org,p_branch,'quality_events.read');
$$;

-- A single SQL statement owns numerator, denominator and drill-down identities.
-- This is an institution-namespaced operational indicator, not a guessed official formula.
create function private.quality_monthly_payload(p_org uuid,p_branch uuid,p_month text) returns jsonb
language sql stable security definer set search_path='' as $$
 with bounds as (
  select (p_month||'-01')::date starts_on,((p_month||'-01')::date+interval '1 month')::date ends_on
 ), attendance as (
  select a.id,a.client_id,a.service_date from public.attendance_records a,bounds b
  where a.organization_id=p_org and a.branch_id=p_branch and a.correction_of_id is null
  and a.status='present' and a.service_date>=b.starts_on and a.service_date<b.ends_on
 ), attendees as (
  select distinct on(client_id) id,client_id,service_date from attendance order by client_id,service_date,id
 ), weights as (
  select w.id,w.client_id,(w.observed_at at time zone 'Asia/Taipei')::date service_date,
   coalesce(c.correction_kind,'original') correction_kind
  from public.weight_observations w,bounds b
  left join lateral(select correction_kind from public.weight_observation_corrections c
   where c.observation_id=w.id and c.organization_id=p_org and c.branch_id=p_branch
   order by c.sequence_number desc limit 1)c on true
  where w.organization_id=p_org and w.branch_id=p_branch
  and w.observed_at>=b.starts_on::timestamp at time zone 'Asia/Taipei'
  and w.observed_at<b.ends_on::timestamp at time zone 'Asia/Taipei'
 ), measured as (
  select distinct on(w.client_id) w.id,w.client_id,w.service_date from weights w
  where w.correction_kind<>'void' and exists(select 1 from attendees a where a.client_id=w.client_id)
  order by w.client_id,w.service_date,w.id
 ), sources as (
  select 'falls' key,'fall' source,f.id,f.client_id,(f.occurred_at at time zone 'Asia/Taipei')::date service_date
  from public.fall_incidents f,bounds b where f.organization_id=p_org and f.branch_id=p_branch
  and f.occurred_at>=b.starts_on::timestamp at time zone 'Asia/Taipei' and f.occurred_at<b.ends_on::timestamp at time zone 'Asia/Taipei'
  union all
  select 'infections','infection',i.id,i.client_id,(i.occurred_at at time zone 'Asia/Taipei')::date
  from public.infection_incidents i,bounds b where i.organization_id=p_org and i.branch_id=p_branch
  and i.occurred_at>=b.starts_on::timestamp at time zone 'Asia/Taipei' and i.occurred_at<b.ends_on::timestamp at time zone 'Asia/Taipei'
  union all
  select 'abnormal','abnormal',e.id,e.affected_client_id,(e.occurred_at at time zone 'Asia/Taipei')::date
  from public.abnormal_incidents e,bounds b where e.organization_id=p_org and e.branch_id=p_branch and e.affected_target_kind='client'
  and e.occurred_at>=b.starts_on::timestamp at time zone 'Asia/Taipei' and e.occurred_at<b.ends_on::timestamp at time zone 'Asia/Taipei'
  union all select 'weight_coverage','weight',id,client_id,service_date from measured
 ), keys as (select * from (values(1,'falls'),(2,'infections'),(3,'abnormal'),(4,'weight_coverage'))v(position,key)),
 aggregates as (
  select k.position,k.key,
   (select count(*) from sources s where s.key=k.key) numerator,
   case when k.key='weight_coverage' then (select count(*) from attendees) else (select count(*) from attendance) end denominator,
   coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'clientId',s.client_id,'date',s.service_date,'source',s.source) order by s.service_date,s.id)
    from sources s where s.key=k.key),'[]'::jsonb) numerator_items,
   case when k.key='weight_coverage' then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'clientId',a.client_id,'date',a.service_date,'source','attendance') order by a.service_date,a.id) from attendees a),'[]'::jsonb)
   else coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'clientId',a.client_id,'date',a.service_date,'source','attendance') order by a.service_date,a.id) from attendance a),'[]'::jsonb) end denominator_items
  from keys k
 ) select jsonb_build_object('schemaVersion',1,'organizationId',p_org,'branchId',p_branch,'month',p_month,
 'ruleVersion','organization.quality-monthly-v1','officialIndicator',false,
 'excludedVoidedWeights',(select count(*) from weights where correction_kind='void'),
 'metrics',(select jsonb_agg(jsonb_build_object('key',key,'numerator',numerator,'denominator',denominator,
 'rate',case when denominator=0 then null else round(numerator::numeric*100/denominator,6)::text end,
 'numeratorItems',numerator_items,'denominatorItems',denominator_items) order by position) from aggregates));
$$;

create function private.quality_monthly_snapshot(p_org uuid,p_branch uuid,p_month text,p_snapshot uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_payload jsonb;v_hash text;v_now timestamptz;v_saved private.quality_monthly_snapshots;
begin
 if not private.quality_monthly_authorized(p_org,p_branch) then raise exception using errcode='42501',message='quality monthly denied';end if;
 if p_month is null or p_month!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception using errcode='22023',message='invalid month';end if;
 if p_snapshot is null then
  v_payload:=private.quality_monthly_payload(p_org,p_branch,p_month);v_now:=clock_timestamp();
  v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 else
  select * into v_saved from private.quality_monthly_snapshots where id=p_snapshot and organization_id=p_org and branch_id=p_branch and month=p_month;
  if not found then raise exception using errcode='42501',message='snapshot not in scope';end if;
  v_payload:=v_saved.payload;v_now:=v_saved.created_at;v_hash:=v_saved.payload_hash;
 end if;
 if exists(select 1 from jsonb_array_elements(v_payload->'metrics')m where jsonb_array_length(m->'numeratorItems')>25000 or jsonb_array_length(m->'denominatorItems')>25000) then
  raise exception using errcode='54000',message='monthly detail capacity exceeded';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','quality_monthly_snapshots',coalesce(p_snapshot::text,p_month),array[]::text[],jsonb_build_object('month',p_month,'frozen',p_snapshot is not null));
 return v_payload||jsonb_build_object('hash',v_hash,'generatedAt',v_now,'snapshotId',p_snapshot);
end;$$;

create function private.quality_monthly_freeze(p_org uuid,p_branch uuid,p_month text,p_expected_hash text,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_payload jsonb;v_hash text;v_request_hash text;v_saved private.quality_monthly_snapshots;
begin
 if not private.quality_monthly_authorized(p_org,p_branch) or not private.has_operations_evidence_permission(p_org,p_branch,'quality_monthly.export')
 or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='quality freeze denied';end if;
 if p_key is null or p_month is null or p_month!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_expected_hash is null or p_expected_hash!~'^[a-f0-9]{64}$' then
 raise exception using errcode='22023',message='invalid snapshot request';end if;
 v_request_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'month',p_month,'expected',p_expected_hash)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into v_saved from private.quality_monthly_snapshots where actor_user_id=auth.uid() and idempotency_key=p_key;
 if found then
  if v_saved.request_hash<>v_request_hash then raise exception using errcode='23505',message='idempotency conflict';end if;
  return v_saved.payload||jsonb_build_object('hash',v_saved.payload_hash,'generatedAt',v_saved.created_at,'snapshotId',v_saved.id);
 end if;
 v_payload:=private.quality_monthly_payload(p_org,p_branch,p_month);
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 if v_hash<>p_expected_hash then raise exception using errcode='40001',message='monthly data changed';end if;
 if exists(select 1 from jsonb_array_elements(v_payload->'metrics')m where jsonb_array_length(m->'numeratorItems')>25000 or jsonb_array_length(m->'denominatorItems')>25000) then
  raise exception using errcode='54000',message='monthly detail capacity exceeded';end if;
 insert into private.quality_monthly_snapshots(organization_id,branch_id,month,payload,payload_hash,actor_user_id,idempotency_key,request_hash)
 values(p_org,p_branch,p_month,v_payload,v_hash,auth.uid(),p_key,v_request_hash) returning * into v_saved;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'insert','quality_monthly_snapshots',v_saved.id::text,array[]::text[],jsonb_build_object('month',p_month,'rule_version','organization.quality-monthly-v1'));
 return v_payload||jsonb_build_object('hash',v_hash,'generatedAt',v_saved.created_at,'snapshotId',v_saved.id);
end;$$;

create function public.quality_monthly_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_month text,p_snapshot_id uuid default null) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.quality_monthly_snapshot(p_expected_organization_id,p_expected_branch_id,p_month,p_snapshot_id);$$;
create function public.quality_monthly_freeze(p_expected_organization_id uuid,p_expected_branch_id uuid,p_month text,p_expected_hash text,p_idempotency_key uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.quality_monthly_freeze(p_expected_organization_id,p_expected_branch_id,p_month,p_expected_hash,p_idempotency_key);$$;
revoke all on function private.quality_monthly_authorized(uuid,uuid),private.quality_monthly_payload(uuid,uuid,text),
 private.quality_monthly_snapshot(uuid,uuid,text,uuid),private.quality_monthly_freeze(uuid,uuid,text,text,uuid),
 public.quality_monthly_snapshot(uuid,uuid,text,uuid),public.quality_monthly_freeze(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.quality_monthly_snapshot(uuid,uuid,text,uuid),private.quality_monthly_freeze(uuid,uuid,text,text,uuid),
 public.quality_monthly_snapshot(uuid,uuid,text,uuid),public.quality_monthly_freeze(uuid,uuid,text,text,uuid) to authenticated;

create function private.quality_monthly_download(p_org uuid,p_branch uuid,p_month text,p_snapshot uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_payload jsonb;
begin
 if p_snapshot is null or not private.quality_monthly_authorized(p_org,p_branch)
 or not private.has_operations_evidence_permission(p_org,p_branch,'quality_monthly.export') or private.data_inventory_reauth() is null then
 raise exception using errcode='42501',message='quality download denied';end if;
 v_payload:=private.quality_monthly_snapshot(p_org,p_branch,p_month,p_snapshot);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'export','quality_monthly_snapshots',p_snapshot::text,array[]::text[],jsonb_build_object('month',p_month,'snapshot_hash',v_payload->>'hash'));
 return v_payload;
end;$$;
create function public.quality_monthly_download(p_expected_organization_id uuid,p_expected_branch_id uuid,p_month text,p_snapshot_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$select private.quality_monthly_download(p_expected_organization_id,p_expected_branch_id,p_month,p_snapshot_id);$$;
revoke all on function private.quality_monthly_download(uuid,uuid,text,uuid),public.quality_monthly_download(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.quality_monthly_download(uuid,uuid,text,uuid),public.quality_monthly_download(uuid,uuid,text,uuid) to authenticated;

-- Independent evidence review and frozen INTERNAL bundles. Official indicator
-- applicability remains unapproved; neither review nor bundle implies filing.
create table private.evaluation_evidence_reviews(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,
 version_id uuid not null unique references private.evaluation_preparation_versions(id) on delete restrict,
 reviewer_user_id uuid not null references auth.users(id) on delete restrict,
 decision text not null check(decision in ('approved','needs_changes')),
 reason_code text not null check(reason_code in ('review_complete','evidence_missing','source_not_verified','incomplete')),
 evidence jsonb,content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 idempotency_key uuid not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),unique(reviewer_user_id,idempotency_key),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 check((decision='approved')=(reason_code='review_complete')),
 check(decision<>'approved' or evidence is not null)
);
create index evaluation_evidence_review_scope_idx on private.evaluation_evidence_reviews(organization_id,branch_id,created_at desc);
create table private.evaluation_evidence_bundles(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,
 payload jsonb not null,payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),
 actor_user_id uuid not null references auth.users(id) on delete restrict,idempotency_key uuid not null,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 unique(actor_user_id,idempotency_key),foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict
);
create index evaluation_evidence_bundle_scope_idx on private.evaluation_evidence_bundles(organization_id,branch_id,created_at desc);
alter table private.evaluation_evidence_reviews enable row level security;alter table private.evaluation_evidence_reviews force row level security;
alter table private.evaluation_evidence_bundles enable row level security;alter table private.evaluation_evidence_bundles force row level security;
revoke all on private.evaluation_evidence_reviews,private.evaluation_evidence_bundles from public,anon,authenticated,service_role;
create trigger evaluation_evidence_reviews_immutable before update or delete on private.evaluation_evidence_reviews for each row execute function private.evaluation_preparation_append_only();
create trigger evaluation_evidence_bundles_immutable before update or delete on private.evaluation_evidence_bundles for each row execute function private.evaluation_preparation_append_only();

create function private.evaluation_evidence_resolve(p_org uuid,p_branch uuid,p_reference uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_job public.document_print_jobs;v_attachment private.clinical_attachments;v_source jsonb;v_source_id uuid;v_source_version integer;
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) then raise exception using errcode='42501',message='evidence denied';end if;
 select * into v_job from public.document_print_jobs where id=p_reference and organization_id=p_org and branch_id=p_branch;
 if found and private.can_staff_access_client(v_job.client_id,'document_printing.read') then
  return jsonb_build_object('reference',v_job.id,'kind','document_snapshot','hash',v_job.render_model_hash,'sourceId',v_job.id,'sourceVersion',1);
 end if;
 select a.* into v_attachment from private.clinical_attachments a join private.clinical_attachment_scans s on s.attachment_id=a.id and s.verdict='clean'
 where a.id=p_reference and a.organization_id=p_org and a.branch_id=p_branch;
 if found then
  v_source_id:=v_attachment.source_id;v_source_version:=v_attachment.source_version;
  -- Photos are uploaded while a record is a draft. Signing creates an immutable
  -- successor and inherits only already-clean attachments. Bind review to that
  -- signed successor rather than treating its original draft as formal evidence.
  if v_attachment.source_kind='care_diary' then
   select r.id,r.version into v_source_id,v_source_version from public.care_records r
   where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=v_attachment.client_id
   and r.category='staff/daily-care/care-diary' and r.status::text in('signed','corrected')
   and (r.id=v_attachment.source_id or exists(select 1 from private.clinical_attachment_links l
    where l.attachment_id=v_attachment.id and l.source_kind='care_diary' and l.source_id=r.id))
   order by r.version desc,r.id limit 1;
  elsif v_attachment.source_kind='body_assessment' then
   select r.id,r.version into v_source_id,v_source_version from public.body_assessment_versions r
   where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=v_attachment.client_id and r.record_state='signed'
   and (r.id=v_attachment.source_id or exists(select 1 from private.clinical_attachment_links l
    where l.attachment_id=v_attachment.id and l.source_kind='body_assessment' and l.source_id=r.id))
   order by r.version desc,r.id limit 1;
  end if;
  if v_source_id is null then raise exception using errcode='23514',message='evidence source not final';end if;
  v_source:=private.clinical_attachment_source(p_org,p_branch,v_attachment.client_id,v_attachment.source_kind,v_source_id,false);
  if (v_source->>'version')::integer<>v_source_version then raise exception using errcode='23514',message='evidence version mismatch';end if;
  if (v_attachment.source_kind in ('care_diary','body_assessment') and v_source->>'state'<>'signed')
   or (v_attachment.source_kind in ('vaccination','inspection') and v_source->>'state'<>'active') then
   raise exception using errcode='23514',message='evidence source not final';end if;
  return jsonb_build_object('reference',v_attachment.id,'kind','clinical_attachment','hash',v_attachment.sha256,
   'sourceId',v_source_id,'sourceVersion',v_source_version);
 end if;
 raise exception using errcode='23514',message='evidence missing or not verified';
end;$$;

create function private.evaluation_evidence_state(p_org uuid,p_branch uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with latest as(select distinct on(item_code)* from private.evaluation_preparation_versions where organization_id=p_org and branch_id=p_branch order by item_code,version desc)
 select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('version',private.evaluation_preparation_version_json(v),
 'review',case when r.id is null then null else jsonb_build_object('reviewId',r.id,'versionId',r.version_id,'reviewerUserId',r.reviewer_user_id,
 'decision',r.decision,'reasonCode',r.reason_code,'evidence',r.evidence,'contentHash',r.content_hash,'reviewedAt',r.created_at)end) order by v.item_code),'[]'::jsonb),
 'total',count(*),'approved',count(*)filter(where r.decision='approved')) from latest v
 left join private.evaluation_evidence_reviews r on r.version_id=v.id and r.organization_id=p_org and r.branch_id=p_branch;
$$;

-- All metadata changes, reviews and bundle creation share a branch collection
-- lease. A new item cannot appear between validation and the immutable freeze.
alter function private.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid) rename to evaluation_preparation_mutate_base;
create function private.evaluation_preparation_mutate(p_org uuid,p_branch uuid,p_request jsonb,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) then raise exception using errcode='42501',message='evaluation preparation denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text,7902));
 return private.evaluation_preparation_mutate_base(p_org,p_branch,p_request,p_key);
end;$$;
create or replace function public.evaluation_preparation_mutate(p_expected_organization_id uuid,p_expected_branch_id uuid,p_request jsonb,p_idempotency_key uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.evaluation_preparation_mutate(p_expected_organization_id,p_expected_branch_id,p_request,p_idempotency_key);$$;

create function private.evaluation_evidence_review(p_org uuid,p_branch uuid,p_version uuid,p_decision text,p_reason text,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_version private.evaluation_preparation_versions;v_old private.evaluation_evidence_reviews;v_evidence jsonb;v_hash text;v_payload jsonb;
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='evidence review denied';end if;
 if p_key is null or p_version is null or p_decision not in ('approved','needs_changes') or p_decision is null
 or p_reason is null or p_reason not in ('review_complete','evidence_missing','source_not_verified','incomplete')
 or ((p_decision='approved')<>(p_reason='review_complete')) then raise exception using errcode='22023',message='invalid review';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text,7902));
 v_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'version',p_version,'decision',p_decision,'reason',p_reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,79));
 select * into v_old from private.evaluation_evidence_reviews where reviewer_user_id=auth.uid() and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_hash then raise exception using errcode='23505',message='review idempotency conflict';end if;
 else
  select * into v_version from private.evaluation_preparation_versions where id=p_version and organization_id=p_org and branch_id=p_branch;
  if not found then raise exception using errcode='42501',message='review version out of scope';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text||':'||v_version.item_code,79));
  if exists(select 1 from private.evaluation_preparation_versions where organization_id=p_org and branch_id=p_branch and item_code=v_version.item_code and version>v_version.version)
   or exists(select 1 from private.evaluation_evidence_reviews where version_id=p_version) then raise exception using errcode='40001',message='review version changed';end if;
  if auth.uid()=v_version.recorded_by or auth.uid()=v_version.owner_user_id then raise exception using errcode='42501',message='independent reviewer required';end if;
  if v_version.progress<>'internal_review_requested' then raise exception using errcode='23514',message='review not requested';end if;
  if p_decision='approved' then v_evidence:=private.evaluation_evidence_resolve(p_org,p_branch,v_version.evidence_reference);end if;
  v_payload:=jsonb_build_object('versionId',p_version,'versionHash',v_version.content_hash,'reviewerUserId',auth.uid(),'decision',p_decision,'reasonCode',p_reason,'evidence',v_evidence);
  insert into private.evaluation_evidence_reviews(organization_id,branch_id,version_id,reviewer_user_id,decision,reason_code,evidence,content_hash,idempotency_key,request_hash)
  values(p_org,p_branch,p_version,auth.uid(),p_decision,p_reason,v_evidence,encode(sha256(convert_to(v_payload::text,'UTF8')),'hex'),p_key,v_hash) returning * into v_old;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
  values(p_org,p_branch,auth.uid(),'insert','evaluation_evidence_reviews',v_old.id::text,jsonb_build_object('decision',p_decision,'version_id',p_version));
 end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'idempotencyKey',p_key,
 'reviewId',v_old.id,'versionId',v_old.version_id,'decision',v_old.decision,'formalSubmissionEnabled',false);
end;$$;

create function private.evaluation_evidence_bundle(p_org uuid,p_branch uuid,p_expected_hash text,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_state jsonb;v_hash text;v_request_hash text;v_old private.evaluation_evidence_bundles;v_item jsonb;v_evidence jsonb;
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='bundle denied';end if;
 if p_key is null or p_expected_hash is null or p_expected_hash!~'^[a-f0-9]{64}$' then raise exception using errcode='22023',message='invalid bundle';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text,7902));
 v_request_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'expected',p_expected_hash)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,7901));
 select * into v_old from private.evaluation_evidence_bundles where actor_user_id=auth.uid() and idempotency_key=p_key;
 if found then
  if v_old.request_hash<>v_request_hash then raise exception using errcode='23505',message='bundle idempotency conflict';end if;
 else
  v_state:=private.evaluation_evidence_state(p_org,p_branch);
  v_hash:=encode(sha256(convert_to(v_state::text,'UTF8')),'hex');
  if v_hash<>p_expected_hash then raise exception using errcode='40001',message='evidence collection changed';end if;
  if (v_state->>'total')::integer=0 or (v_state->>'total')::integer<>(v_state->>'approved')::integer or (v_state->>'total')::integer>2500 then raise exception using errcode='23514',message='bundle has unresolved items';end if;
  -- Re-check current scope, scanner verdict and exact evidence version. Never
  -- grant access merely because another reviewer saw it earlier.
  for v_item in select value from jsonb_array_elements(v_state->'items') loop
   v_evidence:=private.evaluation_evidence_resolve(p_org,p_branch,(v_item#>>'{version,evidenceReference}')::uuid);
   if v_evidence is distinct from v_item#>'{review,evidence}' then raise exception using errcode='40001',message='reviewed evidence changed';end if;
  end loop;
  insert into private.evaluation_evidence_bundles(organization_id,branch_id,payload,payload_hash,actor_user_id,idempotency_key,request_hash)
  values(p_org,p_branch,v_state,v_hash,auth.uid(),p_key,v_request_hash) returning * into v_old;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
  values(p_org,p_branch,auth.uid(),'insert','evaluation_evidence_bundles',v_old.id::text,jsonb_build_object('item_count',v_state->'total','official_submission',false));
 end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'idempotencyKey',p_key,'bundleId',v_old.id,'hash',v_old.payload_hash,'formalSubmissionEnabled',false);
end;$$;

alter function private.evaluation_preparation_snapshot(uuid,uuid,integer) rename to evaluation_preparation_snapshot_base;
create function private.evaluation_preparation_snapshot(p_org uuid,p_branch uuid,p_page integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_base jsonb;v_state jsonb;v_reviews jsonb;v_bundles jsonb;v_evidence_options jsonb;
begin
 v_base:=private.evaluation_preparation_snapshot_base(p_org,p_branch,p_page);
 v_state:=private.evaluation_evidence_state(p_org,p_branch);
 select coalesce(jsonb_agg(i->'review'),'[]'::jsonb) into v_reviews from jsonb_array_elements(v_state->'items')i
 where i->'review'<>'null'::jsonb and exists(select 1 from jsonb_array_elements(v_base->'items')b where b->>'versionId'=i#>>'{version,versionId}');
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'hash',b.payload_hash,'createdAt',b.created_at,'itemCount',b.payload->'total') order by b.created_at desc),'[]'::jsonb)
 into v_bundles from(select * from private.evaluation_evidence_bundles where organization_id=p_org and branch_id=p_branch order by created_at desc limit 20)b;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'createdAt',e.created_at,'sourceId',e.source_id) order by e.created_at desc,e.id),'[]'::jsonb) into v_evidence_options from(
  select * from(
   select j.id,'document_snapshot' kind,j.created_at,j.id source_id from public.document_print_jobs j
   where j.organization_id=p_org and j.branch_id=p_branch and private.can_staff_access_client(j.client_id,'document_printing.read')
   union all
   select a.id,'clinical_attachment',a.created_at,a.source_id from private.clinical_attachments a join private.clinical_attachment_scans s on s.attachment_id=a.id and s.verdict='clean'
   where a.organization_id=p_org and a.branch_id=p_branch and private.care_roster_can_read(a.client_id,'clients.read')
   and case a.source_kind when 'care_diary' then private.care_roster_can_read(a.client_id,'care_records.read')
    when 'body_assessment' then private.care_roster_can_read(a.client_id,'body_assessments.read') else private.care_roster_can_read(a.client_id,'health.read')end
  )e order by e.created_at desc,e.id limit 200
 )e;
 return v_base||jsonb_build_object('reviews',v_reviews,'bundles',v_bundles,'evidenceOptions',v_evidence_options,
 'collectionHash',encode(sha256(convert_to(v_state::text,'UTF8')),'hex'),'approvedTotal',v_state->'approved');
end;$$;
create or replace function public.evaluation_preparation_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_page integer) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.evaluation_preparation_snapshot(p_expected_organization_id,p_expected_branch_id,p_page);$$;

create function public.evaluation_evidence_review(p_expected_organization_id uuid,p_expected_branch_id uuid,p_version_id uuid,p_decision text,p_reason_code text,p_idempotency_key uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.evaluation_evidence_review(p_expected_organization_id,p_expected_branch_id,p_version_id,p_decision,p_reason_code,p_idempotency_key);$$;
create function public.evaluation_evidence_bundle(p_expected_organization_id uuid,p_expected_branch_id uuid,p_expected_hash text,p_idempotency_key uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.evaluation_evidence_bundle(p_expected_organization_id,p_expected_branch_id,p_expected_hash,p_idempotency_key);$$;
create function private.evaluation_evidence_bundle_read(p_org uuid,p_branch uuid,p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_bundle private.evaluation_evidence_bundles;
begin
 if not private.evaluation_preparation_authorized(p_org,p_branch) or private.data_inventory_reauth() is null then raise exception using errcode='42501',message='bundle read denied';end if;
 select * into v_bundle from private.evaluation_evidence_bundles where id=p_id and organization_id=p_org and branch_id=p_branch;
 if not found then raise exception using errcode='42501',message='bundle not in scope';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
 values(p_org,p_branch,auth.uid(),'select','evaluation_evidence_bundles',p_id::text,jsonb_build_object('download',true,'official_submission',false));
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'bundleId',p_id,'hash',v_bundle.payload_hash,
 'createdAt',v_bundle.created_at,'payload',v_bundle.payload,'formalSubmissionEnabled',false);
end;$$;
create function public.evaluation_evidence_bundle_read(p_expected_organization_id uuid,p_expected_branch_id uuid,p_bundle_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.evaluation_evidence_bundle_read(p_expected_organization_id,p_expected_branch_id,p_bundle_id);$$;
revoke all on function private.evaluation_evidence_resolve(uuid,uuid,uuid),private.evaluation_evidence_state(uuid,uuid),
 private.evaluation_preparation_mutate_base(uuid,uuid,jsonb,uuid),private.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid),
 private.evaluation_preparation_snapshot_base(uuid,uuid,integer),private.evaluation_preparation_snapshot(uuid,uuid,integer),
 private.evaluation_evidence_review(uuid,uuid,uuid,text,text,uuid),private.evaluation_evidence_bundle(uuid,uuid,text,uuid),
 private.evaluation_evidence_bundle_read(uuid,uuid,uuid),public.evaluation_evidence_review(uuid,uuid,uuid,text,text,uuid),
 public.evaluation_evidence_bundle(uuid,uuid,text,uuid),public.evaluation_evidence_bundle_read(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid),private.evaluation_preparation_snapshot(uuid,uuid,integer),private.evaluation_evidence_review(uuid,uuid,uuid,text,text,uuid),
 private.evaluation_evidence_bundle(uuid,uuid,text,uuid),private.evaluation_evidence_bundle_read(uuid,uuid,uuid),
 public.evaluation_evidence_review(uuid,uuid,uuid,text,text,uuid),public.evaluation_evidence_bundle(uuid,uuid,text,uuid),public.evaluation_evidence_bundle_read(uuid,uuid,uuid) to authenticated;
commit;
