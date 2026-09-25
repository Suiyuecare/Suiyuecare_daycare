begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep foreign-key lookups and deletes bounded for result-history rows.
create index if not exists external_assessment_results_actor_idx
  on private.external_assessment_results (actor_id);
create index if not exists external_assessment_result_receipts_result_idx
  on private.external_assessment_result_receipts (result_id);

commit;
