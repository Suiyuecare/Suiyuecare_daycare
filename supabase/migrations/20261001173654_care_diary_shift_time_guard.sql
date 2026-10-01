begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The roster derives half-day completion from occurred_at, while the diary
-- writer stores the selected shift in data.fields.shift. Keep the two aligned
-- for new local structured records and every later revision. Historical rows
-- are not scanned or rewritten: NOT VALID still checks all new INSERT/UPDATEs.
-- Legacy/imported diary shapes without fields.shift remain readable.
alter table public.care_records
  add constraint care_records_local_diary_shift_time_check
  check (
    category <> 'staff/daily-care/care-diary'
    or source_system <> 'local'
    or (
      data #>> '{fields,shift}' is null
      and data #>> '{_request,page_slug}' is distinct from 'staff/daily-care/care-diary'
    )
    or coalesce(
      data #>> '{fields,shift}' = 'full_day'
      or (
        data #>> '{fields,shift}' = 'morning'
        and (occurred_at at time zone 'Asia/Taipei')::time < time '12:00'
      )
      or (
        data #>> '{fields,shift}' = 'afternoon'
        and (occurred_at at time zone 'Asia/Taipei')::time >= time '12:00'
      ),
      false
    )
  ) not valid;

commit;
