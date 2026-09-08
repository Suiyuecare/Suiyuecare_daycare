# Dependency security verification — 2026-09-08

## Scope

This change is limited to the production AWS S3 dependency chain used by the
HTML WORM archive adapter. It does not change Next.js, React, Supabase, any
cloud resource, or any cloud configuration.

## Before

`pnpm audit --prod --json` reported seven advisories: one critical, three high,
two moderate, and one low. Every advisory resolved to the same production-only
transitive dependency:

`@aws-sdk/client-s3@3.922.0` → `@aws-sdk/core@3.922.0` →
`@aws-sdk/xml-builder@3.921.0` → `fast-xml-parser@5.2.5`.

| Severity | Advisory | Affected versions | Patched versions |
|---|---|---|---|
| Critical | [GHSA-m7jm-9gc2-mpf2](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2) | `>=5.0.0 <5.3.5` | `>=5.3.5` |
| High | [GHSA-37qj-frw5-hhjh](https://github.com/advisories/GHSA-37qj-frw5-hhjh) | `>=5.0.9 <=5.3.3` | `>=5.3.4` |
| High | [GHSA-jmr7-xgp7-cmfj](https://github.com/advisories/GHSA-jmr7-xgp7-cmfj) | `>=5.0.0 <5.3.6` | `>=5.3.6` |
| High | [GHSA-8gc5-j5rx-235r](https://github.com/advisories/GHSA-8gc5-j5rx-235r) | `>=5.0.0 <5.5.6` | `>=5.5.6` |
| Moderate | [GHSA-jp2q-39xq-3w4g](https://github.com/advisories/GHSA-jp2q-39xq-3w4g) | `>=5.0.0 <5.5.7` | `>=5.5.7` |
| Moderate | [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) | `<5.7.0` | `>=5.7.0` |
| Low | [GHSA-fj3w-jwp8-x2g3](https://github.com/advisories/GHSA-fj3w-jwp8-x2g3) | `>=5.0.0 <5.3.8` | `>=5.3.8` |

The effective fix floor was therefore `fast-xml-parser >=5.7.0`, not 5.5.6.

## Selected fix

The direct dependency is pinned from `@aws-sdk/client-s3@3.922.0` to
`@aws-sdk/client-s3@3.980.0`. This is the first available client release after
the existing version whose complete S3/signature dependency graph no longer
pins the vulnerable XML-builder branch. Its resolved production graph uses
`@aws-sdk/core@3.977.9` and `@aws-sdk/xml-builder@3.972.40`; that XML builder no
longer depends on `fast-xml-parser`.

`@aws-sdk/client-s3@3.974.0` was explicitly rejected during verification: even
though its primary core branch was safe, it retained a second vulnerable branch
through `@aws-sdk/signature-v4-multi-region@3.972.0`. No package-manager
override or forced transitive version was used.

## Verification after update

- `pnpm audit --prod --json`: zero advisories and zero critical, high,
  moderate, low, and info vulnerabilities across 214 production dependencies.
- `pnpm audit --json`: zero advisories and zero critical, high, moderate, low,
  and info vulnerabilities across all 676 resolved dependencies.
- `pnpm why fast-xml-parser --prod`: no production dependency found.
- Lockfile search: no `fast-xml-parser`, `@aws-sdk/xml-builder@3.972.0`, or old
  `@aws-sdk/client-s3@3.922.0`/`3.974.0` entry remains.
- `pnpm exec vitest run src/lib/imports/worm-archive.test.ts
  src/lib/imports/imports.test.ts src/lib/imports/client-contract.test.ts
  src/components/imports/import-workspace.test.tsx`: 4 files, 21 tests passed.
- `pnpm typecheck`: passed.

The focused tests use an injected fake S3 client. No command connected to AWS,
created a cloud resource, uploaded an object, or read a real bucket.
