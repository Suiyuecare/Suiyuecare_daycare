begin;
select plan(6);
-- Runtime catalog contracts accompany observed native lock races; they are not
-- substitutes for real GoTrue, source-document verification or production UAT.
select matches(pg_get_functiondef('private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid)'::regprocedure),
 'pg_advisory_xact_lock[^;]+;[[:space:]]*v_challenge[[:space:]]*:=[[:space:]]*private.require_jubo_pending_admission_reviewer',
 'proposal rechecks exact scope and recent same-session AAL2 immediately after lock');
select matches(pg_get_functiondef('private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure),
 'pg_advisory_xact_lock[^;]+;[[:space:]]*v_challenge[[:space:]]*:=[[:space:]]*private.require_jubo_pending_admission_reviewer',
 'review rechecks exact scope and recent same-session AAL2 immediately after lock');
select matches(pg_get_functiondef('private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure),
 'pg_advisory_xact_lock[^;]+;[[:space:]]*v_challenge[[:space:]]*:=[^;]+;[[:space:]]*if not private.jubo_admission_independent_director',
 'review rechecks independent director before reading any old receipt');
select ok((select bool_and(prosecdef and provolatile='v' and proconfig=array['search_path=""']) from pg_proc
 where oid in('private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid)'::regprocedure,
 'private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure)),
 'private guarded operations retain volatile empty-path definer execution');
select ok((select bool_and(not prosecdef and provolatile='v') from pg_proc
 where oid in('public.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid)'::regprocedure,
 'public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure)),
 'public proposal/review wrappers retain invoker execution');
select ok(not has_function_privilege('anon','public.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid)','execute')
 and not has_function_privilege('service_role','public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)','execute')
 and not has_table_privilege('authenticated','private.jubo_pending_admission_reviews','insert,update,delete'),
 'no anonymous, backend-service reviewer or direct authenticated write bypass');
select * from finish();
rollback;
