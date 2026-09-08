import { describe, expect, it } from "vitest";

import { buildDemoProfessionalServiceSummary } from "./demo";
import {
  projectProfessionalServiceSummary,
  type ProfessionalServiceSummarySourceRow,
} from "./projection";
import {
  parseProfessionalServiceSummaryQuery,
  professionalServiceSummaryHref,
} from "./query";
import { professionalServiceSummaryCsv } from "./csv";

const organizationId = "42100000-0000-4000-8000-000000000091";
const branchId = "42100000-0000-4000-8000-000000000092";
const clientId = "42100000-0000-4000-8000-000000000093";
const sourceId = "42100000-0000-4000-8000-000000000094";
const sourceKey = "42100000-0000-4000-8000-000000000095";
const configs = [
  ["occupational_therapy_assessment", 33, "configured", "manual_due_date_only"],
  ["physical_therapy_assessment", 34, "configured", "manual_due_date_only"],
  ["chewing_assessment", 35, "candidate_only", "not_configured"],
  ["mna_assessment", 36, "license_required_not_configured", "not_configured"],
  ["consultation", 37, "configured", "manual_deadline_or_explicit_missing_state"],
  ["case_conference", 38, "configured", "action_deadline_only"],
  ["referral", 39, "configured", "due_rule_not_configured"],
  ["physical_therapy_service", 40, "configured",
    "existing_records_only_frequency_not_configured"],
  ["occupational_therapy_service", 41, "configured",
    "existing_records_only_frequency_not_configured"],
] as const;

function validRow(): ProfessionalServiceSummarySourceRow {
  return {
    snapshot_id: "42100000-0000-4000-8000-000000000096",
    snapshot_hash: "a".repeat(64),
    expires_at: "2026-09-07T08:15:00.000Z",
    payload: {
      organization_id: organizationId,
      branch_id: branchId,
      generated_at: "2026-09-07T08:00:00.000Z",
      month: "2026-09",
      month_start: "2026-09-01",
      month_end: "2026-09-30",
      cutoff_on: "2026-09-07",
      items: [{
        item_id: `physical_therapy_assessment:${sourceKey}`,
        source_kind: "physical_therapy_assessment",
        professional_kind: "physical_therapy",
        professional_label: "物理治療",
        source_page: 34,
        source_page_title: "物理治療評估",
        source_href: `/app/staff/professional-care/physical-assessment?client=${clientId}`,
        client_id: clientId,
        client_display_name: "合成個案甲",
        service_status: "active",
        source_record_id: sourceId,
        source_record_key: sourceKey,
        source_version: 2,
        raw_status: "signed",
        summary_status: "completed",
        expectation_status: "configured_manual_due_date",
        expected_count: 1,
        completed_count: 1,
        pending_count: 0,
        overdue_count: 0,
        service_count: 0,
        latest_on: "2026-09-03",
        next_due_on: "2026-09-30",
        status_reason: "最近評估已簽署；複評日期為人工設定",
        source_hash: "b".repeat(64),
      }],
      item_count: 1,
      item_total: 1,
      items_truncated: false,
      metrics: {
        expected: 1, completed: 1, pending: 0, overdue: 0,
        service_records: 0, not_configured_items: 0,
      },
      client_options: [{
        client_id: clientId,
        display_name: "合成個案甲",
        service_status: "active",
      }],
      client_total: 1,
      client_options_truncated: false,
      source_configuration: configs.map((value) => ({
        source_kind: value[0], source_page: value[1],
        data_status: value[2], expectation_status: value[3],
      })),
      source_configuration_count: 9,
      configured_source_count: 7,
      not_configured_source_count: 2,
      expectation_coverage_status: "partial_authoritative_rows_only",
      missing_schedule_claim: "not_made",
      export_status: "immutable_snapshot_available",
      offline_status: "not_configured",
    },
  };
}

describe("Page 42 query contract", () => {
  it("accepts an exact month, assigned client, professional and status", () => {
    const result = parseProfessionalServiceSummaryQuery({
      month: "2026-09",
      client: clientId.toUpperCase(),
      professional: "physical_therapy",
      status: "completed",
    });
    expect(result.invalid).toBe(false);
    expect(result.filters).toEqual({
      month: "2026-09",
      clientId,
      professionalKind: "physical_therapy",
      status: "completed",
    });
  });

  it.each([
    { month: "2026-13" },
    { client: "not-a-client" },
    { professional: "doctor" },
    { status: "green" },
    { month: ["2026-09", "2026-10"] },
    { unknown: "value" },
  ])("fails closed on malformed or ambiguous query %#", (query) => {
    expect(parseProfessionalServiceSummaryQuery(query).invalid).toBe(true);
  });

  it("creates a canonical filter link without empty values", () => {
    expect(professionalServiceSummaryHref({
      month: "2026-09", clientId: null,
      professionalKind: "all", status: "pending",
    })).toBe("?month=2026-09&status=pending");
  });
});

describe("Page 42 strict projection", () => {
  it("projects the scoped source and preserves count evidence", () => {
    const snapshot = projectProfessionalServiceSummary({
      row: validRow(), expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false,
    });
    expect(snapshot.metrics).toEqual({
      expected: 1, completed: 1, pending: 0, overdue: 0,
      serviceRecords: 0, notConfiguredItems: 0,
    });
    expect(snapshot.items[0]).toMatchObject({
      sourcePage: 34, summaryStatus: "completed", completedCount: 1,
    });
    expect(snapshot.sourceConfiguration).toHaveLength(9);
  });

  it.each([
    ["tenant", (row: ProfessionalServiceSummarySourceRow) => {
      row.payload.organization_id = clientId;
    }],
    ["source page", (row: ProfessionalServiceSummarySourceRow) => {
      row.payload.items[0]!.source_page = 35;
    }],
    ["counter sum", (row: ProfessionalServiceSummarySourceRow) => {
      row.payload.items[0]!.pending_count = 1;
    }],
    ["status evidence", (row: ProfessionalServiceSummarySourceRow) => {
      row.payload.items[0]!.summary_status = "overdue";
    }],
    ["source URL", (row: ProfessionalServiceSummarySourceRow) => {
      row.payload.items[0]!.source_href =
        `/app/staff/professional-care/referrals?client=${clientId}`;
    }],
    ["visible metric", (row: ProfessionalServiceSummarySourceRow) => {
      row.payload.metrics.completed = 2;
      row.payload.metrics.expected = 2;
    }],
  ])("rejects forged %s", (_name, mutate) => {
    const row = validRow();
    mutate(row);
    expect(() => projectProfessionalServiceSummary({
      row, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_PROFESSIONAL_SERVICE_SUMMARY_PROJECTION");
  });

  it("allows full metrics to exceed the bounded visible list only when truncated", () => {
    const row = validRow();
    row.payload.item_total = 2;
    row.payload.items_truncated = true;
    row.payload.metrics.expected = 2;
    row.payload.metrics.completed = 2;
    expect(projectProfessionalServiceSummary({
      row, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false,
    }).matchingTotal).toBe(2);
  });
});

describe("Page 42 demo and CSV", () => {
  it("keeps explicit text statuses and honest governance gaps", () => {
    const snapshot = buildDemoProfessionalServiceSummary({
      month: "2026-09", clientId: null, professionalKind: "all", status: "all",
    });
    expect(snapshot.items.map((value) => value.summaryStatus)).toEqual(
      expect.arrayContaining(["completed", "pending", "overdue", "not_configured"]),
    );
    expect(snapshot.sourceConfiguration).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePage: 35, dataStatus: "candidate_only",
        expectationStatus: "not_configured",
      }),
      expect.objectContaining({
        sourcePage: 36, dataStatus: "license_required_not_configured",
      }),
    ]));
    expect(snapshot.metrics.expected).toBe(
      snapshot.metrics.completed + snapshot.metrics.pending +
      snapshot.metrics.overdue,
    );
    expect(buildDemoProfessionalServiceSummary({
      month: "2026-09", clientId: null,
      professionalKind: "all", status: "all",
    })).toMatchObject({
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      generatedAt: snapshot.generatedAt,
      expiresAt: snapshot.expiresAt,
    });
  });

  it("filters demo items using the same domain values", () => {
    const snapshot = buildDemoProfessionalServiceSummary({
      month: "2026-09", clientId: null,
      professionalKind: "physical_therapy", status: "completed",
    });
    const unfiltered = buildDemoProfessionalServiceSummary({
      month: "2026-09", clientId: null,
      professionalKind: "all", status: "all",
    });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items.every((value) =>
      value.professionalKind === "physical_therapy" &&
      value.summaryStatus === "completed")).toBe(true);
    expect(snapshot.items[0]?.itemId).toBe(unfiltered.items.find((value) =>
      value.sourceKind === "physical_therapy_service")?.itemId);
    expect(snapshot.snapshotId).not.toBe(unfiltered.snapshotId);
  });

  it("exports the same identity, metrics and detail with CSV escaping", () => {
    const snapshot = buildDemoProfessionalServiceSummary({
      month: "2026-09", clientId: null,
      professionalKind: "all", status: "all",
    });
    const csv = professionalServiceSummaryCsv({
      ...snapshot,
      items: [{ ...snapshot.items[0]!, clientDisplayName: '合成,個案"甲' }],
      matchingTotal: 1,
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(snapshot.snapshotId);
    expect(csv).toContain(snapshot.snapshotHash);
    expect(csv).toContain(`"合成,個案""甲"`);
    expect(csv).toContain(`應完成,${snapshot.metrics.expected}`);
    expect(csv).toContain("顯示／匯出明細,1");
    expect(csv).toContain("明細是否截斷,否");
    expect(csv).toContain(",已完成,");
    expect(csv).not.toContain(",completed,");
    expect(professionalServiceSummaryCsv({
      ...snapshot,
      items: [{ ...snapshot.items[0]!, clientDisplayName: "=2+3" }],
      matchingTotal: 1,
    })).toContain("'=2+3");
  });
});
