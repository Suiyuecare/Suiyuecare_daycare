-- Candidate-only JUBO records: index the referencing side of newly added
-- foreign keys. Keep the existing pair-leading review index for pair lookups;
-- the source-leading index below serves source-row FK checks and covers the
-- organization/branch columns counted by the foundation schema contract.
begin;
set local lock_timeout = '5s';

create index jubo_pending_admission_proposals_link_fk_idx
  on private.jubo_pending_admission_proposals
  (pending_link_id, organization_id, branch_id, client_id);

create index jubo_pending_director_drafts_source_fk_idx
  on private.jubo_pending_director_draft_revisions
  (source_row_id, organization_id, branch_id);

create index jubo_pending_director_drafts_link_fk_idx
  on private.jubo_pending_director_draft_revisions (pending_link_id);

create index jubo_profile_v2_previews_reauth_fk_idx
  on private.jubo_profile_mapping_v2_previews (reauth_challenge_id);

create index jubo_profile_v2_reviews_source_fk_idx
  on private.jubo_profile_mapping_v2_reviews
  (master_source_row_id, organization_id, branch_id);

commit;
