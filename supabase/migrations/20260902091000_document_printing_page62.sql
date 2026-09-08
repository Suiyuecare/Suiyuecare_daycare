-- Page 62: governed document templates, immutable print-job snapshots, and
-- audited preview/download access. No official template is seeded here.

insert into public.permissions(permission_key, description, risk_level) values
  ('document_printing.read', 'Read governed document templates and print jobs', 2),
  ('document_printing.manage', 'Create immutable print jobs from approved templates', 3),
  ('document_printing.access', 'Preview or download immutable generated documents', 3)
on conflict (permission_key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.role_key in (
  'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
  'nurse', 'professional', 'finance_claims'
) and permission.permission_key in (
  'document_printing.read', 'document_printing.manage', 'document_printing.access'
)
on conflict do nothing;

create table public.document_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  template_key text not null,
  version integer not null,
  status text not null default 'approved',
  title text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  definition jsonb not null,
  watermark_text text not null,
  footer_note text not null,
  font_bucket text not null,
  font_object_path text not null,
  font_sha256 text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint document_template_branch_scope_fkey
    foreign key(branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint document_template_version_key unique(
    organization_id, branch_id, template_key, version
  ),
  constraint document_template_id_scope_key unique(
    id, organization_id, branch_id
  ),
  constraint document_template_identity_check check (
    template_key ~ '^[a-z][a-z0-9_-]{2,79}$'
    and version > 0 and status = 'approved'
  ),
  constraint document_template_dates_check check (
    approved_at <= created_at + interval '30 seconds'
    and effective_from >= approved_at - interval '30 seconds'
    and (effective_to is null or effective_to > effective_from)
  ),
  constraint document_template_text_check check (
    char_length(btrim(title)) between 1 and 160
    and char_length(btrim(watermark_text)) between 1 and 80
    and char_length(btrim(footer_note)) between 1 and 500
    and char_length(btrim(font_bucket)) between 3 and 63
    and font_bucket ~ '^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$'
    and char_length(btrim(font_object_path)) between 1 and 500
    and font_object_path !~ '(^|/)\.\.(/|$)'
    and font_object_path !~ '[[:cntrl:]]'
  ),
  constraint document_template_definition_check check (
    jsonb_typeof(definition) = 'object'
    and definition ->> 'schema_version' = '1'
    and jsonb_typeof(definition -> 'sections') = 'array'
    and jsonb_array_length(definition -> 'sections') between 1 and 30
  ),
  constraint document_template_hashes_check check (
    font_sha256 ~ '^[a-f0-9]{64}$'
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.document_template_versions is
  'Immutable approved Page-62 template versions. The application has no direct publication path; official templates remain absent until a governed source, font asset, and approval are supplied.';

create table public.document_print_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  template_version_id uuid not null,
  client_id uuid not null,
  document_date date not null,
  render_model jsonb not null,
  render_model_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  creator_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null,
  content_hash text not null,
  constraint document_print_job_id_scope_key unique(
    id, organization_id, branch_id, client_id
  ),
  constraint document_print_job_template_scope_fkey foreign key(
    template_version_id, organization_id, branch_id
  ) references public.document_template_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint document_print_job_client_scope_fkey foreign key(
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint document_print_job_render_model_check check (
    jsonb_typeof(render_model) = 'object'
    and render_model ->> 'schemaVersion' = '1'
    and render_model ->> 'locale' = 'zh-TW'
    and render_model ->> 'timezone' = 'Asia/Taipei'
    and jsonb_typeof(render_model -> 'sections') = 'array'
    and jsonb_array_length(render_model -> 'sections') between 1 and 30
  ),
  constraint document_print_job_hashes_check check (
    render_model_hash ~ '^[a-f0-9]{64}$'
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.document_print_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  job_id uuid not null,
  template_version_id uuid not null,
  document_date date not null,
  render_model_hash text not null,
  created_at timestamptz not null,
  constraint document_print_operation_actor_key unique(
    actor_user_id, idempotency_key
  ),
  constraint document_print_operation_job_scope_fkey foreign key(
    job_id, organization_id, branch_id, client_id
  ) references public.document_print_jobs(
    id, organization_id, branch_id, client_id
  ) on delete restrict,
  constraint document_print_operation_template_scope_fkey foreign key(
    template_version_id, organization_id, branch_id
  ) references public.document_template_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint document_print_operation_hashes_check check (
    request_hash ~ '^[a-f0-9]{64}$'
    and render_model_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.document_print_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  job_id uuid not null,
  action text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  accessed_at timestamptz not null,
  render_model_hash text not null,
  constraint document_print_access_job_scope_fkey foreign key(
    job_id, organization_id, branch_id, client_id
  ) references public.document_print_jobs(
    id, organization_id, branch_id, client_id
  ) on delete restrict,
  constraint document_print_access_action_check check (
    action in ('preview', 'download')
  ),
  constraint document_print_access_hash_check check (
    render_model_hash ~ '^[a-f0-9]{64}$'
  )
);

create index document_template_scope_effective_idx
  on public.document_template_versions(
    organization_id, branch_id, template_key, effective_from, effective_to
  );
create index document_template_approved_by_idx
  on public.document_template_versions(approved_by);
create index document_print_job_scope_created_idx
  on public.document_print_jobs(organization_id, branch_id, created_at desc);
create index document_print_job_client_idx
  on public.document_print_jobs(client_id, created_at desc);
create index document_print_job_template_idx
  on public.document_print_jobs(template_version_id);
create index document_print_job_created_by_idx
  on public.document_print_jobs(created_by);
create index document_print_job_reauth_idx
  on public.document_print_jobs(creator_reauth_challenge_id);
create index document_print_operation_scope_idx
  on private.document_print_operations(organization_id, branch_id, created_at desc);
create index document_print_operation_job_idx
  on private.document_print_operations(job_id);
create index document_print_operation_client_idx
  on private.document_print_operations(client_id);
create index document_print_operation_template_idx
  on private.document_print_operations(template_version_id);
create index document_print_access_scope_idx
  on private.document_print_access_events(
    organization_id, branch_id, accessed_at desc
  );
create index document_print_access_job_idx
  on private.document_print_access_events(job_id, accessed_at desc);
create index document_print_access_client_idx
  on private.document_print_access_events(client_id, accessed_at desc);
create index document_print_access_actor_idx
  on private.document_print_access_events(actor_user_id, accessed_at desc);
create index document_print_access_reauth_idx
  on private.document_print_access_events(actor_reauth_challenge_id);

create or replace function private.prevent_document_print_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'document template, job, operation, and access evidence is append-only';
end;
$$;

create trigger document_template_versions_append_only
before update or delete on public.document_template_versions
for each row execute function private.prevent_document_print_mutation();
create trigger document_print_jobs_append_only
before update or delete on public.document_print_jobs
for each row execute function private.prevent_document_print_mutation();
create trigger document_print_operations_append_only
before update or delete on private.document_print_operations
for each row execute function private.prevent_document_print_mutation();
create trigger document_print_access_events_append_only
before update or delete on private.document_print_access_events
for each row execute function private.prevent_document_print_mutation();

create trigger document_template_versions_audit_row_change
after insert or update or delete on public.document_template_versions
for each row execute function private.audit_row_change();
create trigger document_print_jobs_audit_row_change
after insert or update or delete on public.document_print_jobs
for each row execute function private.audit_row_change();
create trigger document_print_access_events_audit_row_change
after insert or update or delete on private.document_print_access_events
for each row execute function private.audit_row_change();

alter table public.document_template_versions enable row level security;
alter table public.document_template_versions force row level security;
alter table public.document_print_jobs enable row level security;
alter table public.document_print_jobs force row level security;
alter table private.document_print_operations enable row level security;
alter table private.document_print_operations force row level security;
alter table private.document_print_access_events enable row level security;
alter table private.document_print_access_events force row level security;

revoke all on table public.document_template_versions
  from anon, authenticated, service_role;
revoke all on table public.document_print_jobs
  from anon, authenticated, service_role;
revoke all on table private.document_print_operations
  from anon, authenticated, service_role;
revoke all on table private.document_print_access_events
  from anon, authenticated, service_role;

create or replace function private.document_printing_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, 'clients.read')
    and private.has_permission(
      p_organization_id, p_branch_id, 'document_printing.read'
    )
    and private.has_permission(p_organization_id, p_branch_id, p_permission);
$$;

create or replace function private.require_document_printing_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'same-session document printing AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'same-session document printing AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and event.verified_at >= p_reference_time - interval '15 minutes'
    and event.verified_at <= p_reference_time + interval '30 seconds'
  order by event.verified_at desc, event.id desc limit 1;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'same-session document printing AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.document_template_definition_is_valid(
  p_definition jsonb
)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_section jsonb; v_row jsonb;
begin
  if jsonb_typeof(p_definition) <> 'object'
     or p_definition ->> 'schema_version' <> '1'
     or p_definition - array['schema_version', 'sections'] <> '{}'::jsonb
     or jsonb_typeof(p_definition -> 'sections') <> 'array'
     or jsonb_array_length(p_definition -> 'sections') not between 1 and 30 then
    return false;
  end if;
  for v_section in select value from jsonb_array_elements(p_definition -> 'sections') loop
    if jsonb_typeof(v_section) <> 'object'
       or v_section - array['heading', 'rows'] <> '{}'::jsonb
       or char_length(btrim(coalesce(v_section ->> 'heading', ''))) not between 1 and 160
       or jsonb_typeof(v_section -> 'rows') <> 'array'
       or jsonb_array_length(v_section -> 'rows') not between 1 and 80 then
      return false;
    end if;
    for v_row in select value from jsonb_array_elements(v_section -> 'rows') loop
      if jsonb_typeof(v_row) <> 'object'
         or v_row - array['label', 'source_key'] <> '{}'::jsonb
         or char_length(btrim(coalesce(v_row ->> 'label', ''))) not between 1 and 160
         or v_row ->> 'source_key' not in (
           'client.display_name', 'client.client_code', 'client.status',
           'client.admitted_on', 'client.ended_on', 'document.date'
         ) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.document_render_value(
  p_source_key text,
  p_client public.clients,
  p_document_date date
)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_value text; v_state text := 'recorded';
begin
  case p_source_key
    when 'client.display_name' then v_value := btrim(p_client.display_name);
    when 'client.client_code' then v_value := nullif(btrim(p_client.client_code), '');
    when 'client.status' then v_value := p_client.status::text;
    when 'client.admitted_on' then v_value := p_client.admitted_on::text;
    when 'client.ended_on' then
      v_value := p_client.ended_on::text;
      if v_value is null then v_state := 'not_applicable'; end if;
    when 'document.date' then v_value := p_document_date::text;
    else return null;
  end case;
  if v_value is null and v_state = 'recorded' then v_state := 'missing'; end if;
  return jsonb_build_object(
    'value', v_value,
    'state', v_state
  );
end;
$$;

create or replace function private.build_document_render_model(
  p_template public.document_template_versions,
  p_organization_name text,
  p_branch_name text,
  p_client public.clients,
  p_document_date date,
  p_generated_at timestamptz
)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_section jsonb; v_row jsonb; v_sections jsonb := '[]'::jsonb;
  v_rows jsonb; v_value jsonb;
begin
  if not private.document_template_definition_is_valid(p_template.definition) then
    raise exception using errcode = '23514',
      message = 'document template definition is not supported';
  end if;
  for v_section in select value from jsonb_array_elements(
    p_template.definition -> 'sections'
  ) loop
    v_rows := '[]'::jsonb;
    for v_row in select value from jsonb_array_elements(v_section -> 'rows') loop
      v_value := private.document_render_value(
        v_row ->> 'source_key', p_client, p_document_date
      );
      if v_value is null then
        raise exception using errcode = '23514',
          message = 'document template source key is not supported';
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'label', btrim(v_row ->> 'label'),
        'value', v_value -> 'value',
        'state', v_value ->> 'state'
      ));
    end loop;
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'heading', btrim(v_section ->> 'heading'),
      'rows', v_rows
    ));
  end loop;
  return jsonb_build_object(
    'schemaVersion', 1,
    'locale', 'zh-TW',
    'timezone', 'Asia/Taipei',
    'template', jsonb_build_object(
      'versionId', p_template.id,
      'templateKey', p_template.template_key,
      'version', p_template.version,
      'title', btrim(p_template.title),
      'contentHash', p_template.content_hash
    ),
    'organization', jsonb_build_object(
      'organizationId', p_template.organization_id,
      'organizationName', btrim(p_organization_name),
      'branchId', p_template.branch_id,
      'branchName', btrim(p_branch_name)
    ),
    'client', jsonb_build_object(
      'clientId', p_client.id,
      'displayName', btrim(p_client.display_name),
      'clientCode', nullif(btrim(p_client.client_code), '')
    ),
    'documentDate', p_document_date,
    'generatedAt', p_generated_at,
    'title', btrim(p_template.title),
    'watermark', btrim(p_template.watermark_text),
    'sections', v_sections,
    'footerNote', btrim(p_template.footer_note)
  );
end;
$$;

create or replace function private.create_document_print_job_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_template_version_id uuid,
  p_client_id uuid,
  p_document_date date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, job_id uuid, template_version_id uuid, client_id uuid,
  document_date date, render_model_hash text, committed_at timestamptz,
  replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_reauth uuid; v_template public.document_template_versions%rowtype;
  v_client public.clients%rowtype; v_operation private.document_print_operations%rowtype;
  v_job public.document_print_jobs%rowtype; v_request_hash text;
  v_model jsonb; v_model_hash text; v_org_name text; v_branch_name text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_template_version_id is null or p_client_id is null
     or p_document_date is null or p_idempotency_key is null
     or extract(year from p_document_date) not between 1900 and 2200
     or not private.document_printing_authority(
       p_expected_organization_id, p_expected_branch_id,
       'document_printing.manage'
     ) then
    raise exception using errcode = '42501',
      message = 'document print job is not permitted';
  end if;
  if not private.can_staff_access_client(p_client_id, 'document_printing.read') then
    raise exception using errcode = '42501',
      message = 'document client is outside current assignment';
  end if;
  v_reauth := private.require_document_printing_reauth(v_actor, v_now);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'template_version_id', p_template_version_id,
    'client_id', p_client_id,
    'document_date', p_document_date,
    'actor_user_id', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'document-print-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    62
  ));
  select operation.* into v_operation
  from private.document_print_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'document print idempotency conflict';
    end if;
    if not private.document_printing_authority(
         p_expected_organization_id, p_expected_branch_id,
         'document_printing.manage'
       ) or not private.can_staff_access_client(
         v_operation.client_id, 'document_printing.read'
       ) then
      raise exception using errcode = '42501',
        message = 'document print replay authority expired';
    end if;
    return query select v_operation.id, v_operation.job_id,
      v_operation.template_version_id, v_operation.client_id,
      v_operation.document_date, v_operation.render_model_hash,
      v_operation.created_at, true;
    return;
  end if;

  select template.* into v_template
  from public.document_template_versions template
  where template.id = p_template_version_id
    and template.organization_id = p_expected_organization_id
    and template.branch_id = p_expected_branch_id
    and template.status = 'approved'
    and template.approved_at <= v_now
    and template.effective_from <= v_now
    and (template.effective_to is null or template.effective_to > v_now)
  for share;
  if not found or not private.document_template_definition_is_valid(
    v_template.definition
  ) then
    raise exception using errcode = '55000',
      message = 'approved document template is not configured';
  end if;
  if exists (
    select 1 from public.document_template_versions overlap
    where overlap.organization_id = v_template.organization_id
      and overlap.branch_id = v_template.branch_id
      and overlap.template_key = v_template.template_key
      and overlap.id <> v_template.id
      and overlap.status = 'approved'
      and overlap.approved_at <= v_now
      and overlap.effective_from <= v_now
      and (overlap.effective_to is null or overlap.effective_to > v_now)
  ) then
    raise exception using errcode = '55000',
      message = 'approved document template periods overlap';
  end if;

  select client.* into v_client from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for share;
  if not found or v_client.admitted_on is null
     or p_document_date < v_client.admitted_on
     or (v_client.ended_on is not null and p_document_date > v_client.ended_on)
     or not private.can_staff_access_client(v_client.id, 'document_printing.read') then
    raise exception using errcode = '42501',
      message = 'document client or document date is outside current scope';
  end if;
  select organization.name, branch.name into v_org_name, v_branch_name
  from public.organizations organization
  join public.branches branch on branch.id = p_expected_branch_id
    and branch.organization_id = organization.id and branch.is_active
  where organization.id = p_expected_organization_id;
  if v_org_name is null or v_branch_name is null then
    raise exception using errcode = '42501', message = 'document tenant unavailable';
  end if;

  v_model := private.build_document_render_model(
    v_template, v_org_name, v_branch_name, v_client, p_document_date, v_now
  );
  v_model_hash := encode(sha256(convert_to(v_model::text, 'UTF8')), 'hex');
  insert into public.document_print_jobs(
    organization_id, branch_id, template_version_id, client_id,
    document_date, render_model, render_model_hash, created_by,
    creator_reauth_challenge_id, created_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_template.id, v_client.id,
    p_document_date, v_model, v_model_hash, v_actor, v_reauth, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1, 'template_content_hash', v_template.content_hash,
      'render_model_hash', v_model_hash, 'created_by', v_actor,
      'created_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_job;

  insert into private.document_print_operations(
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    request_hash, job_id, template_version_id, document_date,
    render_model_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_client.id, v_actor,
    p_idempotency_key, v_request_hash, v_job.id, v_template.id,
    p_document_date, v_model_hash, v_now
  ) returning * into v_operation;
  if not private.document_printing_authority(
       p_expected_organization_id, p_expected_branch_id,
       'document_printing.manage'
     ) or not private.can_staff_access_client(
       v_client.id, 'document_printing.read'
     ) then
    raise exception using errcode = '42501',
      message = 'document print authority expired before commit';
  end if;
  return query select v_operation.id, v_job.id, v_template.id, v_client.id,
    p_document_date, v_model_hash, v_now, false;
end;
$$;

create or replace function private.document_printing_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(payload jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_templates jsonb := '[]'::jsonb; v_template_total bigint := 0;
  v_clients jsonb := '[]'::jsonb; v_client_total bigint := 0;
  v_jobs jsonb := '[]'::jsonb; v_job_total bigint := 0;
begin
  if not private.document_printing_authority(
       p_expected_organization_id, p_expected_branch_id,
       'document_printing.read'
     ) then
    raise exception using errcode = '42501',
      message = 'document printing snapshot is not permitted';
  end if;
  with current_templates as (
    select template.*, count(*) over(partition by template.template_key) active_count,
      row_number() over(order by template.title collate "C", template.version desc) rn
    from public.document_template_versions template
    where template.organization_id = p_expected_organization_id
      and template.branch_id = p_expected_branch_id
      and template.status = 'approved' and template.approved_at <= v_now
      and template.effective_from <= v_now
      and (template.effective_to is null or template.effective_to > v_now)
      and private.document_template_definition_is_valid(template.definition)
  )
  select count(*) filter(where active_count = 1),
    coalesce(jsonb_agg(jsonb_build_object(
      'version_id', id, 'template_key', template_key, 'version', version,
      'title', title, 'effective_from', effective_from,
      'effective_to', effective_to, 'content_hash', content_hash,
      'font_asset_status', 'configured'
    ) order by title collate "C", version desc)
      filter(where active_count = 1 and rn <= 100), '[]'::jsonb)
  into v_template_total, v_templates from current_templates;

  with options as (
    select client.*, row_number() over(
      order by client.display_name collate "C", client.id
    ) rn
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'document_printing.read')
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'client_id', id, 'display_name', display_name,
    'client_code', nullif(btrim(client_code), '')
  ) order by display_name collate "C", id) filter(where rn <= 200), '[]'::jsonb)
  into v_client_total, v_clients from options;

  with access_counts as (
    select event.job_id,
      count(*) filter(where event.action = 'preview') preview_count,
      count(*) filter(where event.action = 'download') download_count,
      max(event.accessed_at) last_accessed_at
    from private.document_print_access_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    group by event.job_id
  ), visible as (
    select job.*, template.template_key, template.version template_version,
      template.title template_title, creator.display_name creator_display_name,
      coalesce(access.preview_count, 0) preview_count,
      coalesce(access.download_count, 0) download_count,
      access.last_accessed_at,
      row_number() over(order by job.created_at desc, job.id) rn
    from public.document_print_jobs job
    join public.document_template_versions template
      on template.id = job.template_version_id
    join public.profiles creator on creator.id = job.created_by
    left join access_counts access on access.job_id = job.id
    where job.organization_id = p_expected_organization_id
      and job.branch_id = p_expected_branch_id
      and private.can_staff_access_client(job.client_id, 'document_printing.read')
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'job_id', id, 'template_version_id', template_version_id,
    'template_key', template_key, 'template_version', template_version,
    'template_title', template_title, 'client_id', client_id,
    'client_display_name', render_model -> 'client' ->> 'displayName',
    'document_date', document_date, 'render_model_hash', render_model_hash,
    'created_by_display_name', creator_display_name, 'created_at', created_at,
    'preview_count', preview_count, 'download_count', download_count,
    'last_accessed_at', last_accessed_at, 'render_model', render_model
  ) order by created_at desc, id) filter(where rn <= 100), '[]'::jsonb)
  into v_job_total, v_jobs from visible;

  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'document_printing_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page62_document_printing_v1',
      'generated_at', v_now, 'template_total', v_template_total,
      'client_total', v_client_total, 'job_total', v_job_total
    )
  );
  if not private.document_printing_authority(
       p_expected_organization_id, p_expected_branch_id,
       'document_printing.read'
     ) then
    raise exception using errcode = '42501',
      message = 'document printing snapshot authority expired';
  end if;
  return query select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', v_now,
    'templates', v_templates,
    'template_total', v_template_total,
    'templates_truncated', v_template_total > 100,
    'clients', v_clients,
    'client_total', v_client_total,
    'clients_truncated', v_client_total > 200,
    'jobs', v_jobs,
    'job_total', v_job_total,
    'jobs_truncated', v_job_total > 100,
    'template_governance_status', case when v_template_total > 0
      then 'configured' else 'not_configured' end,
    'pdf_renderer_status', 'available',
    'font_asset_status', case when v_template_total > 0
      then 'configured' else 'not_configured' end,
    'attachment_status', 'not_configured',
    'export_status', 'pdf_only',
    'offline_status', 'disabled'
  );
end;
$$;

create or replace function private.access_document_print_job_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_job_id uuid,
  p_action text
)
returns table(
  job_id uuid, template_version_id uuid, client_id uuid,
  render_model jsonb, render_model_hash text, font_bucket text,
  font_object_path text, font_sha256 text, accessed_at timestamptz
)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_reauth uuid; v_job public.document_print_jobs%rowtype;
  v_template public.document_template_versions%rowtype;
begin
  if p_job_id is null or p_action not in ('preview', 'download')
     or not private.document_printing_authority(
       p_expected_organization_id, p_expected_branch_id,
       'document_printing.access'
     ) then
    raise exception using errcode = '42501',
      message = 'document access is not permitted';
  end if;
  v_reauth := private.require_document_printing_reauth(v_actor, v_now);
  select job.* into v_job from public.document_print_jobs job
  where job.id = p_job_id
    and job.organization_id = p_expected_organization_id
    and job.branch_id = p_expected_branch_id
  for share;
  if not found or not private.can_staff_access_client(
    v_job.client_id, 'document_printing.read'
  ) then
    raise exception using errcode = '42501',
      message = 'document job is outside current assignment';
  end if;
  select template.* into v_template
  from public.document_template_versions template
  where template.id = v_job.template_version_id
    and template.organization_id = v_job.organization_id
    and template.branch_id = v_job.branch_id;
  if not found or encode(sha256(convert_to(v_job.render_model::text, 'UTF8')), 'hex')
       <> v_job.render_model_hash then
    raise exception using errcode = '55000',
      message = 'document immutable snapshot verification failed';
  end if;
  insert into private.document_print_access_events(
    organization_id, branch_id, client_id, job_id, action, actor_user_id,
    actor_reauth_challenge_id, accessed_at, render_model_hash
  ) values (
    v_job.organization_id, v_job.branch_id, v_job.client_id, v_job.id,
    p_action, v_actor, v_reauth, v_now, v_job.render_model_hash
  );
  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    v_job.organization_id, v_job.branch_id, v_actor,
    case p_action when 'preview' then 'select' else 'print' end,
    'document_print_jobs', v_job.id::text, array['pdf_access'],
    jsonb_build_object(
      'workflow', 'page62_document_printing_v1',
      'access_action', p_action,
      'template_version_id', v_job.template_version_id,
      'render_model_hash', v_job.render_model_hash,
      'accessed_at', v_now
    )
  );
  if not private.document_printing_authority(
       p_expected_organization_id, p_expected_branch_id,
       'document_printing.access'
     ) or not private.can_staff_access_client(
       v_job.client_id, 'document_printing.read'
     ) then
    raise exception using errcode = '42501',
      message = 'document access authority expired';
  end if;
  return query select v_job.id, v_template.id, v_job.client_id,
    v_job.render_model, v_job.render_model_hash, v_template.font_bucket,
    v_template.font_object_path, v_template.font_sha256, v_now;
end;
$$;

create or replace function public.create_document_print_job(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_template_version_id uuid,
  p_client_id uuid,
  p_document_date date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, job_id uuid, template_version_id uuid, client_id uuid,
  document_date date, render_model_hash text, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.create_document_print_job_guarded(
    p_expected_organization_id, p_expected_branch_id,
    p_template_version_id, p_client_id, p_document_date, p_idempotency_key
  );
$$;

create or replace function public.document_printing_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(payload jsonb)
language sql volatile security invoker set search_path = '' as $$
  select * from private.document_printing_snapshot_response(
    p_expected_organization_id, p_expected_branch_id
  );
$$;

create or replace function public.access_document_print_job(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_job_id uuid,
  p_action text
)
returns table(
  job_id uuid, template_version_id uuid, client_id uuid,
  render_model jsonb, render_model_hash text, font_bucket text,
  font_object_path text, font_sha256 text, accessed_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.access_document_print_job_guarded(
    p_expected_organization_id, p_expected_branch_id, p_job_id, p_action
  );
$$;

revoke all on function private.prevent_document_print_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.document_printing_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_document_printing_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.document_template_definition_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.document_render_value(text,public.clients,date)
  from public, anon, authenticated, service_role;
revoke all on function private.build_document_render_model(
  public.document_template_versions,text,text,public.clients,date,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.create_document_print_job_guarded(
  uuid,uuid,uuid,uuid,date,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.document_printing_snapshot_response(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.access_document_print_job_guarded(
  uuid,uuid,uuid,text
) from public, anon, authenticated, service_role;

revoke all on function public.create_document_print_job(
  uuid,uuid,uuid,uuid,date,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.document_printing_snapshot(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.access_document_print_job(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

grant execute on function private.create_document_print_job_guarded(
  uuid,uuid,uuid,uuid,date,uuid
) to authenticated;
grant execute on function private.document_printing_snapshot_response(uuid,uuid)
  to authenticated;
grant execute on function private.access_document_print_job_guarded(
  uuid,uuid,uuid,text
) to authenticated;
grant execute on function public.create_document_print_job(
  uuid,uuid,uuid,uuid,date,uuid
) to authenticated;
grant execute on function public.document_printing_snapshot(uuid,uuid)
  to authenticated;
grant execute on function public.access_document_print_job(uuid,uuid,uuid,text)
  to authenticated;

comment on function public.create_document_print_job(uuid,uuid,uuid,uuid,date,uuid) is
  'Creates an immutable Page-62 render model from one currently approved, non-overlapping template and an assigned client after same-session AAL2.';
comment on function public.document_printing_snapshot(uuid,uuid) is
  'Returns one audited bounded Page-62 snapshot. With no approved template and private font asset, formal printing remains not_configured.';
comment on function public.access_document_print_job(uuid,uuid,uuid,text) is
  'Records each preview or download before returning the immutable model and private font locator to the authenticated server route.';
