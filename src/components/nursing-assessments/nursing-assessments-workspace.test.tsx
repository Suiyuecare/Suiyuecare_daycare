// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
import { NursingAssessmentsWorkspace, NursingVersionDifferences } from "./nursing-assessments-workspace";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const id = "51000000-0000-4000-8000-000000000001";
const demo = buildDemoNursingAssessmentSnapshot(id, id);
const formal = { ...demo, demo: false };
const version = demo.clients[0]!.versions[0]!;
const props = { snapshot: formal, canManage: true, canSign: true, hasRecentAal2: true, actorUserId: version.recordedBy };
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("manual nursing workspace", () => {
  it("shows manual form version and synthetic read-only restrictions", () => {
    render(<NursingAssessmentsWorkspace {...props} snapshot={demo}/>);
    expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled();
    expect(screen.getByText(/manual-nursing-v1/)).toBeInTheDocument();
    expect(screen.getByText(/官方量表計分、附件、匯出、通知與離線同步：尚未設定/)).toBeInTheDocument();
  });
  it("blocks signing without recent AAL2 but permits drafts", () => {
    render(<NursingAssessmentsWorkspace {...props} hasRecentAal2={false}/>);
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "新增護理評估" })).not.toBeDisabled();
  });
  it("shows prior/current differences and explicit missing state", () => {
    const current = structuredClone(version); current.version = 2;
    current.content.domains.observations.detail = "合成觀察更新";
    render(<NursingVersionDifferences previous={version} current={current}/>);
    expect(screen.getByText("前版")).toBeInTheDocument(); expect(screen.getByText("本版")).toBeInTheDocument();
    expect(screen.getByText(/合成觀察更新/)).toBeInTheDocument();
  });
  it("does not refresh on ambiguous success and retries exact request/key", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ status: "ok", data: {} }) });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).toBe(fetch.mock.calls[1]![1].headers["idempotency-key"]);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("never displays demo fallback when real load fails", () => {
    render(<NursingAssessmentsWorkspace {...props} snapshot={null} loadError/>);
    expect(screen.getByRole("alert")).toHaveTextContent("護理評估暫時無法載入");
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument();
  });
  it("does not silently rebase an open draft editor onto a refreshed snapshot", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NursingAssessmentsWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button", { name: "修訂最新草稿" }));
    rerender(<NursingAssessmentsWorkspace {...props} snapshot={{ ...formal,
      generatedAt: new Date(Date.parse(formal.generatedAt) + 1000).toISOString() }}/>);
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("畫面版本已更新");
    expect(fetch).not.toHaveBeenCalled();
  });
});
