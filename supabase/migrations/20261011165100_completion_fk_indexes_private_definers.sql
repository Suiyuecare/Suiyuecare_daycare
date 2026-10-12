begin;
set local lock_timeout = '5s';

-- The public admission RPC only invokes the separately guarded private
-- context. It does not need owner privileges in the exposed API schema.
alter function public.is_family_login_allowed() security invoker;

-- Cover new foreign keys without changing data, grants or RLS policies.
create index care_handoffs_owner_idx on private.care_handoffs(owner_id);
create index care_handoffs_sender_idx on private.care_handoffs(sender_id);
create index care_handoffs_source_record_idx on private.care_handoffs(source_record_id);
create index family_messages_tenant_branch_idx on private.family_messages(organization_id,branch_id);
create index questionnaire_publication_requested_reauth_idx on private.questionnaire_rule_publications(requested_reauth);
create index questionnaire_publication_approved_reauth_idx on private.questionnaire_rule_publications(approved_reauth);
create index questionnaire_publication_form_version_idx on private.questionnaire_rule_publications(form_version);

commit;
