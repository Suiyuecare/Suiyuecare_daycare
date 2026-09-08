// Shared by pgTAP and TypeScript contract tests. Synthetic local auth only;
// Supabase's deployed auth schema is never created or replaced by this helper.
export const bootstrapSql = String.raw`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    instance_id uuid,
    id uuid primary key,
    aud text,
    role text,
    email text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    banned_until timestamptz,
    deleted_at timestamptz,
    is_anonymous boolean not null default false,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    created_at timestamptz,
    updated_at timestamptz
  );
  -- Minimal verified Supabase Auth metadata for local pre-MFA tests only.
  -- Revoked hosted sessions are absent rows; auth.sessions has no revoked_at.
  create table auth.sessions (
    id uuid primary key,
    user_id uuid not null references auth.users(id),
    created_at timestamptz,
    updated_at timestamptz,
    not_after timestamptz
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    )
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.jwt(), auth.uid()
    to anon, authenticated, service_role;
`;
