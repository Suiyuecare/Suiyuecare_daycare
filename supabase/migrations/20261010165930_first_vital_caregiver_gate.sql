-- A care worker's first effective current/future-day numeric vital must follow
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- confirmed case arrival. Device/import rows and text-only notes are not an
-- attendance event. The explicit combined writer inserts arrival first in the
-- same transaction, so the guard observes the committed-intent row there.
create function private.require_care_worker_arrival_for_vital() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or new.numeric_value is null
    or new.measurement_kind not in
      ('blood_pressure_systolic','blood_pressure_diastolic','pulse','temperature','oxygen_saturation')
    -- A +5-minute clock tolerance can cross midnight. A future-day vital is
    -- never a historical backfill and must not silently precede its arrival.
    or (new.measured_at at time zone 'Asia/Taipei')::date <
      (v_now at time zone 'Asia/Taipei')::date then
    return new;
  end if;

  if exists (
    select 1 from public.memberships m
    join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id
    where m.profile_id=v_actor and m.organization_id=new.organization_id
      and (m.branch_id is null or m.branch_id=new.branch_id)
      and m.status='active' and m.starts_at<=v_now
      and (m.ends_at is null or m.ends_at>v_now)
      and r.is_active and r.role_key='care_worker'
      and (r.organization_id is null or r.organization_id=new.organization_id)
  ) and not exists (
    select 1 from public.attendance_records a
    where a.organization_id=new.organization_id and a.branch_id=new.branch_id
      and a.client_id=new.client_id
      and a.service_date=(new.measured_at at time zone 'Asia/Taipei')::date
      and a.correction_of_id is null and a.status='present'
      and a.checked_in_at is not null
  ) then
    raise exception using errcode='23514',
      message='first same-day care-worker vital requires confirmed case arrival';
  end if;
  return new;
end;
$$;

create trigger measurements_require_care_worker_arrival
before insert or update of measurement_kind, numeric_value, measured_at, client_id,
  organization_id, branch_id on public.measurements
for each row execute function private.require_care_worker_arrival_for_vital();

revoke all on function private.require_care_worker_arrival_for_vital()
  from public, anon, authenticated, service_role;

commit;
