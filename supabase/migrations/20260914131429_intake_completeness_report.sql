begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Metadata-only report over private append-only intake evidence. This private
-- definer is required because authenticated users deliberately have no direct
-- table privileges. Reuse the same live session, tenant, client and category
-- guards as the underlying workspaces; the public entry remains invoker-only.
create function private.intake_completeness_snapshot(p_org uuid,p_branch uuid,p_date date)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_intake_authority(p_org,p_branch,null,false);
 if p_date is null or not isfinite(p_date) or p_date<date '2000-01-01' or p_date>date '2100-01-01' then
  raise exception using errcode='22023',message='invalid intake report date'; end if;
 -- One SELECT statement supplies all client/check rows from the same MVCC
 -- snapshot. No per-client RPC waterfall and no separately queried totals.
 with visible as materialized (
  select c.id,c.client_code,c.display_name,c.status
  from public.clients c where c.organization_id=p_org and c.branch_id=p_branch
   and (private.can_staff_access_client(c.id,'clients.read') or private.can_routine_intake_access_client(c.id,'clients.read'))
   and (private.can_staff_access_client(c.id,'clients.demographics.read') or private.can_routine_intake_access_client(c.id,'clients.demographics.read'))
  order by c.client_code,c.id limit 501
 ), projected as (
  select c.*, coalesce(v.version,0) profile_version,
   jsonb_build_array(
    jsonb_build_object('key','identity','state',case when v.id is null then 'unknown' when nullif(btrim(v.profile->>'identityNumber'),'') is null then 'missing' else 'complete' end),
    jsonb_build_object('key','birth_date','state',case when v.id is null then 'unknown' when nullif(v.profile->>'dateOfBirth','') is null then 'missing' else 'complete' end),
    jsonb_build_object('key','address','state',case when v.id is null then 'unknown' when nullif(btrim(v.profile->>'residentialAddress'),'') is null then 'missing' else 'complete' end),
    jsonb_build_object('key','contact','state',case when v.id is null then 'unknown' when exists(select 1 from jsonb_array_elements(v.profile->'contacts') x where nullif(btrim(x->>'name'),'') is not null and nullif(btrim(x->>'phone'),'') is not null) then 'complete' else 'missing' end),
    jsonb_build_object('key','emergency_contact','state',case when v.id is null then 'unknown' when exists(select 1 from jsonb_array_elements(v.profile->'contacts') x where x->'isEmergency'='true'::jsonb and nullif(btrim(x->>'name'),'') is not null and nullif(btrim(x->>'phone'),'') is not null) then 'complete' else 'missing' end),
    jsonb_build_object('key','consent','state',case when v.id is null then 'unknown' when v.profile#>>'{consent,status}'='confirmed' and v.profile#>>'{consent,confirmedOn}' is not null then 'complete' when v.profile#>>'{consent,status}'='declined' then 'declined' else 'pending' end)
   ) || docs.checks || jsonb_build_array(jsonb_build_object('key','weekly','state',
     case when not (private.care_roster_can_read(c.id,'clients.read') or private.has_routine_intake_access(p_org,p_branch,'weekly.read',c.id)) then 'denied'
      when w.id is null then 'missing' when w.effective_to<p_date then 'expired' else 'complete' end)) checks
  from visible c
  left join lateral (select p.id,p.version,p.profile from private.client_intake_versions p
    where p.organization_id=p_org and p.branch_id=p_branch and p.client_id=c.id order by p.version desc limit 1) v on true
  left join lateral (select p.id,p.effective_to from private.client_weekly_versions p
    where p.organization_id=p_org and p.branch_id=p_branch and p.client_id=c.id and p.effective_from<=p_date
    order by p.version desc limit 1) w on true
  cross join lateral (
   select jsonb_agg(jsonb_build_object('key',cat.category,'state',case
    when not private.client_document_access(c.id,cat.category,false) then 'denied'
    when r.document_version=coalesce(d.version,0) and r.decision='not_applicable' then 'not_applicable'
    when d.id is null then 'missing'
    when s.verdict is null then 'pending'
    when s.verdict<>'clean' then 'replacement'
    when r.document_version=d.version and r.decision='needs_replacement' then 'replacement'
    when d.valid_until<p_date then 'expired'
    when r.document_version=d.version and r.decision='reviewed' then 'complete'
    else 'pending' end) order by cat.ordinal) checks
   from unnest(array['identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam']) with ordinality cat(category,ordinal)
   left join lateral (select p.id,p.version,p.valid_until from private.client_document_versions p
    where p.organization_id=p_org and p.branch_id=p_branch and p.client_id=c.id and p.category=cat.category
    and private.client_document_access(c.id,cat.category,false) order by p.version desc limit 1) d on true
   left join private.client_document_scan_results s on s.document_id=d.id
   left join lateral (select p.document_version,p.decision from private.client_document_review_versions p
    where p.organization_id=p_org and p.branch_id=p_branch and p.client_id=c.id and p.category=cat.category
    and private.client_document_access(c.id,cat.category,false) order by p.version desc limit 1) r on true
  ) docs
 )
 select jsonb_build_object('organizationId',p_org,'branchId',p_branch,'asOf',p_date,'generatedAt',statement_timestamp(),
  'rows',coalesce(jsonb_agg(jsonb_build_object('clientId',id,'displayName',display_name,'clientCode',client_code,
    'clientStatus',status,'profileVersion',profile_version,'checks',checks) order by client_code,id),'[]'::jsonb))
 into result from projected;
 if jsonb_array_length(result->'rows')>500 then raise exception using errcode='54000',message='intake report scope limit';end if;
 -- A read that cannot write its non-PHI audit evidence fails closed.
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
 values(p_org,p_branch,auth.uid(),'select','intake_completeness_snapshot',
  jsonb_build_object('row_count',jsonb_array_length(result->'rows'),'projection','intake_completeness_v1','as_of',p_date));
 perform private.require_intake_authority(p_org,p_branch,null,false);
 return result;
end;$$;
create function public.intake_completeness_snapshot(p_org uuid,p_branch uuid,p_date date)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.intake_completeness_snapshot(p_org,p_branch,p_date);
$$;
revoke all on function private.intake_completeness_snapshot(uuid,uuid,date),public.intake_completeness_snapshot(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.intake_completeness_snapshot(uuid,uuid,date),public.intake_completeness_snapshot(uuid,uuid,date) to authenticated;
comment on function public.intake_completeness_snapshot(uuid,uuid,date) is 'Scoped metadata-only intake follow-up. Not clinical approval, admission approval, document authenticity certification or a launch gate.';
commit;
