-- Keep the owner-only singleton's Auth foreign key indexed, consistent with
-- the existing schema contract. This does not change admission or privileges.
create index executive_access_policy_user_id_idx
  on private.executive_access_policy (allowed_user_id);
