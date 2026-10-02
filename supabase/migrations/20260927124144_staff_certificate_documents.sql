-- Evidence only: no certificate version, registration, qualification or service
-- predicate is changed by reserving, scanning or independently reviewing a file.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('staff-certificate-documents','staff-certificate-documents',false,4194304,
    array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing$q$;
  if exists(select 1 from storage.buckets where id='staff-certificate-documents' and
   (public or file_size_limit is distinct from 4194304 or allowed_mime_types is distinct from array['application/pdf','image/jpeg','image/png'])) then
   raise exception using errcode='23514',message='staff certificate bucket configuration is invalid';
  end if;
  execute $q$create policy staff_certificate_documents_browser_block on storage.objects
   as restrictive for all to anon,authenticated
   using(bucket_id<>'staff-certificate-documents') with check(bucket_id<>'staff-certificate-documents')$q$;
 end if;
end $$;

create table private.staff_certificate_documents(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,
 staff_membership_id uuid not null references public.memberships(id) on delete restrict,
 staff_user_id uuid not null references public.profiles(id) on delete restrict,
 certificate_key uuid not null,record_version_id uuid not null,record_content_hash text not null check(record_content_hash~'^[a-f0-9]{64}$'),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),mime_type text not null check(mime_type in('application/pdf','image/jpeg','image/png')),
 file_size_bytes integer not null check(file_size_bytes between 1 and 4194304),object_path text not null unique,
 uploaded_by uuid not null references public.profiles(id) on delete restrict,uploaded_at timestamptz not null default clock_timestamp(),
 uploader_session_id uuid not null,uploader_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
 foreign key(record_version_id,organization_id,branch_id,certificate_key)
  references public.staff_certificate_versions(id,organization_id,branch_id,certificate_key) on delete restrict,
 check(object_path=organization_id::text||'/'||branch_id::text||'/'||staff_membership_id::text||'/'||certificate_key::text||'/'||id::text)
);
create index staff_certificate_documents_source_idx on private.staff_certificate_documents(record_version_id,organization_id,branch_id,certificate_key,uploaded_at desc,id);
create index staff_certificate_documents_member_idx on private.staff_certificate_documents(staff_membership_id);
create index staff_certificate_documents_staff_user_idx on private.staff_certificate_documents(staff_user_id);
create index staff_certificate_documents_uploader_idx on private.staff_certificate_documents(uploaded_by);
create index staff_certificate_documents_challenge_idx on private.staff_certificate_documents(uploader_challenge_id);
create table private.staff_certificate_document_scans(
 document_id uuid primary key references private.staff_certificate_documents(id) on delete restrict,
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),verdict text not null check(verdict in('clean','infected','failed')),
 scanner text not null check(scanner~'^[a-zA-Z0-9._-]{3,80}$'),scanned_at timestamptz not null default clock_timestamp(),
 object_identity jsonb not null check(jsonb_typeof(object_identity)='object')
);
create table private.staff_certificate_document_reviews(
 id uuid primary key default gen_random_uuid(),document_id uuid not null unique references private.staff_certificate_documents(id) on delete restrict,
 reviewed_by uuid not null references public.profiles(id) on delete restrict,reviewed_at timestamptz not null default clock_timestamp(),
 decision text not null check(decision in('verified','rejected')),
 reason text not null check(char_length(reason) between 3 and 300 and reason=btrim(reason) and reason!~'[[:cntrl:]]'),
 reviewer_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict
);
create index staff_certificate_document_reviews_actor_idx on private.staff_certificate_document_reviews(reviewed_by);
create index staff_certificate_document_reviews_challenge_idx on private.staff_certificate_document_reviews(reviewer_challenge_id);
create table private.staff_certificate_document_operations(
 actor_user_id uuid not null references public.profiles(id) on delete restrict,idempotency_key uuid not null,
 organization_id uuid not null,branch_id uuid not null,action text not null check(action in('reserve','review')),
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),document_id uuid not null references private.staff_certificate_documents(id) on delete restrict,
 review_id uuid references private.staff_certificate_document_reviews(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_user_id,idempotency_key),
 check((action='review')=(review_id is not null))
);
create index staff_certificate_document_operations_document_idx on private.staff_certificate_document_operations(document_id);
create index staff_certificate_document_operations_review_idx on private.staff_certificate_document_operations(review_id);
do $$ declare n text;begin
 foreach n in array array['staff_certificate_documents','staff_certificate_document_scans','staff_certificate_document_reviews','staff_certificate_document_operations'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('alter table private.%I force row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.staff_certificate_append_only()',n||'_immutable',n);
 end loop;
end $$;

-- Helpers are private and never individually callable by browser or scanner.
create function private.staff_certificate_document_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission in('staff_certificates.read','staff_certificates.manage') and auth.uid() is not null
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and(private.staff_certificate_current_authority(p_org,p_branch,p_permission)
   or exists(select 1 from private.routine_staff_scope() s where s.organization_id=p_org and(s.branch_id is null or s.branch_id=p_branch)))
  and exists(select 1 from public.profiles p join public.memberships m on m.profile_id=p.id
   join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active
   join public.role_permissions rp on rp.role_id=r.id join public.permissions perm on perm.id=rp.permission_id
   where p.id=auth.uid() and p.is_active and p.kind in('staff','professional','driver','finance') and m.organization_id=p_org
    and(m.branch_id is null or m.branch_id=p_branch) and m.status='active' and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
    and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp() and(r.organization_id is null or r.organization_id=p_org)
    and perm.permission_key=p_permission),false);
$$;
create function private.staff_certificate_document_authority(p_org uuid,p_branch uuid,p_manage boolean)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2' and private.staff_certificate_document_permission(p_org,p_branch,'staff_certificates.read')
  and(not p_manage or private.staff_certificate_document_permission(p_org,p_branch,'staff_certificates.manage')),false);
$$;
create function private.staff_certificate_document_recent_aal2_evidence(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();challenge uuid;verified timestamptz;session uuid;
begin
 if not private.staff_certificate_document_authority(p_org,p_branch,false) then return null;end if;
 challenge:=private.require_staff_certificate_reauth(actor,clock_timestamp());session:=(auth.jwt()->>'session_id')::uuid;
 select e.verified_at into verified from private.reauth_events e join private.reauth_challenges c on c.id=e.challenge_id
  join auth.mfa_amr_claims amr on amr.session_id=e.session_id and amr.authentication_method=e.verification_method
   and floor(extract(epoch from amr.updated_at))=floor(extract(epoch from e.verified_at))
 where c.id=challenge and c.user_id=actor and c.session_id=session and e.user_id=actor and e.session_id=session
  and e.aal='aal2' and e.revoked_at is null and c.consumed_at is not null and c.invalidated_at is null
  and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and e.verified_at<=clock_timestamp() and e.verified_at>=clock_timestamp()-interval '15 minutes'
  and exists(select 1 from jsonb_array_elements(auth.jwt()->'amr') a where a->>'method'=e.verification_method
   and a->>'timestamp'=floor(extract(epoch from e.verified_at))::bigint::text);
 if verified is null or not private.staff_certificate_document_authority(p_org,p_branch,false) then return null;end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',actor,'verifiedAt',verified);
end $$;
create function private.require_staff_certificate_document_evidence(p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
 if private.staff_certificate_document_recent_aal2_evidence(p_org,p_branch) is null then
  raise exception using errcode='42501',message='recent certificate document AAL2 evidence is required';end if;
 return private.require_staff_certificate_reauth(auth.uid(),clock_timestamp());
end $$;
create function public.staff_certificate_document_recent_aal2_evidence(p_org uuid,p_branch uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.staff_certificate_document_recent_aal2_evidence(p_org,p_branch);$$;

create function private.has_any_staff_certificate_document_mfa_scope()
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.branches b where b.is_active
  and private.staff_certificate_document_permission(b.organization_id,b.id,'staff_certificates.read'));
$$;
do $$declare source text;changed text;anchor text;begin
 source:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
 anchor:='private.has_any_social_work_mfa_scope()';
 if strpos(source,anchor)=0 then raise exception 'certificate document MFA acquisition anchor missing';end if;
 changed:=replace(source,anchor,anchor||' or private.has_any_staff_certificate_document_mfa_scope()');execute changed;
 source:=pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure);
 anchor:='private.is_active_user() or private.has_any_custom_governance_scope() or private.has_any_nursing_mfa_scope() or private.has_any_referral_mfa_scope() or private.has_any_social_work_mfa_scope()';
 if strpos(source,anchor)=0 then raise exception 'certificate document MFA admission anchor missing';end if;
 changed:=replace(source,anchor,anchor||' or private.has_any_staff_certificate_document_mfa_scope()');
 anchor:=E'when private.has_any_social_work_mfa_scope() then \'social_work\' end;';
 if strpos(changed,anchor)=0 then raise exception 'certificate document MFA capture anchor missing';end if;
 changed:=replace(changed,anchor,E'when private.has_any_social_work_mfa_scope() then \'social_work\'\n when private.has_any_staff_certificate_document_mfa_scope() then \'staff_certificate_document\' end;');
 anchor:=E'when \'social_work\' then private.has_any_social_work_mfa_scope() end';
 if strpos(changed,anchor)=0 then raise exception 'certificate document MFA final anchor missing';end if;
 changed:=replace(changed,anchor,E'when \'social_work\' then private.has_any_social_work_mfa_scope()\n when \'staff_certificate_document\' then private.has_any_staff_certificate_document_mfa_scope() end');execute changed;
end $$;
create function private.staff_certificate_document_source(p_org uuid,p_branch uuid,p_key uuid,p_version uuid,p_hash text,p_current boolean)
returns public.staff_certificate_versions language plpgsql volatile security definer set search_path='' as $$
declare v public.staff_certificate_versions;
begin
 select * into v from public.staff_certificate_versions r where r.id=p_version and r.organization_id=p_org and r.branch_id=p_branch and r.certificate_key=p_key;
 if not found or v.content_hash is distinct from p_hash or not private.staff_certificate_target_in_scope(p_org,p_branch,v.staff_membership_id,p_current)
  or not exists(select 1 from public.memberships m where m.id=v.staff_membership_id and m.profile_id=v.staff_user_id)
  or not exists(select 1 from public.branches b where b.id=p_branch and b.organization_id=p_org and b.is_active) then
  raise exception using errcode='42501',message='certificate document source is outside current scope';
 end if;
 if p_current and (v.record_status<>'active' or exists(select 1 from public.staff_certificate_versions next where next.previous_version_id=v.id)) then
  raise exception using errcode='40001',message='certificate document source version changed';
 end if;
 return v;
end $$;

create function private.staff_certificate_document_object(d private.staff_certificate_documents)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare o jsonb;
begin
 if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
  raise exception using errcode='55000',message='certificate document storage is unavailable';
 end if;
 execute 'select to_jsonb(o) from storage.objects o where o.bucket_id=$1 and o.name=$2' into o using 'staff-certificate-documents',d.object_path;
 if o is null or jsonb_typeof(o->'metadata') is distinct from 'object'
  or coalesce(o->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or o->'metadata'->>'mimetype' is distinct from d.mime_type
  or o->'metadata'->>'size' is distinct from d.file_size_bytes::text
  or not exists(select 1 from storage.buckets b where b.id='staff-certificate-documents' and not b.public) then
  raise exception using errcode='55000',message='certificate document stored object is not confirmed';
 end if;
 return jsonb_build_object('id',o->'id','bucketId',o->'bucket_id','name',o->'name','metadata',o->'metadata','updatedAt',o->'updated_at');
end $$;

create function private.staff_certificate_document_json(d private.staff_certificate_documents)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('documentId',d.id,'organizationId',d.organization_id,'branchId',d.branch_id,
  'staffMembershipId',d.staff_membership_id,'staffUserId',d.staff_user_id,'certificateKey',d.certificate_key,
  'recordVersionId',d.record_version_id,'recordContentHash',d.record_content_hash,'sha256',d.sha256,
  'mimeType',d.mime_type,'fileSizeBytes',d.file_size_bytes,'uploadedBy',d.uploaded_by,'uploadedAt',d.uploaded_at,
  'scanStatus',coalesce((select s.verdict from private.staff_certificate_document_scans s where s.document_id=d.id),'reserved'),
  'persisted',true,'serviceEligibility','not_evaluated','signable',false,'demo',false);
$$;
create function private.staff_certificate_document_object_matches(d private.staff_certificate_documents,p_identity jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin return p_identity is not null and private.staff_certificate_document_object(d)=p_identity;
exception when sqlstate '55000' then return false;
end $$;
create function private.staff_certificate_document_review_json(d private.staff_certificate_documents,r private.staff_certificate_document_reviews,p_replayed boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.staff_certificate_document_json(d)||jsonb_build_object('reviewId',r.id,'reviewedBy',r.reviewed_by,'reviewedAt',r.reviewed_at,
  'decision',r.decision,'reason',r.reason,'replayed',p_replayed);
$$;

create function private.reserve_staff_certificate_document_guarded(p_org uuid,p_branch uuid,p_input jsonb)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v public.staff_certificate_versions;d private.staff_certificate_documents;op private.staff_certificate_document_operations;
 actor uuid:=auth.uid();key uuid;member uuid;cert uuid;version uuid;hash text;field text;challenge uuid;result jsonb;terminal jsonb;replayed boolean:=false;doc uuid:=gen_random_uuid();
begin
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document reservation is not permitted';end if;
 challenge:=private.require_staff_certificate_document_evidence(p_org,p_branch);
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&array['staffMembershipId','certificateKey','recordVersionId','recordContentHash','idempotency_key','sha256','mimeType','fileSizeBytes'])
  or p_input-array['staffMembershipId','certificateKey','recordVersionId','recordContentHash','idempotency_key','sha256','mimeType','fileSizeBytes']<>'{}'::jsonb then
  raise exception using errcode='22023',message='invalid certificate document reservation';end if;
 foreach field in array array['staffMembershipId','certificateKey','recordVersionId','idempotency_key'] loop
  if jsonb_typeof(p_input->field) is distinct from 'string' or (p_input->>field)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invalid certificate document reservation';end if;
 end loop;
 if jsonb_typeof(p_input->'recordContentHash') is distinct from 'string' or (p_input->>'recordContentHash')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_input->'sha256') is distinct from 'string' or (p_input->>'sha256')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_input->'mimeType') is distinct from 'string' or p_input->>'mimeType' not in('application/pdf','image/jpeg','image/png')
  or jsonb_typeof(p_input->'fileSizeBytes') is distinct from 'number' or (p_input->>'fileSizeBytes')!~'^[0-9]{1,7}$'
  or (p_input->>'fileSizeBytes')::integer not between 1 and 4194304 then raise exception using errcode='22023',message='invalid certificate document reservation';end if;
 key:=(p_input->>'idempotency_key')::uuid;member:=(p_input->>'staffMembershipId')::uuid;cert:=(p_input->>'certificateKey')::uuid;version:=(p_input->>'recordVersionId')::uuid;
 hash:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,'action','reserve','input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-operation:'||actor::text||':'||key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate:'||p_org::text||':'||p_branch::text||':'||cert::text,0));
 v:=private.staff_certificate_document_source(p_org,p_branch,cert,version,p_input->>'recordContentHash',true);
 if v.staff_membership_id<>member then raise exception using errcode='42501',message='certificate document source is outside current scope';end if;
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document reservation is not permitted';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 select * into op from private.staff_certificate_document_operations where actor_user_id=actor and idempotency_key=key;
 if found then
  if op.request_hash<>hash or op.action<>'reserve' or op.organization_id<>p_org or op.branch_id<>p_branch then raise exception using errcode='23505',message='certificate document operation key conflict';end if;
  select * into d from private.staff_certificate_documents where id=op.document_id;replayed:=true;
  if d.record_version_id<>version or d.staff_membership_id<>member or d.record_content_hash<>v.content_hash or d.uploaded_by<>actor then raise exception using errcode='55000',message='certificate document operation source is invalid';end if;
 else
  insert into private.staff_certificate_documents(id,organization_id,branch_id,staff_membership_id,staff_user_id,certificate_key,record_version_id,record_content_hash,
   sha256,mime_type,file_size_bytes,object_path,uploaded_by,uploader_session_id,uploader_challenge_id)
  values(doc,p_org,p_branch,member,v.staff_user_id,cert,version,v.content_hash,p_input->>'sha256',p_input->>'mimeType',(p_input->>'fileSizeBytes')::integer,
   p_org::text||'/'||p_branch::text||'/'||member::text||'/'||cert::text||'/'||doc::text,actor,(auth.jwt()->>'session_id')::uuid,challenge) returning * into d;
 end if;
 if not replayed then
  insert into private.staff_certificate_document_operations(actor_user_id,idempotency_key,organization_id,branch_id,action,request_hash,document_id)
   values(actor,key,p_org,p_branch,'reserve',hash,d.id);
 end if;
 if exists(select 1 from private.staff_certificate_document_scans where document_id=d.id) then
  if private.staff_certificate_document_object(d) is distinct from (select object_identity from private.staff_certificate_document_scans where document_id=d.id) then
   raise exception using errcode='55000',message='certificate document stored object changed';end if;
  terminal:=private.staff_certificate_document_json(d);
 end if;
 result:=private.staff_certificate_document_json(d)||jsonb_build_object('objectPath',d.object_path,'replayed',replayed,'terminalReceipt',terminal);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'insert','staff_certificate_document_reservation',d.id::text,array['evidence_reservation'],jsonb_build_object('replayed',replayed));
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document reservation final verification failed';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 perform private.staff_certificate_document_source(p_org,p_branch,cert,version,d.record_content_hash,true);
 if terminal is not null and private.staff_certificate_document_object(d) is distinct from(select object_identity from private.staff_certificate_document_scans where document_id=d.id) then
  raise exception using errcode='55000',message='certificate document stored object changed';end if;
 if result is distinct from (private.staff_certificate_document_json(d)||jsonb_build_object('objectPath',d.object_path,'replayed',replayed,'terminalReceipt',terminal)) then raise exception using errcode='40001',message='certificate document evidence changed during audit';end if;
 return query select result;
end $$;

-- Service worker verifies captured admission without changing auth.uid(),
-- impersonating a JWT, or treating mere service_role as uploader authority.
create function private.staff_certificate_document_uploader_current(d private.staff_certificate_documents)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.branches b join public.organizations org on org.id=b.organization_id
  where b.id=d.branch_id and b.organization_id=d.organization_id and b.is_active and org.is_active)
 and private.staff_certificate_target_in_scope(d.organization_id,d.branch_id,d.staff_membership_id,true)
 and exists(select 1 from public.profiles p join public.memberships m on m.profile_id=p.id
  join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active
  join public.role_permissions rp on rp.role_id=r.id join public.permissions perm on perm.id=rp.permission_id
  where p.id=d.uploaded_by and p.is_active and p.kind in('staff','professional','driver','finance')
   and m.organization_id=d.organization_id and(m.branch_id is null or m.branch_id=d.branch_id) and m.status='active'
   and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
   and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp()
   and(r.organization_id is null or r.organization_id=d.organization_id) and r.role_key not in('family','platform_ops') and perm.permission_key='staff_certificates.manage')
 and exists(select 1 from public.profiles p join public.memberships m on m.profile_id=p.id
  join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active
  join public.role_permissions rp on rp.role_id=r.id join public.permissions perm on perm.id=rp.permission_id
  where p.id=d.uploaded_by and p.is_active and m.organization_id=d.organization_id and(m.branch_id is null or m.branch_id=d.branch_id)
   and m.status='active' and m.starts_at<=clock_timestamp() and(m.ends_at is null or m.ends_at>clock_timestamp())
   and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp()
   and(r.organization_id is null or r.organization_id=d.organization_id) and r.role_key not in('family','platform_ops') and perm.permission_key='staff_certificates.read')
 and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  join lateral (
   select g.allowed_email,g.google_subject,g.company_email_domain from private.staff_google_access_grants g
    where g.allowed_user_id=d.uploaded_by and g.organization_id=d.organization_id and g.enabled and g.approved_at<=clock_timestamp()
     and(g.expires_at is null or g.expires_at>clock_timestamp())
   union all select e.allowed_email,e.google_subject,null::text from private.executive_access_policy e
    where e.allowed_user_id=d.uploaded_by and e.enabled and e.approved_at<=clock_timestamp() and(select count(*) from private.executive_access_policy)=1
  ) policy on true
  where u.id=d.uploaded_by and not u.is_anonymous and u.deleted_at is null and u.email_confirmed_at is not null
   and(u.banned_until is null or u.banned_until<=clock_timestamp()) and lower(u.email)=policy.allowed_email
   and s.id=d.uploader_session_id and s.aal::text='aal2' and s.oauth_client_id is null and s.created_at<=d.uploaded_at
   and(s.not_after is null or s.not_after>clock_timestamp())
   and(select count(*) from auth.identities i where i.user_id=u.id and i.provider='google')=1
   and not exists(select 1 from auth.identities i where i.user_id=u.id and i.provider not in('google','email'))
   and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google' and i.provider_id=policy.google_subject
    and i.identity_data->>'sub'=policy.google_subject and lower(i.identity_data->>'email')=policy.allowed_email
    and i.identity_data->'email_verified'='true'::jsonb
    and(policy.company_email_domain is null or not(i.identity_data?'hd') or lower(i.identity_data->>'hd')=policy.company_email_domain))
   and exists(select 1 from auth.mfa_amr_claims a where a.session_id=s.id and a.authentication_method='oauth' and a.updated_at<=clock_timestamp())
   and not exists(select 1 from auth.mfa_amr_claims a where a.session_id=s.id and a.authentication_method not in('oauth','totp','token_refresh'))
 )
 and exists(select 1 from private.reauth_challenges c join private.reauth_events e on e.challenge_id=c.id and e.user_id=c.user_id and e.session_id=c.session_id
  join auth.mfa_amr_claims a on a.session_id=e.session_id and a.authentication_method=e.verification_method
   and floor(extract(epoch from a.updated_at))=floor(extract(epoch from e.verified_at))
  where c.id=d.uploader_challenge_id and c.user_id=d.uploaded_by and c.session_id=d.uploader_session_id
   and c.consumed_at is not null and c.invalidated_at is null and e.revoked_at is null and e.aal='aal2'
   and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
   and e.verification_method in('totp','webauthn','phone') and e.verified_at<=clock_timestamp()
   and e.verified_at>=clock_timestamp()-interval '15 minutes'),false);
$$;

create function private.complete_staff_certificate_document_scan_guarded(p_document uuid,p_sha256 text,p_verdict text,p_scanner text)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare d private.staff_certificate_documents;s private.staff_certificate_document_scans;o jsonb;result jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='server certificate scanner registration only';end if;
 if p_document is null or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or p_verdict is null or p_verdict not in('clean','infected','failed')
  or p_scanner is null or p_scanner!~'^[a-zA-Z0-9._-]{3,80}$' then raise exception using errcode='22023',message='invalid certificate document scan';end if;
 select * into d from private.staff_certificate_documents where id=p_document;
 if not found or d.sha256<>p_sha256 or not private.staff_certificate_document_uploader_current(d) then
  raise exception using errcode='42501',message='certificate document scan reservation is not current';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate:'||d.organization_id::text||':'||d.branch_id::text||':'||d.certificate_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-scan:'||p_document::text,0));
 perform private.staff_certificate_document_source(d.organization_id,d.branch_id,d.certificate_key,d.record_version_id,d.record_content_hash,true);
 o:=private.staff_certificate_document_object(d);
 select * into s from private.staff_certificate_document_scans where document_id=d.id;
 if found then
  if s.sha256<>p_sha256 or s.verdict<>p_verdict or s.scanner<>p_scanner then raise exception using errcode='23505',message='certificate document scan evidence conflict';end if;
  if s.object_identity is distinct from o then raise exception using errcode='55000',message='certificate document stored object changed';end if;
 else
  if d.uploaded_at<clock_timestamp()-interval '15 minutes' then raise exception using errcode='55000',message='certificate document reservation expired';end if;
  insert into private.staff_certificate_document_scans(document_id,sha256,verdict,scanner,object_identity)
   values(d.id,p_sha256,p_verdict,p_scanner,o) returning * into s;
 end if;
 result:=private.staff_certificate_document_json(d);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(d.organization_id,d.branch_id,d.uploaded_by,'insert','staff_certificate_document_scan',d.id::text,array['scan_verdict'],jsonb_build_object('scanStatus',s.verdict));
 if not private.staff_certificate_document_uploader_current(d) then raise exception using errcode='42501',message='certificate document scan final verification failed';end if;
 perform private.staff_certificate_document_source(d.organization_id,d.branch_id,d.certificate_key,d.record_version_id,d.record_content_hash,true);
 if o is distinct from private.staff_certificate_document_object(d) or not exists(select 1 from private.staff_certificate_document_scans saved where saved=s)
  or not exists(select 1 from private.staff_certificate_documents saved where saved=d) then
  raise exception using errcode='40001',message='certificate document scan source changed during audit';end if;
 return query select result;
end $$;

create function private.review_staff_certificate_document_guarded(p_org uuid,p_branch uuid,p_input jsonb)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare d private.staff_certificate_documents;r private.staff_certificate_document_reviews;op private.staff_certificate_document_operations;
 actor uuid:=auth.uid();key uuid;doc uuid;version uuid;challenge uuid;hash text;field text;result jsonb;replayed boolean:=false;o jsonb;
begin
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document review is not permitted';end if;
 challenge:=private.require_staff_certificate_document_evidence(p_org,p_branch);
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&array['documentId','recordVersionId','recordContentHash','decision','reason','idempotency_key'])
  or p_input-array['documentId','recordVersionId','recordContentHash','decision','reason','idempotency_key']<>'{}'::jsonb then
  raise exception using errcode='22023',message='invalid certificate document review';end if;
 foreach field in array array['documentId','recordVersionId','idempotency_key'] loop
  if jsonb_typeof(p_input->field) is distinct from 'string' or (p_input->>field)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invalid certificate document review';end if;
 end loop;
 if jsonb_typeof(p_input->'recordContentHash') is distinct from 'string' or(p_input->>'recordContentHash')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_input->'decision') is distinct from 'string' or p_input->>'decision' not in('verified','rejected')
  or jsonb_typeof(p_input->'reason') is distinct from 'string' or char_length(p_input->>'reason') not between 3 and 300
  or p_input->>'reason'<>btrim(p_input->>'reason') or p_input->>'reason'~'[[:cntrl:]]' then raise exception using errcode='22023',message='invalid certificate document review';end if;
 key:=(p_input->>'idempotency_key')::uuid;doc:=(p_input->>'documentId')::uuid;version:=(p_input->>'recordVersionId')::uuid;
 hash:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,'action','review','input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-operation:'||actor::text||':'||key::text,0));
 select * into d from private.staff_certificate_documents where id=doc and organization_id=p_org and branch_id=p_branch;
 if not found or actor=d.uploaded_by or actor=d.staff_user_id then raise exception using errcode='42501',message='independent certificate document reviewer required';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate:'||p_org::text||':'||p_branch::text||':'||d.certificate_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-scan:'||doc::text,0));
 perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,version,p_input->>'recordContentHash',true);
 if d.record_version_id<>version or d.record_content_hash<>p_input->>'recordContentHash' then raise exception using errcode='40001',message='certificate document source version changed';end if;
 if not exists(select 1 from private.staff_certificate_document_scans s where s.document_id=doc and s.verdict='clean' and s.sha256=d.sha256) then
  raise exception using errcode='22023',message='clean certificate document required for review';end if;
 o:=private.staff_certificate_document_object(d);
 if o is distinct from(select object_identity from private.staff_certificate_document_scans where document_id=doc) then raise exception using errcode='55000',message='certificate document stored object changed';end if;
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document review is not permitted';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 select * into op from private.staff_certificate_document_operations where actor_user_id=actor and idempotency_key=key;
 if found then
  if op.request_hash<>hash or op.action<>'review' or op.organization_id<>p_org or op.branch_id<>p_branch then raise exception using errcode='23505',message='certificate document operation key conflict';end if;
  select * into r from private.staff_certificate_document_reviews where id=op.review_id and document_id=doc and reviewed_by=actor;
  if not found then raise exception using errcode='55000',message='certificate document operation source is invalid';end if;replayed:=true;
 else
  if exists(select 1 from private.staff_certificate_document_reviews where document_id=doc) then raise exception using errcode='40001',message='certificate document already reviewed';end if;
  insert into private.staff_certificate_document_reviews(document_id,reviewed_by,decision,reason,reviewer_challenge_id)
   values(doc,actor,p_input->>'decision',p_input->>'reason',challenge) returning * into r;
  insert into private.staff_certificate_document_operations(actor_user_id,idempotency_key,organization_id,branch_id,action,request_hash,document_id,review_id)
   values(actor,key,p_org,p_branch,'review',hash,doc,r.id);
 end if;
 result:=private.staff_certificate_document_review_json(d,r,replayed);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,'insert','staff_certificate_document_review',doc::text,array['human_evidence_review'],jsonb_build_object('decision',r.decision,'replayed',replayed));
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document review final verification failed';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,version,d.record_content_hash,true);
 if o is distinct from private.staff_certificate_document_object(d) or not exists(select 1 from private.staff_certificate_document_reviews saved where saved=r)
  or result is distinct from private.staff_certificate_document_review_json(d,r,replayed) then raise exception using errcode='40001',message='certificate document review source changed during audit';end if;
 return query select result;
end $$;

create function private.staff_certificate_document_read_access(p_org uuid,p_branch uuid,p_member uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.staff_certificate_document_authority(p_org,p_branch,false)
  and private.staff_certificate_target_in_scope(p_org,p_branch,p_member,false)
  and(exists(select 1 from public.memberships m where m.id=p_member and m.profile_id=auth.uid())
   or private.staff_certificate_document_permission(p_org,p_branch,'staff_certificates.manage'));
$$;
create function private.staff_certificate_documents_bundle(p_org uuid,p_branch uuid,p_key uuid,p_version uuid,p_now timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.staff_certificate_versions;rows jsonb;total integer;
begin
 select * into v from public.staff_certificate_versions where id=p_version and organization_id=p_org and branch_id=p_branch and certificate_key=p_key;
 if not found or not private.staff_certificate_document_read_access(p_org,p_branch,v.staff_membership_id) then raise exception using errcode='42501',message='certificate document history is not permitted';end if;
 perform private.staff_certificate_document_source(p_org,p_branch,p_key,p_version,v.content_hash,false);
 select count(*) into total from private.staff_certificate_documents d where d.organization_id=p_org and d.branch_id=p_branch and d.certificate_key=p_key and d.record_version_id=p_version;
 select coalesce(jsonb_agg(private.staff_certificate_document_json(d)||jsonb_build_object('review',case when r.id is null then null else private.staff_certificate_document_review_json(d,r,false) end,
  'canDownload',coalesce(s.verdict='clean' and(r.decision is null or r.decision<>'rejected') and v.record_status='active'
   and not exists(select 1 from public.staff_certificate_versions next where next.previous_version_id=v.id)
   and private.staff_certificate_target_in_scope(p_org,p_branch,v.staff_membership_id,true)
   and private.staff_certificate_document_object_matches(d,s.object_identity),false)) order by d.uploaded_at desc,d.id),'[]'::jsonb) into rows
 from(select * from private.staff_certificate_documents where organization_id=p_org and branch_id=p_branch and certificate_key=p_key and record_version_id=p_version order by uploaded_at desc,id limit 50)d
 left join private.staff_certificate_document_scans s on s.document_id=d.id left join private.staff_certificate_document_reviews r on r.document_id=d.id;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'staffMembershipId',v.staff_membership_id,'staffUserId',v.staff_user_id,
  'certificateKey',p_key,'recordVersionId',p_version,'recordContentHash',v.content_hash,'generatedAt',p_now,'documents',rows,'total',total,'truncated',total>50,
  'serviceEligibility','not_evaluated','signable',false,'demo',false);
end $$;
create function private.staff_certificate_documents_snapshot_guarded(p_org uuid,p_branch uuid,p_certificate_key uuid,p_record_version_id uuid)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;after_result jsonb;stamp timestamptz;
begin
 -- Build first, then choose a timestamp after all existing evidence times.
 result:=private.staff_certificate_documents_bundle(p_org,p_branch,p_certificate_key,p_record_version_id,clock_timestamp());
 stamp:=clock_timestamp();result:=jsonb_set(result,'{generatedAt}',to_jsonb(stamp));
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','staff_certificate_documents_snapshot',p_record_version_id::text,array['bounded_snapshot'],jsonb_build_object('total',result->'total','truncated',result->'truncated'));
 after_result:=private.staff_certificate_documents_bundle(p_org,p_branch,p_certificate_key,p_record_version_id,stamp);
 if result is distinct from after_result then raise exception using errcode='40001',message='certificate document history changed during audit';end if;
 return query select result;
end $$;
create function private.prepare_staff_certificate_document_download_guarded(p_org uuid,p_branch uuid,p_document uuid)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare d private.staff_certificate_documents;s private.staff_certificate_document_scans;o jsonb;result jsonb;
begin
 select * into d from private.staff_certificate_documents where id=p_document and organization_id=p_org and branch_id=p_branch;
 if not found or not private.staff_certificate_document_read_access(p_org,p_branch,d.staff_membership_id)
  or exists(select 1 from private.staff_certificate_document_reviews where document_id=p_document and decision='rejected') then
  raise exception using errcode='42501',message='certificate document download is not permitted';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,d.record_version_id,d.record_content_hash,true);
 select * into s from private.staff_certificate_document_scans where document_id=p_document and verdict='clean' and sha256=d.sha256;
 if not found then raise exception using errcode='42501',message='certificate document download is not permitted';end if;
 o:=private.staff_certificate_document_object(d);
 if o is distinct from s.object_identity then raise exception using errcode='55000',message='certificate document stored object changed';end if;
 result:=private.staff_certificate_document_json(d)||jsonb_build_object('objectPath',d.object_path,'expiresSeconds',60,'canDownload',true);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','staff_certificate_document_download',p_document::text,array['short_lived_download'],'{"expiresSeconds":60}'::jsonb);
 if not private.staff_certificate_document_read_access(p_org,p_branch,d.staff_membership_id)
  or exists(select 1 from private.staff_certificate_document_reviews where document_id=p_document and decision='rejected') then
  raise exception using errcode='42501',message='certificate document download final verification failed';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,d.record_version_id,d.record_content_hash,true);
 if o is distinct from private.staff_certificate_document_object(d) or not exists(select 1 from private.staff_certificate_document_scans saved where saved=s)
  or result is distinct from(private.staff_certificate_document_json(d)||jsonb_build_object('objectPath',d.object_path,'expiresSeconds',60,'canDownload',true)) then
  raise exception using errcode='40001',message='certificate document download source changed during audit';end if;
 return query select result;
end $$;

create function public.reserve_staff_certificate_document(p_org uuid,p_branch uuid,p_input jsonb) returns table(payload jsonb)
 language sql volatile security invoker set search_path='' as $$select * from private.reserve_staff_certificate_document_guarded(p_org,p_branch,p_input);$$;
create function public.complete_staff_certificate_document_scan(p_document uuid,p_sha256 text,p_verdict text,p_scanner text) returns table(payload jsonb)
 language sql volatile security invoker set search_path='' as $$select * from private.complete_staff_certificate_document_scan_guarded(p_document,p_sha256,p_verdict,p_scanner);$$;
create function public.review_staff_certificate_document(p_org uuid,p_branch uuid,p_input jsonb) returns table(payload jsonb)
 language sql volatile security invoker set search_path='' as $$select * from private.review_staff_certificate_document_guarded(p_org,p_branch,p_input);$$;
create function public.staff_certificate_documents_snapshot(p_org uuid,p_branch uuid,p_certificate_key uuid,p_record_version_id uuid) returns table(payload jsonb)
 language sql volatile security invoker set search_path='' as $$select * from private.staff_certificate_documents_snapshot_guarded(p_org,p_branch,p_certificate_key,p_record_version_id);$$;
create function public.prepare_staff_certificate_document_download(p_org uuid,p_branch uuid,p_document uuid) returns table(payload jsonb)
 language sql volatile security invoker set search_path='' as $$select * from private.prepare_staff_certificate_document_download_guarded(p_org,p_branch,p_document);$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.proname in('staff_certificate_document_permission','staff_certificate_document_authority',
   'staff_certificate_document_recent_aal2_evidence','require_staff_certificate_document_evidence','has_any_staff_certificate_document_mfa_scope',
   'staff_certificate_document_source','staff_certificate_document_object','staff_certificate_document_object_matches','staff_certificate_document_json','staff_certificate_document_review_json',
   'reserve_staff_certificate_document_guarded','staff_certificate_document_uploader_current','complete_staff_certificate_document_scan_guarded',
   'review_staff_certificate_document_guarded','staff_certificate_document_read_access','staff_certificate_documents_bundle','staff_certificate_documents_snapshot_guarded',
   'prepare_staff_certificate_document_download_guarded','reserve_staff_certificate_document','complete_staff_certificate_document_scan',
   'review_staff_certificate_document','staff_certificate_documents_snapshot','prepare_staff_certificate_document_download') loop
  execute format('alter function %s owner to postgres',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function private.reserve_staff_certificate_document_guarded(uuid,uuid,jsonb),private.review_staff_certificate_document_guarded(uuid,uuid,jsonb),
 private.staff_certificate_documents_snapshot_guarded(uuid,uuid,uuid,uuid),private.prepare_staff_certificate_document_download_guarded(uuid,uuid,uuid),
 private.staff_certificate_document_recent_aal2_evidence(uuid,uuid),public.staff_certificate_document_recent_aal2_evidence(uuid,uuid),
 public.reserve_staff_certificate_document(uuid,uuid,jsonb),public.review_staff_certificate_document(uuid,uuid,jsonb),
 public.staff_certificate_documents_snapshot(uuid,uuid,uuid,uuid),public.prepare_staff_certificate_document_download(uuid,uuid,uuid) to authenticated;
grant execute on function private.complete_staff_certificate_document_scan_guarded(uuid,text,text,text),public.complete_staff_certificate_document_scan(uuid,text,text,text) to service_role;
comment on table private.staff_certificate_documents is 'Evidence reservation only. Clean or human verified never changes certificate version, registration, professional qualification or service eligibility.';
commit;
