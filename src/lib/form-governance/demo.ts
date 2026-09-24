import type {
  FormDefinitionSourceRow,
  FormPublicationSourceRow,
  FormVersionSourceRow,
} from "./projection";
import { projectFormGovernanceSnapshot } from "./projection";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const generatedAt = "2026-09-01T08:30:00.000Z";

const definitions: FormDefinitionSourceRow[] = [
  {
    id: "82000000-0000-4000-8000-000000000001",
    organization_id: organizationId,
    form_key: "tenant.custom.care_diary",
    name: "機構自訂照顧日誌",
    category: "照顧表單",
    is_official: false,
  },
  {
    id: "82000000-0000-4000-8000-000000000002",
    organization_id: organizationId,
    form_key: "tenant.fall_followup",
    name: "跌倒事件追蹤規則",
    category: "品質規則",
    is_official: false,
  },
  {
    id: "82000000-0000-4000-8000-000000000003",
    organization_id: null,
    form_key: "official.spmsq",
    name: "SPMSQ 官方量表",
    category: "官方量表",
    is_official: true,
  },
  {
    id: "82000000-0000-4000-8000-000000000004",
    organization_id: organizationId,
    form_key: "tenant.monthly_service",
    name: "每月服務彙整規則",
    category: "營運規則",
    is_official: false,
  },
];

const versions: FormVersionSourceRow[] = [
  {
    id: "82100000-0000-4000-8000-000000000001",
    form_definition_id: definitions[0]!.id,
    version: 1,
    status: "published",
    effective_from: "2026-01-01",
    effective_to: "2026-08-31",
    schema_field_count: 3,
    scoring_rule_count: 0,
    published_at: "2025-12-20T03:00:00.000Z",
    content_hash: "a".repeat(64),
  },
  {
    id: "82100000-0000-4000-8000-000000000002",
    form_definition_id: definitions[0]!.id,
    version: 2,
    status: "draft",
    effective_from: "2026-09-01",
    effective_to: "2026-12-31",
    schema_field_count: 4,
    scoring_rule_count: 0,
    published_at: null,
    content_hash: null,
  },
  {
    id: "82100000-0000-4000-8000-000000000003",
    form_definition_id: definitions[0]!.id,
    version: 3,
    status: "draft",
    effective_from: "2027-01-01",
    effective_to: null,
    schema_field_count: 2,
    scoring_rule_count: 0,
    published_at: null,
    content_hash: null,
  },
  {
    id: "82100000-0000-4000-8000-000000000004",
    form_definition_id: definitions[1]!.id,
    version: 1,
    status: "draft",
    effective_from: null,
    effective_to: null,
    schema_field_count: 1,
    scoring_rule_count: 1,
    published_at: null,
    content_hash: null,
  },
  {
    id: "82100000-0000-4000-8000-000000000005",
    form_definition_id: definitions[2]!.id,
    version: 7,
    status: "published",
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    schema_field_count: 10,
    scoring_rule_count: 2,
    published_at: "2025-12-15T02:00:00.000Z",
    content_hash: "b".repeat(64),
  },
  {
    id: "82100000-0000-4000-8000-000000000006",
    form_definition_id: definitions[3]!.id,
    version: 1,
    status: "draft",
    effective_from: "2026-10-01",
    effective_to: "2026-12-31",
    schema_field_count: 2,
    scoring_rule_count: 1,
    published_at: null,
    content_hash: null,
  },
];

const publications: FormPublicationSourceRow[] = [
  {
    id: "82200000-0000-4000-8000-000000000001",
    form_definition_id: definitions[0]!.id,
    form_version_id: versions[0]!.id,
    status: "approved",
    requested_at: "2025-12-19T01:00:00.000Z",
    requested_by_current_user: true,
    approved_at: "2025-12-20T03:00:00.000Z",
    approved_by_current_user: false,
  },
  {
    id: "82200000-0000-4000-8000-000000000002",
    form_definition_id: definitions[0]!.id,
    form_version_id: versions[1]!.id,
    status: "pending",
    requested_at: "2026-09-01T07:30:00.000Z",
    requested_by_current_user: false,
    approved_at: null,
    approved_by_current_user: false,
  },
  {
    id: "82200000-0000-4000-8000-000000000003",
    form_definition_id: definitions[3]!.id,
    form_version_id: versions[5]!.id,
    status: "pending",
    requested_at: "2026-09-01T08:00:00.000Z",
    requested_by_current_user: true,
    approved_at: null,
    approved_by_current_user: false,
  },
];

export function buildDemoFormGovernanceSnapshot() {
  return projectFormGovernanceSnapshot({
    definitionRows: definitions,
    versionRows: versions.map(version => ({ ...version, custom_builder_eligible: version.form_definition_id === definitions[0]!.id })),
    publicationRows: publications,
    expectedOrganizationId: organizationId,
    expectedBranchId: branchId,
    today: "2026-09-01",
    generatedAt,
    demo: true,
  });
}
