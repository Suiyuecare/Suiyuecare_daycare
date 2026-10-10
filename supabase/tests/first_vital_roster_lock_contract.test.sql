begin;
select plan(3);

-- pgTAP runs in one PostgreSQL connection, so this is a lock-key/order
-- regression guard, not a substitute for a two-session race exercise.
with function_source as (
  select regexp_replace(pg_get_functiondef(
    'private.save_care_roster_guarded(uuid,uuid,jsonb)'::regprocedure),
    '[[:space:]]+', '', 'g') as body
)
select ok(strpos(body,
  'pg_advisory_xact_lock(hashtextextended(v_client::text||v_date::text||v_shift,0))') > 0,
  'roster writer serializes each client, service date and shift')
from function_source;

with function_source as (
  select regexp_replace(pg_get_functiondef(
    'private.record_first_vital_arrival_atomic(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)'::regprocedure),
    '[[:space:]]+', '', 'g') as body
)
select ok(strpos(body,
  'pg_advisory_xact_lock(hashtextextended(v_client.id::text||v_service_date::text||v_shift,0))') > 0,
  'first-vital arrival takes the same client, service date and shift lock')
from function_source;

with function_source as (
  select regexp_replace(pg_get_functiondef(
    'private.record_first_vital_arrival_atomic(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)'::regprocedure),
    '[[:space:]]+', '', 'g') as body
)
select ok(
  strpos(body,'pg_advisory_xact_lock(hashtextextended(v_client.id::text||v_service_date::text||v_shift,0))') > 0
  and strpos(body,'pg_advisory_xact_lock(hashtextextended(v_client.id::text||v_service_date::text||v_shift,0))') <
    strpos(body,'select1fromprivate.care_roster_versionsroster'),
  'first-vital arrival locks before reading the latest roster version')
from function_source;

select * from finish();
rollback;
