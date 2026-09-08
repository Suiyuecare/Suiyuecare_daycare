-- Fail-closed draft boundary for the only workflow allowed to use the generic
-- care-record endpoint. Signed care records remain unavailable until a
-- challenge-backed signing/correction RPC is implemented.

create or replace function private.record_care_diary_draft_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_shift text,
  p_care_item text,
  p_note text,
  p_abnormal boolean,
  p_follow_up text,
  p_idempotency_key uuid
)
returns table(
  id uuid,
  version integer,
  status public.record_status,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_existing public.care_records%rowtype;
  v_created public.care_records%rowtype;
  v_now timestamptz;
  v_care_item text := btrim(p_care_item);
  v_note text := btrim(coalesce(p_note, ''));
  v_follow_up text := nullif(btrim(p_follow_up), '');
  v_fields jsonb;
  v_request_hash text;
  v_data jsonb;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_occurred_at is null
     or p_idempotency_key is null
     or p_shift is null
     or p_shift not in ('morning', 'afternoon', 'full_day')
     or p_care_item is null
     or octet_length(v_care_item) not between 1 and 480
     or octet_length(v_note) > 8000
     or p_abnormal is null
     or (v_follow_up is not null and octet_length(v_follow_up) > 4000) then
    raise exception using errcode = '22023', message = 'valid care diary draft fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'care_records.write'
     )) then
    raise exception using errcode = '42501', message = 'care diary draft is not permitted';
  end if;

  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'shift', p_shift,
    'care_item', v_care_item,
    'note', v_note,
    'abnormal', p_abnormal,
    'follow_up', v_follow_up
  ));
  v_request_hash := encode(
    sha256(convert_to(jsonb_build_object(
      'schema_version', 1,
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id,
      'actor_user_id', v_actor,
      'client_id', p_client_id,
      'occurred_at', to_char(
        p_occurred_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'category', 'staff/daily-care/care-diary',
      'fields', v_fields
    )::text, 'UTF8')),
    'hex'
  );
  v_data := jsonb_build_object(
    'fields', v_fields,
    '_request', jsonb_build_object(
      'schema_version', 1,
      'idempotency_hash', v_request_hash,
      'page_slug', 'staff/daily-care/care-diary'
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'care-diary:' || p_expected_organization_id::text || ':' ||
    v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select record.* into v_existing
  from public.care_records record
  where record.organization_id = p_expected_organization_id
    and record.record_key = p_idempotency_key
    and record.version = 1
  for update;

  if found then
    if v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.created_by <> v_actor
       or v_existing.category <> 'staff/daily-care/care-diary'
       or v_existing.status <> 'draft'
       or v_existing.occurred_at <> p_occurred_at
       or v_existing.data -> '_request' ->> 'idempotency_hash' is distinct from v_request_hash then
      raise exception using errcode = '23505', message = 'care diary idempotency conflict';
    end if;

    if not (select private.can_staff_access_client(v_existing.client_id, 'care_records.write')) then
      raise exception using errcode = '42501', message = 'care diary replay is not permitted';
    end if;

    return query select v_existing.id, v_existing.version, v_existing.status, true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.can_staff_access_client(p_client_id, 'care_records.write')) then
    raise exception using errcode = '42501', message = 'care diary draft is not permitted';
  end if;

  v_now := clock_timestamp();
  if p_occurred_at < v_now - interval '24 hours'
     or p_occurred_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'care diary time is outside the allowed 24-hour draft window';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > (p_occurred_at at time zone 'Asia/Taipei')::date
     or (
       v_client.ended_on is not null
       and v_client.ended_on <= (p_occurred_at at time zone 'Asia/Taipei')::date
     ) then
    raise exception using errcode = '23514', message = 'care diary requires an active admitted client';
  end if;

  insert into public.care_records (
    organization_id,
    branch_id,
    client_id,
    record_key,
    version,
    category,
    status,
    occurred_at,
    data,
    source_system,
    created_by
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_idempotency_key,
    1,
    'staff/daily-care/care-diary',
    'draft',
    p_occurred_at,
    v_data,
    'local',
    v_actor
  )
  returning * into v_created;

  return query select v_created.id, v_created.version, v_created.status, false;
end;
$$;

create or replace function public.record_care_diary_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_shift text,
  p_care_item text,
  p_note text,
  p_abnormal boolean,
  p_follow_up text,
  p_idempotency_key uuid
)
returns table(
  id uuid,
  version integer,
  status public.record_status,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.record_care_diary_draft_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_occurred_at,
    p_shift,
    p_care_item,
    p_note,
    p_abnormal,
    p_follow_up,
    p_idempotency_key
  );
$$;

comment on function public.record_care_diary_draft(
  uuid, uuid, uuid, timestamptz, text, text, text, boolean, text, uuid
) is
  'Creates or exactly replays one scoped care-diary draft; it cannot sign, correct, or publish a care record.';

revoke all on function private.record_care_diary_draft_atomic(
  uuid, uuid, uuid, timestamptz, text, text, text, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.record_care_diary_draft_atomic(
  uuid, uuid, uuid, timestamptz, text, text, text, boolean, text, uuid
) to authenticated;

revoke all on function public.record_care_diary_draft(
  uuid, uuid, uuid, timestamptz, text, text, text, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.record_care_diary_draft(
  uuid, uuid, uuid, timestamptz, text, text, text, boolean, text, uuid
) to authenticated;

-- Direct Data API mutations could otherwise forge signed_by, signed_at,
-- content hashes, categories, or authorship. Draft creation is RPC-only and
-- signing intentionally remains unavailable until its evidence workflow lands.
revoke insert, update, delete on table public.care_records from authenticated;
