-- Page 57: immutable meal requirements, attendance-scoped menu review,
-- deterministic exact-code conflict detection, and prepared-count evidence.

insert into public.permissions(permission_key, description, risk_level) values
  ('meals.read', 'Read assigned-client meal requirements and meal plans', 2),
  ('meals.manage', 'Create meal requirements and attendance-scoped meal plans', 3),
  ('meals.confirm', 'Resolve meal conflicts and complete preparation', 3)
on conflict (permission_key) do update set
  description = excluded.description, risk_level = excluded.risk_level;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where (
  permission.permission_key in ('meals.read', 'meals.manage')
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional'
  )
) or (
  permission.permission_key = 'meals.confirm'
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'nurse', 'professional'
  )
)
on conflict do nothing;

create or replace function private.meal_reference_items_are_valid(
  p_items jsonb,
  p_allow_empty boolean default true
)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_item jsonb;
begin
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 50
     or (not p_allow_empty and jsonb_array_length(p_items) = 0) then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or v_item - array['code', 'label'] <> '{}'::jsonb
       or coalesce(v_item ->> 'code', '') !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
       or char_length(btrim(coalesce(v_item ->> 'label', ''))) not between 1 and 120
       or v_item ->> 'label' ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;
  return not exists (
    select 1 from jsonb_array_elements(p_items) item
    group by item ->> 'code' having count(*) > 1
  );
exception when others then
  return false;
end;
$$;

create table public.meal_requirement_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  client_id uuid not null,
  requirement_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  effective_from date not null,
  texture_state text not null,
  texture_label text,
  allergy_status text not null,
  allergens jsonb not null,
  contraindication_status text not null,
  contraindications jsonb not null,
  note text,
  source_kind text not null default 'manual_unstandardized',
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint meal_requirement_branch_scope_fkey foreign key(branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint meal_requirement_client_scope_fkey foreign key(
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint meal_requirement_id_scope_key unique(id, organization_id, branch_id, client_id),
  constraint meal_requirement_chain_key unique(requirement_key, version),
  constraint meal_requirement_previous_unique unique(previous_version_id),
  constraint meal_requirement_previous_scope_fkey foreign key(
    previous_version_id, organization_id, branch_id, client_id
  ) references public.meal_requirement_versions(
    id, organization_id, branch_id, client_id
  ) on delete restrict,
  constraint meal_requirement_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null))
  ),
  constraint meal_requirement_texture_check check (
    texture_state in ('recorded', 'missing', 'not_applicable')
    and ((texture_state = 'recorded' and char_length(btrim(texture_label)) between 1 and 120)
      or (texture_state <> 'recorded' and texture_label is null))
  ),
  constraint meal_requirement_allergy_check check (
    allergy_status in ('recorded', 'none_declared', 'unknown')
    and private.meal_reference_items_are_valid(allergens, allergy_status <> 'recorded')
    and ((allergy_status = 'recorded' and jsonb_array_length(allergens) > 0)
      or (allergy_status <> 'recorded' and allergens = '[]'::jsonb))
  ),
  constraint meal_requirement_contraindication_check check (
    contraindication_status in ('recorded', 'none_declared', 'unknown')
    and private.meal_reference_items_are_valid(
      contraindications, contraindication_status <> 'recorded'
    )
    and ((contraindication_status = 'recorded'
          and jsonb_array_length(contraindications) > 0)
      or (contraindication_status <> 'recorded' and contraindications = '[]'::jsonb))
  ),
  constraint meal_requirement_note_check check (
    note is null or (char_length(btrim(note)) between 1 and 1000
      and note !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')
  ),
  constraint meal_requirement_source_check check (source_kind = 'manual_unstandardized'),
  constraint meal_requirement_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.meal_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  plan_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  status text not null,
  service_date date not null,
  meal_kind text not null,
  menu_title text not null,
  ingredients jsonb not null,
  extra_planned_portions integer not null,
  attendance_client_ids uuid[] not null,
  attendance_snapshot_hash text not null,
  assignment_snapshot jsonb not null,
  conflict_snapshot jsonb not null,
  resolution_snapshot jsonb,
  actual_portions jsonb,
  extra_actual_portions integer,
  attendance_count integer not null,
  planned_portion_total integer not null,
  actual_portion_total integer,
  variance_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null,
  content_hash text not null,
  constraint meal_plan_branch_scope_fkey foreign key(branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint meal_plan_id_scope_key unique(id, organization_id, branch_id),
  constraint meal_plan_chain_key unique(plan_key, version),
  constraint meal_plan_previous_unique unique(previous_version_id),
  constraint meal_plan_previous_scope_fkey foreign key(
    previous_version_id, organization_id, branch_id
  ) references public.meal_plan_versions(id, organization_id, branch_id) on delete restrict,
  constraint meal_plan_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null))
  ),
  constraint meal_plan_identity_check check (
    status in ('review', 'prepared')
    and meal_kind in ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner')
    and extract(year from service_date) between 1900 and 2200
    and char_length(btrim(menu_title)) between 1 and 160
    and menu_title !~ '[[:cntrl:]]'
    and private.meal_reference_items_are_valid(ingredients, false)
  ),
  constraint meal_plan_counts_check check (
    extra_planned_portions between 0 and 100
    and attendance_count >= 0
    and cardinality(attendance_client_ids) = attendance_count
    and planned_portion_total = attendance_count + extra_planned_portions
    and jsonb_typeof(assignment_snapshot) = 'array'
    and jsonb_array_length(assignment_snapshot) = attendance_count
    and jsonb_typeof(conflict_snapshot) = 'array'
  ),
  constraint meal_plan_completion_check check (
    (status = 'review' and resolution_snapshot is null and actual_portions is null
      and extra_actual_portions is null and actual_portion_total is null
      and variance_reason is null)
    or
    (status = 'prepared' and jsonb_typeof(resolution_snapshot) = 'array'
      and jsonb_typeof(actual_portions) = 'array'
      and extra_actual_portions between 0 and 100 and actual_portion_total >= 0
      and ((actual_portion_total = attendance_count and variance_reason is null)
        or (actual_portion_total <> attendance_count
          and char_length(btrim(variance_reason)) between 1 and 1000)))
  ),
  constraint meal_plan_hashes_check check (
    attendance_snapshot_hash ~ '^[a-f0-9]{64}$'
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.meal_management_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  requirement_version_id uuid,
  plan_version_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  stable_key uuid not null,
  version integer not null,
  status text not null,
  client_id uuid,
  service_date date,
  meal_kind text,
  attendance_count integer,
  conflict_count integer,
  planned_portion_total integer,
  actual_portion_total integer,
  committed_at timestamptz not null,
  constraint meal_operation_actor_key unique(actor_user_id, idempotency_key),
  constraint meal_operation_requirement_fkey foreign key(
    requirement_version_id, organization_id, branch_id, client_id
  ) references public.meal_requirement_versions(
    id, organization_id, branch_id, client_id
  ) on delete restrict,
  constraint meal_operation_plan_fkey foreign key(
    plan_version_id, organization_id, branch_id
  ) references public.meal_plan_versions(id, organization_id, branch_id) on delete restrict,
  constraint meal_operation_entity_check check (
    (entity_type = 'requirement' and requirement_version_id = entity_id
      and requirement_version_id is not null and plan_version_id is null
      and client_id is not null and status = 'recorded')
    or
    (entity_type = 'plan' and plan_version_id = entity_id
      and plan_version_id is not null and requirement_version_id is null
      and client_id is null and status in ('review', 'prepared'))
  ),
  constraint meal_operation_action_check check (
    action in ('set_requirement', 'save_plan', 'complete_plan')
    and version > 0 and request_hash ~ '^[a-f0-9]{64}$'
  )
);

create index meal_requirement_scope_effective_idx on public.meal_requirement_versions(
  organization_id, branch_id, client_id, effective_from desc, version desc
);
create index meal_requirement_branch_idx on public.meal_requirement_versions(branch_id);
create index meal_requirement_client_idx on public.meal_requirement_versions(client_id);
create index meal_requirement_previous_idx on public.meal_requirement_versions(previous_version_id);
create index meal_requirement_recorded_by_idx on public.meal_requirement_versions(recorded_by);
create index meal_plan_scope_date_idx on public.meal_plan_versions(
  organization_id, branch_id, service_date, meal_kind, version desc
);
create index meal_plan_branch_idx on public.meal_plan_versions(branch_id);
create index meal_plan_previous_idx on public.meal_plan_versions(previous_version_id);
create index meal_plan_created_by_idx on public.meal_plan_versions(created_by);
create index meal_plan_reauth_idx on public.meal_plan_versions(reauth_challenge_id);
create index meal_operation_scope_idx on private.meal_management_operations(
  organization_id, branch_id, committed_at desc
);
create index meal_operation_requirement_idx on private.meal_management_operations(requirement_version_id);
create index meal_operation_plan_idx on private.meal_management_operations(plan_version_id);
create index meal_operation_client_idx on private.meal_management_operations(client_id);

create or replace function private.prevent_meal_management_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'meal requirements, plans, and operation evidence are append-only';
end;
$$;

create trigger meal_requirement_versions_append_only before update or delete
on public.meal_requirement_versions for each row
execute function private.prevent_meal_management_mutation();
create trigger meal_plan_versions_append_only before update or delete
on public.meal_plan_versions for each row
execute function private.prevent_meal_management_mutation();
create trigger meal_management_operations_append_only before update or delete
on private.meal_management_operations for each row
execute function private.prevent_meal_management_mutation();
create trigger meal_requirement_versions_audit_row_change after insert or update or delete
on public.meal_requirement_versions for each row execute function private.audit_row_change();
create trigger meal_plan_versions_audit_row_change after insert or update or delete
on public.meal_plan_versions for each row execute function private.audit_row_change();
create trigger meal_management_operations_audit_row_change after insert or update or delete
on private.meal_management_operations for each row execute function private.audit_row_change();

alter table public.meal_requirement_versions enable row level security;
alter table public.meal_requirement_versions force row level security;
alter table public.meal_plan_versions enable row level security;
alter table public.meal_plan_versions force row level security;
alter table private.meal_management_operations enable row level security;
alter table private.meal_management_operations force row level security;
revoke all on table public.meal_requirement_versions from anon, authenticated, service_role;
revoke all on table public.meal_plan_versions from anon, authenticated, service_role;
revoke all on table private.meal_management_operations from anon, authenticated, service_role;

create or replace function private.meal_management_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, 'clients.read')
    and private.has_permission(p_organization_id, p_branch_id, 'attendance.read')
    and private.has_permission(p_organization_id, p_branch_id, 'health.read')
    and private.has_permission(p_organization_id, p_branch_id, 'meals.read')
    and private.has_permission(p_organization_id, p_branch_id, p_permission);
$$;

create or replace function private.require_meal_management_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'recent meal-management AAL2 is required';
  end if;
  begin v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'recent meal-management AAL2 is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge on challenge.id = event.challenge_id
    and challenge.user_id = event.user_id and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and event.verified_at >= p_reference_time - interval '15 minutes'
    and event.verified_at <= p_reference_time + interval '30 seconds'
  order by event.verified_at desc, event.id desc limit 1;
  if v_challenge_id is null then
    raise exception using errcode = '42501', message = 'recent meal-management AAL2 is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.meal_operation_result(
  p_operation private.meal_management_operations,
  p_replayed boolean
)
returns table(
  operation_id uuid, action text, entity_type text, entity_id uuid,
  stable_key uuid, version integer, status text, client_id uuid,
  service_date date, meal_kind text, attendance_count integer,
  conflict_count integer, planned_portion_total integer,
  actual_portion_total integer, committed_at timestamptz, replayed boolean
)
language sql stable set search_path = '' as $$
  select p_operation.id, p_operation.action, p_operation.entity_type,
    p_operation.entity_id, p_operation.stable_key, p_operation.version,
    p_operation.status, p_operation.client_id, p_operation.service_date,
    p_operation.meal_kind, p_operation.attendance_count,
    p_operation.conflict_count, p_operation.planned_portion_total,
    p_operation.actual_portion_total, p_operation.committed_at, p_replayed;
$$;

create or replace function private.mutate_meal_management_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_payload jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, entity_type text, entity_id uuid,
  stable_key uuid, version integer, status text, client_id uuid,
  service_date date, meal_kind text, attendance_count integer,
  conflict_count integer, planned_portion_total integer,
  actual_portion_total integer, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_reauth uuid; v_request_hash text; v_existing private.meal_management_operations%rowtype;
  v_operation private.meal_management_operations%rowtype;
  v_client public.clients%rowtype; v_requirement public.meal_requirement_versions%rowtype;
  v_current_requirement public.meal_requirement_versions%rowtype;
  v_plan public.meal_plan_versions%rowtype; v_current_plan public.meal_plan_versions%rowtype;
  v_previous uuid; v_expected integer; v_effective date; v_service_date date;
  v_meal_kind text; v_texture_state text; v_texture_label text;
  v_allergy_status text; v_allergens jsonb; v_contra_status text; v_contras jsonb;
  v_note text; v_menu_title text; v_ingredients jsonb; v_extra integer;
  v_plan_id uuid; v_assignments jsonb := '[]'::jsonb; v_conflicts jsonb := '[]'::jsonb;
  v_client_conflicts jsonb; v_conflict jsonb; v_ingredient jsonb;
  v_attendance_ids uuid[] := '{}'::uuid[]; v_attendance_hash text;
  v_attendance_count integer := 0; v_conflict_count integer := 0;
  v_resolutions jsonb; v_actuals jsonb; v_actual_total integer; v_variance text;
  v_item jsonb; v_requirement_key uuid; v_plan_key uuid; v_new_version integer;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_action not in ('set_requirement', 'save_plan', 'complete_plan')
     or jsonb_typeof(p_payload) <> 'object' or p_idempotency_key is null
     or not private.meal_management_authority(
       p_expected_organization_id, p_expected_branch_id,
       case p_action when 'complete_plan' then 'meals.confirm' else 'meals.manage' end
     ) then
    raise exception using errcode = '42501', message = 'meal operation is not permitted';
  end if;
  v_reauth := private.require_meal_management_reauth(v_actor, v_now);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor_user_id', v_actor,
    'action', p_action, 'payload', p_payload
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'meal-operation:' || v_actor::text || ':' || p_idempotency_key::text, 57
  ));
  select operation.* into v_existing from private.meal_management_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.request_hash <> v_request_hash
       or v_existing.action <> p_action then
      raise exception using errcode = '23505', message = 'meal idempotency conflict';
    end if;
    if not private.meal_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      case p_action when 'complete_plan' then 'meals.confirm' else 'meals.manage' end
    ) or (v_existing.client_id is not null and not private.can_staff_access_client(
      v_existing.client_id, 'meals.read'
    )) then
      raise exception using errcode = '42501', message = 'meal replay authority expired';
    end if;
    return query select * from private.meal_operation_result(v_existing, true);
    return;
  end if;

  if p_action = 'set_requirement' then
    if p_payload - array[
      'client_id','previous_version_id','expected_version','effective_from',
      'texture_state','texture_label','allergy_status','allergens',
      'contraindication_status','contraindications','note'
    ] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'unsupported meal requirement field';
    end if;
    v_previous := nullif(p_payload ->> 'previous_version_id', '')::uuid;
    v_expected := (p_payload ->> 'expected_version')::integer;
    v_effective := (p_payload ->> 'effective_from')::date;
    v_texture_state := p_payload ->> 'texture_state';
    v_texture_label := nullif(btrim(p_payload ->> 'texture_label'), '');
    v_allergy_status := p_payload ->> 'allergy_status'; v_allergens := p_payload -> 'allergens';
    v_contra_status := p_payload ->> 'contraindication_status'; v_contras := p_payload -> 'contraindications';
    v_note := nullif(btrim(p_payload ->> 'note'), '');
    select client.* into v_client from public.clients client
    where client.id = (p_payload ->> 'client_id')::uuid
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id for share;
    if not found or not private.can_staff_access_client(v_client.id, 'meals.read')
       or v_client.admitted_on is null or v_effective < v_client.admitted_on
       or (v_client.ended_on is not null and v_effective > v_client.ended_on)
       or v_expected < 0 or v_texture_state not in ('recorded','missing','not_applicable')
       or (v_texture_state = 'recorded') <> (v_texture_label is not null)
       or v_allergy_status not in ('recorded','none_declared','unknown')
       or v_contra_status not in ('recorded','none_declared','unknown')
       or not private.meal_reference_items_are_valid(v_allergens, v_allergy_status <> 'recorded')
       or not private.meal_reference_items_are_valid(v_contras, v_contra_status <> 'recorded')
       or (v_allergy_status = 'recorded') <> (jsonb_array_length(v_allergens) > 0)
       or (v_contra_status = 'recorded') <> (jsonb_array_length(v_contras) > 0)
       or (v_allergy_status <> 'recorded' and v_allergens <> '[]'::jsonb)
       or (v_contra_status <> 'recorded' and v_contras <> '[]'::jsonb)
       or (v_note is not null and (char_length(v_note) > 1000 or v_note ~ '[[:cntrl:]]')) then
      raise exception using errcode = '23514', message = 'meal requirement is invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('meal-requirement:' || v_client.id::text, 57));
    select requirement.* into v_current_requirement
    from public.meal_requirement_versions requirement
    where requirement.client_id = v_client.id
      and requirement.organization_id = p_expected_organization_id
      and requirement.branch_id = p_expected_branch_id
      and not exists (select 1 from public.meal_requirement_versions child
        where child.previous_version_id = requirement.id)
    order by requirement.version desc limit 1 for share;
    if (not found and (v_previous is not null or v_expected <> 0))
       or (found and (v_current_requirement.id is distinct from v_previous
         or v_current_requirement.version <> v_expected)) then
      raise exception using errcode = '40001', message = 'meal requirement version conflict';
    end if;
    v_requirement_key := coalesce(v_current_requirement.requirement_key, gen_random_uuid());
    v_new_version := v_expected + 1;
    insert into public.meal_requirement_versions(
      organization_id, branch_id, client_id, requirement_key, version,
      previous_version_id, effective_from, texture_state, texture_label,
      allergy_status, allergens, contraindication_status, contraindications,
      note, recorded_by, recorded_at, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_client.id,
      v_requirement_key, v_new_version, v_previous, v_effective,
      v_texture_state, v_texture_label, v_allergy_status, v_allergens,
      v_contra_status, v_contras, v_note, v_actor, v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version',1,'requirement_key',v_requirement_key,'version',v_new_version,
        'previous_version_id',v_previous,'client_id',v_client.id,
        'effective_from',v_effective,'texture_state',v_texture_state,
        'texture_label',v_texture_label,'allergy_status',v_allergy_status,
        'allergens',v_allergens,'contraindication_status',v_contra_status,
        'contraindications',v_contras,'note',v_note,'recorded_by',v_actor,
        'recorded_at',v_now
      )::text,'UTF8')),'hex')
    ) returning * into v_requirement;
    insert into private.meal_management_operations(
      organization_id, branch_id, actor_user_id, idempotency_key, request_hash,
      action, requirement_version_id, entity_type, entity_id, stable_key,
      version, status, client_id, committed_at
    ) values (
      p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
      v_request_hash,p_action,v_requirement.id,'requirement',v_requirement.id,
      v_requirement.requirement_key,v_requirement.version,'recorded',v_client.id,v_now
    ) returning * into v_operation;
  elsif p_action = 'save_plan' then
    if p_payload - array['previous_version_id','expected_version','service_date',
      'meal_kind','menu_title','ingredients','extra_portions'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'unsupported meal plan field';
    end if;
    v_previous := nullif(p_payload ->> 'previous_version_id','')::uuid;
    v_expected := (p_payload ->> 'expected_version')::integer;
    v_service_date := (p_payload ->> 'service_date')::date;
    v_meal_kind := p_payload ->> 'meal_kind'; v_menu_title := btrim(p_payload ->> 'menu_title');
    v_ingredients := p_payload -> 'ingredients'; v_extra := (p_payload ->> 'extra_portions')::integer;
    if v_expected < 0 or extract(year from v_service_date) not between 1900 and 2200
       or v_meal_kind not in ('breakfast','morning_snack','lunch','afternoon_snack','dinner')
       or char_length(v_menu_title) not between 1 and 160 or v_menu_title ~ '[[:cntrl:]]'
       or not private.meal_reference_items_are_valid(v_ingredients, false)
       or v_extra not between 0 and 100 then
      raise exception using errcode = '23514', message = 'meal plan is invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('meal-plan:' || p_expected_branch_id::text
      || ':' || v_service_date::text || ':' || v_meal_kind, 57));
    select plan.* into v_current_plan from public.meal_plan_versions plan
    where plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id and plan.service_date = v_service_date
      and plan.meal_kind = v_meal_kind
      and not exists (select 1 from public.meal_plan_versions child
        where child.previous_version_id = plan.id)
    order by plan.version desc limit 1 for share;
    if (not found and (v_previous is not null or v_expected <> 0))
       or (found and (v_current_plan.id is distinct from v_previous
         or v_current_plan.version <> v_expected or v_current_plan.status <> 'review')) then
      raise exception using errcode = '40001', message = 'meal plan version conflict';
    end if;
    if exists (
      select 1 from public.attendance_records attendance
      where attendance.organization_id = p_expected_organization_id
        and attendance.branch_id = p_expected_branch_id
        and attendance.service_date = v_service_date
        and attendance.correction_of_id is null and attendance.status = 'present'
        and not private.can_staff_access_client(attendance.client_id, 'meals.read')
    ) then raise exception using errcode = '42501', message = 'meal attendance scope is incomplete'; end if;
    for v_client in
      select client.* from public.attendance_records attendance
      join public.clients client on client.id = attendance.client_id
      where attendance.organization_id = p_expected_organization_id
        and attendance.branch_id = p_expected_branch_id
        and attendance.service_date = v_service_date
        and attendance.correction_of_id is null and attendance.status = 'present'
      order by client.id
    loop
      v_attendance_ids := array_append(v_attendance_ids, v_client.id);
      v_client_conflicts := '[]'::jsonb;
      select requirement.* into v_requirement
      from public.meal_requirement_versions requirement
      where requirement.organization_id = p_expected_organization_id
        and requirement.branch_id = p_expected_branch_id
        and requirement.client_id = v_client.id
        and requirement.effective_from <= v_service_date
      order by requirement.effective_from desc, requirement.version desc limit 1;
      if not found then
        v_conflict := jsonb_build_object('kind','requirement_missing','client_id',v_client.id,
          'item_code',null,'label','尚未設定餐食需求');
        v_conflict := v_conflict || jsonb_build_object('key',encode(sha256(convert_to(v_conflict::text,'UTF8')),'hex'));
        v_client_conflicts := v_client_conflicts || jsonb_build_array(v_conflict);
      else
        if v_requirement.texture_state = 'missing' then
          v_conflict := jsonb_build_object('kind','texture_missing','client_id',v_client.id,
            'item_code',null,'label','餐食質地尚未確認');
          v_conflict := v_conflict || jsonb_build_object('key',encode(sha256(convert_to(v_conflict::text,'UTF8')),'hex'));
          v_client_conflicts := v_client_conflicts || jsonb_build_array(v_conflict);
        end if;
        if v_requirement.allergy_status = 'unknown' then
          v_conflict := jsonb_build_object('kind','allergy_unknown','client_id',v_client.id,
            'item_code',null,'label','過敏資訊尚未確認');
          v_conflict := v_conflict || jsonb_build_object('key',encode(sha256(convert_to(v_conflict::text,'UTF8')),'hex'));
          v_client_conflicts := v_client_conflicts || jsonb_build_array(v_conflict);
        end if;
        if v_requirement.contraindication_status = 'unknown' then
          v_conflict := jsonb_build_object('kind','contraindication_unknown','client_id',v_client.id,
            'item_code',null,'label','禁忌資訊尚未確認');
          v_conflict := v_conflict || jsonb_build_object('key',encode(sha256(convert_to(v_conflict::text,'UTF8')),'hex'));
          v_client_conflicts := v_client_conflicts || jsonb_build_array(v_conflict);
        end if;
        for v_ingredient in select value from jsonb_array_elements(v_ingredients) loop
          if exists (select 1 from jsonb_array_elements(v_requirement.allergens) item
            where item ->> 'code' = v_ingredient ->> 'code') then
            v_conflict := jsonb_build_object('kind','allergen_match','client_id',v_client.id,
              'item_code',v_ingredient ->> 'code','label',v_ingredient ->> 'label');
            v_conflict := v_conflict || jsonb_build_object('key',encode(sha256(convert_to(v_conflict::text,'UTF8')),'hex'));
            v_client_conflicts := v_client_conflicts || jsonb_build_array(v_conflict);
          end if;
          if exists (select 1 from jsonb_array_elements(v_requirement.contraindications) item
            where item ->> 'code' = v_ingredient ->> 'code') then
            v_conflict := jsonb_build_object('kind','contraindication_match','client_id',v_client.id,
              'item_code',v_ingredient ->> 'code','label',v_ingredient ->> 'label');
            v_conflict := v_conflict || jsonb_build_object('key',encode(sha256(convert_to(v_conflict::text,'UTF8')),'hex'));
            v_client_conflicts := v_client_conflicts || jsonb_build_array(v_conflict);
          end if;
        end loop;
      end if;
      v_conflicts := v_conflicts || v_client_conflicts;
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'client_id',v_client.id,'client_code',v_client.client_code,
        'client_display_name',v_client.display_name,
        'requirement_version_id',case when v_requirement.id is null then null else v_requirement.id end,
        'texture_state',case when v_requirement.id is null then null else v_requirement.texture_state end,
        'texture_label',case when v_requirement.id is null then null else v_requirement.texture_label end,
        'allergy_status',case when v_requirement.id is null then null else v_requirement.allergy_status end,
        'allergen_labels',case when v_requirement.id is null then '[]'::jsonb else
          (select coalesce(jsonb_agg(item ->> 'label' order by item ->> 'code'),'[]'::jsonb)
           from jsonb_array_elements(v_requirement.allergens) item) end,
        'contraindication_status',case when v_requirement.id is null then null else v_requirement.contraindication_status end,
        'contraindication_labels',case when v_requirement.id is null then '[]'::jsonb else
          (select coalesce(jsonb_agg(item ->> 'label' order by item ->> 'code'),'[]'::jsonb)
           from jsonb_array_elements(v_requirement.contraindications) item) end,
        'planned_portions',1,'conflicts',v_client_conflicts
      ));
      v_requirement := null;
    end loop;
    v_attendance_count := cardinality(v_attendance_ids);
    v_conflict_count := jsonb_array_length(v_conflicts);
    v_attendance_hash := encode(sha256(convert_to(to_jsonb(v_attendance_ids)::text,'UTF8')),'hex');
    v_plan_key := coalesce(v_current_plan.plan_key, gen_random_uuid()); v_new_version := v_expected + 1;
    insert into public.meal_plan_versions(
      organization_id,branch_id,plan_key,version,previous_version_id,status,
      service_date,meal_kind,menu_title,ingredients,extra_planned_portions,
      attendance_client_ids,attendance_snapshot_hash,assignment_snapshot,
      conflict_snapshot,attendance_count,planned_portion_total,created_by,
      reauth_challenge_id,created_at,content_hash
    ) values (
      p_expected_organization_id,p_expected_branch_id,v_plan_key,v_new_version,v_previous,
      'review',v_service_date,v_meal_kind,v_menu_title,v_ingredients,v_extra,
      v_attendance_ids,v_attendance_hash,v_assignments,v_conflicts,v_attendance_count,
      v_attendance_count+v_extra,v_actor,v_reauth,v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version',1,'plan_key',v_plan_key,'version',v_new_version,
        'previous_version_id',v_previous,'service_date',v_service_date,
        'meal_kind',v_meal_kind,'menu_title',v_menu_title,'ingredients',v_ingredients,
        'extra_planned_portions',v_extra,'attendance_snapshot_hash',v_attendance_hash,
        'assignment_snapshot',v_assignments,'conflict_snapshot',v_conflicts,
        'created_by',v_actor,'created_at',v_now
      )::text,'UTF8')),'hex')
    ) returning * into v_plan;
    insert into private.meal_management_operations(
      organization_id,branch_id,actor_user_id,idempotency_key,request_hash,action,
      plan_version_id,entity_type,entity_id,stable_key,version,status,service_date,
      meal_kind,attendance_count,conflict_count,planned_portion_total,committed_at
    ) values (
      p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
      v_request_hash,p_action,v_plan.id,'plan',v_plan.id,v_plan.plan_key,v_plan.version,
      v_plan.status,v_plan.service_date,v_plan.meal_kind,v_plan.attendance_count,
      jsonb_array_length(v_plan.conflict_snapshot),v_plan.planned_portion_total,v_now
    ) returning * into v_operation;
  else
    if p_payload - array['plan_version_id','expected_version','resolutions',
      'actual_portions','extra_actual_portions','variance_reason'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'unsupported meal completion field';
    end if;
    v_plan_id := (p_payload ->> 'plan_version_id')::uuid;
    v_expected := (p_payload ->> 'expected_version')::integer;
    v_resolutions := p_payload -> 'resolutions'; v_actuals := p_payload -> 'actual_portions';
    v_extra := (p_payload ->> 'extra_actual_portions')::integer;
    v_variance := nullif(btrim(p_payload ->> 'variance_reason'),'');
    if jsonb_typeof(v_resolutions) <> 'array' or jsonb_array_length(v_resolutions) > 500
       or jsonb_typeof(v_actuals) <> 'array' or jsonb_array_length(v_actuals) > 500
       or v_extra not between 0 and 100 or v_expected < 1
       or exists (select 1 from jsonb_array_elements(v_resolutions) item where
         jsonb_typeof(item) <> 'object' or item - array['conflict_key','disposition','note'] <> '{}'::jsonb
         or item ->> 'conflict_key' !~ '^[a-f0-9]{64}$'
         or item ->> 'disposition' not in ('verified_safe','substituted','excluded')
         or char_length(btrim(coalesce(item ->> 'note',''))) not between 1 and 1000)
       or exists (select 1 from jsonb_array_elements(v_actuals) item where
         jsonb_typeof(item) <> 'object' or item - array['client_id','portions'] <> '{}'::jsonb
         or coalesce(item ->> 'client_id','') !~ '^[0-9a-f-]{36}$'
         or (item ->> 'portions')::integer not between 0 and 5)
       or exists (select 1 from jsonb_array_elements(v_resolutions) item
         group by item ->> 'conflict_key' having count(*) > 1)
       or exists (select 1 from jsonb_array_elements(v_actuals) item
         group by item ->> 'client_id' having count(*) > 1) then
      raise exception using errcode = '23514', message = 'meal completion is invalid';
    end if;
    select plan.* into v_current_plan from public.meal_plan_versions plan
    where plan.id = v_plan_id and plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id for share;
    if not found or v_current_plan.status <> 'review' or v_current_plan.version <> v_expected
       or exists (select 1 from public.meal_plan_versions child
         where child.previous_version_id = v_current_plan.id) then
      raise exception using errcode = '40001', message = 'meal completion version conflict';
    end if;
    if exists (select 1
      from unnest(v_current_plan.attendance_client_ids) as attendee(client_id)
      where not private.can_staff_access_client(attendee.client_id, 'meals.read')) then
      raise exception using errcode = '42501', message = 'meal completion client scope expired';
    end if;
    select coalesce(array_agg(attendance.client_id order by attendance.client_id),'{}'::uuid[])
      into v_attendance_ids from public.attendance_records attendance
    where attendance.organization_id = p_expected_organization_id
      and attendance.branch_id = p_expected_branch_id
      and attendance.service_date = v_current_plan.service_date
      and attendance.correction_of_id is null and attendance.status = 'present';
    v_attendance_hash := encode(sha256(convert_to(to_jsonb(v_attendance_ids)::text,'UTF8')),'hex');
    if v_attendance_hash <> v_current_plan.attendance_snapshot_hash then
      raise exception using errcode = '40001', message = 'meal attendance changed before completion';
    end if;
    if jsonb_array_length(v_resolutions) <> jsonb_array_length(v_current_plan.conflict_snapshot)
       or exists (select 1 from jsonb_array_elements(v_current_plan.conflict_snapshot) conflict
         where not exists (select 1 from jsonb_array_elements(v_resolutions) resolution
           where resolution ->> 'conflict_key' = conflict ->> 'key'))
       or jsonb_array_length(v_actuals) <> v_current_plan.attendance_count
       or exists (select 1
         from unnest(v_current_plan.attendance_client_ids) as attendee(client_id)
         where not exists (select 1 from jsonb_array_elements(v_actuals) actual
           where (actual ->> 'client_id')::uuid = attendee.client_id)) then
      raise exception using errcode = '23514', message = 'every conflict and attendee requires one completion decision';
    end if;
    select coalesce(sum((item ->> 'portions')::integer),0) + v_extra into v_actual_total
    from jsonb_array_elements(v_actuals) item;
    if (v_actual_total = v_current_plan.attendance_count and v_variance is not null)
       or (v_actual_total <> v_current_plan.attendance_count and
         (v_variance is null or char_length(v_variance) > 1000 or v_variance ~ '[[:cntrl:]]')) then
      raise exception using errcode = '23514', message = 'meal attendance variance reason is inconsistent';
    end if;
    v_new_version := v_current_plan.version + 1;
    insert into public.meal_plan_versions(
      organization_id,branch_id,plan_key,version,previous_version_id,status,
      service_date,meal_kind,menu_title,ingredients,extra_planned_portions,
      attendance_client_ids,attendance_snapshot_hash,assignment_snapshot,
      conflict_snapshot,resolution_snapshot,actual_portions,extra_actual_portions,
      attendance_count,planned_portion_total,actual_portion_total,variance_reason,
      created_by,reauth_challenge_id,created_at,content_hash
    ) values (
      v_current_plan.organization_id,v_current_plan.branch_id,v_current_plan.plan_key,
      v_new_version,v_current_plan.id,'prepared',v_current_plan.service_date,
      v_current_plan.meal_kind,v_current_plan.menu_title,v_current_plan.ingredients,
      v_current_plan.extra_planned_portions,v_current_plan.attendance_client_ids,
      v_current_plan.attendance_snapshot_hash,v_current_plan.assignment_snapshot,
      v_current_plan.conflict_snapshot,v_resolutions,v_actuals,v_extra,
      v_current_plan.attendance_count,v_current_plan.planned_portion_total,
      v_actual_total,v_variance,v_actor,v_reauth,v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version',1,'plan_key',v_current_plan.plan_key,'version',v_new_version,
        'previous_version_id',v_current_plan.id,'resolution_snapshot',v_resolutions,
        'actual_portions',v_actuals,'extra_actual_portions',v_extra,
        'actual_portion_total',v_actual_total,'variance_reason',v_variance,
        'created_by',v_actor,'created_at',v_now
      )::text,'UTF8')),'hex')
    ) returning * into v_plan;
    insert into private.meal_management_operations(
      organization_id,branch_id,actor_user_id,idempotency_key,request_hash,action,
      plan_version_id,entity_type,entity_id,stable_key,version,status,service_date,
      meal_kind,attendance_count,conflict_count,planned_portion_total,
      actual_portion_total,committed_at
    ) values (
      p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
      v_request_hash,p_action,v_plan.id,'plan',v_plan.id,v_plan.plan_key,v_plan.version,
      v_plan.status,v_plan.service_date,v_plan.meal_kind,v_plan.attendance_count,
      jsonb_array_length(v_plan.conflict_snapshot),v_plan.planned_portion_total,
      v_plan.actual_portion_total,v_now
    ) returning * into v_operation;
  end if;
  if not private.meal_management_authority(
    p_expected_organization_id,p_expected_branch_id,
    case p_action when 'complete_plan' then 'meals.confirm' else 'meals.manage' end
  ) or (v_operation.client_id is not null and not private.can_staff_access_client(
    v_operation.client_id,'meals.read')) then
    raise exception using errcode = '42501', message = 'meal authority expired before commit';
  end if;
  return query select * from private.meal_operation_result(v_operation,false);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
  raise exception using errcode = '22023', message = 'meal operation value has an invalid type';
end;
$$;

create or replace function private.meal_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_service_date date,
  p_meal_kind text,
  p_texture_query text,
  p_conflict_filter text
)
returns table(payload jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_clients jsonb := '[]'::jsonb; v_client_total bigint := 0;
  v_plans jsonb := '[]'::jsonb; v_plan_total bigint := 0;
  v_expected bigint := 0; v_actual bigint := 0; v_conflicts bigint := 0;
begin
  if p_service_date is null or extract(year from p_service_date) not between 1900 and 2200
     or p_meal_kind not in ('all','breakfast','morning_snack','lunch','afternoon_snack','dinner')
     or p_conflict_filter not in ('all','with_conflicts','clear')
     or char_length(coalesce(p_texture_query,'')) > 80
     or coalesce(p_texture_query,'') ~ '[[:cntrl:]]'
     or not private.meal_management_authority(
       p_expected_organization_id,p_expected_branch_id,'meals.read'
     ) then
    raise exception using errcode = '42501', message = 'meal snapshot is not permitted';
  end if;
  with visible as (
    select client.*, requirement.id requirement_version_id,
      requirement.version requirement_version, requirement.effective_from,
      requirement.texture_state, requirement.texture_label,
      requirement.allergy_status, requirement.allergens,
      requirement.contraindication_status, requirement.contraindications,
      row_number() over(order by client.display_name collate "C",client.id) rn
    from public.clients client
    left join lateral (
      select requirement.* from public.meal_requirement_versions requirement
      where requirement.client_id = client.id
        and requirement.organization_id = client.organization_id
        and requirement.branch_id = client.branch_id
        and requirement.effective_from <= p_service_date
      order by requirement.effective_from desc,requirement.version desc limit 1
    ) requirement on true
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id,'meals.read')
  )
  select count(*),coalesce(jsonb_agg(jsonb_build_object(
    'client_id',id,'client_code',client_code,'display_name',display_name,
    'requirement_version_id',requirement_version_id,'requirement_version',requirement_version,
    'effective_from',effective_from,'texture_state',texture_state,'texture_label',texture_label,
    'allergy_status',allergy_status,'allergens',coalesce(allergens,'[]'::jsonb),
    'contraindication_status',contraindication_status,
    'contraindications',coalesce(contraindications,'[]'::jsonb)
  ) order by display_name collate "C",id) filter(where rn <= 200),'[]'::jsonb)
  into v_client_total,v_clients from visible;

  with terminal as (
    select plan.*,profile.display_name created_by_display_name,
      jsonb_array_length(plan.conflict_snapshot) conflict_count
    from public.meal_plan_versions plan
    join public.profiles profile on profile.id = plan.created_by
    where plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id and plan.service_date = p_service_date
      and (p_meal_kind = 'all' or plan.meal_kind = p_meal_kind)
      and not exists(select 1 from public.meal_plan_versions child
        where child.previous_version_id = plan.id)
      and not exists(select 1
        from unnest(plan.attendance_client_ids) as attendee(client_id)
        where not private.can_staff_access_client(attendee.client_id,'meals.read'))
  ), matched as (
    select * from terminal where
      (coalesce(p_texture_query,'') = '' or exists(
        select 1 from jsonb_array_elements(assignment_snapshot) assignment
        where coalesce(assignment ->> 'texture_label','') ilike '%' || p_texture_query || '%'
      )) and (p_conflict_filter = 'all'
        or (p_conflict_filter = 'with_conflicts' and conflict_count > 0)
        or (p_conflict_filter = 'clear' and conflict_count = 0))
  ), filtered as (
    select matched.*,
      row_number() over(order by service_date desc,meal_kind collate "C",id) rn
    from matched
  )
  select count(*),coalesce(sum(planned_portion_total),0),
    coalesce(sum(actual_portion_total) filter(where status='prepared'),0),
    coalesce(sum(conflict_count),0),coalesce(jsonb_agg(jsonb_build_object(
      'plan_version_id',id,'plan_key',plan_key,'version',version,
      'previous_version_id',previous_version_id,'status',status,
      'service_date',service_date,'meal_kind',meal_kind,'menu_title',menu_title,
      'ingredients',ingredients,'attendance_count',attendance_count,
      'extra_planned_portions',extra_planned_portions,
      'planned_portion_total',planned_portion_total,'actual_portion_total',actual_portion_total,
      'extra_actual_portions',extra_actual_portions,
      'conflict_count',conflict_count,'attendance_snapshot_hash',attendance_snapshot_hash,
      'variance_reason',variance_reason,'created_by_display_name',created_by_display_name,
      'created_at',created_at,'assignment_snapshot',assignment_snapshot,
      'conflict_snapshot',conflict_snapshot,'resolution_snapshot',resolution_snapshot,
      'actual_portions',actual_portions
    ) order by service_date desc,meal_kind collate "C",id) filter(where rn <= 100),'[]'::jsonb)
  into v_plan_total,v_expected,v_actual,v_conflicts,v_plans from filtered;
  insert into public.audit_events(
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select','meal_management_snapshot',
    p_expected_branch_id::text,array['bounded_snapshot'],jsonb_build_object(
      'workflow','page57_meal_management_v1','service_date',p_service_date,
      'meal_kind',p_meal_kind,'client_total',v_client_total,'plan_total',v_plan_total,
      'generated_at',v_now
    )
  );
  return query select jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'generated_at',v_now,'clients',v_clients,'client_total',v_client_total,
    'clients_truncated',v_client_total>200,'plans',v_plans,
    'matching_plan_total',v_plan_total,'plans_truncated',v_plan_total>100,
    'expected_portion_total',v_expected,'actual_portion_total',v_actual,
    'special_texture_total',null,'conflict_total',v_conflicts,
    'attendance_reconciliation_status','available',
    'texture_taxonomy_status','manual_unstandardized',
    'offline_status','not_configured','export_status','not_configured'
  );
end;
$$;

create or replace function public.mutate_meal_management(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_payload jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, entity_type text, entity_id uuid,
  stable_key uuid, version integer, status text, client_id uuid,
  service_date date, meal_kind text, attendance_count integer,
  conflict_count integer, planned_portion_total integer,
  actual_portion_total integer, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_meal_management_guarded(
    p_expected_organization_id,p_expected_branch_id,p_action,p_payload,p_idempotency_key
  );
$$;

create or replace function public.meal_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_service_date date,
  p_meal_kind text,
  p_texture_query text,
  p_conflict_filter text
)
returns table(payload jsonb)
language sql volatile security invoker set search_path = '' as $$
  select * from private.meal_management_snapshot_response(
    p_expected_organization_id,p_expected_branch_id,p_service_date,
    p_meal_kind,p_texture_query,p_conflict_filter
  );
$$;

revoke all on function private.meal_reference_items_are_valid(jsonb,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.prevent_meal_management_mutation()
  from public,anon,authenticated,service_role;
revoke all on function private.meal_management_authority(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.require_meal_management_reauth(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.meal_operation_result(private.meal_management_operations,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.mutate_meal_management_guarded(uuid,uuid,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.meal_management_snapshot_response(uuid,uuid,date,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.mutate_meal_management(uuid,uuid,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.meal_management_snapshot(uuid,uuid,date,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.mutate_meal_management_guarded(uuid,uuid,text,jsonb,uuid)
  to authenticated;
grant execute on function private.meal_management_snapshot_response(uuid,uuid,date,text,text,text)
  to authenticated;
grant execute on function public.mutate_meal_management(uuid,uuid,text,jsonb,uuid)
  to authenticated;
grant execute on function public.meal_management_snapshot(uuid,uuid,date,text,text,text)
  to authenticated;

comment on table public.meal_requirement_versions is
  'Append-only manual, non-standardized meal texture/allergy/contraindication snapshots. Exact codes never imply a diagnosis.';
comment on table public.meal_plan_versions is
  'Append-only attendance-scoped meal review and prepared evidence. Conflict matches use exact governed codes only.';
comment on function public.mutate_meal_management(uuid,uuid,text,jsonb,uuid) is
  'Creates Page-57 requirement, menu-review, or completion versions with recent AAL2 and actor-scoped exact replay.';
comment on function public.meal_management_snapshot(uuid,uuid,date,text,text,text) is
  'Returns one audited bounded Page-57 snapshot; texture taxonomy, offline cache, and export remain not configured.';
