-- Pages 45/67: atomically create one staff notification and its complete
-- delivery fan-out. Family delivery remains fail-closed until an explicit
-- client/relationship/consent-scoped request shape is implemented.

alter table public.notifications
  add column queue_idempotency_key uuid,
  add column request_hash text,
  add column queued_reauth_challenge_id uuid;

alter table public.notifications
  add constraint notifications_queued_reauth_challenge_fkey
    foreign key (queued_reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  add constraint notifications_request_evidence_check check (
    (
      queue_idempotency_key is null
      and request_hash is null
      and queued_reauth_challenge_id is null
    )
    or (
      queue_idempotency_key is not null
      and request_hash ~ '^[a-f0-9]{64}$'
      and queued_reauth_challenge_id is not null
    )
  );

create unique index notifications_actor_queue_idempotency_idx
  on public.notifications (
    organization_id,
    created_by,
    queue_idempotency_key
  )
  where queue_idempotency_key is not null;
create index notifications_queued_reauth_challenge_idx
  on public.notifications (queued_reauth_challenge_id)
  where queued_reauth_challenge_id is not null;

create or replace function private.enqueue_staff_notification_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_category text,
  p_priority smallint,
  p_title text,
  p_body text,
  p_recipient_user_ids uuid[],
  p_channels text[],
  p_scheduled_for timestamptz,
  p_source_type text,
  p_source_id text,
  p_idempotency_key uuid
)
returns table(
  notification_id uuid,
  delivery_count integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz;
  v_category text := btrim(p_category);
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_source_type text := nullif(btrim(p_source_type), '');
  v_source_id text := nullif(btrim(p_source_id), '');
  v_recipients uuid[];
  v_channels text[];
  v_request_hash text;
  v_audience jsonb;
  v_scheduled_for timestamptz;
  v_valid_recipient_count integer;
  v_challenge private.reauth_challenges%rowtype;
  v_existing public.notifications%rowtype;
  v_created public.notifications%rowtype;
  v_delivery_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_idempotency_key is null
     or p_category is null
     or p_priority is null
     or p_title is null
     or p_body is null
     or p_recipient_user_ids is null
     or p_channels is null
     or char_length(v_category) not between 1 and 80
     or p_priority not between 0 and 3
     or char_length(v_title) not between 1 and 80
     or char_length(v_body) not between 1 and 240
     or (v_source_type is not null and char_length(v_source_type) > 80)
     or (v_source_id is not null and char_length(v_source_id) > 200)
     or cardinality(p_recipient_user_ids) not between 1 and 500
     or cardinality(p_channels) not between 1 and 4 then
    raise exception using errcode = '22023', message = 'valid notification queue fields are required';
  end if;

  -- Enforce the same privacy boundary in the database that the HTTP parser
  -- enforces: external notification copy is a generic signpost only.
  if (v_title || ' ' || v_body) ~* (
    '[A-Z][12][0-9]{8}|09[0-9]{8}|'
    || '(姓名|身分證|病歷號|電話|手機|地址|生日|出生日期)[[:space:]]*[:：]|'
    || '血壓|血糖|血氧|體溫|脈搏|胰島素|用藥|服藥|診斷|病歷|檢驗結果|'
    || '感染|跌倒|憂鬱|失智|傷口|尿布|排泄|月經|疫苗|TOCC'
  ) then
    raise exception using errcode = '22023', message = 'notification copy contains sensitive content';
  end if;

  select array_agg(distinct recipient order by recipient)
    into v_recipients
  from unnest(p_recipient_user_ids) recipient;

  select array_agg(distinct lower(btrim(channel)) order by lower(btrim(channel)))
    into v_channels
  from unnest(p_channels) channel;

  if cardinality(v_recipients) < 1
     or cardinality(v_channels) < 1
     or exists (
       select 1 from unnest(v_channels) channel
       where channel not in ('in_app', 'pwa', 'line', 'sms')
     ) then
    raise exception using errcode = '22023', message = 'notification recipients or channels are invalid';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.manage'
     ))
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
     ) then
    raise exception using errcode = '42501', message = 'notification queue is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'category', v_category,
    'priority', p_priority,
    'title', v_title,
    'body', v_body,
    'recipient_user_ids', to_jsonb(v_recipients),
    'channels', to_jsonb(v_channels),
    'scheduled_for', case
      when p_scheduled_for is null then null
      else to_char(
        p_scheduled_for at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    end,
    'source_type', v_source_type,
    'source_id', v_source_id,
    'created_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'notification-queue:' || p_expected_organization_id::text || ':' ||
    v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select notification.* into v_existing
  from public.notifications notification
  where notification.organization_id = p_expected_organization_id
    and notification.created_by = v_actor
    and notification.queue_idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.branch_id <> p_expected_branch_id
       or v_existing.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505', message = 'notification queue idempotency conflict';
    end if;

    select count(*)::integer into v_delivery_count
    from public.notification_deliveries delivery
    where delivery.notification_id = v_existing.id
      and delivery.organization_id = v_existing.organization_id;

    if v_delivery_count <> cardinality(v_recipients) * cardinality(v_channels) then
      raise exception using errcode = '40001', message = 'notification delivery fan-out is incomplete';
    end if;

    return query select v_existing.id, v_delivery_count, true;
    return;
  end if;

  -- A recipient is eligible only through an effective membership in the exact
  -- tenant/branch. Family profiles are intentionally rejected by this RPC;
  -- their eventual workflow must bind one client, relationship, consent scope,
  -- and consent version instead of inferring access from membership alone.
  select count(*)::integer into v_valid_recipient_count
  from unnest(v_recipients) recipient(user_id)
  where exists (
    select 1
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    where profile.id = recipient.user_id
      and profile.kind <> 'family'
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (
        membership.branch_id is null
        or membership.branch_id = p_expected_branch_id
      )
  );

  if v_valid_recipient_count <> cardinality(v_recipients) then
    raise exception using errcode = '42501', message = 'one or more notification recipients are outside the selected staff scope';
  end if;

  -- Recipient and authorization checks may wait on tenant state. Re-evaluate
  -- immediately before capturing the exact challenge and writing any row.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.manage'
     )) then
    raise exception using errcode = '42501', message = 'notification queue authority expired';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for notification queueing';
  end;

  select challenge.* into v_challenge
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = v_actor
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  v_now := clock_timestamp();
  if v_challenge.id is null
     or v_challenge.factor_verified_at is null
     or v_challenge.factor_verified_at < v_now - interval '15 minutes'
     or v_challenge.factor_verified_at > v_now + interval '1 minute' then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for notification queueing';
  end if;

  if p_scheduled_for is not null and p_scheduled_for < v_now - interval '1 minute' then
    raise exception using errcode = '22023', message = 'notification schedule is in the past';
  end if;
  v_scheduled_for := coalesce(p_scheduled_for, v_now);
  v_audience := jsonb_build_object(
    'schema_version', 2,
    'recipient_user_ids', to_jsonb(v_recipients),
    'channels', to_jsonb(v_channels),
    'content_hash', v_request_hash,
    'recipient_kind', 'staff'
  );

  insert into public.notifications (
    organization_id,
    branch_id,
    category,
    priority,
    title,
    body,
    audience,
    status,
    scheduled_for,
    source_type,
    source_id,
    created_by,
    queue_idempotency_key,
    request_hash,
    queued_reauth_challenge_id
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_category,
    p_priority,
    v_title,
    v_body,
    v_audience,
    'scheduled',
    v_scheduled_for,
    v_source_type,
    v_source_id,
    v_actor,
    p_idempotency_key,
    v_request_hash,
    v_challenge.id
  )
  returning * into v_created;

  insert into public.notification_deliveries (
    organization_id,
    branch_id,
    notification_id,
    recipient_user_id,
    channel,
    status,
    idempotency_key
  )
  select
    p_expected_organization_id,
    p_expected_branch_id,
    v_created.id,
    recipient.user_id,
    channel.value,
    'queued',
    gen_random_uuid()
  from unnest(v_recipients) recipient(user_id)
  cross join unnest(v_channels) channel(value);

  get diagnostics v_delivery_count = row_count;
  if v_delivery_count <> cardinality(v_recipients) * cardinality(v_channels) then
    raise exception using errcode = '40001', message = 'notification delivery fan-out was not written atomically';
  end if;

  return query select v_created.id, v_delivery_count, false;
end;
$$;

create or replace function public.enqueue_staff_notification(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_category text,
  p_priority smallint,
  p_title text,
  p_body text,
  p_recipient_user_ids uuid[],
  p_channels text[],
  p_scheduled_for timestamptz,
  p_source_type text,
  p_source_id text,
  p_idempotency_key uuid
)
returns table(
  notification_id uuid,
  delivery_count integer,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.enqueue_staff_notification_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_category,
    p_priority,
    p_title,
    p_body,
    p_recipient_user_ids,
    p_channels,
    p_scheduled_for,
    p_source_type,
    p_source_id,
    p_idempotency_key
  );
$$;

comment on function public.enqueue_staff_notification(
  uuid, uuid, text, smallint, text, text, uuid[], text[], timestamptz, text, text, uuid
) is
  'Atomically creates or exactly replays a tenant-scoped staff notification and complete delivery fan-out.';

revoke all on function private.enqueue_staff_notification_atomic(
  uuid, uuid, text, smallint, text, text, uuid[], text[], timestamptz, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_staff_notification(
  uuid, uuid, text, smallint, text, text, uuid[], text[], timestamptz, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.enqueue_staff_notification_atomic(
  uuid, uuid, text, smallint, text, text, uuid[], text[], timestamptz, text, text, uuid
) to authenticated;
grant execute on function public.enqueue_staff_notification(
  uuid, uuid, text, smallint, text, text, uuid[], text[], timestamptz, text, text, uuid
) to authenticated;

-- Provider delivery updates are server-side only. Recipient read/confirm will
-- be reopened through a narrow idempotent acknowledgement RPC, not column DML.
revoke insert, update, delete on table public.notifications from authenticated;
revoke insert, update, delete on table public.notification_deliveries from authenticated;
revoke update (status, read_at, confirmed_at, updated_at)
on table public.notification_deliveries from authenticated;
