-- Candidate only: an owner-only, ungranted path for 23 formally visible
-- client master shells. All rows remain pending and non-operational. This
-- must not be exposed until the entire operational gate matrix and the
-- trusted same-bytes XLSX staging worker pass formal PostgreSQL tests.
begin;
set local lock_timeout = '5s';

alter table public.clients add constraint clients_pending_has_no_service_period
  check (status <> 'pending' or (admitted_on is null and ended_on is null));

create table private.jubo_public_pending_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  pending_operation_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt)='object'),
  committed_at timestamptz not null default clock_timestamp(),
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (pending_operation_id,organization_id,branch_id)
    references private.jubo_pending_master_operations(id,organization_id,branch_id) on delete restrict,
  unique(pair_id),unique(pending_operation_id),unique(actor_user_id,idempotency_key),
  unique(id,organization_id,branch_id)
);
create index jubo_public_pending_promotions_scope_idx on private.jubo_public_pending_promotions
  (organization_id,branch_id,committed_at desc);
create index jubo_public_pending_promotions_reauth_idx on private.jubo_public_pending_promotions
  (reauth_challenge_id);

create table private.jubo_public_pending_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  promotion_id uuid not null,
  pending_row_id uuid not null,
  client_id uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  foreign key (promotion_id,organization_id,branch_id)
    references private.jubo_public_pending_promotions(id,organization_id,branch_id) on delete restrict,
  foreign key (pending_row_id,organization_id,branch_id)
    references private.jubo_pending_master_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  unique(pending_row_id),unique(client_id)
);
create index jubo_public_pending_links_scope_idx on private.jubo_public_pending_links
  (organization_id,branch_id,promotion_id);

do $tables$ declare t text; begin
  foreach t in array array['jubo_public_pending_promotions','jubo_public_pending_links'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

-- Existing clients_insert RLS is broader than this one reviewed source path.
-- Even an authorized manager cannot directly create a pending case without
-- the owner-only transaction and its immutable operation evidence.
create function private.guard_jubo_pending_client_insert() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare v_operation uuid;
begin
  -- Test OLD first. Otherwise pending -> active could escape through the
  -- new-status early return before a reviewed admission transition exists.
  if tg_op='UPDATE' and old.status='pending' then
    raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_TRANSITION_DISABLED';
  end if;
  if new.status <> 'pending' then return new; end if;
  if tg_op <> 'INSERT' or current_user <> 'postgres' then
    raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION';
  end if;
  begin
    v_operation:=nullif(current_setting('app.jubo_pending_promotion_id',true),'')::uuid;
  exception when invalid_text_representation then
    v_operation:=null;
  end;
  if v_operation is null or new.source_system <> 'jubo'
    or not exists(select 1 from private.jubo_public_pending_promotions op
      where op.id=v_operation and op.organization_id=new.organization_id
        and op.branch_id=new.branch_id) then
    raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION';
  end if;
  return new;
end;
$$;
create trigger aa_jubo_pending_client_insert_guard before insert or update on public.clients
  for each row execute function private.guard_jubo_pending_client_insert();

-- Defence in depth: no public client-linked table may write a record for a
-- pending person. Assessment drafts need a separate, explicitly reviewed
-- allowlist later; signed assessments, transport, medication, attendance,
-- service and claims are all denied by default now.
create function private.reject_pending_client_activity() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_client uuid;
begin
  if tg_op='DELETE' then v_client:=old.client_id;
  else v_client:=new.client_id; end if;
  if v_client is not null and exists(select 1 from public.clients client
    where client.id=v_client and client.status='pending') then
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='UPDATE' and old.client_id is distinct from new.client_id
    and exists(select 1 from public.clients client
      where client.id=old.client_id and client.status='pending') then
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
do $triggers$ declare t record; begin
  for t in select distinct table_name from information_schema.columns
    where table_schema='public' and column_name='client_id' and data_type='uuid'
      and table_name in (select table_name from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE')
    order by table_name loop
    execute format('create trigger jubo_pending_client_no_activity before insert or update or delete on public.%I for each row execute function private.reject_pending_client_activity()',t.table_name);
  end loop;
end $triggers$;

create function private.promote_jubo_public_pending_candidate(
  p_org uuid,p_branch uuid,p_pair uuid,p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_pair private.jubo_verified_source_pairs%rowtype;
  v_pending_operation private.jubo_pending_master_operations%rowtype;
  v_previous private.jubo_public_pending_promotions%rowtype;
  v_row private.jubo_pending_master_rows%rowtype;
  v_challenge uuid; v_request_sha text; v_promotion uuid; v_client uuid;
  v_receipt jsonb; v_linked integer; v_monthly integer;
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve')
    or not private.has_permission(p_org,p_branch,'imports.manage') then
    raise exception using errcode='42501',message='JUBO_PUBLIC_PENDING_DENIED';
  end if;
  v_challenge:=private.current_client_master_reauth_challenge();
  if p_org is null or p_branch is null or p_pair is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='JUBO_PUBLIC_PENDING_INVALID';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-public-pending:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_public_pending_promotions
    where actor_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v_previous.id is not null then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PUBLIC_PENDING_IDEMPOTENCY_CONFLICT';
    end if;
    return v_previous.receipt||jsonb_build_object('replayed',true);
  end if;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  select * into v_pending_operation from private.jubo_pending_master_operations
    where pair_id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  if v_pair.id is null or v_pending_operation.id is null then
    raise exception using errcode='42501',message='JUBO_PUBLIC_PENDING_SCOPE_MISMATCH';
  end if;
  if exists(select 1 from private.jubo_public_pending_promotions where pair_id=p_pair) then
    raise exception using errcode='23505',message='JUBO_PUBLIC_PENDING_ALREADY_COMMITTED';
  end if;
  if v_pair.master_byte_sha256<>private.jubo_expected_source_sha256('client_master')
    or v_pair.monthly_byte_sha256<>private.jubo_expected_source_sha256('daycare_monthly_summary')
    or v_pair.master_rows_sha256<>private.jubo_staged_rows_sha256(v_pair.master_batch_id)
    or v_pair.master_nonrecord_rows_sha256<>private.jubo_nonrecord_rows_sha256(v_pair.master_batch_id)
    or v_pair.monthly_rows_sha256<>private.jubo_staged_rows_sha256(v_pair.monthly_batch_id) then
    raise exception using errcode='22023',message='JUBO_PUBLIC_PENDING_SOURCE_MISMATCH';
  end if;
  if (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id)<>23
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and monthly_source_row_id is not null)<>17
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and source_status='服務中')<>17
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and source_status='暫停服務')<>1
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and source_status='結案')<>5
    or exists(select 1 from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and (admitted_on is not null or care_eligible)) then
    raise exception using errcode='22023',message='JUBO_PUBLIC_PENDING_COUNT_MISMATCH';
  end if;
  -- A lock prevents a concurrent legacy client insert from escaping the
  -- unbound-identity scan. The exact identity index still handles races with
  -- existing bound clients. This is intentionally a rare one-time operation.
  perform set_config('lock_timeout','5s',true);
  lock table public.clients in share row exclusive mode;
  if exists(select 1 from public.clients existing where existing.organization_id=p_org
    and not exists(select 1 from private.client_intake_identities bound
      where bound.client_id=existing.id and bound.organization_id=p_org))
    or exists(select 1 from private.jubo_pending_master_rows pending
      join private.client_intake_identities bound
        on bound.organization_id=p_org and bound.identity_sha256=pending.identity_sha256
      where pending.operation_id=v_pending_operation.id) then
    raise exception using errcode='23505',message='JUBO_PUBLIC_PENDING_IDENTITY_COLLISION';
  end if;
  v_promotion:=gen_random_uuid();
  v_receipt:=jsonb_build_object('promotionId',v_promotion,'publicPendingClients',23,
    'monthlyMatches',17,'sourceActive',17,'sourceSuspended',1,'sourceClosed',5,
    'careEligible',0,'admitted',0,'replayed',false);
  insert into private.jubo_public_pending_promotions(id,organization_id,branch_id,pair_id,
    pending_operation_id,actor_user_id,reauth_challenge_id,idempotency_key,
    request_sha256,receipt) values(v_promotion,p_org,p_branch,p_pair,
    v_pending_operation.id,auth.uid(),v_challenge,p_idempotency_key,v_request_sha,v_receipt);
  perform set_config('app.jubo_pending_promotion_id',v_promotion::text,true);
  for v_row in select * from private.jubo_pending_master_rows
    where operation_id=v_pending_operation.id order by id loop
    v_client:=gen_random_uuid();
    insert into public.clients(id,organization_id,branch_id,client_code,display_name,
      date_of_birth,status,admitted_on,ended_on,source_system)
      values(v_client,p_org,p_branch,'JUBO-'||replace(v_client::text,'-',''),
        v_row.display_name,v_row.date_of_birth,'pending',null,null,'jubo');
    insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256)
      values(p_org,p_branch,v_client,v_row.identity_sha256);
    insert into private.jubo_public_pending_links(organization_id,branch_id,promotion_id,
      pending_row_id,client_id) values(p_org,p_branch,v_promotion,v_row.id,v_client);
    insert into private.jubo_client_source_links(source_row_id,organization_id,branch_id,
      client_id,import_operation_id) values(v_row.source_row_id,p_org,p_branch,v_client,v_promotion);
  end loop;
  select count(*),count(*) filter (where pending.monthly_source_row_id is not null)
    into v_linked,v_monthly
    from private.jubo_public_pending_links link
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
    join public.clients client on client.id=link.client_id
    where link.promotion_id=v_promotion and client.status='pending'
      and client.admitted_on is null and client.ended_on is null;
  if v_linked<>23 or v_monthly<>17 then
    raise exception using errcode='40001',message='JUBO_PUBLIC_PENDING_READBACK_MISMATCH';
  end if;
  return v_receipt;
end;
$$;
alter function private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function private.guard_jubo_pending_client_insert() from public,anon,authenticated,service_role;
revoke all on function private.reject_pending_client_activity() from public,anon,authenticated,service_role;
revoke all on function private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
comment on function private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid) is
  'Candidate only: NO Data API grant; cannot run until same-bytes parser worker, full operational gate and formal PostgreSQL concurrency checks pass.';
commit;
