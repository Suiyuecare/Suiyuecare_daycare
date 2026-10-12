begin;
set local lock_timeout='5s';

-- A lock wait may outlive the exact membership, scope or recent AAL2.
-- Revalidate before an idempotent receipt lookup as well as a new write.
-- Preparation stays unverified; this patch cannot activate formal admission.
do $patch$
declare d text; anchor text; replacement text;
begin
 d:=pg_get_functiondef('private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid)'::regprocedure);
 anchor:=$old$  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-proposal:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_admission_proposals$old$;
 replacement:=$new$  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-proposal:'||auth.uid()||':'||p_idempotency_key,0));
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  select * into v_previous from private.jubo_pending_admission_proposals$new$;
 if position(anchor in d)=0 then raise exception 'unexpected admission proposal receipt boundary'; end if;
 execute replace(d,anchor,replacement);

 d:=pg_get_functiondef('private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure);
 anchor:=$old$  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-review:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_admission_reviews$old$;
 replacement:=$new$  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-review:'||auth.uid()||':'||p_idempotency_key,0));
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  if not private.jubo_admission_independent_director(p_org,p_branch) then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED'; end if;
  select * into v_previous from private.jubo_pending_admission_reviews$new$;
 if position(anchor in d)=0 then raise exception 'unexpected admission review receipt boundary'; end if;
 execute replace(d,anchor,replacement);
end;
$patch$;

commit;
