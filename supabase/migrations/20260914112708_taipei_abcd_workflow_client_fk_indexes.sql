begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Add only the client-leading indexes for the two new workflow foreign keys.
-- Keep the already-published organization-leading lookup indexes unchanged.
create index taipei_export_client_fk_idx
  on private.taipei_abcd_export_snapshots (client_id, organization_id, branch_id);
create index taipei_review_client_fk_idx
  on private.taipei_abcd_review_events (client_id, organization_id, branch_id);

commit;
