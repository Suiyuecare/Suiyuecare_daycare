// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoAbcdAssessmentSnapshot } from "@/lib/abcd-assessments/demo";
import { emptyAbcdAssessmentFilters } from "@/lib/abcd-assessments/query";
import type { AbcdAssessmentFilters, AbcdAssessmentSnapshot } from "@/lib/abcd-assessments/types";

import { AbcdAssessmentActions, CreateAbcdAssessment } from "./abcd-assessment-actions";
import { AbcdAssessmentsWorkspace } from "./abcd-assessments-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const page = staffPages.find(({ number }) => number === 21)!;
const filters = emptyAbcdAssessmentFilters();
const demo = buildDemoAbcdAssessmentSnapshot(filters);
const formal: AbcdAssessmentSnapshot = { ...demo, demo: false };
function recoveryRead(clientId: string | null = null) {
  return Response.json({ status: "ok", requestId: "21090000-0000-4000-8000-000000000001",
    errors: [], data: { organizationId: formal.organizationId, branchId: formal.branchId,
      clientId, generatedAt: "2026-09-28T04:01:00Z", absenceIsFinal: false,
      truncated: false, pendingTruncated: false, operations: [] } });
}

function workspace(snapshot: AbcdAssessmentSnapshot | null, options: { loadError?: boolean;
  canManage?: boolean; recent?: boolean; filters?: AbcdAssessmentFilters } = {}) {
  return render(<AbcdAssessmentsWorkspace canManage={options.canManage ?? false}
    filters={options.filters ?? filters} hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false} page={page} snapshot={snapshot} />);
}

function fillCreate(scope: HTMLElement = document.body) {
  const fields = within(scope);
  fireEvent.change(fields.getByLabelText("人工評估日期"), { target: { value: "2026-09-08" } });
  fireEvent.change(fields.getByLabelText("人工摘要（非正式題本、非診斷）"),
    { target: { value: "合成人工候選摘要" } });
  fireEvent.change(fields.getByLabelText("人工結果文字"), { target: { value: "合成人工候選結果" } });
  fireEvent.change(fields.getByLabelText("人工指定複評日"), { target: { value: "2026-12-08" } });
  fireEvent.change(fields.getByLabelText("人工依據"), { target: { value: "由人員依服務檢討日指定" } });
}

function renderExisting(operation: "revise" | "sign" | "correct") {
  const assessment = formal.assessments.find((item) => item.assessmentState ===
    (operation === "correct" ? "signed" : "draft"))!;
  const props = { assessment, branchId: formal.branchId, canManage: true,
    hasRecentAal2: true, organizationId: formal.organizationId };
  const view = render(<AbcdAssessmentActions {...props} />);
  fireEvent.click(screen.getByText("候選紀錄操作"));
  if (operation === "sign") fireEvent.change(screen.getByLabelText("操作"), { target: { value: "sign" } });
  else fireEvent.change(screen.getByLabelText(/修訂理由|更正理由/u),
    { target: { value: "人工檢查後修正候選內容" } });
  return { assessment, props, view };
}

describe("Page 21 ABCD candidate workspace", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 30;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `21300000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("freezes dedicated permissions, type-year separation and online-only boundary", () => {
    expect(page.requiredPermissions).toEqual(["clients.read", "abcd_assessments.read"]);
    expect(page.acceptance.join(" ")).toMatch(/年度.*A／B／C／D.*不得互相覆寫/u);
    expect(page.acceptance.join(" ")).toMatch(/不得建立分數、診斷、自動複評或照顧決策/u);
    expect(page.acceptance.join(" ")).toMatch(/最近 15 分鐘 AAL2/u);
    expect(page.offline.mode).toBe("online-only");
  });

  it("renders complete-set metrics and honest unconfigured boundaries without engineering language", () => {
    const { container } = workspace(demo);
    expect(screen.getByRole("heading", { level: 1, name: "ABCD 評估" })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/完整統計（/u));
    const region = screen.getByRole("region", { name: "ABCD 候選評估統計" });
    for (const [label, value] of [["符合評估", "5"], ["A 類", "2"], ["B 類", "1"],
      ["C 類", "1"], ["D 類", "1"], ["複評日期缺值", "2"]]) {
      const node = within(region).getByText(label);
      expect(within(node.closest("article")!).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText(/正式 A／B／C／D 題本、公式、代碼與授權來源尚未配置/u)).toBeInTheDocument();
    expect(screen.getByText(/不是正式 ABCD 量表；沒有正式分數、診斷、自動複評或照顧決策/u)).toBeVisible();
    expect(container.textContent).not.toMatch(/\b(?:SQL|RPC|UUID|formal_rule_status|not_configured)\b/u);
  });

  it("shows the client task first and collapses secondary guidance, filters, record detail and metrics", () => {
    const { container } = workspace(demo);
    expect(screen.getByRole("heading", { name: "先選個案" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "評估個案" })).toHaveValue("");
    expect(screen.getByText(/不是正式 ABCD 量表；沒有正式分數/u)).toBeVisible();
    for (const label of ["查看尚未開通的正式功能", "更多篩選", "完整統計（5 筆）"]) {
      const disclosure = screen.getByText(label).closest("details");
      expect(disclosure).not.toHaveAttribute("open");
    }
    expect(container.querySelectorAll("details[class*='manualDisclosure']")).toHaveLength(demo.assessments.length);
    expect(container.querySelectorAll("details[class*='manualDisclosure'][open]")).toHaveLength(0);
    const filter = screen.getByRole("heading", { name: "先選個案" }).closest("section")!.querySelector("form")!;
    expect(filter).toHaveAttribute("method", "get");
    expect(filter).toHaveAttribute("action", "/app/staff/assessments/abcd");
    expect([...new FormData(filter).keys()]).toEqual(["client", "year", "type", "reassessment", "status", "q"]);
  });

  it("keeps active advanced filters visible and identifies the selected client", () => {
    const selected = { ...filters, clientId: demo.clients[0]!.clientId, assessmentType: "B" as const,
      assessmentYear: 2026, reassessmentState: "missing" as const, status: "draft" as const,
      query: "甲" };
    const view = buildDemoAbcdAssessmentSnapshot(selected);
    workspace(view, { filters: selected });
    expect(screen.getByRole("heading", { name: `${demo.clients[0]!.displayName}的評估` })).toBeInTheDocument();
    const advanced = screen.getByText("更多篩選（已套用）").closest("details")!;
    expect(advanced).toHaveAttribute("open");
    const form = advanced.closest("form")!;
    expect(Object.fromEntries(new FormData(form))).toEqual({ client: selected.clientId, year: "2026",
      type: "B", reassessment: "missing", status: "draft", q: "甲" });
  });

  it("shows A/B and year variants as distinct candidate records", () => {
    workspace(demo);
    expect(screen.getAllByText(/2026 年・A 類/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026 年・B 類/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2025 年・A 類/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/人工、非標準化候選紀錄/u).length).toBeGreaterThan(0);
  });

  it("mounts exactly one operation form per record across desktop and mobile widths", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => url.startsWith("/api/abcd-assessments/recovery") ?
      Promise.resolve(recoveryRead()) : Promise.reject(new TypeError("network failed")));
    vi.stubGlobal("fetch", fetchMock);
    const mutationCalls = () => fetchMock.mock.calls.filter(([url, init]) =>
      url === "/api/abcd-assessments" && (init as RequestInit | undefined)?.method === "POST");
    const view = workspace(formal, { canManage: true, recent: true });
    expect(screen.getAllByText("候選紀錄操作")).toHaveLength(formal.assessments.length);
    const draftIndex = formal.assessments.findIndex((assessment) => assessment.assessmentState === "draft");
    const action = screen.getAllByText("候選紀錄操作")[draftIndex]!.closest("details")!;
    fireEvent.click(within(action).getByText("候選紀錄操作"));
    await waitFor(() => expect(within(action).getByRole("button", { name: "鎖定版本並送出" })).toBeEnabled());
    fireEvent.change(within(action).getByLabelText("修訂理由"),
      { target: { value: "人工檢查後修正候選內容" } });
    fireEvent.click(within(action).getByRole("button", { name: "鎖定版本並送出" }));
    await within(action).findByText(/操作結果尚未確認；原內容已鎖定/u);
    const firstInit = mutationCalls()[0]![1] as RequestInit;
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      fireEvent(window, new Event("resize"));
      view.rerender(<AbcdAssessmentsWorkspace canManage filters={filters} hasRecentAal2
        loadError={false} page={page} snapshot={formal} />);
      expect(screen.getAllByText("候選紀錄操作")).toHaveLength(formal.assessments.length);
      expect(within(action).getByRole("button", { name: "操作待確認" })).toBeDisabled();
      fireEvent.click(within(action).getByRole("button", { name: "以相同內容重試" }));
      await waitFor(() => expect(mutationCalls()).toHaveLength(2));
      const secondInit = mutationCalls()[1]![1] as RequestInit;
      expect(secondInit.body).toBe(firstInit.body);
      expect((secondInit.headers as Record<string, string>)["idempotency-key"])
        .toBe((firstInit.headers as Record<string, string>)["idempotency-key"]);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("exposes signer time purpose role and reauthentication evidence in history", () => {
    const { container } = workspace(demo);
    fireEvent.click(screen.getAllByText("查看人工內容與版本")[0]!);
    const summary = [...container.querySelectorAll("summary")]
      .find((node) => node.textContent?.includes("版本與簽署證據")) as HTMLElement;
    fireEvent.click(summary);
    expect((summary.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getAllByText(/簽署人：合成簽署員（professional）/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/目的：ABCD 人工候選評估簽署/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/重驗證證據：/u).length).toBeGreaterThan(0);
  });

  it("makes sign confirmation explicit and blocks stale AAL2", () => {
    const draft = formal.assessments.find((item) => item.assessmentState === "draft")!;
    render(<AbcdAssessmentActions assessment={draft} branchId={formal.branchId} canManage
      hasRecentAal2={false} organizationId={formal.organizationId} />);
    fireEvent.click(screen.getByText("候選紀錄操作"));
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "sign" } });
    expect(screen.getByText(/我確認這是人工、非標準化候選紀錄/u)).toBeInTheDocument();
    expect(screen.getByText(/最近 15 分鐘 AAL2/u)).toBeInTheDocument();
    expect((screen.getByRole("button", { name: "鎖定版本並送出" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preserves edited fields but blocks an old draft after a background version refresh", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { assessment, props, view } = renderExisting("revise");
    const summary = screen.getByLabelText("人工摘要（非正式題本、非診斷）");
    fireEvent.change(summary, { target: { value: "尚未送出的舊版人工摘要" } });
    view.rerender(<AbcdAssessmentActions {...props} assessment={{ ...assessment,
      versionId: "21990000-0000-4000-8000-000000000097", version: assessment.version + 1,
      contentHash: "b".repeat(64), manualSummary: "背景更新後的新版人工摘要" }} />);
    expect(screen.getByLabelText("人工摘要（非正式題本、非診斷）"))
      .toHaveValue("尚未送出的舊版人工摘要");
    expect(screen.getByText(/原表單內容已保留但不能直接送出/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "鎖定版本並送出" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins the viewed version when an action is opened before any field is edited", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const assessment = formal.assessments.find((item) => item.assessmentState === "draft")!;
    const props = { assessment, branchId: formal.branchId, canManage: true,
      hasRecentAal2: true, organizationId: formal.organizationId };
    const view = render(<AbcdAssessmentActions {...props} />);
    fireEvent.click(screen.getByText("候選紀錄操作"));
    const oldSummary = screen.getByLabelText("人工摘要（非正式題本、非診斷）");
    expect(oldSummary).toHaveValue(assessment.manualSummary);
    view.rerender(<AbcdAssessmentActions {...props} assessment={{ ...assessment,
      versionId: "21990000-0000-4000-8000-000000000097", version: assessment.version + 1,
      contentHash: "b".repeat(64), manualSummary: "背景更新後的新版人工摘要" }} />);
    expect(screen.getByLabelText("人工摘要（非正式題本、非診斷）"))
      .toHaveValue(assessment.manualSummary);
    expect(screen.getByText(/原表單內容已保留但不能直接送出/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "鎖定版本並送出" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rebases untouched fields to a new version before the first submit", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    const assessment = formal.assessments.find((item) => item.assessmentState === "draft")!;
    const props = { assessment, branchId: formal.branchId, canManage: true,
      hasRecentAal2: true, organizationId: formal.organizationId };
    const view = render(<AbcdAssessmentActions {...props} />);
    const latest = { ...assessment, versionId: "21990000-0000-4000-8000-000000000097",
      version: assessment.version + 1, contentHash: "b".repeat(64),
      manualSummary: "背景更新後的新版人工摘要" };
    view.rerender(<AbcdAssessmentActions {...props} assessment={latest} />);
    await waitFor(() => expect(screen.getByLabelText("人工摘要（非正式題本、非診斷）"))
      .toHaveValue(latest.manualSummary));
    fireEvent.click(screen.getByText("候選紀錄操作"));
    fireEvent.change(screen.getByLabelText("修訂理由"),
      { target: { value: "核對新版後修訂人工摘要" } });
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.previous_version_id).toBe(latest.versionId);
    expect(body.expected_version).toBe(latest.version);
    expect(body.expected_content_hash).toBe(latest.contentHash);
    expect(body.manual_summary).toBe(latest.manualSummary);
  });

  it.each(["revise", "sign", "correct"] as const)(
    "freezes an unknown %s result and retries the exact version, body and key", async (operation) => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
      vi.stubGlobal("fetch", fetchMock);
      renderExisting(operation);
      fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
      await screen.findByText(/操作結果尚未確認；原內容已鎖定/u);
      const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(screen.getByRole("button", { name: "操作待確認" })).toBeDisabled();
      expect(screen.getByLabelText("操作")).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
      expect(secondInit.body).toBe(firstInit.body);
      expect((secondInit.headers as Record<string, string>)["idempotency-key"])
        .toBe((firstInit.headers as Record<string, string>)["idempotency-key"]);
      expect((secondInit.headers as Record<string, string>)["x-abcd-assessment-operation"]).toBe(operation);
    },
  );

  it.each(["revise", "correct"] as const)("focuses the invalid %s reason without a POST", (operation) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderExisting(operation);
    const reason = screen.getByLabelText(/修訂理由|更正理由/u);
    fireEvent.change(reason, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reason).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/請完成「.*理由/u);
  });

  it("keeps an unknown sign locked even when a later exact retry receives a 403", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network failed"))
      .mockImplementation(async () => Response.json({
        requestId: "21990000-0000-4000-8000-000000000001", status: "error", data: null,
        errors: [{ code: "AAL2_REQUIRED", message: "請重新驗證。" }],
      }, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    renderExisting("sign");
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await screen.findByText(/操作結果尚未確認；原內容已鎖定/u);
    const firstKey = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "操作待確認" })).toBeDisabled();
    expect(((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"])
      .toBe(firstKey);
  });

  it("blocks same-tab navigation and unload while an ABCD result is unknown", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    renderExisting("sign");
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await screen.findByText(/操作結果尚未確認；原內容已鎖定/u);
    const link = document.createElement("a");
    link.href = "/app/clients";
    link.textContent = "前往其他頁";
    document.body.appendChild(link);
    try {
      expect(fireEvent.click(link)).toBe(false);
      expect(screen.getByRole("button", { name: "操作待確認" })).toBeDisabled();
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    } finally { link.remove(); }
  });

  it.each([
    ["version conflict", 409, { requestId: "21990000-0000-4000-8000-000000000001",
      status: "error", data: null, errors: [{ code: "ABCD_ASSESSMENT_VERSION_CONFLICT", message: "版本已變更。" }] }],
    ["server failure", 503, { requestId: "21990000-0000-4000-8000-000000000001",
      status: "error", data: null, errors: [{ code: "SERVICE_NOT_CONFIGURED", message: "服務暫停。" }] }],
    ["malformed rejection", 400, { status: "error", data: null,
      errors: [{ code: "INVALID_ABCD_ASSESSMENT_OPERATION", message: "欄位錯誤。" }] }],
  ])("keeps an ambiguous %s response frozen", async (_label, status, body) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    renderExisting("sign");
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await screen.findByText(/操作結果尚未確認；原內容已鎖定/u);
    expect(screen.getByRole("button", { name: "操作待確認" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([[400, "INVALID_ABCD_ASSESSMENT_OPERATION"], [401, "AUTH_REQUIRED"],
    [403, "AAL2_REQUIRED"]] as const)("unlocks a first definitive %i %s rejection but never reuses its key", async (status, code) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({
      requestId: "21990000-0000-4000-8000-000000000001", status: "error", data: null,
      errors: [{ code, message: "請確認資料。" }],
    }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    renderExisting("sign");
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await screen.findByText(/本次未寫入，請確認後再試/u);
    expect(screen.getByRole("button", { name: "鎖定版本並送出" })).toBeEnabled();
    const firstKey = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"])
      .not.toBe(firstKey);
  });

  it("disables an unknown sign retry when branch, version or AAL2 context changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { assessment, props, view } = renderExisting("sign");
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await screen.findByText(/操作結果尚未確認；原內容已鎖定/u);
    const retry = () => screen.getByRole("button", { name: "以相同內容重試" });
    view.rerender(<AbcdAssessmentActions {...props} branchId="21990000-0000-4000-8000-000000000099" />);
    expect(retry()).toBeDisabled();
    view.rerender(<AbcdAssessmentActions {...props} assessment={{ ...assessment, version: assessment.version + 1 }} />);
    expect(retry()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "重新載入最新版本" })).not.toBeInTheDocument();
    expect(screen.getByText(/原操作結果尚未確認，請先由主管核對原筆/u)).toBeVisible();
    view.rerender(<AbcdAssessmentActions {...props} assessment={{ ...assessment,
      clientId: "21990000-0000-4000-8000-000000000098" }} />);
    expect(retry()).toBeDisabled();
    view.rerender(<AbcdAssessmentActions {...props} hasRecentAal2={false} />);
    expect(retry()).toBeDisabled();
    fireEvent.click(retry());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.rerender(<AbcdAssessmentActions {...props} canManage={false} />);
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/原操作結果尚未確認.*權限已變更/u);
    expect(screen.getByRole("alert")).toHaveTextContent(/頁首登出/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not resubmit a correlated successful sign", async () => {
    const { assessment } = renderExisting("sign");
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      return Response.json({ requestId: "21990000-0000-4000-8000-000000000001", status: "ok", errors: [],
        data: { organizationId: formal.organizationId, branchId: formal.branchId,
          clientId: assessment.clientId, operationId: "21990000-0000-4000-8000-000000000002",
          idempotencyKey: (init.headers as Record<string, string>)["idempotency-key"],
          action: "sign_assessment", assessmentKey: assessment.assessmentKey,
          versionId: "21990000-0000-4000-8000-000000000004", version: assessment.version + 1,
          assessmentState: "signed", assessmentType: assessment.assessmentType,
          assessmentYear: assessment.assessmentYear, previousVersionId: assessment.versionId,
          sourceContentHash: assessment.contentHash, contentHash: "a".repeat(64),
          recordPayload: { clientId: assessment.clientId, assessmentType: assessment.assessmentType,
            assessmentYear: assessment.assessmentYear, assessmentDate: assessment.assessmentDate,
            manualSummary: assessment.manualSummary, result: assessment.result,
            reassessment: assessment.reassessment, formKind: "manual_unstandardized",
            formalRuleStatus: "not_configured" },
          committedAt: "2026-09-08T01:01:00Z", replayed: false, persisted: true, demo: false },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    await screen.findByText(/人工候選評估已簽署/u);
    expect(screen.getByRole("button", { name: "鎖定版本並送出" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("freezes an unknown create and retries only its original client, body and key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CreateAbcdAssessment canManage snapshot={formal} />);
    fireEvent.click(screen.getByText("新增獨立候選草稿"));
    fireEvent.change(screen.getByRole("combobox", { name: "個案" }), { target: { value: formal.clients[0]!.clientId } });
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await screen.findByText(/保存結果尚未確認；原內容已鎖定/u);
    const first = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
    const firstBody = (fetchMock.mock.calls[0]![1] as RequestInit).body;
    expect(screen.getByLabelText("人工摘要（非正式題本、非診斷）")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "個案" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存待確認" })).toBeDisabled();
    view.rerender(<CreateAbcdAssessment canManage selectedClientId={formal.clients[1]!.clientId} snapshot={formal} />);
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(formal.clients[0]!.clientId);
    expect(screen.getByText("表單個案與目前查詢不同；請回到原個案後再保存。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"]).toBe(first);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe(firstBody);
    fireEvent.click(screen.getByRole("button", { name: "保存待確認" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([[400, "INVALID_ABCD_ASSESSMENT_OPERATION"], [403, "ABCD_ASSESSMENT_NOT_AUTHORIZED"]])(
    "keeps the original operation locked when an unknown result precedes a %i %s rejection", async (status, code) => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network failed"))
        .mockImplementation(async () => Response.json({
          requestId: "21990000-0000-4000-8000-000000000001", status: "error", data: null,
          errors: [{ code, message: "這次請求已拒絕。" }],
        }, { status }));
      vi.stubGlobal("fetch", fetchMock);
      render(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId} snapshot={formal} />);
      fillCreate();
      fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
      await screen.findByText(/保存結果尚未確認；原內容已鎖定/u);
      const firstKey = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
      fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled());
      expect(screen.getByRole("combobox", { name: "個案" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "保存待確認" })).toBeDisabled();
      expect(((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"])
        .toBe(firstKey);
    },
  );

  it("keeps a pending operation locked when its branch or authorization snapshot changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId} snapshot={formal} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await screen.findByText(/保存結果尚未確認；原內容已鎖定/u);
    view.rerender(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId}
      snapshot={{ ...formal, branchId: "21990000-0000-4000-8000-000000000099" }} />);
    expect(screen.getByRole("combobox", { name: "個案" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.rerender(<CreateAbcdAssessment canManage={false} selectedClientId={formal.clients[0]!.clientId}
      snapshot={formal} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/原筆保存結果尚未確認.*權限或個案名單已變更/u);
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    view.rerender(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId}
      snapshot={{ ...formal, clients: [] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/請通知主管核對原筆/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([[400, "INVALID_ABCD_ASSESSMENT_OPERATION"], [403, "ABCD_ASSESSMENT_NOT_AUTHORIZED"]])(
    "unlocks only a complete, definitive %i %s rejection", async (status, code) => {
      const fetchMock = vi.fn().mockImplementation(async () => Response.json({
        requestId: "21990000-0000-4000-8000-000000000001", status: "error", data: null,
        errors: [{ code, message: "這次請求已拒絕。" }],
      }, { status }));
      vi.stubGlobal("fetch", fetchMock);
      render(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId} snapshot={formal} />);
      fillCreate();
      fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
      await screen.findByText(/這次請求已拒絕。 本次未建立/u);
      expect(screen.getByRole("combobox", { name: "個案" })).toBeEnabled();
      expect(screen.getByLabelText("人工摘要（非正式題本、非診斷）")).toBeEnabled();
      const firstKey = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
      fireEvent.change(screen.getByLabelText("人工摘要（非正式題本、非診斷）"),
        { target: { value: "修正後的合成人工候選摘要" } });
      fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const secondKey = ((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
      expect(secondKey).not.toBe(firstKey);
    },
  );

  it.each([
    [409, { requestId: "21990000-0000-4000-8000-000000000001", status: "error", data: null,
      errors: [{ code: "ABCD_ASSESSMENT_VERSION_CONFLICT", message: "版本已變更。" }] }],
    [400, { status: "error", data: null,
      errors: [{ code: "INVALID_ABCD_ASSESSMENT_OPERATION", message: "這次請求已拒絕。" }] }],
  ])("keeps an ambiguous %i response frozen", async (status, body) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId} snapshot={formal} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await screen.findByText(/保存結果尚未確認；原內容已鎖定/u);
    expect(screen.getByRole("combobox", { name: "個案" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled();
  });

  it("offers a fresh snapshot reload after a correlated successful create", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const key = (init.headers as Record<string, string>)["idempotency-key"];
      return Response.json({ requestId: "21990000-0000-4000-8000-000000000001", status: "ok", errors: [],
        data: { organizationId: formal.organizationId, branchId: formal.branchId,
          clientId: body.client_id, operationId: "21990000-0000-4000-8000-000000000002",
          idempotencyKey: key, action: "save_assessment",
          assessmentKey: "21990000-0000-4000-8000-000000000003",
          versionId: "21990000-0000-4000-8000-000000000004", version: 1,
          assessmentState: "draft", assessmentType: body.assessment_type,
          assessmentYear: body.assessment_year, previousVersionId: null,
          sourceContentHash: null, contentHash: "a".repeat(64),
          recordPayload: { clientId: body.client_id, assessmentType: body.assessment_type,
            assessmentYear: body.assessment_year, assessmentDate: body.assessment_date,
            manualSummary: body.manual_summary, result: body.result, reassessment: body.reassessment,
            formKind: "manual_unstandardized", formalRuleStatus: "not_configured" },
          committedAt: "2026-09-08T01:01:00Z", replayed: false, persisted: true, demo: false },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateAbcdAssessment canManage selectedClientId={formal.clients[0]!.clientId} snapshot={formal} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await screen.findByText(/候選草稿 v1 已建立/u);
    expect(screen.getByRole("button", { name: "重新載入後新增另一份" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "個案" })).toBeDisabled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("carries the authorized selected client into the create form and never posts for the first client", async () => {
    const selectedClientId = formal.clients[1]!.clientId;
    const fetchMock = vi.fn().mockImplementation((url: string) => url.startsWith("/api/abcd-assessments/recovery") ?
      Promise.resolve(recoveryRead(selectedClientId)) : Promise.reject(new TypeError("network failed")));
    vi.stubGlobal("fetch", fetchMock);
    const selectedFilters = { ...filters, clientId: selectedClientId };
    workspace(formal, { canManage: true, filters: selectedFilters });
    const create = screen.getByRole("region", { name: "新增 ABCD 人工候選評估" });
    expect(create.querySelector("details")).toHaveAttribute("open");
    expect(within(create).getByRole("combobox", { name: "個案" })).toHaveValue(selectedClientId);
    fillCreate(create);
    await waitFor(() => expect(within(create).getByRole("button", { name: "建立人工候選草稿" })).toBeEnabled());
    fireEvent.click(within(create).getByRole("button", { name: "建立人工候選草稿" }));
    const writeCalls = () => fetchMock.mock.calls.filter(([url, init]) =>
      url === "/api/abcd-assessments" && (init as RequestInit | undefined)?.method === "POST");
    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(JSON.parse((writeCalls()[0]![1] as RequestInit).body as string).client_id).toBe(selectedClientId);
  });

  it("pauses new ABCD writes when the original-operation lookup fails after a reload", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    workspace(formal, { canManage: true, recent: true,
      filters: { ...filters, clientId: formal.clients[0]!.clientId } });
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent(/原操作仍可能已保存/u);
    const create = screen.getByRole("region", { name: "新增 ABCD 人工候選評估" });
    expect(within(create).getByRole("button", { name: "建立人工候選草稿" })).toBeDisabled();
    expect(within(create).getByText(/暫停新操作/u)).toBeVisible();
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/abcd-assessments/recovery")))
      .toBe(true);
  });

  it.each([null, "21010000-0000-4000-8000-000000000099"])(
    "does not silently choose the first client for missing or unlisted selection %s", async (selectedClientId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<CreateAbcdAssessment canManage selectedClientId={selectedClientId} snapshot={formal} />);
      fireEvent.click(screen.getByText("新增獨立候選草稿"));
      const picker = screen.getByRole("combobox", { name: "個案" });
      expect(picker).toHaveValue("");
      fillCreate();
      fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(picker).toHaveFocus();
      expect(picker).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(selectedClientId
        ? "目前可選名單未包含此個案" : "請先選擇目前可處理的個案");
    },
  );

  it.each([
    ["another listed client", formal.clients[1]!.clientId],
    ["a client absent from the authorized options", "21010000-0000-4000-8000-000000000099"],
  ])("blocks an edited form after the route changes to %s", async (_caseName, selectedClientId) => {
    const first = formal.clients[0]!.clientId;
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CreateAbcdAssessment canManage selectedClientId={first} snapshot={formal} />);
    fillCreate();
    view.rerender(<CreateAbcdAssessment canManage selectedClientId={selectedClientId} snapshot={formal} />);
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(first);
    expect(screen.getByText("表單個案與目前查詢不同；請回到原個案後再保存。")).toBeVisible();
    if (selectedClientId !== formal.clients[1]!.clientId) {
      expect(screen.getByText("目前可選名單未包含此個案，不能保存這份表單。")).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(selectedClientId === formal.clients[1]!.clientId
      ? "填寫途中查詢個案已改變；請回到原個案查詢後再保存。"
      : "目前可選名單未包含此個案；請重新開啟表單或聯絡管理員。")).toBeVisible();
    expect(screen.getByRole("combobox", { name: /^個案/ })).toHaveFocus();
    view.rerender(<CreateAbcdAssessment canManage selectedClientId={first} snapshot={formal} />);
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).client_id).toBe(first);
  });

  it("fails closed without substituting demo records", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("heading", { level: 1, name: "ABCD 評估" })).toBeInTheDocument();
    expect(screen.getByText(/篩選條件無效，或正式 ABCD 候選評估快照暫時無法取得/u)).toBeInTheDocument();
    expect(screen.queryByText("日照個案甲")).not.toBeInTheDocument();
  });
});
