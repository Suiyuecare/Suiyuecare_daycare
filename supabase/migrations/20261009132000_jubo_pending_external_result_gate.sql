-- Candidate only. External assessment results are formal, append-only results,
-- never preparation drafts. Guard the ledger itself so every writer is covered.
begin;
set local lock_timeout = '5s';

create trigger jubo_pending_external_result_formal_gate
  before insert on private.external_assessment_results
  for each row execute function private.guard_jubo_pending_private_client_write('formal');

comment on trigger jubo_pending_external_result_formal_gate on private.external_assessment_results is
  'Reject a formal external assessment result for a pending JUBO intake at the storage boundary.';
commit;
