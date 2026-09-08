begin;

-- Billing periods and daily reconciliation use the Asia/Taipei business day.
-- Align current_date fixtures with the production cutoff so entries recorded
-- after UTC midnight are still reconciled on their Taiwan calendar date.
set local time zone 'Asia/Taipei';

select plan(36);

-- 1
select is((select count(*)::integer from unnest(array[
  'billing_fee_item_versions','billing_invoices','billing_invoice_lines',
  'billing_ledger_entries','billing_receipts','billing_reconciliation_runs'
]) expected(name) where to_regclass('public.' || expected.name) is not null),6,
  'Page 64 has dedicated public evidence stores');
-- 2
select ok((select count(*)=7 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' and c.relname in (
    'billing_fee_item_versions','billing_invoices','billing_invoice_lines',
    'billing_ledger_entries','billing_receipts','billing_reconciliation_runs'
  )) or (n.nspname='private' and c.relname='billing_operations')),
  'all billing evidence and receipts force RLS');
-- 3
select ok(not has_table_privilege('authenticated','public.billing_invoices','insert')
  and not has_table_privilege('authenticated','public.billing_ledger_entries','update')
  and not has_table_privilege('service_role','public.billing_receipts','select'),
  'browser and platform service roles cannot bypass the RPC boundary');
-- 4
select ok(has_function_privilege('authenticated',
  'public.create_billing_invoice(uuid,uuid,uuid,uuid,date,date,date,date,jsonb,integer,bigint,uuid)','execute')
  and has_function_privilege('authenticated',
  'public.record_billing_entry(uuid,uuid,uuid,text,text,uuid,text,timestamptz,text,integer,bigint,uuid)','execute')
  and has_function_privilege('authenticated',
  'public.issue_billing_receipt(uuid,uuid,uuid,uuid,uuid,integer,uuid)','execute')
  and has_function_privilege('authenticated',
  'public.run_billing_reconciliation(uuid,uuid,date,bigint,uuid)','execute')
  and has_function_privilege('authenticated',
  'public.billing_management_snapshot(uuid,uuid,date,date,uuid,text)','execute')
  and not has_function_privilege('anon',
  'public.billing_management_snapshot(uuid,uuid,date,date,uuid,text)','execute'),
  'only authenticated callers receive the five narrow public billing RPCs');
-- 5
select ok((select count(*)=13 and bool_and(
  proconfig=array['search_path=""']::text[]
  and prosecdef=(n.nspname='private'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (
    ('private','billing_current_authority'),
    ('private','require_billing_reauth_evidence'),
    ('private','create_billing_invoice_guarded'),
    ('private','record_billing_entry_guarded'),
    ('private','issue_billing_receipt_guarded'),
    ('private','run_billing_reconciliation_guarded'),
    ('private','billing_management_snapshot_bundle'),
    ('private','billing_management_snapshot_response'),
    ('public','create_billing_invoice'),
    ('public','record_billing_entry'),
    ('public','issue_billing_receipt'),
    ('public','run_billing_reconciliation'),
    ('public','billing_management_snapshot')
  )), 'billing definers stay private and every exposed wrapper is an invoker');
-- 6
select ok((select count(*)=4 and bool_and(risk_level=3)
  from public.permissions where permission_key like 'billing.%'),
  'billing read, manage, adjust and reconcile permissions are high risk');
-- 7
select ok(not exists(
  select 1 from public.role_permissions rp
  join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id
  where p.permission_key in ('billing.manage','billing.adjust','billing.reconcile')
    and r.role_key not in ('organization_manager','finance_claims')
), 'billing mutation permissions default only to manager and finance templates');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','64010000-0000-4000-8000-000000000001','authenticated','authenticated','p64-finance@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','64010000-0000-4000-8000-000000000002','authenticated','authenticated','p64-approver@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','64010000-0000-4000-8000-000000000003','authenticated','authenticated','p64-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
('64020000-0000-4000-8000-000000000001','p64_a','合成帳務機構 A'),
('64020000-0000-4000-8000-000000000002','p64_b','合成帳務機構 B');
insert into public.branches(id,organization_id,code,name) values
('64030000-0000-4000-8000-000000000001','64020000-0000-4000-8000-000000000001','main','合成帳務分支 A'),
('64030000-0000-4000-8000-000000000002','64020000-0000-4000-8000-000000000001','empty','合成未設定分支'),
('64030000-0000-4000-8000-000000000003','64020000-0000-4000-8000-000000000002','main','合成帳務分支 B');
insert into public.profiles(id,display_name,kind,employee_code) values
('64010000-0000-4000-8000-000000000001','合成財務甲','finance','P64-A'),
('64010000-0000-4000-8000-000000000002','合成財務乙','finance','P64-B'),
('64010000-0000-4000-8000-000000000003','合成跨機構人員','finance','P64-X');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
('64040000-0000-4000-8000-000000000001','64020000-0000-4000-8000-000000000001',null,'64010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
('64040000-0000-4000-8000-000000000002','64020000-0000-4000-8000-000000000001',null,'64010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
('64040000-0000-4000-8000-000000000003','64020000-0000-4000-8000-000000000002',null,'64010000-0000-4000-8000-000000000003','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values
('64040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000009'),
('64040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000009'),
('64040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000009');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,
  status,admitted_on) values
('64050000-0000-4000-8000-000000000001','64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001','SYN-P64-01','合成個案甲','active',current_date-365),
('64050000-0000-4000-8000-000000000002','64020000-0000-4000-8000-000000000002','64030000-0000-4000-8000-000000000003','SYN-P64-X','合成跨機構個案','active',current_date-365);

-- 8
select throws_ok($$insert into public.billing_fee_item_versions(
  id,organization_id,branch_id,fee_item_key,version,fee_code,fee_name,unit_label,
  unit_price,currency,tax_handling,effective_from,effective_to,source_status,
  proposed_by,approved_by,approved_at,governance_note,content_hash
) values (
  '64060000-0000-4000-8000-000000000099','64020000-0000-4000-8000-000000000001',
  '64030000-0000-4000-8000-000000000001','64061000-0000-4000-8000-000000000099',
  1,'BAD','無獨立核准','次',100,'TWD','explicitly_not_applicable',current_date-30,null,
  'governance_approved','64010000-0000-4000-8000-000000000001',
  '64010000-0000-4000-8000-000000000001',now(),'合成錯誤',repeat('9',64)
)$$,'23514',null,'the proposer cannot approve their own fee version');

insert into public.billing_fee_item_versions(
  id,organization_id,branch_id,fee_item_key,version,fee_code,fee_name,unit_label,
  unit_price,currency,tax_handling,effective_from,effective_to,source_status,
  proposed_by,approved_by,approved_at,governance_note,content_hash
) values (
  '64060000-0000-4000-8000-000000000001','64020000-0000-4000-8000-000000000001',
  '64030000-0000-4000-8000-000000000001','64061000-0000-4000-8000-000000000001',
  1,'DAY-SYN','合成日照服務','日',100.00,'TWD','explicitly_not_applicable',
  current_date-60,current_date+60,'governance_approved',
  '64010000-0000-4000-8000-000000000001','64010000-0000-4000-8000-000000000002',
  now()-interval '1 day','合成測試用獨立核准費目',repeat('a',64)
),(
  '64060000-0000-4000-8000-000000000002','64020000-0000-4000-8000-000000000001',
  '64030000-0000-4000-8000-000000000001','64061000-0000-4000-8000-000000000002',
  1,'MEAL-SYN','合成餐食服務','份',33.33,'TWD','explicitly_included_in_unit_price',
  current_date-60,current_date+60,'governance_approved',
  '64010000-0000-4000-8000-000000000001','64010000-0000-4000-8000-000000000002',
  now()-interval '1 day','合成測試用含價費目',repeat('b',64)
);
-- 9
select throws_ok($$insert into public.billing_fee_item_versions(
  id,organization_id,branch_id,fee_item_key,version,previous_version_id,
  fee_code,fee_name,unit_label,unit_price,currency,tax_handling,effective_from,effective_to,
  source_status,proposed_by,approved_by,approved_at,governance_note,content_hash
) values (
  '64060000-0000-4000-8000-000000000003','64020000-0000-4000-8000-000000000001',
  '64030000-0000-4000-8000-000000000001','64061000-0000-4000-8000-000000000001',2,
  '64060000-0000-4000-8000-000000000001','DAY-SYN','重疊新版','日',120,'TWD',
  'explicitly_not_applicable',current_date,current_date+90,'governance_approved',
  '64010000-0000-4000-8000-000000000001','64010000-0000-4000-8000-000000000002',
  now(),'合成重疊測試',repeat('c',64)
)$$,'23P01','billing fee effective periods cannot overlap',
  'approved versions cannot overlap for one stable fee item');

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,
  consumed_jwt_jti,factor_method,factor_verified_at
) values (
  '64070000-0000-4000-8000-000000000001','64010000-0000-4000-8000-000000000001',
  '64071000-0000-4000-8000-000000000001',repeat('6',64),
  '64072000-0000-4000-8000-000000000001',now()-interval '2 minutes','p64-before',
  now()-interval '1 minute',now()+interval '4 minutes',now()-interval '20 seconds',
  now()-interval '20 seconds','p64-after','totp',now()-interval '20 seconds'
);
insert into private.reauth_events(user_id,session_id,challenge_id,aal,
  verification_method,verified_at) values (
  '64010000-0000-4000-8000-000000000001','64071000-0000-4000-8000-000000000001',
  '64070000-0000-4000-8000-000000000001','aal2','totp',now()-interval '20 seconds'
);

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','64010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','64071000-0000-4000-8000-000000000001')::text,true);
-- 10
select results_eq($$select payload->>'fee_configuration_status',
  payload->>'online_payment_status',payload->>'statutory_document_status'
  from public.billing_management_snapshot(
    '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000002',
    current_date-30,current_date,null,'all')$$,
  $$values ('not_configured'::text,'disabled'::text,'not_configured'::text)$$,
  'an unconfigured branch is explicit and never gains fabricated rates or payment processing');
-- 11
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','64010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','64071000-0000-4000-8000-000000000099')::text,true);
select throws_ok($$select * from public.billing_management_snapshot(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  current_date-30,current_date,null,'all')$$,'42501','current billing AAL2 evidence is required',
  'a different session cannot reuse recent billing step-up evidence');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','64010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','64071000-0000-4000-8000-000000000001')::text,true);
-- 12
select throws_ok($$select * from public.create_billing_invoice(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  '64050000-0000-4000-8000-000000000001','64080000-0000-4000-8000-000000000099',
  current_date-30,current_date-1,current_date,current_date+30,
  jsonb_build_array(jsonb_build_object('fee_item_version_id',
    '64060000-0000-4000-8000-000000000099','service_date',current_date-1,'quantity','1')),
  0,0,'64090000-0000-4000-8000-000000000099')$$,'55000',
  'approved billing fee version is not configured for service date',
  'an absent fee version fails closed before an invoice is issued');

create temporary table invoice_result as select * from public.create_billing_invoice(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  '64050000-0000-4000-8000-000000000001','64080000-0000-4000-8000-000000000001',
  current_date-30,current_date-1,current_date,current_date+30,
  jsonb_build_array(
    jsonb_build_object('fee_item_version_id','64060000-0000-4000-8000-000000000001',
      'service_date',current_date-2,'quantity','2','line_note','合成兩日服務'),
    jsonb_build_object('fee_item_version_id','64060000-0000-4000-8000-000000000002',
      'service_date',current_date-1,'quantity','3')
  ),0,0,'64090000-0000-4000-8000-000000000001');
-- 13
select results_eq($$select invoice_version,invoice_ledger_version,
  branch_ledger_version,invoice_total,balance_after,line_count,payment_status,replayed
  from invoice_result$$,
  $$values (1,1,1::bigint,'299.99'::text,'299.99'::text,2,'unpaid'::text,false)$$,
  'approved exact fee snapshots issue one balanced internal bill');
-- 14
select ok((select replayed and invoice_id=(select invoice_id from invoice_result)
  from public.create_billing_invoice(
    '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
    '64050000-0000-4000-8000-000000000001','64080000-0000-4000-8000-000000000001',
    current_date-30,current_date-1,current_date,current_date+30,
    jsonb_build_array(
      jsonb_build_object('fee_item_version_id','64060000-0000-4000-8000-000000000001',
        'service_date',current_date-2,'quantity','2','line_note','合成兩日服務'),
      jsonb_build_object('fee_item_version_id','64060000-0000-4000-8000-000000000002',
        'service_date',current_date-1,'quantity','3')
    ),0,0,'64090000-0000-4000-8000-000000000001')),
  'an exact actor-scoped replay returns the immutable invoice result');
-- 15
select throws_ok($$select * from public.create_billing_invoice(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  '64050000-0000-4000-8000-000000000001','64080000-0000-4000-8000-000000000001',
  current_date-30,current_date-1,current_date,current_date+30,
  jsonb_build_array(jsonb_build_object('fee_item_version_id',
    '64060000-0000-4000-8000-000000000001','service_date',current_date-2,'quantity','1')),
  0,0,'64090000-0000-4000-8000-000000000001')$$,'23505',
  'billing idempotency key conflict','changed content under the same actor key conflicts');
-- 16
reset role;
select results_eq($$select (select count(*)::integer from public.billing_invoices),
  (select count(*)::integer from public.billing_invoice_lines),
  (select count(*)::integer from public.billing_ledger_entries)$$,
  $$values (1,2,1)$$,'invoice, line snapshots and initial charge append exactly once');
-- 17
select results_eq($$select fee_code,unit_price::text,quantity::text,amount::text
  from public.billing_invoice_lines order by line_number$$,
  $$values ('DAY-SYN'::text,'100.00'::text,'2.0000'::text,'200.00'::text),
    ('MEAL-SYN'::text,'33.33'::text,'3.0000'::text,'99.99'::text)$$,
  'line evidence freezes exact approved versions, quantities, prices and amounts');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','64010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','64071000-0000-4000-8000-000000000001')::text,true);
-- 18
select throws_ok($$select * from public.create_billing_invoice(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  '64050000-0000-4000-8000-000000000001','64080000-0000-4000-8000-000000000002',
  current_date-30,current_date-1,current_date,current_date+30,
  jsonb_build_array(jsonb_build_object('fee_item_version_id',
    '64060000-0000-4000-8000-000000000002','service_date',current_date-2,'quantity','0.1')),
  0,1,'64090000-0000-4000-8000-000000000002')$$,'22023',
  'billing line requires an unconfigured rounding rule',
  'a line needing an unspecified rounding rule fails closed');
-- 19
select throws_ok($$select * from public.create_billing_invoice(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  '64050000-0000-4000-8000-000000000001','64080000-0000-4000-8000-000000000003',
  current_date-30,current_date-1,current_date,current_date+30,
  jsonb_build_array(jsonb_build_object('fee_item_version_id',
    '64060000-0000-4000-8000-000000000001','service_date',current_date-2,'quantity','1')),
  0,0,'64090000-0000-4000-8000-000000000003')$$,'40001',
  'billing branch ledger version conflict','a stale branch version cannot append a bill');
-- 20
select throws_ok($$select * from invoice_result invoice cross join lateral
  public.record_billing_entry(invoice.organization_id,invoice.branch_id,
    invoice.invoice_id,'payment','100.00',null,'online_card',now(),null,1,1,
    '64090000-0000-4000-8000-000000000004')$$,'22023',
  'billing payment must use an approved offline method',
  'online card payment cannot enter the first-version ledger');

create temporary table payment_result as select result.*
from invoice_result invoice cross join lateral public.record_billing_entry(
  invoice.organization_id,invoice.branch_id,invoice.invoice_id,
  'payment','100.00',null,'bank_transfer',now(),'合成轉帳登記',1,1,
  '64090000-0000-4000-8000-000000000005') result;
-- 21
select results_eq($$select entry_kind,amount,signed_amount,balance_after,
  invoice_ledger_version,branch_ledger_version,payment_status
  from payment_result$$,
  $$values ('payment'::text,'100.00'::text,'-100.00'::text,'199.99'::text,2,2::bigint,'partial'::text)$$,
  'offline payment appends an exact negative ledger delta and partial balance');

create temporary table receipt_result as select result.*
from payment_result payment cross join lateral public.issue_billing_receipt(
  payment.organization_id,payment.branch_id,payment.invoice_id,payment.entry_id,
  '64081000-0000-4000-8000-000000000001',2,
  '64090000-0000-4000-8000-000000000006') result;
-- 22
select ok((select amount='100.00' and document_status='not_configured'
  and receipt_number like 'SYS-REC-%' and not replayed from receipt_result),
  'receipt issuance creates only an immutable internal record and no statutory document');
-- 23
select throws_ok($$select * from payment_result payment cross join lateral
  public.issue_billing_receipt(payment.organization_id,payment.branch_id,
    payment.invoice_id,payment.entry_id,'64081000-0000-4000-8000-000000000002',2,
    '64090000-0000-4000-8000-000000000007')$$,'23505',
  'billing payment already has an internal receipt record',
  'one payment cannot silently produce multiple receipt records');
-- 24
select throws_ok($$select * from payment_result payment cross join lateral
  public.record_billing_entry(payment.organization_id,payment.branch_id,
    payment.invoice_id,'refund','100.01',payment.entry_id,null,now(),'合成超額退款',2,2,
    '64090000-0000-4000-8000-000000000008')$$,'23514',
  'billing refund exceeds original payment','refund cannot exceed its original payment');

create temporary table refund_result as select result.*
from payment_result payment cross join lateral public.record_billing_entry(
  payment.organization_id,payment.branch_id,payment.invoice_id,
  'refund','20.00',payment.entry_id,null,now(),'合成部分退款',2,2,
  '64090000-0000-4000-8000-000000000009') result;
-- 25
select results_eq($$select signed_amount,balance_after,
  invoice_ledger_version,branch_ledger_version from refund_result$$,
  $$values ('20.00'::text,'219.99'::text,3,3::bigint)$$,
  'bounded refund restores the exact outstanding amount');
-- 26
select throws_ok($$select * from refund_result refund cross join lateral
  public.record_billing_entry(refund.organization_id,refund.branch_id,
    refund.invoice_id,'adjustment_credit','220.00',null,null,now(),'合成超額折讓',3,3,
    '64090000-0000-4000-8000-000000000010')$$,'23514',
  'billing entry would create a negative balance',
  'credit adjustment cannot create a negative receivable');

create temporary table adjustment_result as select result.*
from refund_result refund cross join lateral public.record_billing_entry(
  refund.organization_id,refund.branch_id,refund.invoice_id,
  'adjustment_debit','5.00',null,null,now(),'合成人工補收調整',3,3,
  '64090000-0000-4000-8000-000000000011') result;
-- 27
select results_eq($$select signed_amount,balance_after,
  invoice_ledger_version,branch_ledger_version from adjustment_result$$,
  $$values ('5.00'::text,'224.99'::text,4,4::bigint)$$,
  'reasoned debit adjustment appends without rewriting history');
-- 28
select ok((select payload->>'branch_ledger_version'='4'
  and payload->'metrics'->>'receivable_total'='299.99'
  and payload->'metrics'->>'collected_total'='80.00'
  and payload->'metrics'->>'outstanding_total'='224.99'
  and payload->'metrics'->>'refund_total'='20.00'
  and jsonb_array_length(payload->'invoices'->0->'lines')=2
  and jsonb_array_length(payload->'invoices'->0->'entries')=4
  and jsonb_array_length(payload->'invoices'->0->'receipts')=1
  from public.billing_management_snapshot(
    '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
    current_date-30,current_date,null,'partial')),
  'one snapshot keeps metrics, details, entries and receipts exactly consistent');

create temporary table reconciliation_result as select *
from public.run_billing_reconciliation(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  current_date,4,'64090000-0000-4000-8000-000000000012');
-- 29
select results_eq($$select expected_branch_ledger_version,source_entry_count,
  invoice_total,payment_total,refund_total,adjustment_debit_total,
  adjustment_credit_total,ledger_balance,detail_balance,difference,
  reconciliation_status,replayed from reconciliation_result$$,
  $$values (4::bigint,4::bigint,'299.99'::text,'100.00'::text,'20.00'::text,
    '5.00'::text,'0.00'::text,'224.99'::text,'224.99'::text,'0.00'::text,
    'matched'::text,false)$$,
  'daily reconciliation independently balances invoice detail and ledger totals');
-- 30
select ok((select replayed and reconciliation_id=(select reconciliation_id
  from reconciliation_result) from public.run_billing_reconciliation(
    '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
    current_date,4,'64090000-0000-4000-8000-000000000012')),
  'exact daily reconciliation replay returns the original immutable evidence');
-- 31
select throws_ok($$select * from public.run_billing_reconciliation(
  '64020000-0000-4000-8000-000000000001','64030000-0000-4000-8000-000000000001',
  current_date,3,'64090000-0000-4000-8000-000000000013')$$,'40001',
  'billing branch ledger version conflict','stale reconciliation cannot certify a newer ledger');
-- 32
reset role;
select throws_ok($$update public.billing_ledger_entries set amount=1$$,
  '55000','billing records and operation receipts are immutable',
  'ledger evidence cannot be rewritten even by the migration owner');
-- 33
select throws_ok($$delete from public.billing_receipts$$,
  '55000','billing records and operation receipts are immutable',
  'receipt evidence cannot be deleted');
-- 34
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','64010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','64071000-0000-4000-8000-000000000001')::text,true);
select throws_ok($$select * from public.billing_management_snapshot(
  '64020000-0000-4000-8000-000000000002','64030000-0000-4000-8000-000000000003',
  current_date-30,current_date,null,'all')$$,'42501',
  'billing snapshot is not permitted','cross-organization billing read is rejected');
-- 35
reset role;
select ok((select count(*) >= 13 from public.audit_events
  where (table_name in (
    'public.billing_fee_item_versions','public.billing_invoices',
    'public.billing_invoice_lines','public.billing_ledger_entries',
    'public.billing_receipts','public.billing_reconciliation_runs',
    'private.billing_operations'
  ) and metadata ? 'schema')
    or table_name='billing_management_snapshot'),
  'billing writes and reads leave scoped audit evidence');
-- 36
select ok(not exists(select 1 from public.audit_events
  where table_name like '%billing%'
    and metadata::text ~ '(合成個案|合成轉帳|299.99|100.00)'),
  'billing audit metadata excludes client names, notes and monetary values');

select * from finish();
rollback;
