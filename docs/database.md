# Database foundation

This project keeps its Supabase/Postgres foundation under `supabase/` and does
not require a linked cloud project for local validation.

## Reproduce locally

Requirements:

- Supabase CLI 2.105 or newer.
- A Docker-compatible local container runtime.
- No `supabase link` is required or expected.

Run from the repository root:

```sh
supabase start
supabase db reset --local
supabase test db
supabase migration list --local
supabase db lint --local --level warning
```

`supabase db reset --local` applies all migrations from an empty database and
then loads `supabase/seed.sql`. The seed is synthetic and must not be replaced
with exports containing real personal data.

## Tenant model

- `organizations` are the top-level tenant boundary.
- `branches` are constrained to their parent organization.
- Tenant business rows repeat `organization_id` and `branch_id` and use
  composite foreign keys. This prevents a record from referencing a client or
  batch in another branch even if application validation is bypassed.
- `profiles` map one-to-one to `auth.users`; authorization comes from active
  `memberships`, `membership_roles`, and `role_permissions`, never from
  user-editable metadata.
- General staff need an active client assignment. Roles carrying
  `clients.view_all` may see the entire authorized branch. Family access comes
  only from an active, unexpired, unrevoked consent scope.
- A `NULL` branch argument is organization scope: only an active organization-
  wide membership can satisfy it. Branch identities cannot create an
  organization-wide membership or assign a system role.

The frontend tenant-context interface is:

```sql
select * from public.active_memberships;
```

It returns `organization_id`, `branch_id`, `display_name`, `role_keys[]`,
`scopes[]`, and `user_id` for the current user only. The view uses
`security_invoker=true`, so the RLS policies of all underlying tables remain in
force. Frontend code should not join membership and authorization tables
itself.

## Case-center read model

Page 2 is a server-only, read-only projection over existing RLS-protected
`clients`, `client_assignments`, and (only when authorized) `profiles`. It does
not add a broader database view or definer RPC:

- every query is constrained to the selected `TenantContext` organization and
  branch in addition to the base-table RLS policies;
- visible rows are deduplicated by the stable `clients.id`, then filtered and
  paginated on the server at 24 records per page;
- staff without `clients.assign` can only project their own visible assignment;
  an unknown assignment is represented as restricted, never as unassigned;
- profile names are read only with `profiles.manage`; otherwise the projection
  emits a short staff code and does not widen profile RLS;
- no national ID, contact, health, care JSON, or other sensitive client column
  is selected for this registry.

This read model intentionally provides no insert or update interface. Client
creation and lifecycle changes remain separate page 60/61 workflows.

## Authorization and AAL2

All application tables currently in `public` enable and force RLS. `anon` has no
application table privileges. `authenticated` receives only the operations
that have matching policies, and audit rows cannot be inserted or changed by
an application user.

Every non-family profile requires an `aal2` JWT before any membership,
permission, care-record, or synchronization policy succeeds. Family OTP users
remain `aal1`, but cannot use staff permissions even if a role is mistakenly
attached to their profile.

High-risk actions use database-backed recent reauthentication evidence:

1. Trusted server code generates a random nonce, keeps the raw value out of the
   database, and calls service-role-only
   `public.issue_aal2_reauth_challenge(...)` with its SHA-256, the user/session,
   and the pre-challenge JWT `iat`/`jti`. Issuing a new challenge invalidates the
   prior pending challenge; only one may remain usable per user/session.
2. After Supabase Auth verifies a new TOTP, WebAuthn, or phone factor and issues
   a refreshed JWT, the authenticated caller submits the challenge ID and
   nonce SHA-256 to `public.record_aal2_reauth(uuid, text)`.
3. Consumption atomically requires the same user/session, unexpired and unused
   challenge, a refreshed JWT, and a supported `amr.timestamp` no earlier than
   challenge creation. An old `aal2` JWT cannot refresh the recent timestamp.
4. High-risk policies call `private.has_recent_aal2(15)`. The user, session,
   revocation state, and 15-minute server-time window must all match.
5. `public.has_recent_aal2(15)` is available to the application for UX guards,
   but database policy remains authoritative.

The public RPCs are `SECURITY INVOKER`; privileged implementations are in the
non-exposed `private` schema. Every `SECURITY DEFINER` function uses an empty
fixed `search_path`, checks `auth.uid()`, has `PUBLIC` execution revoked, and
receives only the explicit execution grant it needs. Challenge issuance is an
invoker function granted only to `service_role`.

Never insert into private reauthentication tables from a browser or treat a
long-lived JWT `aal` claim alone as proof of recent verification. If the Auth
provider does not return a new supported `amr.timestamp` and refreshed
`iat`/`jti` after a repeated challenge, consumption fails closed and that flow
must not be represented as fresh step-up authentication.

## Family data surface

Family profiles receive zero rows from client, consent, care, attendance,
measurement, medication, service, and notification base-table policies. The
supported consent-scoped read interfaces are:

- `public.family_client_summaries()` returns only `client_id`, `branch_id`,
  `display_name`, `client_status`, `admitted_on`, and `updated_at`. It never
  returns national-ID ciphertext or health fields.
- `public.family_care_summaries(client_id)` returns only signed record metadata:
  `record_id`, `category`, occurrence/effective timestamps, `signed_at`, and
  `updated_at`. It never returns care JSON, attachments, signatures, or hashes.
- Notification access is limited to the current user's
  `notification_deliveries` row; notification base content is not exposed.

Medication and health summary RPCs are intentionally fail-closed until an
explicit staff-approved publication model is implemented.

## Versioning and immutability

- Form definitions have numbered form versions. Once a version is published,
  it cannot be mutated or deleted.
- Care records and medication plans use a stable `record_key` plus an
  increasing version and an optional previous-version link.
- Signed care, attendance, medication, and service rows cannot be updated or
  deleted. Corrections must be new rows that point to the prior record and give
  a reason.
- High-risk or late medication administration cannot be signed until an
  independent second verifier is present.
- Finalized import batches are immutable. Imported HTML content is represented
  by metadata and staged fields only; the encrypted WORM object is external and
  referenced by `raw_object_key` and `raw_object_version`.
- `import_batches.staging_payload` preserves normalized sections, parser
  warnings, security findings, conflicts, and approval resolutions as a JSON
  object, capped at 16 MiB. It remains protected by database encryption at rest,
  explicit grants, and RLS; the original HTML remains in WORM storage.

### Client lifecycle flow

`client_transitions` is the append-only source of truth for page 61 admission,
suspension, resumption, transfer, closure, and death history. It repeats the
organization, branch, and client identifiers and enforces them with the same
composite client foreign key used by the rest of the care domain.

- The supported API is `public.transition_client(...)`, a `SECURITY INVOKER`
  RPC. It accepts only a client ID, event kind, effective date, reason, handoff
  detail, expected client `row_version`, and idempotency key; it does not accept
  a tenant identifier.
- Each call locks the visible client row, verifies `clients.manage`, requires
  database-backed AAL2 evidence for the same session from the preceding 15
  minutes, compares the expected row version, writes one history row, and
  updates `clients.status`, `admitted_on`/`ended_on`, and `row_version` in the
  same transaction.
- Legal transitions are admission into active service, active to suspended,
  suspended back to active, and active/suspended to the terminal transferred,
  closed, or deceased states. A terminal state cannot be reopened. Dates
  cannot be in the future, before admission, or earlier than existing history.
- Every event requires a reason. Transfer, closure, and death additionally
  require handoff detail. Actor and creation time are derived by the database,
  not trusted from browser input.
- Idempotency is unique per authenticated actor. An exact retry returns the
  stored result with `replayed=true`; reuse for different content fails. A
  post-lock replay check also covers concurrent duplicate requests.
- Direct changes to lifecycle columns on `clients` are rejected unless backed
  by the matching immutable transition. `client_transitions` has no application
  `UPDATE` or `DELETE` grant, and a trigger rejects those mutations even for a
  privileged table owner. Both the event insert and resulting client update
  create metadata-only audit markers.

The invoker RPC necessarily uses the caller's table privileges. Although an
authenticated `clients.manage` caller has `INSERT` on `client_transitions`, the
same row lock, AAL2, scope, state-machine, date, actor, optimistic-version, and
atomic client-update triggers execute on direct insertion. Application code
should still call the RPC so it receives durable replay semantics and the
structured resulting version.

Example:

```sql
select *
from public.transition_client(
  p_client_id := '<client UUID>',
  p_event_kind := 'suspend',
  p_effective_on := date '2026-09-01',
  p_reason := '住院暫停服務',
  p_handoff_note := null,
  p_expected_row_version := 3,
  p_idempotency_key := '<request UUID>'
);
```

Application integration keeps the read and write boundaries separate:

- `loadClientLifecycleSnapshot()` is server-only. It explicitly selects the
  scoped client label/status/version fields and immutable transition business
  fields under RLS, always repeats organization and branch filters, and pages
  history 50 rows at a time. The serialized page model contains no date of
  birth, encrypted identifier, contact/health/source payload, idempotency key,
  tenant/branch key, or actor UUID.
- The creator label is the current user's authenticated display name, an
  RLS-visible profile name for callers with `profiles.manage`, or the generic
  label “已授權工作人員”. A failed/unauthorized profile lookup never causes an
  actor UUID to be returned to the browser.
- `POST /api/clients/transitions` accepts a strict, 32 KiB typed payload and a
  UUID `Idempotency-Key`. It rejects demo mode, requires `clients.manage` and a
  fresh AAL2 event before invoking `public.transition_client(...)`; the RPC
  repeats those checks and remains the transaction authority.
- The page 61 composer is rendered only for authorized production users and
  stays disabled until the server confirms recent AAL2. Client-side legal-event
  choices are convenience hints only; the locked database state machine makes
  the final decision.

### Vital-sign set flow

Page 3 writes one logical vital-sign set through
`public.record_vital_set(...)`. The browser never inserts or updates
`measurements` directly:

- The public function is a `SECURITY INVOKER` wrapper. Its private definer
  repeats the authenticated AAL2, `health.write`, assignment or `view_all`,
  tenant, branch, and client-lifecycle checks before deriving scope and actor.
- Only active, admitted, non-ended clients are accepted. The recorded instant
  must be within the preceding 24 hours or the next five minutes and cannot
  predate admission in `Asia/Taipei`.
- Blood pressure is an all-or-nothing pair. Pressure, pulse, and oxygen values
  are integers; temperature allows one decimal place. Both TypeScript and SQL
  reject non-finite, over-precision, empty, and broad out-of-range input so the
  column type never silently rounds an accepted clinical value.
- One advisory lock serializes an organization, actor, and set key. The request
  hash uses a fixed UTC timestamp and canonical numeric representations, so an
  exact retry remains identical even if the database session time zone or JSON
  numeric scale changes. A changed request with the same key fails.
- Each derived row idempotency UUID includes organization, actor, set, and
  measurement kind. Two authorized actors may therefore use the same incoming
  UUID without colliding with the tenant-wide base-table uniqueness rule.
- The transaction inserts every supplied kind or none. The API compares the
  returned kinds and replay flags with its validated request before reporting
  success. Signed correction, versioned alert thresholds, and device ingestion
  require separate governed flows and are not implied by this writer.

### Blood-glucose flow

Page 4 uses a separate typed boundary, `public.record_blood_glucose(...)`,
while reusing the governed `measurements` ledger. Authenticated users keep
RLS-scoped reads but have no direct `INSERT`, `UPDATE`, or `DELETE` privilege
on that table:

- The request body accepts only client, occurrence time, meal context, numeric
  value, and unit. The Route Handler supplies the selected organization and
  branch from the authenticated `TenantContext`; tenant, branch, actor, source,
  request hash, signature, and row identifier are not browser fields.
- The public wrapper is `SECURITY INVOKER`. Its private definer rechecks the
  current AAL2 claim and `health.write`, selects the exact expected
  organization/branch/client, and locks that client row with `FOR UPDATE`.
  This lock is intentionally incompatible with ordinary lifecycle/status/date
  updates, so all lifecycle and clock gates run only after a concurrently
  closing client has settled.
- An organization/branch/actor/key advisory lock serializes retries. The
  canonical hash includes the expected scope, exact UTC instant, meal context,
  unit, and normalized value. An exact replay is returned before mutable clock
  and lifecycle gates, but only after current scope and permission are checked;
  changed content with the same key fails and cannot create a second row.
- A new mutation is limited to active, admitted, non-ended clients and an
  occurrence from the preceding 24 hours through the next five minutes. Meal
  context is one of `fasting`, `pre_meal`, `post_meal`, or `random`. `mg/dL`
  accepts integers from 20 through 600; `mmol/L` accepts 1.1 through 33.3 with
  at most one decimal. These are technical input guards, not alert thresholds
  or clinical diagnoses.
- The server-only service-day projection repeats organization and branch
  predicates under RLS, selects only client labels and the seven blood-glucose
  display fields, sorts by occurrence time, and keeps missing data distinct
  from zero. The page filters by service date, client, meal context, and
  measured/unmeasured state and marks the latest valid time in the current
  result.

The dedicated pgTAP covers grants, invoker/definer boundaries, current AAL2 and
permission, a same-actor multi-branch context-confusion case, cross-tenant
scope, lifecycle/time/range/precision validation, exact replay/conflict,
direct-DML denial, audit evidence, and the `FOR UPDATE` lock clause. A formal
two-session lifecycle race, a single repeatable-read snapshot for client and
measurement reads, versioned thresholds/abnormal confirmation, append-only
correction, offline consumption, and production Supabase E2E remain separate
acceptance gates.

### Attendance event flow

Page 46 writes one typed attendance event through
`public.record_attendance_event(...)`; authenticated clients retain RLS-scoped
read access but have no direct `INSERT`, `UPDATE`, or `DELETE` privilege on
`attendance_records`:

- The public entry point is a `SECURITY INVOKER` wrapper. Its private definer
  repeats current AAL2, `attendance.write`, assignment or `view_all`, expected
  organization, expected branch, and exact client-scope checks before trusting
  any event.
- The transaction locks the client row and a client/service-day advisory key,
  derives `service_date` only from `occurred_at` in `Asia/Taipei`, and accepts
  only active clients whose admission/end dates cover that service date.
- `check_in`, `absent`, and `leave` require no current non-cancelled row for the
  same client/day. `check_out` requires one open present row and cannot precede
  its check-in. The base-table unique index and compare-and-swap update remain
  final race guards.
- A new event more than 15 minutes behind database server time is a backfill.
  It requires a non-empty reason, `attendance.correct`, and database-backed
  AAL2 evidence for the same session from the preceding 15 minutes, and its
  source is stored as `staff_backfill`; an ordinary operation ledger entry uses
  `staff`.
- `private.attendance_operations` is an immutable, forced-RLS ledger keyed by
  organization, actor, and idempotency UUID. It stores the canonical request
  hash plus the exact result snapshot, so check-out replay does not depend on
  the base attendance row's creation key. An exact retry returns that snapshot;
  changed content with the same key fails before another write.
- Inserts to both the base record and operation ledger emit metadata-only audit
  events. Signed attendance and a governed append-only correction/review chain,
  schedule-derived applicable denominators, offline consumption, and formal
  Supabase/concurrency E2E remain separate acceptance gates.

### Core care-plan flow

`authorized_care_plans` models the official or otherwise authorized care-plan
source. `client_service_plans` models the institution's executable individual
service plan and points to the exact signed authorized version on which it was
based. Both tables are append-only version ledgers:

- `plan_key` is stable for one revision stream, while `version` increases by
  exactly one and `previous_version_id` permits only one linear successor.
- The four stored states are `draft`, `approved`, `signed`, and `voided`.
  Approval, signing, correction, and voiding create a new linked row; clients
  receive no `UPDATE` or `DELETE` privilege, and a trigger also blocks those
  operations for privileged connections.
- A signed or voided version stores the creator, approver, signer, server-time
  evidence, content hashes, signature purpose, and the consumed AAL2 challenge
  IDs. A browser cannot finalize a version with only a long-lived `aal2` JWT:
  the current session must also have database-backed reauthentication evidence
  from the preceding 15 minutes.
- `effective_from` and `effective_to` are mandatory and ordered. An advisory-
  locked insert guard rejects overlapping signed versions from unrelated plan
  streams. A correction in the same stream supersedes only for its own date
  range; the highest signed-or-voided version for that date is deterministic,
  and a latest `voided` version means no effective plan for that date.
- A client service plan must stay within the referenced signed authorization
  period, and `authorized_limits_snapshot` must exactly match that authorized
  version's `service_limits`. The database deliberately does not invent or
  hard-code statutory service codes, rates, or formulas.
- `service_events.client_service_plan_id` preserves the source chain. An event
  entering `in_progress` or `completed` must reference the current signed
  service plan for the same organization, branch, client, and Taipei service
  date. A planned event may attach that key once when execution starts; it
  cannot later remove or replace the source key. The linked service plan must
  also point to the one current signed authorization for that date; replacing
  or voiding the authorization immediately makes the older service plan
  ineligible for new executed events. Matching transaction advisory locks
  prevent an event from validating against a plan concurrently being replaced.

The permission catalogue adds `care_plans.read`, `care_plans.write`,
`care_plans.approve`, and `care_plans.sign`. System-role defaults are narrow:

- Organization managers and branch supervisors receive all four permissions.
- Case managers/social workers, nurses, and professionals receive read, write,
  and sign, but may carry forward only unchanged content and evidence from the
  immediately preceding approved version unless they also receive an
  organization-specific approval role.
- Care workers receive read only. Finance, drivers, family users, and platform
  operations receive no care-plan permission by default.

Every policy still requires the role's organization/branch scope and either an
active client assignment or `clients.view_all`. Family users never receive base
plan rows.

The read-only RPC is:

```sql
select *
from public.daily_service_summary(
  p_client_id := '<client UUID>',
  p_service_date := date '2026-09-01'
);
```

It accepts no tenant identifier. The invoker's RLS and assignment determine the
tenant, and access fails closed unless the caller can read the client plan,
attendance, health measurements, care records, and service events. One database
snapshot returns the effective authorized/service-plan IDs; four source counts;
and the exact attendance, measurement, care-record, and service-event UUID arrays
used by those counts. The arrays are the supported drill-down keys and prevent a
separate count query from drifting from the detail list. Terminal versions are
resolved inside each stable plan stream first, so a high-version voided legacy
stream cannot hide a valid version-one replacement. The service-plan ID is
returned only when it points to that same current signed authorization.

### Completed and signed service flow

Page 53 completes one service through
`public.complete_service_event(expected_organization_id, expected_branch_id,
client_id, service_code, started_at, ended_at, result, notes,
idempotency_key)`. The route supplies the two expected-scope values from the
server-selected staff context; they are not request-body fields. The public
function is `SECURITY INVOKER`;
the single private definer transaction is the only authenticated write path to
`service_events`:

- The RPC accepts the expected organization and branch only as a confused-deputy
  guard; the client lookup, operation replay, and request hash must all match
  that selected scope. It accepts no plan, staff, signature, or hash fields.
  It requires an employee `aal2` JWT, database-backed reauthentication
  for the same session within 15 minutes, `services.write`, `services.sign`,
  and assignment or `clients.view_all`.
- A new mutation locks the client, requires active/admitted/non-ended service,
  and accepts start and end instants only within the preceding 24 hours (with a
  five-minute future clock allowance). The service date is derived from the
  start instant in `Asia/Taipei`; negative duration is rejected.
- The transaction uses the shared `client-service-plan` then
  `authorized-care-plan` advisory-lock order. It resolves terminal versions per
  stable stream and fails unless exactly one current signed authorization and
  one current signed client service plan tied to that authorization cover the
  service date. Selected plan rows are also locked before insert.
- Service codes are normalized to uppercase and limited to a strict 1-to-40
  character technical format. Evidence is constructed only from trimmed
  `result` and optional `notes`, capped at 4 KiB; arbitrary evidence JSON is not
  accepted.
- The database writes `completed`, the current actor, server signature time,
  fixed signature purpose, and the exact consumed same-session reauthentication
  challenge. The challenge is protected after its terminal transition and the
  service FK is `ON DELETE RESTRICT`, so later session step-ups cannot rewrite
  the signing evidence. The canonical SHA-256 covers derived tenant, plans,
  service facts, evidence, actor, signature, and challenge ID. Authenticated direct
  `INSERT`, `UPDATE`, and `DELETE` grants on `service_events` are revoked.
- `private.service_event_operations` is forced-RLS and append-only, with a
  globally actor-scoped UUID retry key. An exact request returns the immutable
  committed event; reuse for different normalized content fails. The base-row
  idempotency UUID is separately derived from organization, actor, and retry
  key so two actors cannot collide through the older organization-wide key.

This is a dedicated #53 slice, not a complete governed service catalogue or
claim authority. Effective-dated service-code rules, employee qualification,
authorized quantities and rates, cancellation/correction/void workflows,
offline consumption, and formal Supabase plus browser E2E remain fail-closed
release gates. No statutory code, rate, allowance, or formula is invented here.

### Atomic claim workflow

Claim validation, export, and reconciliation use three authenticated public
`SECURITY INVOKER` RPCs. None accepts an organization or branch identifier:

```sql
select * from public.validate_claim_batch(batch_id, expected_total, idempotency_key);
select * from public.export_claim_batch(batch_id, expected_total, idempotency_key);
select * from public.reconcile_claim_batch(batch_id, expected_total, results, idempotency_key);
```

- `validate_claim_batch` locks the parent draft, requires `claims.manage` and
  same-session AAL2 evidence from the preceding 15 minutes, and validates 1 to
  5,000 items, the exact decimal total, branch/client/event scope, service
  date/code, completion, signature, evidence hash, and empty response fields.
  It also re-resolves the service-date terminal service plan and the one current
  signed authorization, so a later replacement or void makes stale evidence
  ineligible. Only then does the same transaction move the batch to
  `validated`; its item set is frozen at that point.
- Validation and first export acquire the same sorted per-client
  `client-service-plan` then `authorized-care-plan` transaction advisory locks
  as the plan version guards before resolving eligibility. A concurrent plan
  replacement or void therefore cannot commit between the current-plan check
  and the claim state transition.
- `export_claim_batch` repeats the same eligibility predicate, verifies the
  stored validation hash, inserts the service events into the private
  append-only allocation ledger, and stores the canonical database-generated
  snapshot hash/count/amount before changing the batch to `exported`. The
  allocation primary key prevents the same service event from being exported
  in another batch, including concurrent requests.
- Migration of existing exported/submitted/accepted/rejected/reconciled/voided
  batches backfills the allocation ledger. If historical data allocates one
  service event more than once, migration stops with a count-only governance
  error instead of silently choosing one claim.
- `reconcile_claim_batch` accepts only a complete 1:1 result set: its JSON array
  length, valid row count, unique item count, and batch membership must all
  equal the immutable snapshot count. Results are normalized and sorted before
  the database computes the replay hash. Partial, duplicate, extra, malformed,
  changed-retry, and legacy JavaScript snapshots fail closed.
- The JSON bridge is deliberately bounded to 2 MiB and 5,000 rows. Response
  codes are safe ASCII up to 40 UTF-8 bytes and optional messages are up to 64
  UTF-8 bytes; this keeps even maximally escaped valid input below the route
  limit. Longer official explanations belong to the future governed response
  file parser, not an oversized ad-hoc JSON request.
- Validation, export, and reconciliation UUIDs are unique database keys. An
  exact retry returns the original operation status and `replayed=true`, even
  after a later state advance or void; a reused key with different normalized
  content fails. Numeric `NaN` and infinity values, draft-prefilled snapshot or
  export metadata, and item-prefilled reconciliation responses are rejected.
- Direct `UPDATE` on claim batches and items is withdrawn from authenticated
  callers. The first release does not yet expose a narrow draft-item correction
  or draft-discard RPC; application code must not restore broad table updates.

`public.claim_batch_summaries(branch_id, limit)` remains a read-only invoker
query. RLS determines the organization and branch visibility, and stored
snapshot count/amount is used after export so list totals cannot drift from the
immutable detail set. It also returns responded and rejected item counts, so a
mixed-result batch continues to expose its rejected work after the batch moves
to the reconciled state. Legacy response rows that predate per-item outcomes
are explicitly marked `legacy_response_unknown`; the UI shows a governance
warning instead of falsely reporting zero responses or zero rejected items.

This is still a **partial #49 implementation**, not a production-ready official
claim engine. Service-code rates, authorized quantities/amounts, county/year
format rules, and official response specifications do not yet have governed,
effective-dated database models. Until those are implemented and legally and
operationally accepted, the system must not claim that an arbitrary item
`amount` or generated snapshot is officially billable or submittable. No
statutory rate or allowance formula is guessed in this migration.

### Medication plan and administration flow

Page 8 and page 7 use separate but linked ledgers. `medication_plans` is the
effective-dated, append-only source plan; `medication_administrations` records
what happened at one scheduled medication instant against the exact plan
version that was valid at the occurrence time.

- Plan creation, replacement, and termination serialize on the client and
  effective interval. An approved version freezes its actor, server time,
  purpose, content hash, and same-session AAL2 evidence. Old plan rows and
  administration rows are never rewritten when medication later stops or
  changes.
- One administration can be `taken`, `refused`, `held`, or `missed`. Exception
  states require a bounded reason. High-risk, insulin, late-entry, and governed
  exception cases cannot finish without a second independent eligible actor.
- Operation ledgers store canonical request hashes and exact result receipts.
  Exact replay rechecks current actor authority and recent same-session AAL2,
  but deliberately does not reinterpret an already committed result merely
  because a responsible employee later leaves.
- Browser calls receive narrow receipts; direct base-table writes and access to
  reauthentication evidence remain revoked.

The repository does not ship an institution-approved high-risk medicine list
or clinical dosing rule. Those are still governed inputs and formal release
gates.

Page 5 adds a separate append-only insulin execution ledger without creating a
second medication-plan authority. It accepts only the exact Page 8 plan version
that was approved, effective and not stopped at the scheduled slot. Every
insulin administration requires two different people for execution and review,
with recent same-session AAL2 for both; late entry additionally requires a
different authorized supervisor and a bounded reason. Each participant is
revalidated against the exact current Page 72 terminal qualification version
for both membership and user. Plan designation, personnel designation and the
dose rule must reference the same published governance version, and the dose
rule must match the exact plan unit. If the institution has not published the
qualification taxonomy, insulin designation and unit-bound dose governance,
all production mutations fail closed as `not_configured`; no role-only
qualification or invented clinical range is accepted.

### Client TOCC and monthly individual service plans

Page 9 records individual and batch TOCC submissions through the same atomic
validator. The database derives the one-month validity window with Taiwan
calendar semantics, returns a per-item outcome for batches, distinguishes
missing from a negative result, and prevents a retry from duplicating an
already committed item.

Page 10 uses `individual_service_plans`, intentionally separate from the
broader page-52 `client_service_plans` model:

- `plan_month` is always the first day of the selected Taiwan calendar month.
- Each organization, branch, client, and month has one linear append-only
  version chain. A correction must name the terminal predecessor and provide a
  reason; branching, `UPDATE`, and `DELETE` are rejected.
- Goals, activities, frequency text, responsible user, progress, and progress
  notes are signed human-entered facts. The database resolves and freezes the
  responsible person's display name for a new version.
- Exact replay occurs before mutable responsible-person eligibility is
  re-evaluated, so later departure does not invalidate an immutable receipt;
  current actor scope and recent same-session AAL2 are still required.
- Read and responsible-person projections recheck branch and permission state
  after the data query and again after audit insertion before returning.

No completion formula, clinical recommendation, or copy-prior-month rule is
invented by this schema.

### Client master and social-resource boundaries

Page 60 uses `private.client_master_operations` plus the public
`create_local_client`, `update_local_client`, and `client_master_snapshot`
interfaces. The snapshot is branch and assignment scoped, omits raw identity
ciphertext, applies field masking, and emits a read audit event. Writes use
optimistic row versions, duplicate stable-identifier checks, actor-scoped
idempotency, and server-derived audit metadata. Relationship, consent, and
attachment submodels remain separate release work.

Page 31 stores institution-owned entries in `social_resources`:

- audience, eligibility, contact, and validity each have explicit
  `provided`, `missing`, or `not_applicable` semantics instead of overloading
  an empty string;
- create, edit, confirm, and deactivate operations use optimistic row versions
  and immutable actor-scoped receipts; inactive entries cannot be rewritten;
- effective counts use the snapshot's Taiwan date, exclude future starts, and
  count pending confirmation only for active entries with no confirmation;
- expiration is status-independent and may overlap an inactive entry. The UI
  labels this overlap rather than silently forcing mutually exclusive totals.

No expiry-soon or periodic reconfirmation threshold exists until an institution
publishes one. The projection returns that boundary explicitly.

### Staff notification management and recipient notification center

Page 45 wraps the shared notification writer with three guarded interfaces:
`push_notification_management_snapshot`,
`preview_in_app_staff_notification_recipients`, and
`enqueue_in_app_staff_notification`.

- The management snapshot contains only current operational staff in the
  selected branch or organization scope and only page-45 notification history.
  Internal audience IDs, request hashes, idempotency keys, reauthentication
  evidence, and provider diagnostics are omitted.
- Preview resolves the exact current server-side recipient names without
  writing. Queueing then atomically creates one notification and the complete
  in-app delivery fan-out under one actor-scoped key.
- This slice hard-codes only `in_app`. A queued delivery is reported as
  `queued`, never as sent, delivered, or read. Family, PWA, LINE, SMS, provider
  workers, and partial-failure retry remain unavailable.
- Aggregate cards and history are returned from one bounded database snapshot;
  a non-truncated response must have exact aggregate/detail parity.

Page 67 is the recipient-side center. Its audited projection returns only the
current recipient's visible, published notification rows and safe source links.
Draft, future, cancelled, cross-recipient, and invalid-source records are
excluded. Read and confirmation actions are immutable idempotent receipts and
recheck recipient scope after lock waits. A priority-three timeout or escalation
rule is not inferred until the institution publishes one.

### Quality, activities, training, announcements, meetings, and inventory

Page 24 stores one immutable `fall_incidents` row per reported event and an
append-only `fall_incident_entries` chain for treatment, follow-up, and closure.
The writer locks the client and incident, checks event and entry chronology,
rechecks exact tenant, branch, client scope and AAL2 after the lock, and returns
an actor-scoped immutable receipt. Closure additionally requires recent
same-session AAL2. Injury degree is institution-entered text with explicit
`provided`, `missing`, and `not_applicable` states; no clinical taxonomy,
severity score, or reporting threshold is inferred. The audited snapshot keeps
full filtered aggregates separate from the 200-incident and 100-entry display
limits so one incident is never counted once per timeline entry.

Page 25 uses a separate immutable infection-event chain with explicit
`provided`, `missing`, and `not_applicable` type evidence. Treatment, follow-up,
cluster link, cluster unlink, and closure are append-only entries. A cluster is
selected by stable UUID and never inferred from a matching label. The writer
rechecks current client scope, permission, chronology, incident version, and
cluster state under locks; closure requires recent same-session AAL2. Snapshot
totals are calculated on the complete filtered set before bounded event,
timeline, client, type, and cluster options are returned. The system does not
infer a diagnosis, outbreak, or statutory reporting requirement.

Page 26 stores immutable kilogram observations and an append-only correction
ledger. Replace and void preserve the source value, and void is terminal. A
monthly comparison uses only a valid observation from the exact preceding
Taipei calendar month and computes signed kilogram and percentage differences
with database decimal arithmetic, never floating-point coercion. Missing and
not-applicable remain distinct from zero. Institution thresholds are effective-
dated versions published by two independent, recently AAL2-authenticated users
with `quality_rules.manage`; a later rule does not rescore old evidence. Alert
acknowledgement freezes both observations, their correction versions, and the
rule version used at that time.

Page 27 stores one immutable abnormal incident and an append-only chain of
manual notification, improvement, follow-up, and closure entries. Affected
targets are explicit client, staff, visitor, facility, or other identifiers;
the system never infers a diagnosis, statutory report, or delivery result.
Writers lock the incident chain and recheck current tenant, branch, assignment,
permission, responsible-person scope, chronology, and actor-scoped replay.
Closure requires recent same-session AAL2. The snapshot calculates inclusive
date-range metrics over the full filtered set before applying its 200-row
display bound.

Page 29 stores immutable social-work service-record versions ordered by the
actual occurrence timestamp rather than entry time. Draft revision, recent-AAL2
signature, and reasoned correction append a linear version; follow-up planning,
completion, and cancellation use a separate append-only expected-sequence
ledger. Every mutation rechecks tenant, branch, current client assignment and
actor permission while locked, and exact replay is actor scoped. Snapshot counts
use the complete filtered set before bounded record and option lists. Narrative
content is excluded from audit metadata; offline sync, attachments, export and
external follow-up delivery remain explicitly unconfigured.

Page 30 stores immutable activity schedule versions and append-only status
events. Create, revise, start, complete, and cancel operations revalidate the
current responsible staff member, participant client scope, capacity, time
range, expected schedule/status version, and actor-scoped replay while locks
are held. Cancellation requires a reason and recent same-session AAL2. Past
change and cancellation-notification policies remain explicitly unconfigured;
no external delivery is claimed. Counts are calculated before the bounded
activity, staff, client, and type option lists.

Page 68 stores immutable staff-announcement versions. A draft has no delivery
claim. Publishing revalidates current branch staff and governance-role
membership, then freezes the exact release-recipient set; later staff changes do
not rewrite that set. Withdrawal creates a new version with a required reason,
and read receipts represent only an actual portal recipient action. Lifecycle
states are derived at one snapshot time, while an active release and a newer
pending draft remain visibly distinct. This slice is limited to the signed-in
staff portal and does not claim LINE, PWA, SMS, family, or provider delivery.

Page 71 stores immutable staff-training record versions; correction and void
append rather than overwrite, and a voided terminal version contributes no
active hours or credits. Hours and credits use database decimal arithmetic,
while missing credit and missing evidence remain distinct from zero and not
applicable. Institution progress rules are effective-dated proposals published
by a second, recently AAL2-authenticated actor. Until a rule is published, the
system does not assume a six-year or 120-credit target and returns gap and
expiry metrics as unconfigured. Attachment upload/scanning and external
reporting remain fail-closed.

Page 72 stores immutable employee-certificate versions; corrections and voids
append to one terminal chain and never rewrite earlier evidence. Certificate
type, number, effective/expiry dates, registration, verification, and evidence
state are frozen per version. A finite exception is pinned to the current
terminal certificate version and requires two distinct, currently authorized,
recent-AAL2 approvers; the requester cannot approve their own request. Every
step uses actor-scoped exact replay and an expected approval count. Attachment
references fail closed until the upload and malware-scanning pipeline exists.
Restricted-service taxonomy and expiry-reminder rules are deliberately not
invented: the snapshot reports both as `not_configured` and service eligibility
as `not_evaluated` until an institution publishes governed versions.

Page 75 stores signed meeting-minute versions with frozen attendee, agenda,
decision, signer-role, and action snapshots. A correction links to the current
terminal version, preserves existing action identities, and cannot silently
remove them. Action progress is a separate append-only chain guarded by the
expected previous update. Overdue state is derived using the snapshot's
`Asia/Taipei` date and creates only an internal work-item flag; meeting types,
retention, escalation, and external-notification policy remain explicitly
institution-owned and unconfigured. Signing and correction require recent
same-session AAL2; ordinary action progress still requires employee AAL2.

Page 76 stores a separate immutable `consultant` message stream; it never reads
or writes the general notification, announcement, or care-communication
streams. Creation freezes the exact currently eligible professional-recipient
set. Managers can inspect the frozen set and its append-only read/confirmation
receipts, while a consultant can see only messages addressed to that same user
and only that user's receipt. Snapshot view/search writes a metadata-only audit
event without copying subject or body. Attachments are structurally isolated
but every attachment-bearing create fails closed until the trusted upload and
malware-scanning pipeline exists; the current delivery boundary is in-app only.

Page 77 separates immutable inventory movements from item-status history and
current batch balances. Receipt, issue, return, adjustment, stocktake, and
client issue use exact four-decimal arithmetic and an expected batch-ledger
version. The transaction locks and rechecks the item, batch, original issue,
client scope, and current actor authority; it rejects negative balance, expired
issue, excessive return, cross-item batches, and unauthorized client issue or
replay. Client-identifying movement fields and return options are omitted when
the current actor cannot access that client. Low-stock, near-expiry, and
stocktake-cycle metrics remain `not_configured` until an institution publishes
a policy; the slice does not imply purchasing, medication-order, or finance
integration.

These dedicated slices follow the project-wide boundary: exposed `public` RPCs are
`SECURITY INVOKER`; privileged implementations live in the non-exposed
`private` schema as pinned-search-path `SECURITY DEFINER` functions with their
own complete authorization checks. `supabase/config.toml` does not expose the
`private` schema through the Data API.

### Role and form governance

Page 81 records permission changes in `role_governance_requests`. Six bounded
operation types cover role permissions and membership-role assignments. Scope
expansion requires an independent approver, current authority, and recent
same-session AAL2; request and approval retries return immutable correlated
receipts. `role_governance_snapshot` exposes a bounded role, permission,
membership, and pending-request view without leaking actor identifiers.

Page 82 records publication decisions in `form_publication_requests`. The
current slice provides an audited bounded snapshot, publication request,
independent approval, effective-period exclusion, and fail-closed behavior when
the required set is truncated. It does **not** yet provide full form/rule CRUD,
test sandbox, retirement, or every historical replay path, so page 82 remains
partial rather than dedicated.

## Import replay and integration idempotency

- Upload replay is durable across process restarts through
  `import_batches.upload_idempotency_key`, unique per organization, branch, and
  uploader. File hashes are also unique at the organization-and-branch scope;
  a duplicate in one branch cannot disclose a batch owned by another branch.
- Reparse and approval replay use `import_operations`. Trusted server code first inserts a
  `pending` row with an idempotency key, canonical request SHA-256, operation
  kind, actor, and expected batch version. The batch update and transition to
  `applied` should occur in the same short database transaction. A retried key
  must return the stored result only when its request hash and operation kind
  match; otherwise the API returns an idempotency conflict.
- Completed import operations are immutable. Import approval also requires the
  approval permission and database-backed AAL2 evidence from the same session
  within the previous 15 minutes.
- `public.approve_import_staging(batch_id, expected_version, idempotency_key,
  request_hash)` atomically locks the batch, checks both import permissions and
  recent AAL2, records/returns the durable operation result, compare-and-swaps
  the version, and freezes the reviewed staging data. It deliberately leaves
  status as `ready_for_approval` and returns `staging_only=true`; no domain rows
  are promoted and the batch is never mislabeled `imported`. A future domain
  promotion RPC must write all target rows and transition status in one database
  transaction before production approval can be called complete.
- LINE webhook audit markers have a partial unique key for
  `table_name = 'line_webhook_events'` plus the provider event ID in `row_pk`.
  Trusted server code should use `insert ... on conflict do nothing` and never
  use a read-then-insert sequence for webhook deduplication.

## Audit and grants

Mutation triggers write only identifiers, changed field names, request IDs,
and operational metadata to `audit_events`; they do not copy field values or
personal data into the audit ledger. Reads, exports, prints, and other
application-level actions must be inserted by trusted server code using the
service role.

The migrations revoke automatic Data API grants and opt privileges back in
explicitly. `supabase/config.toml` also sets `auto_expose_new_tables=false` so a
future table is not exposed merely because it was created in `public`.

## Test coverage

`supabase/tests/foundation_schema.test.sql` verifies the table inventory, RLS,
forced RLS, grants, SECURITY DEFINER placement, fixed search paths, foreign-key
indexes, safe tenant-context view, and synthetic seed marker.

`supabase/tests/rls_access.test.sql` also verifies employee AAL2 enforcement,
fresh-factor challenge consumption, nonce replay/supersession, organization-
versus-branch scope, system-role escalation denial, family base-table denial
and whitelist RPCs, synchronization denial, tenant isolation, and anonymous
denial.

`supabase/tests/core_care_plans.test.sql` verifies append-only grants and
triggers, AAL1 and cross-tenant denial, assignment and role boundaries, linear
versions, period-overlap rejection, authorization-period and limit enforcement,
service-event linkage, deterministic effective versions, source counts, and
source-ID drill-down parity. It also covers a high-version voided legacy stream
beside a version-one replacement and rejects execution through a service plan
whose authorization has since been replaced. It also guards the shared
service-plan then authorization advisory-lock order used to prevent a newly
inserted service plan from being stale at commit.

`supabase/tests/atomic_claim_workflows.test.sql` verifies 42 claim assertions:
public-wrapper invoker posture, explicit grants, direct-update denial, AAL1 and
cross-tenant denial, draft validation and freeze, atomic export and exact
snapshot metadata, idempotent replay/conflicts, allocation uniqueness,
unsigned/period/evidence rejection, post-export item immutability, full-only
reconciliation and normalization, legacy fail-closed behavior, finite numeric
guards, metadata-prefill denial, and exact RLS-filtered summaries.

`supabase/tests/client_lifecycle.test.sql` verifies the six-state event
catalogue, composite client scope, forced RLS, explicit grants, invoker RPC,
same-session recent AAL2, organization and branch isolation, legal/illegal
state transitions, effective-date rules, optimistic locking, exact replay and
idempotency conflicts, atomic client updates, direct-mutation denial, and
metadata-only audit markers.

`supabase/tests/complete_service_event.test.sql` verifies 31 dedicated service
assertions: public/private function posture, withdrawn base-table writes,
AAL1 and stale-step-up denial, immutable signature challenge linkage,
cross-tenant and selected-context multi-branch isolation, missing current plans,
terminal clients, time and duration bounds, strict code input, server-derived
plan/actor/evidence/signature/hash, globally actor-scoped exact replay and scope
conflict handling, and daily-summary source-ID drill-down parity.

`supabase/tests/blood_glucose_measurements_test.sql` verifies 39 dedicated
blood-glucose assertions: the unit/context constraint and partial read index,
explicit grants and function posture, current AAL2/permission, same-actor
selected-context multi-branch and cross-tenant isolation, lifecycle and time
gates, both unit ranges and precision, non-finite rejection, exact replay and
changed-content conflict, one-row result, direct write denial, audit evidence,
post-replay permission revalidation, and the client `FOR UPDATE` lifecycle lock.

`supabase/tests/staff_certificates_page72.test.sql` verifies 36 dedicated
certificate assertions: explicit grants and forced RLS, immutable version and
exception ledgers, current AAL2 and permission checks, tenant/branch/staff
scope, linear correction and void semantics, untrusted attachment rejection,
actor-scoped exact replay, finite exception periods, requester/approver
separation, two distinct approvals, current-authority revalidation, optimistic
approval counts, snapshot consistency, and metadata-only audit evidence.

`supabase/tests/staff_vaccinations_page73.test.sql` verifies 32 dedicated
employee-vaccination assertions: independent sensitive-health permissions,
AAL2, tenant/branch/staff scope, forced RLS and direct-table denial, immutable
create/correct/void versions, actor-scoped exact replay, untrusted attachment
rejection, warning-only duplicate detection that preserves every record,
bounded duplicate details, exact snapshot totals, and audit metadata without
employee health field values.

`supabase/tests/consultant_messages_page76.test.sql` verifies 36 dedicated
consultant-message assertions: category constraints, forced RLS and explicit
grants, append-only messages/recipients/attachments/receipts, staff author and
professional-recipient separation, tenant/branch/current-authority checks,
exact replay/conflict behavior, attachment fail-closed handling, recipient-only
read/confirmation evidence, manager-versus-recipient projection isolation,
bounded snapshot consistency, and metadata-only view/search audit evidence.

`supabase/tests/adaptation_assessment_page32.test.sql` verifies 55 dedicated
adaptation-assessment assertions: tenant/branch/assigned-client isolation,
manual-unstandardized form boundaries, immutable draft/revision/sign/correction
versions, recent AAL2 signing, reasoned signed corrections, append-only follow-up
sequences, actor-scoped exact replay, complete-set statistics before bounded
detail projection, permission revalidation, and audit metadata without
narrative, scores or diagnostic claims.

`supabase/tests/psychosocial_assessment_page28.test.sql` verifies 50 dedicated
psychosocial-assessment assertions: tenant/branch/assigned-client isolation,
manual-unstandardized and non-scoring form boundaries, explicit
recorded/unknown/not-applicable domain states, immutable draft/revision/sign/
correction versions, recent AAL2 signing, reasoned signed corrections,
actor-scoped exact replay, complete-set statistics before bounded projection,
permission revalidation, and audit metadata without narrative, scores or
diagnostic claims.

`supabase/tests/hand_hygiene_page66.test.sql` verifies 34 dedicated hand-hygiene
assertions: service-role-only source ingestion, composite source identity
deduplication and changed-content conflicts, forced RLS and explicit grants,
event-time staff scope, append-only correction sequences, actor-scoped exact
replay, permission revalidation, terminal match/exclusion projection, inclusive
Taipei dates, exact filtered totals, null denominator/rate while governance is
unconfigured, and audit metadata that excludes source IDs, staff codes and
narrative reasons.

`supabase/tests/care_communications_page43.test.sql` verifies 38 dedicated
care-communication assertions: category isolation from consultant messages,
forced RLS and explicit grants, tenant/branch/assigned-client and current family
consent gates, immutable original/correction versions, frozen recipient consent
snapshots, append-only queued outbox evidence, attachment fail-closed behavior,
recent AAL2, actor-scoped exact replay, optimistic version conflicts, bounded
snapshot consistency, and metadata-only audit evidence without narrative text.

`supabase/tests/external_health_devices_page65.test.sql` verifies 34 dedicated
external-device assertions: service-role-only normalized ingestion, composite
tenant/branch/provider/source-measurement deduplication, changed-content and
device-metadata conflicts, separate measured/received timestamps, exact numeric
and unit preservation, forced RLS and explicit grants, recent same-session AAL2,
scoped client assignment, append-only device-state and measurement-correction
sequences, actor-scoped exact replay, optimistic conflicts, terminal matching,
inclusive Taipei dates, exact snapshot totals, explicit unconfigured provider
and connection boundaries, and audit metadata without client or measurement
values.

`supabase/tests/reassurance_calendar_page44.test.sql` verifies 27 dedicated
calendar assertions: forced RLS and explicit grants, tenant/branch/assigned-client
scope, recent AAL2, immutable create/revise/cancel versions, required cancellation
reasons, terminal cancellation, actor-scoped exact replay, optimistic conflicts,
shared calendar/list snapshot identity, inclusive Taipei month boundaries, and
metadata-only audit evidence without event narrative or search text.

`supabase/tests/staff_tocc_page74.test.sql` verifies 33 dedicated employee-TOCC
assertions: independent sensitive permissions, AAL2, tenant/branch/staff scope,
forced RLS and direct-table denial, immutable create/correct/void versions,
actor-scoped exact replay, untrusted attachment rejection, explicit manual
validity and attention evidence without text-derived diagnosis, exact snapshot
totals, and metadata-only view/search audit evidence without result or
disposition content.

`supabase/tests/occupational_therapy_assessment_page33.test.sql` verifies 60
dedicated occupational-therapy assertions: explicit professional permissions,
tenant/branch/assigned-client scope, forced RLS and direct-table denial,
structured numeric/text/missing/not-applicable measurements, fixed manual and
unstandardized form reference, immutable draft/revise/sign/correct chains,
recent same-session AAL2, actor-scoped exact replay, expected-version conflicts,
bounded same-snapshot totals and metadata-only audit evidence without clinical
narrative. No score, formula, diagnosis or automatic deadline is inferred.

`supabase/tests/physical_therapy_assessment_page34.test.sql` verifies 61
dedicated physical-therapy assertions against an independent Page 34 domain:
explicit professional permissions, tenant/branch/assigned-client scope, forced
RLS and direct-table denial, exact-decimal numeric values with manual units,
text observations, and separately reasoned missing/not-applicable states. The
fixed `manual_unstandardized` / `manual-physical-therapy-v1` reference never
infers an official form, score, formula, diagnosis, or automatic deadline.
Immutable draft/revise/sign/correct chains require recent same-session AAL2 for
every write, actor-scoped exact replay, expected-version locking, bounded
same-snapshot totals, and metadata-only audit evidence without clinical text.

`supabase/tests/physical_therapy_services_page40.test.sql` verifies 54
dedicated physical-therapy service assertions against a Page 40 domain that is
independent from Page 34 assessment writes: explicit professional permissions,
tenant/branch/assigned-client scope, forced RLS and direct-table denial,
separately reasoned recorded/missing/not-applicable service content, reaction
and recommendation values, immutable create/revise/sign/correct chains, recent
same-session AAL2 for signing and correction, actor-scoped exact replay,
expected-version locking, and append-only operation evidence. The database—not
the browser—selects and freezes the latest terminal Page 34 assessment effective
on the service occurrence date. Bounded same-snapshot totals and metadata-only
audit evidence are covered without inferring a formula, diagnosis, automatic
recommendation, attachment, export or offline capability.

`supabase/tests/insulin_administrations_page5.test.sql` verifies 46 dedicated
insulin assertions: Page 8 approved/effective/non-stopped plan authority,
forced RLS and direct-write denial, public invoker/private definer posture,
current tenant/branch/assigned-client scope, recent same-session AAL2,
actor-scoped exact replay, expected-version and unique plan-slot conflicts,
exact decimal dose/unit/site/server-time freezing, independent executor and
reviewer, reasoned late-entry supervision, exact Page 72 membership-plus-user
terminal qualification, governance-version pinning, unit-bound dose rules, and
fail-closed behavior when any formal governance input is not configured.

`supabase/tests/interprofessional_consultations_page37.test.sql` verifies 30
dedicated consultation assertions: explicit permissions and grants, forced RLS
and append-only ledgers, tenant/branch/assigned-client and qualified-assignee
scope, recent AAL2 for high-risk transitions, actor-scoped exact replay,
expected-sequence conflicts, create/assign/reassign/reply/supplement/close/
reopen/correction transitions, frozen in-app queued recipients, bounded
snapshot consistency, explicit missing versus not-applicable deadlines, and
audit metadata without consultation narrative.

`supabase/tests/referral_management_page39.test.sql` verifies 40 dedicated
referral-management assertions: explicit permissions and grants, forced RLS and
append-only ledgers, tenant/branch/assigned-client scope, recent AAL2,
actor-scoped exact replay, expected-sequence conflicts, draft/submit/manual
receipt/response/close/correction transitions, explicit missing versus
not-applicable versus manual receiving units, queued-only in-app evidence,
bounded same-snapshot metrics and audit metadata without referral narrative.

`supabase/tests/staff_vital_signs_page69.test.sql` verifies 38 dedicated
employee-vital-sign assertions: independent sensitive-health permissions,
recent same-session AAL2 before health-content parsing, tenant/branch/staff
scope, forced RLS and direct-table denial, immutable create/correct/void
versions, actor-scoped exact replay, exact decimal-text preservation, strict
measured/missing/not-applicable separation, same-snapshot list/trend evidence,
explicit unconfigured threshold and offline/export boundaries, and metadata-only
view/search audit evidence without values, notes or search text.

`supabase/tests/staff_lab_reports_page78.test.sql` verifies 38 dedicated
employee-lab-report assertions: independent sensitive-health permissions,
AAL2 before health-content parsing, tenant/branch/staff scope, forced RLS and
direct-table denial, immutable create/correct/void versions, actor-scoped exact
replay, untrusted attachment rejection, separate exact-content and key-field
duplicate evidence without automatic merging, manual validity status, bounded
duplicate details, exact snapshot totals, and metadata-only view/search audit
evidence without report results.

`supabase/tests/feedback_complaints_page56.test.sql` verifies 51 dedicated
feedback-and-complaint assertions: four independent permissions, forced RLS and
explicit grants, public-invoker/private-definer RPC posture, tenant/branch and
assignee scope, no pre-seeded deadline policy, exact published rule locking,
server-generated case numbers and deadlines, database-clock high-risk and
overdue escalation, immutable case/event/private-content/receipt stores,
expected chain versions, actor-scoped exact replay and conflict rejection,
full append-only correction versions, recent same-session AAL2 terminal close,
terminal-chain rejection, DB-side sensitive null masking and search isolation,
bounded snapshots, and metadata-only read/write audit evidence. It uses only
synthetic `.invalid` identities. Formal Supabase PostgreSQL concurrency, the
approved deadline-policy governance path, external escalation delivery, and
export remain separate production gates.

`supabase/tests/daily_service_summary_page54.test.sql` verifies 39 dedicated
daily-service-summary assertions. `daily_service_summary_snapshot_v2` creates
one actor- and branch-scoped immutable payload from a single database statement
covering attendance, vital signs, care diary, service use, activities, meals,
transport execution and abnormal events. Every cell independently rechecks its
source read permission and assigned-client scope; transport additionally keeps
the assigned-driver-or-`manage_any` boundary. A hidden or unconfigured source
returns unknown/null and is excluded from the completeness denominator instead
of becoming zero. Source record IDs and hashes remain in the snapshot while
drill-down URLs are restricted to a fixed internal allowlist. Exact export
requires the same owner, organization, branch and filters, a still-valid
15-minute snapshot, current source permissions, and recent same-session AAL2.
The test also covers payload/hash immutability, direct-table denial, bounded
rows and source IDs, terminal-version semantics, permission revocation, and
metadata-only view/export audits. Formal Supabase independent-session races,
the complete production role matrix, source-domain business approval, and
50-user/seven-year performance remain release gates.

The repository-level `pnpm test:database` command now creates a fresh PGlite
database for every pgTAP file, installs the local auth-role compatibility
bootstrap, applies every migration and the synthetic seed, and rejects failed
assertions or a plan-count mismatch. `pnpm verify` runs this gate before the
production build. This is intentionally labelled a compatibility gate: release
still requires the same suite on the supported Supabase PostgreSQL version,
database lint, and real independent-connection race tests.

Do not run `supabase db reset --linked`, `supabase db push`, or any migration
command against a hosted project until the organization has completed the
required review and explicitly approved that target.
