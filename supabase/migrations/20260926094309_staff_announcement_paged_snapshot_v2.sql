-- Additive page-68 search/paging projection. The immutable mutation RPCs and
-- their authorization, recent AAL2, terminal-version and replay rules stay
-- unchanged. Page membership is never used as an authorization predicate.
begin;

create function private.staff_announcement_management_bundle_v2(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_actor uuid,
  p_manage boolean,p_now timestamptz,p_selected_release_version_id uuid,
  p_query text,p_status text,p_page integer,p_page_size integer
)
returns jsonb
language sql stable security invoker set search_path='' as $$
  with visible as materialized (
    select item.*, source.created_at as sort_created_at
    from private.staff_announcement_snapshot_rows(
      p_expected_organization_id,p_expected_branch_id,p_actor,p_manage,p_now
    ) item
    join public.staff_announcement_versions source on source.id=item.version_id
      and source.organization_id=p_expected_organization_id
      and source.branch_id=p_expected_branch_id
  ), matching as materialized (
    select * from visible item
    where (p_status='all' or item.lifecycle=p_status)
      and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',
        item.title,item.body,item.active_release_title,item.active_release_body)))>0)
  ), totals as (
    select count(*)::integer as matching_total,
      greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as total_pages
    from matching
  ), requested as (
    select totals.*,least(p_page,totals.total_pages) as page from totals
  ), page_rows as materialized (
    select item.* from matching item
    order by item.sort_created_at desc,item.announcement_key asc
    limit p_page_size offset (select (page-1)*p_page_size from requested)
  )
  select jsonb_build_object(
    'announcements',(
      select coalesce(jsonb_agg(to_jsonb(item)-'sort_created_at'
        order by item.sort_created_at desc,item.announcement_key asc),'[]'::jsonb)
      from page_rows item
    ),
    'summary',(
      select jsonb_build_object(
        'available_total',count(*)::integer,
        'matching_total',(select matching_total from requested),
        'items_truncated',count(*)>(select count(*) from page_rows),
        'draft_total',count(*) filter(where item.version_state='draft'),
        'unreleased_total',count(*) filter(where item.lifecycle='draft'),
        'scheduled_total',count(*) filter(where item.lifecycle='scheduled'),
        'published_total',count(*) filter(where item.lifecycle='published'),
        'expired_total',count(*) filter(where item.lifecycle='expired'),
        'withdrawn_total',count(*) filter(where item.lifecycle='withdrawn'),
        'unread_recipient_total',coalesce(sum(item.unread_count),0)::bigint
      ) from visible item
    ),
    'pagination',(
      select jsonb_build_object('page',page,'page_size',p_page_size,
        'total_pages',total_pages,
        'range_start',case when matching_total=0 then 0 else (page-1)*p_page_size+1 end,
        'range_end',least(page*p_page_size,matching_total)) from requested
    ),
    'selected_announcement',(
      select to_jsonb(item)-'sort_created_at' from visible item
      where p_manage and item.active_release_version_id=p_selected_release_version_id
    ),
    'staff_options',case when p_manage then coalesce((
      select options.staff_options from private.staff_announcement_audience_options_rows(
        p_expected_organization_id,p_expected_branch_id,p_now
      ) options
    ),'[]'::jsonb) else '[]'::jsonb end,
    'role_options',case when p_manage then coalesce((
      select options.role_options from private.staff_announcement_audience_options_rows(
        p_expected_organization_id,p_expected_branch_id,p_now
      ) options
    ),'[]'::jsonb) else '[]'::jsonb end,
    'selected_recipients',case when p_manage and p_selected_release_version_id is not null then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recipient_user_id',recipient.recipient_user_id,
        'recipient_display_name',recipient.recipient_display_name,
        'recipient_employee_code',recipient.recipient_employee_code,
        'recipient_profile_kind',recipient.recipient_profile_kind,
        'resolution_kind',recipient.resolution_kind,'read_at',receipt.read_at
      ) order by recipient.recipient_display_name collate "C",recipient.recipient_user_id),'[]'::jsonb)
      from public.staff_announcement_recipients recipient
      left join public.staff_announcement_read_receipts receipt
        on receipt.release_version_id=recipient.release_version_id
        and receipt.recipient_user_id=recipient.recipient_user_id
      where recipient.organization_id=p_expected_organization_id
        and recipient.branch_id=p_expected_branch_id
        and recipient.release_version_id=p_selected_release_version_id
    ) else '[]'::jsonb end
  );
$$;

create function private.staff_announcement_management_snapshot_v2_core(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_selected_release_version_id uuid,p_query text,p_status text,
  p_page integer,p_page_size integer
)
returns table(
  organization_id uuid,branch_id uuid,generated_at timestamptz,
  announcements jsonb,summary jsonb,staff_options jsonb,role_options jsonb,
  selected_release_version_id uuid,selected_recipients jsonb,can_manage boolean,
  delivery_boundary text,expiry_rule text,selected_announcement jsonb,pagination jsonb
)
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();v_manage boolean;
  v_bundle jsonb;v_owner jsonb;v_count integer;v_read_count integer;
begin
  if private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) is not true then
    raise exception using errcode='42501',message='announcement management snapshot is not permitted';
  end if;
  v_manage:=coalesce(private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ),false);
  if p_selected_release_version_id is not null and not v_manage then
    raise exception using errcode='42501',message='announcement recipient detail is not permitted';
  end if;
  if p_query is null or char_length(p_query)>120 or p_query~'[[:cntrl:]]'
    or p_status is null or p_status not in ('all','draft','scheduled','published','expired','withdrawn')
    or p_page is null or p_page not between 1 and 10000
    or p_page_size is null or p_page_size not in (20,50,100) then
    raise exception using errcode='22023',message='valid announcement search and pagination parameters are required';
  end if;
  v_bundle:=private.staff_announcement_management_bundle_v2(
    p_expected_organization_id,p_expected_branch_id,v_actor,v_manage,v_now,
    p_selected_release_version_id,p_query,p_status,p_page,p_page_size
  );
  if p_selected_release_version_id is not null then
    v_owner:=nullif(v_bundle->'selected_announcement','null'::jsonb);
    if v_owner is null then
      raise exception using errcode='42501',message='selected announcement release is outside current scope';
    end if;
    v_count:=jsonb_array_length(v_bundle->'selected_recipients');
    select count(*)::integer into v_read_count
      from jsonb_array_elements(v_bundle->'selected_recipients') recipient
      where recipient.value->'read_at'<>'null'::jsonb;
    if v_count<>(v_owner->>'recipient_count')::integer
      or v_read_count<>(v_owner->>'read_count')::integer then
      raise exception using errcode='40001',message='announcement aggregate and recipient detail changed';
    end if;
  end if;
  if private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) is not true or v_manage is distinct from coalesce(private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ),false) then
    raise exception using errcode='42501',message='announcement management snapshot authority expired';
  end if;
  insert into public.audit_events(
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'staff_announcement_management_snapshot',p_selected_release_version_id::text,'{}'::text[],
    jsonb_build_object('projection','page68_staff_announcement_management_v2',
      'announcement_count',jsonb_array_length(v_bundle->'announcements'),
      'announcement_available_total',(v_bundle->'summary'->>'available_total')::integer,
      'announcement_matching_total',(v_bundle->'summary'->>'matching_total')::integer,
      'recipient_count',jsonb_array_length(v_bundle->'selected_recipients'),
      'management',v_manage,'page',(v_bundle->'pagination'->>'page')::integer,
      'page_size',p_page_size,'query_present',p_query<>'','status_filter',p_status)
  );
  if private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) is not true or v_manage is distinct from coalesce(private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ),false) or v_bundle is distinct from private.staff_announcement_management_bundle_v2(
    p_expected_organization_id,p_expected_branch_id,v_actor,v_manage,v_now,
    p_selected_release_version_id,p_query,p_status,p_page,p_page_size
  ) then
    raise exception using errcode='42501',message='announcement management snapshot expired after audit';
  end if;
  return query select p_expected_organization_id,p_expected_branch_id,v_now,
    v_bundle->'announcements',v_bundle->'summary',v_bundle->'staff_options',v_bundle->'role_options',
    p_selected_release_version_id,v_bundle->'selected_recipients',v_manage,
    'staff_portal_read_receipts_only'::text,'explicit_datetime_or_explicit_no_expiry'::text,
    nullif(v_bundle->'selected_announcement','null'::jsonb),v_bundle->'pagination';
end;
$$;

create function public.staff_announcement_management_snapshot_v2(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_selected_release_version_id uuid default null,p_query text default '',
  p_status text default 'all',p_page integer default 1,p_page_size integer default 20
)
returns table(
  organization_id uuid,branch_id uuid,generated_at timestamptz,
  announcements jsonb,summary jsonb,staff_options jsonb,role_options jsonb,
  selected_release_version_id uuid,selected_recipients jsonb,can_manage boolean,
  delivery_boundary text,expiry_rule text,selected_announcement jsonb,pagination jsonb
)
language sql volatile security invoker set search_path='' as $$
  select * from private.staff_announcement_management_snapshot_v2_core($1,$2,$3,$4,$5,$6,$7);
$$;

revoke all on function private.staff_announcement_management_bundle_v2(uuid,uuid,uuid,boolean,timestamptz,uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_management_snapshot_v2_core(uuid,uuid,uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.staff_announcement_management_snapshot_v2(uuid,uuid,uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.staff_announcement_management_snapshot_v2_core(uuid,uuid,uuid,text,text,integer,integer) to authenticated;
grant execute on function public.staff_announcement_management_snapshot_v2(uuid,uuid,uuid,text,text,integer,integer) to authenticated;
commit;
