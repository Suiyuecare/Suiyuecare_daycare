// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoAbcdAssessmentSnapshot } from "@/lib/abcd-assessments/demo";
import { emptyAbcdAssessmentFilters } from "@/lib/abcd-assessments/query";
import type { AbcdAssessmentSnapshot } from "@/lib/abcd-assessments/types";

import { AbcdAssessmentActions, CreateAbcdAssessment } from "./abcd-assessment-actions";
import { AbcdAssessmentsWorkspace } from "./abcd-assessments-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const page = staffPages.find(({ number }) => number === 21)!;
const filters = emptyAbcdAssessmentFilters();
const demo = buildDemoAbcdAssessmentSnapshot(filters);
const formal: AbcdAssessmentSnapshot = { ...demo, demo: false };

function workspace(snapshot: AbcdAssessmentSnapshot | null, options: { loadError?: boolean;
  canManage?: boolean; recent?: boolean } = {}) {
  return render(<AbcdAssessmentsWorkspace canManage={options.canManage ?? false}
    filters={filters} hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false} page={page} snapshot={snapshot} />);
}

function fillCreate() {
  fireEvent.change(screen.getByLabelText("人工評估日期"), { target: { value: "2026-09-08" } });
  fireEvent.change(screen.getByLabelText("人工摘要（非正式題本、非診斷）"),
    { target: { value: "合成人工候選摘要" } });
  fireEvent.change(screen.getByLabelText("人工結果文字"), { target: { value: "合成人工候選結果" } });
  fireEvent.change(screen.getByLabelText("人工指定複評日"), { target: { value: "2026-12-08" } });
  fireEvent.change(screen.getByLabelText("人工依據"), { target: { value: "由人員依服務檢討日指定" } });
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
    const region = screen.getByRole("region", { name: "ABCD 候選評估統計" });
    for (const [label, value] of [["符合評估", "5"], ["A 類", "2"], ["B 類", "1"],
      ["C 類", "1"], ["D 類", "1"], ["複評日期缺值", "2"]]) {
      const node = within(region).getByText(label);
      expect(within(node.closest("article")!).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText(/正式 A／B／C／D 題本、公式、代碼與授權來源尚未配置/u)).toBeInTheDocument();
    expect(screen.getByText(/不產生分數、診斷、自動複評或照顧決策/u)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b(?:SQL|RPC|UUID|formal_rule_status|not_configured)\b/u);
  });

  it("shows A/B and year variants as distinct candidate records", () => {
    workspace(demo);
    expect(screen.getAllByText(/2026 年・A 類/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026 年・B 類/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2025 年・A 類/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/人工、非標準化候選紀錄/u).length).toBeGreaterThan(0);
  });

  it("exposes signer time purpose role and reauthentication evidence in history", () => {
    const { container } = workspace(demo);
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

  it("keeps an exact key after unknown outcome and rotates it only after content editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateAbcdAssessment canManage snapshot={formal} />);
    fireEvent.click(screen.getByText("新增獨立候選草稿")); fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await screen.findByText(/結果未知；請保留內容並使用相同操作鍵重試/u);
    const first = ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"]).toBe(first);
    fireEvent.input(screen.getByLabelText("人工摘要（非正式題本、非診斷）"),
      { target: { value: "編輯後的合成人工候選摘要" } });
    fireEvent.click(screen.getByRole("button", { name: "建立人工候選草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(((fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<string, string>)["idempotency-key"]).not.toBe(first);
  });

  it("fails closed without substituting demo records", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("heading", { level: 1, name: "ABCD 評估" })).toBeInTheDocument();
    expect(screen.getByText(/篩選條件無效，或正式 ABCD 候選評估快照暫時無法取得/u)).toBeInTheDocument();
    expect(screen.queryByText("日照個案甲")).not.toBeInTheDocument();
  });
});
