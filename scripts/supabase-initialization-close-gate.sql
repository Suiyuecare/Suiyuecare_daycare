-- One-time operational guard for the explicitly approved EMPTY test project.
-- Run only after verifying the linked project ref. This is not a migration.
-- Keep this gate closed if any migration or verification fails.
begin;
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Initialization requires the verified postgres owner';
  end if;
  if exists (select 1 from auth.users)
     or exists (select 1 from storage.objects)
     or exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
     ) then
    raise exception 'Empty-project initialization precondition failed';
  end if;
end;
$$;
-- PUBLIC membership is implicit: revoking only named API roles is insufficient.
revoke usage on schema public from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
commit;
