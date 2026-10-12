-- Reconcile older routine writers with the effective-day lifecycle helper.
-- These writers predate client_service_state_on: one rejected any future
-- closure, while the other allowed the inclusive closure date. Keep all
-- existing authorization, locking, replay, validation and audit logic.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  v_source := pg_get_functiondef(
    'private.record_vital_set_atomic(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure);
  v_old := $old$  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.ended_on is not null
     or (p_measured_at at time zone 'Asia/Taipei')::date < v_client.admitted_on then
    raise exception using errcode = '42501', message = 'vital-sign recording is not permitted';
  end if;$old$;
  v_new := $new$  if private.client_service_state_on(
       v_client.id,(p_measured_at at time zone 'Asia/Taipei')::date
     ) is distinct from 'eligible' then
    raise exception using errcode = '42501', message = 'vital-sign recording is not permitted';
  end if;$new$;
  if strpos(v_source,v_old)=0 or strpos(replace(v_source,v_old,''),v_old)>0 then
    raise exception 'routine vital writer lifecycle contract changed; inspect before migration';
  end if;
  execute replace(v_source,v_old,v_new);

  v_source := pg_get_functiondef(
    'private.record_attendance_event_atomic(uuid,uuid,uuid,text,timestamptz,text,uuid)'::regprocedure);
  v_old := $old$  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > v_service_date
     or (v_client.ended_on is not null and v_client.ended_on < v_service_date) then
    raise exception using
      errcode = '23514',
      message = 'client is not active, admitted, and unended on the service date';
  end if;$old$;
  v_new := $new$  if private.client_service_state_on(v_client.id,v_service_date)
       is distinct from 'eligible' then
    raise exception using
      errcode = '23514',
      message = 'client is not active, admitted, and unended on the service date';
  end if;$new$;
  if strpos(v_source,v_old)=0 or strpos(replace(v_source,v_old,''),v_old)>0 then
    raise exception 'routine attendance writer lifecycle contract changed; inspect before migration';
  end if;
  execute replace(v_source,v_old,v_new);
end;
$$;

commit;
