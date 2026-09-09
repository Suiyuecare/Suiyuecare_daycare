// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import type { IntegrationsAuditFilters, IntegrationsAuditSnapshot } from "@/lib/integrations-audit/types";

import { IntegrationsAuditWorkspace } from "./integrations-audit-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const page = staffPages.find(({ number }) => number === 83)!;
const filters: IntegrationsAuditFilters = {
  startDate: "2026-09-01", endDate: "2026-09-08", integrationKey: "all", activityState: "all",
  auditAction: "all", resourceCategory: "all", actorUserId: null, correlationId: null,
};
const actorId = "83000000-0000-4000-8000-000000000003";
const recordId = "83000000-0000-4000-8000-000000000004";
const snapshot: IntegrationsAuditSnapshot = {
  snapshotId: "83000000-0000-4000-8000-000000000005", snapshotHash: "8".repeat(64),
  organizationId: "83000000-0000-4000-8000-000000000001",
  branchId: "83000000-0000-4000-8000-000000000002",
  generatedAt: "2026-09-07T16:00:00.000Z", staleAfter: "2026-09-07T16:01:00.000Z",
  window: { startDate: filters.startDate, endDate: filters.endDate, timeZone: "Asia/Taipei" },
  filters,
  inventory: [{
    integrationKey: "central_html_import", sourcePath: "/app/staff/governance/central-html-import",
    activityState: "attention", recordTotal: 1, attentionTotal: 1, pendingTotal: 0,
    latestActivityAt: "2026-09-07T16:00:00.000Z", governanceStatus: "unconfigured",
    providerRegionStatus: "unconfigured", ownerStatus: "unconfigured", retryCommandStatus: "unconfigured",
    deactivationCommandStatus: "unconfigured", reconciliationCommandStatus: "unconfigured",
  }],
  inventoryMatchingTotal: 1,
  signals: [{ signalId: "central_html_import:83000000-0000-4000-8000-000000000004", integrationKey: "central_html_import",
    occurredAt: "2026-09-07T16:00:00.000Z", state: "failed", correlationId: recordId,
    errorCategory: null, errorCodeStatus: "redacted", sourcePath: "/app/staff/governance/central-html-import" }],
  signalMatchingTotal: 1, signalsTruncated: false,
  auditEvents: [{ auditEventId: "9007199254740993", occurredAt: "2026-09-07T16:00:00.000Z",
    action: "select", resourceCategory: "import", actorUserId: actorId,
    recordId: { kind: "uuid", value: recordId }, requestId: null, idempotencyKey: null }],
  auditMatchingTotal: 1, auditEventsTruncated: false,
  options: { integrationKeys: ["all", "central_html_import"], activityStates: ["all", "observed", "attention", "no_activity"],
    auditActions: ["all", "select"], resourceCategories: ["all", "import"] },
  bounds: { maxDateWindowDays: 90, maxSignalRows: 100, maxAuditRows: 200, maxSnapshotBytes: 1_048_576 },
  accessRequirements: { permission: "audit.view", employeeAal2Required: true,
    recentSameSessionAal2Required: true, recentMaximumAgeMinutes: 15 },
  capabilities: { integrationRegistryStatus: "unconfigured", providerRegionalComplianceStatus: "unconfigured",
    ownerAssignmentStatus: "unconfigured", retryCommandsStatus: "unconfigured", deactivationCommandsStatus: "unconfigured",
    reconciliationCommandsStatus: "unconfigured", payloadInspectionStatus: "prohibited", mutationStatus: "read_only" },
  consistencyStatus: "synthetic_demo_snapshot",
  demo: true,
};

function view(changes: Partial<Parameters<typeof IntegrationsAuditWorkspace>[0]> = {}) {
  return render(<IntegrationsAuditWorkspace page={page} filters={filters} snapshot={snapshot} hasRecentAal2 {...changes} />);
}

describe("Page83 integrations/audit read-only workspace", () => {
  afterEach(cleanup);

  it("does not display even a supplied snapshot before recent authentication", () => {
    view({ hasRecentAal2: false });
    expect(screen.getByRole("alert")).toHaveTextContent("需要重新驗證");
    expect(screen.getByRole("link", { name: "立即重新驗證" })).toHaveAttribute("href", "/mfa?audience=staff&purpose=sensitive-action");
    expect(screen.queryByText("9007199254740993")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it.each([{ loadError: true }, { snapshot: null }])("fails closed without demo fallback %j", (changes) => {
    view(changes);
    expect(screen.getByRole("alert")).toHaveTextContent("不會改用展示資料");
    expect(screen.queryByText("9007199254740993")).not.toBeInTheDocument();
  });

  it("labels observed activity separately from configured vendors and exposes no mutation controls", () => {
    view();
    expect(screen.getByRole("heading", { level: 1, name: "整合與稽核中心" })).toBeInTheDocument();
    expect(screen.getByText("尚待正式登錄與審查")).toBeInTheDocument();
    expect(screen.getByText(/展示模式：以下全部是合成紀錄/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重試失敗|停用整合|執行對帳|匯出/u })).not.toBeInTheDocument();
    expect(screen.getByText(/重試、停用及每日對帳命令尚未開放/u)).toBeInTheDocument();
  });

  it("keeps inclusive dates and exact UUID-only filters in a GET form", () => {
    view();
    const form = screen.getByRole("form", { name: "整合與稽核篩選" });
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByLabelText("起日（含當日）")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("迄日（含當日）")).toHaveValue("2026-09-08");
    expect(screen.getByLabelText("操作者 UUID")).toHaveAttribute("name", "actor");
    expect(screen.getByLabelText("相關 UUID")).toHaveAttribute("name", "correlation");
    expect(screen.getByText(/請勿輸入姓名、電話、身分證字號/u)).toBeInTheDocument();
  });

  it("retains large integer audit IDs, masks arbitrary errors and exposes identities in a native disclosure", () => {
    view();
    expect(screen.getByText("9007199254740993")).toBeInTheDocument();
    expect(screen.getByText("已遮罩；不顯示原始錯誤內容")).toBeInTheDocument();
    const summary = screen.getByText("查看去敏感識別資訊");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText(actorId)).toBeInTheDocument();
  });

  it("shows full matching totals separately from capped results and instructs narrower queries", () => {
    view({ snapshot: { ...snapshot, signalMatchingTotal: 501, signalsTruncated: true,
      auditMatchingTotal: 601, auditEventsTruncated: true } });
    expect(screen.getByText(/符合 501 筆，顯示 1 筆/u)).toBeInTheDocument();
    expect(screen.getByText(/符合 601 筆，顯示 1 筆/u)).toBeInTheDocument();
    expect(screen.getByText(/清單已達筆數上限/u)).toBeInTheDocument();
    expect(screen.getByText(/稽核清單已截斷/u)).toBeInTheDocument();
  });

  it("renders a real empty query distinctly from unconfigured capabilities", () => {
    view({ snapshot: { ...snapshot, inventory: [], inventoryMatchingTotal: 0, signals: [], signalMatchingTotal: 0,
      auditEvents: [], auditMatchingTotal: 0 } });
    expect(screen.getByRole("heading", { name: "此範圍沒有整合事件" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "此範圍沒有稽核紀錄" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "沒有符合條件的來源" })).toBeInTheDocument();
    expect(screen.getByText(/不代表正式整合全部停用/u)).toBeInTheDocument();
  });

  it("uses Taipei timestamps across the UTC day boundary", () => {
    view();
    const times = screen.getAllByText("2026/09/08 00:00:00");
    expect(times.length).toBeGreaterThanOrEqual(2);
  });

  it.each(["https://synthetic.invalid/redirect", "javascript:alert(1)", "/app/staff/governance/central-html-import?payload=test"])(
    "does not render a non-allowlisted source link: %s", (sourcePath) => {
      view({ snapshot: { ...snapshot, inventory: [{ ...snapshot.inventory[0]!, sourcePath }] } });
      expect(screen.queryByRole("link", { name: "開啟來源工作頁" })).not.toBeInTheDocument();
      expect(screen.getByText("來源工作頁未配置")).toBeInTheDocument();
    },
  );

  it("keeps a single all-option for each filter and spells out independent filter scopes", () => {
    view();
    for (const label of ["整合來源", "來源活動", "稽核動作", "稽核資源"]) {
      const select = screen.getByLabelText(label);
      expect(select.querySelectorAll('option[value="all"]')).toHaveLength(1);
    }
    expect(screen.getByText(/日期與相關 ID 同時套用到兩份清單/u)).toBeInTheDocument();
  });
});
