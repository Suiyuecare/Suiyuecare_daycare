-- Keep the existing audited directory and every post-20260922 admission rule.
-- Only the case-center purpose may request a larger keyset page; all other
-- purposes retain the original 200-row server bound.
do $migration$
declare
  source text;
  bound_anchor text := 'p_page_size not between 1 and 200';
  routine_anchor text := 'p_purpose in (''case_center'',''core_daily'',''blood_glucose'',''service_usage'',''client_lifecycle'')';
begin
  source := pg_get_functiondef(
    'private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  );
  if (length(source) - length(replace(source, bound_anchor, ''))) / length(bound_anchor) <> 1 then
    raise exception 'Unexpected client directory page-size guard';
  end if;
  if (length(source) - length(replace(source, routine_anchor, ''))) / length(routine_anchor) <> 3 then
    raise exception 'Unexpected post-20260922 routine client directory authorization';
  end if;

  source := replace(
    source,
    bound_anchor,
    'p_page_size not between 1 and (case when p_purpose = ''case_center'' then 500 else 200 end)'
  );
  execute source;
end;
$migration$;
