# 收案與補件表

`/app/intake-completeness` adds a read-only work list over the existing intake profile, document pipeline and weekly plan versions. It does **not** create admission eligibility, an official document requirement, a clinical decision or a launch-approval flag.

## Implemented boundary

- All 13 checks come from one database `SELECT`/MVCC snapshot, capped at 500 authorized clients. Counts, search, item filters and status-card drilldowns use that exact returned set. Cards preserve search and item selection.
- The public RPC is security invoker. Its private definer has no direct client grants on source tables, an empty search path, the existing live intake authority checks, exact tenant/branch filters, both client-read and demographic scopes, and existing assignment checks. Each document category additionally uses the same `client_document_access` guard as its source page. Revoking health access reveals only `denied`, not document presence.
- RPC output includes case UUID/name/code/status, intake version and fixed key/status pairs. It excludes identity numbers, contacts, addresses, medical details, review reasons, hashes, storage paths and attachment bodies.
- Read audit is atomic with response generation, includes only scope/date/count/projection metadata, and fails closed if audit insertion fails. No service-role report execution grant or admin client is used.
- Existing profile with empty value is `missing`; no intake profile version is `unknown`. Pending consent and declined consent are distinct. Documents are not complete until clean-scan evidence and a review match the latest version. Explicit not-applicable decisions remain separate; replacement uploads invalidate old reviews. Expired latest weekly plans never revive earlier open-ended versions.
- Refreshed API data has `private, no-store`, a 10-second abort deadline, scope binding and generated-time validation (at most 120 seconds old, at most 60 seconds future skew). Browser refresh has a separate 12-second timeout. Failed refresh clears prior rows; changing principal/branch/scopes remounts the page. This report has no persistent browser storage or offline write path.
- Intake drilldowns use `/app/client-intake?client=<stable-uuid>&step=profile|documents|weekly`; denied categories have no shortcut.

## Verification

- `node scripts/test-database.mjs intake_completeness_report.test.sql` — 33 assertions; actual migration admission logic with synthetic Google AAL1/AAL2 identities, tenant/branch/assignment isolation, field/category revocation and metadata minimization.
- `pnpm exec vitest run src/lib/intake-completeness src/components/intake-completeness src/app/app/intake-completeness` — projection, filters/counts, scope/freshness/timeout, page remount and actual React interactions.
- Migration was created with Supabase CLI as `20260914131429_intake_completeness_report.sql`. Local PGlite is compatibility evidence, not hosted PostgreSQL, scale testing or production deployment evidence.

## Not included

No CMS/scanner/archival provider activation, new document categories, formal completeness percentage, configurable clinical requirements, role expansion, API-export/PDF, historical point-in-time profile reconstruction or automated reminders. The check date evaluates document expiry and weekly effectiveness; profile/document review is the latest saved version. Existing upload/review authority remains unchanged. Scope-limited empty results do not assert that an entire institution has no clients.
