// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectorDirectory, DirectorWorkspace } from "@/lib/jubo-pending-director/contract";
import { intakeRequest } from "@/lib/client-intake/client";
import { PendingIntakeDirectorWorkspace } from "./workspace";

vi.mock("@/lib/client-intake/client", () => ({
  intakeRequest: vi.fn(), intakeErrorMessage: (cause: unknown) => String(cause),
  isDefiniteIntakeRejection: () => false,
}));
vi.mock("@/components/app/core-draft-guard", () => ({
  requestCoreDraftLeave: (action: () => void) => action(),
  useCoreDraftGuard: () => ({
    changed: vi.fn(), begin: () => true, finish: vi.fn(), hold: vi.fn(),
    unhold: vi.fn(), saved: vi.fn(), discard: (action: () => void) => action(),
  }),
}));

const clientId = "bb240000-0000-4000-8000-000000000001";
const directory: DirectorDirectory = {
  total: 1,
  clients: [{ clientId, displayName: "合成個案甲", clientCode: "SYNTHETIC-JUBO-1", sourceStatus: "服務中" }],
};
const sourceFields = [
  ["displayName", "姓名", "合成個案甲", "合成個案甲"],
  ["sex", "性別", "男性", "male"],
  ["dateOfBirth", "出生日期", "1945/01/02", "1945-01-02"],
  ["identityNumber", "身分識別碼末四碼", "••••0001", "••••0001"],
  ["registeredAddress", "戶籍地址", null, null],
  ["residentialAddress", "居住地址", null, null],
  ["cmsLevel", "CMS 等級", null, null],
  ["disability", "身障資料", null, null],
  ["primaryContactName", "主要聯絡人", null, null],
  ["primaryContactPhone", "主要聯絡電話", null, null],
  ["proxyName", "代理人", null, null],
  ["proxyPhone", "代理人電話", null, null],
] as const;
const workspace: DirectorWorkspace = {
  clientId, clientCode: "SYNTHETIC-JUBO-1", displayName: "合成個案甲",
  status: "pending", sourceSystem: "jubo", sourceStatus: "服務中", sourceFirstServiceOn: null,
  profileVersion: 1,
  humanReview: { decision: "approved", version: 1, reviewedAt: "2026-10-09T00:00:00Z" },
  normalizationFieldIndices: { nfkc: [], contactSeparator: [] },
  fields: sourceFields.map(([key, label, original, display]) => ({ key, label, original, display })),
  localSupplement: null, assessmentPreparations: [], formalRecord: false, formalOperationsAllowed: false,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("branch director pending JUBO intake workspace", () => {
  it("shows source and mapped values with human review, masks identity and never offers formal actions", () => {
    render(<PendingIntakeDirectorWorkspace branchName="合成萬華" initialDirectory={directory}
      initialWorkspace={workspace} initialError={false} today="2026-10-09" />);
    expect(screen.getByRole("heading", { name: "待收案核對" })).toBeInTheDocument();
    expect(screen.getByText("1945/01/02")).toBeVisible();
    expect(screen.getByText("1945-01-02")).toBeVisible();
    expect(screen.getByText("來源映射已人工覆核")).toBeVisible();
    expect(screen.queryByText("SYNTH0001")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /簽署|申報|正式收案|執行給藥/u })).not.toBeInTheDocument();
    expect(screen.getByText(/不得出勤、給藥、排車、簽署或申報/u)).toBeVisible();
  });

  it("saves only an append-only local supplement then keeps the separate assessment draft", async () => {
    const request = vi.mocked(intakeRequest);
    const response: DirectorWorkspace = {
      ...workspace,
      localSupplement: { revision: 1, payload: {
        contactPreference: "unknown", visitPlanningNote: "合成到站討論", followUpNote: "",
      } },
    };
    request.mockResolvedValueOnce({ receipt: {
      draftId: "bb280000-0000-4000-8000-000000000001", revision: 1,
      kind: "local_supplement", formKey: "intake_local", replayed: false, formalRecord: false,
    }, workspace: response });
    vi.stubGlobal("crypto", { randomUUID: () => "bb290000-0000-4000-8000-000000000001" });
    render(<PendingIntakeDirectorWorkspace branchName="合成萬華" initialDirectory={directory}
      initialWorkspace={workspace} initialError={false} today="2026-10-09" />);
    fireEvent.change(screen.getByLabelText("到站規劃"), { target: { value: " 合成到站討論 " } });
    fireEvent.change(screen.getByLabelText("觀察與待確認內容"), { target: { value: "另一張尚未保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存補件草稿" }));
    await screen.findByText("草稿已保存，未簽署、未計分。");
    expect(screen.getByLabelText("觀察與待確認內容")).toHaveValue("另一張尚未保存");
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/jubo-pending-director");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ clientId, kind: "local_supplement", formKey: "intake_local",
      expectedRevision: 0, payload: { visitPlanningNote: "合成到站討論" } });
    expect(sent.payload).not.toHaveProperty("score");
    expect(sent.payload).not.toHaveProperty("admittedOn");
  });

  it("keeps a fixed unknown-operation key for retry instead of creating a second write", async () => {
    const request = vi.mocked(intakeRequest).mockRejectedValue(new Error("合成連線中斷"));
    vi.stubGlobal("crypto", { randomUUID: () => "bb290000-0000-4000-8000-000000000002" });
    render(<PendingIntakeDirectorWorkspace branchName="合成萬華" initialDirectory={directory}
      initialWorkspace={workspace} initialError={false} today="2026-10-09" />);
    fireEvent.change(screen.getByLabelText("缺件與追蹤"), { target: { value: "合成待補" } });
    fireEvent.click(screen.getByRole("button", { name: "保存補件草稿" }));
    const retry = await screen.findByRole("button", { name: "重試原操作" });
    expect(screen.getByLabelText("缺件與追蹤")).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[0]?.[1]?.body).toBe(request.mock.calls[1]?.[1]?.body);
  });
});
