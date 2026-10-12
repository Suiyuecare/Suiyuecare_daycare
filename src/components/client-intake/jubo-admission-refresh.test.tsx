// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
import { JuboAdmissionPreparation } from "./jubo-admission-preparation";
import { admissionPreparationWorkspaceKey } from "@/lib/jubo-admission-preparation/workspace-key";
import type { AdmissionPreparationSnapshot } from "@/lib/jubo-admission-preparation/contract";

const context = { organizationId: "synthetic-org", branchId: "synthetic-branch", userId: "synthetic-actor", scopes: ["clients.manage"] };
const clientId = "00000000-0000-4000-8000-000000000100";
function snapshot(first = 1): AdmissionPreparationSnapshot {
  return { clientId, clientRowVersion: 1, intakeVersion: 1, sourceKind: "operator_master", sourceStatus: "服務中",
    canSubmit: true, admissionEnabled: false, sourceVerified: false,
    proposals: Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${(first + index).toString().padStart(12, "0")}`, version: first + index,
      sha256: "c".repeat(64), clientRowVersion: 1, admittedOn: "2026-10-12",
      eligibilityFrom: "2026-10-01", eligibilityTo: "2026-12-31", eligibilityReference: "SYNTHETIC-ELIGIBILITY",
      eligibilitySha256: "a".repeat(64), agreementReference: "SYNTHETIC-AGREEMENT", agreementSha256: "b".repeat(64),
      reason: "合成收案核對資料不得用於正式服務", proposedAt: "2026-10-12T00:00:00Z",
      ownProposal: true, canReview: false, reviewDecision: null, reviewReason: null,
    })) };
}
function view(value: AdmissionPreparationSnapshot) {
  return <JuboAdmissionPreparation key={admissionPreparationWorkspaceKey(context, value)} snapshot={value} />;
}
function fill() {
  for (const [label, value] of Object.entries({ "已核對的收案日期": "2026-10-12", "資格證明編號／文件位置": "SYNTHETIC-ELIGIBILITY",
    "資格有效起日": "2026-10-01", "資格有效迄日": "2026-12-31", "已簽服務契約編號／文件位置": "SYNTHETIC-AGREEMENT",
    "核對依據（至少 10 字）": "合成收案核對資料不得用於正式服務", "資格證明 SHA-256": "a".repeat(64), "服務契約 SHA-256": "b".repeat(64) })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("unlocks a confirmed submission only after a new capped-history revision is read back", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: {
    proposalId: "00000000-0000-4000-8000-000000000021", proposalSha256: "c".repeat(64), version: 21,
    status: "awaiting_second_review", sourceVerified: false, admissionEnabled: false, replayed: false,
  } }));
  vi.stubGlobal("fetch", fetch);
  const before = snapshot(); const rendered = render(view(before)); fill();
  fireEvent.click(screen.getByRole("button", { name: "提交給主任核對" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("已核對的收案日期")).toBeDisabled();
  rendered.rerender(view(structuredClone(before)));
  expect(screen.getByLabelText("已核對的收案日期")).toBeDisabled();
  const after = snapshot(2); expect(after.proposals).toHaveLength(before.proposals.length);
  rendered.rerender(view(after));
  expect(screen.getByLabelText("已核對的收案日期")).toBeEnabled();
  expect(screen.getByLabelText("已核對的收案日期")).toHaveValue("");
  expect(screen.getByRole("button", { name: "提交給主任核對" })).toBeEnabled();
  expect(fetch).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: /正式收案|完成收案/u })).not.toBeInTheDocument();
});
it("does not reset unsaved fields on an unchanged scoped snapshot", () => {
  const before = snapshot(); const rendered = render(view(before)); fill();
  rendered.rerender(view(structuredClone(before)));
  expect(screen.getByLabelText("已核對的收案日期")).toHaveValue("2026-10-12");
  expect(screen.getByLabelText("核對依據（至少 10 字）")).toHaveValue("合成收案核對資料不得用於正式服務");
});
