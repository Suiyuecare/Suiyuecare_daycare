-- Candidate-only list for the already verified 23/17 pair. No source cells,
-- names, contact details or identity keys leave this read-only function.
begin;
set local lock_timeout = '5s';

create function private.jubo_profile_mapping_v2_review_queue(
  p_org uuid,p_branch uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_total integer; v_pairs jsonb;
begin
  v_challenge:=private.require_jubo_profile_v2_reviewer(p_org,p_branch);
  select count(*) into v_total
    from private.jubo_verified_source_pairs pair
    join private.jubo_pending_master_operations operation
      on operation.pair_id=pair.id and operation.organization_id=p_org
      and operation.branch_id=p_branch
    where pair.organization_id=p_org and pair.branch_id=p_branch
      and not exists (select 1 from private.jubo_public_pending_promotions promoted
        where promoted.pair_id=pair.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'pairId',pairs.id,
    'verifiedAt',pairs.verified_at,
    'sourceRows',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'sourceRowId',source_row.id,
        'sourceSheetRow',source_row.source_row_number,
        'reviewVersion',coalesce(latest.review_version,0),
        'decision',case
          when latest.id is null then 'unreviewed'
          when latest.mapping_version<>'jubo-master-monthly-202610-v2'
            or latest.source_row_sha256<>source_row.row_sha256
            or latest.mapping_review_sha256<>
              private.jubo_profile_mapping_fingerprint(source_row.raw_values,pending)
            then 'stale'
          else latest.decision end
      ) order by source_row.source_row_number),'[]'::jsonb)
      from private.jubo_pending_master_rows pending
      join private.jubo_source_rows source_row
        on source_row.id=pending.source_row_id
        and source_row.organization_id=p_org and source_row.branch_id=p_branch
        and source_row.batch_id=pairs.master_batch_id
      left join lateral (
        select review.id,review.review_version,review.decision,
          review.mapping_version,review.source_row_sha256,review.mapping_review_sha256
        from private.jubo_profile_mapping_v2_reviews review
        where review.pair_id=pairs.id and review.master_source_row_id=source_row.id
          and review.organization_id=p_org and review.branch_id=p_branch
        order by review.review_version desc limit 1
      ) latest on true
      where pending.operation_id=pairs.operation_id
        and pending.organization_id=p_org and pending.branch_id=p_branch
    )
  ) order by pairs.verified_at desc,pairs.id),'[]'::jsonb) into v_pairs
  from (
    select pair.id,pair.master_batch_id,pair.verified_at,operation.id operation_id
    from private.jubo_verified_source_pairs pair
    join private.jubo_pending_master_operations operation
      on operation.pair_id=pair.id and operation.organization_id=p_org
      and operation.branch_id=p_branch
    where pair.organization_id=p_org and pair.branch_id=p_branch
      and not exists (select 1 from private.jubo_public_pending_promotions promoted
        where promoted.pair_id=pair.id)
    order by pair.verified_at desc,pair.id limit 20
  ) pairs;
  if private.current_client_master_reauth_challenge()<>v_challenge then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REAUTH_EXPIRED';
  end if;
  return jsonb_build_object('pairs',v_pairs,'eligiblePairCount',v_total,
    'reviewPurpose','jubo_intake_profile_mapping_v2');
end;
$$;

create function public.jubo_profile_mapping_v2_review_queue(
  p_org uuid,p_branch uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_profile_mapping_v2_review_queue(p_org,p_branch);
$$;

alter function private.jubo_profile_mapping_v2_review_queue(uuid,uuid) owner to postgres;
revoke all on function private.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  to authenticated;
grant execute on function public.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  to authenticated;
comment on function public.jubo_profile_mapping_v2_review_queue(uuid,uuid) is
  'Candidate-only AAL2-scoped row ordinals and v2 review states; no original or normalized personal data.';
commit;
