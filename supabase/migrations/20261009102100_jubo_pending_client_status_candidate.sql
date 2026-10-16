-- Candidate-only lifecycle value. It is distinct from active+NULL so existing
-- operational queries using status='active' cannot mistake it for attendance.
-- A later migration must separately review every operational read/write path
-- and the pending->admitted transition before exposing public promotion.
begin;
set local lock_timeout = '5s';
alter type public.client_status add value if not exists 'pending';
commit;
