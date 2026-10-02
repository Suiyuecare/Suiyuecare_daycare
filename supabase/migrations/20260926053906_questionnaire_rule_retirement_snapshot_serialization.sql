-- Retirement history and its derived availability cutoff must describe one
-- scope snapshot. An audit wait may not admit a normal approval between them.
-- Keep both the initial and final current-authority checks, and recheck after
-- waiting on the exact advisory scope lock shared by review/retirement writers.
create or replace function private.read_questionnaire_rule_retirement_scoped(
 p_org uuid,p_branch uuid,p_activation uuid,p_before_created_at timestamptz,p_before_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a private.questionnaire_rule_activations;items jsonb;page jsonb;total integer;next_cursor jsonb;
begin
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule retirement read denied';end if;
 if p_activation is null or((p_before_created_at is null)<>(p_before_id is null)) or(p_before_created_at is not null and(not isfinite(p_before_created_at) or p_before_created_at>clock_timestamp()+interval '1 minute'))
 then raise exception using errcode='22023',message='invalid retirement history cursor';end if;
 select * into a from private.questionnaire_rule_activations existing where existing.id=p_activation and existing.organization_id=p_org and existing.branch_id=p_branch;
 if not found then raise exception using errcode='42501',message='activation outside selected scope';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'questionnaire-rule-scope:'||p_org::text||':'||p_branch::text||':'||a.form_key,0
 ));
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule retirement read changed while waiting';end if;
 with matching as(select * from private.questionnaire_rule_retirement_requests q where q.organization_id=p_org and q.branch_id=p_branch and q.activation_id=p_activation),
  selected as(select * from matching where p_before_created_at is null or(requested_at,id)<(p_before_created_at,p_before_id) order by requested_at desc,id desc limit 21)
 select coalesce((select jsonb_agg(private.questionnaire_rule_retirement_request_json(s) order by s.requested_at desc,s.id desc) from selected s),'[]'::jsonb),(select count(*)::integer from matching) into items,total;
 page:=items-20;
 if jsonb_array_length(items)>20 then next_cursor:=jsonb_build_object('createdAt',page->19->'requestedAt','id',page->19->'requestId');else next_cursor:=null;end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_rule_retirement','retirement-history',array[]::text[],jsonb_build_object('workflow','questionnaire_rule_retirement_v1','row_count',jsonb_array_length(page),'content_excluded',true));
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule retirement read changed';end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'activationId',a.id,'formKey',a.form_key,'catalogHash',a.catalog_hash,
  'originalEffectiveTo',a.effective_to,'effectiveThrough',private.questionnaire_rule_effective_through(a.id),'requests',page,'total',total,'nextCursor',next_cursor,'generatedAt',clock_timestamp());
end;$$;
