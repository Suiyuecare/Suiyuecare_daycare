// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
import { JuboAdmissionPreparation } from "./jubo-admission-preparation";
import type { AdmissionPreparationSnapshot } from "@/lib/jubo-admission-preparation/contract";
const id = "dcc10000-0000-4000-8000-000000000001";
const snapshot: AdmissionPreparationSnapshot = { clientId: id, clientRowVersion: 1, intakeVersion: 1, sourceKind: "operator_master",
  sourceStatus: "服務中", canSubmit: true, admissionEnabled: false, sourceVerified: false, proposals: [] };
const record: AdmissionPreparationSnapshot["proposals"][number] = { id, version: 1, sha256: "c".repeat(64), clientRowVersion: 1,
  admittedOn: "2026-10-11", eligibilityFrom: "2026-10-01", eligibilityTo: "2026-10-31", eligibilityReference: "SYNTHETIC-ELIGIBILITY",
  eligibilitySha256: "a".repeat(64), agreementReference: "SYNTHETIC-AGREEMENT", agreementSha256: "b".repeat(64),
  reason: "合成收案日期及資格契約均已核對", proposedAt: "2026-10-11T01:00:00Z", ownProposal: false, canReview: true,
  reviewDecision: null, reviewReason: null };
const receipt = { proposalId: id, proposalSha256: "c".repeat(64), version: 1, status: "awaiting_second_review",
  sourceVerified: false, admissionEnabled: false, replayed: false };
function fill() {
  for (const [label, value] of Object.entries({ "已核對的收案日期": "2026-10-11", "資格證明編號／文件位置": "SYNTHETIC-ELIGIBILITY",
    "資格有效起日": "2026-10-01", "資格有效迄日": "2026-10-31", "已簽服務契約編號／文件位置": "SYNTHETIC-AGREEMENT",
    "核對依據（至少 10 字）": "合成收案日期及資格契約均已核對", "資格證明 SHA-256": "a".repeat(64), "服務契約 SHA-256": "b".repeat(64) }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("clear two-person preparation UI", () => {
  it("never guesses admission dates, hides long notes, and does not offer activation", () => {
    render(<JuboAdmissionPreparation snapshot={snapshot} />);
    expect(screen.getByLabelText("已核對的收案日期")).toHaveValue("");
    expect(screen.getByLabelText("已核對的收案日期").closest("form")).toHaveAttribute("method", "post");
    expect(screen.getByText("為何還不能正式收案？").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: /正式收案|完成收案/u })).not.toBeInTheDocument();
  });
  it("focuses the first missing field before any network write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<JuboAdmissionPreparation snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "提交給主任核對" }));
    expect(screen.getByLabelText("已核對的收案日期")).toHaveFocus(); expect(fetch).not.toHaveBeenCalled();
  });
  it("opens collapsed required document fields and focuses the missing hash", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<JuboAdmissionPreparation snapshot={snapshot} />); fill();
    fireEvent.change(screen.getByLabelText("資格證明 SHA-256"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "提交給主任核對" }));
    expect(screen.getByLabelText("資格證明 SHA-256")).toHaveFocus();
    expect(screen.getByLabelText("資格證明 SHA-256").closest("details")).toHaveAttribute("open");
  });
  it("keeps exactly the original body/key and frozen fields after a timeout", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ status: "ok", data: receipt }));
    vi.stubGlobal("fetch", fetch); render(<JuboAdmissionPreparation snapshot={snapshot} />); fill();
    fireEvent.click(screen.getByRole("button", { name: "提交給主任核對" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重試同一次操作" })).toBeVisible());
    expect(screen.getByLabelText("已核對的收案日期")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次操作" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["idempotency-key"]).toBe(fetch.mock.calls[1][1].headers["idempotency-key"]);
    expect(screen.getByText("已提交，請另一位主任核對。")).toBeVisible();
  });
  it("does not clear an earlier unknown result on a later authentication denial", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ status: "error", errors: [{ message: "重新登入" }] }, { status: 403 }));
    vi.stubGlobal("fetch", fetch); render(<JuboAdmissionPreparation snapshot={snapshot} />); fill();
    fireEvent.click(screen.getByRole("button", { name: "提交給主任核對" }));
    await screen.findByRole("button", { name: "重試同一次操作" });
    fireEvent.click(screen.getByRole("button", { name: "重試同一次操作" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("重新登入"));
    expect(screen.getByLabelText("已核對的收案日期")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重試同一次操作" })).toBeVisible();
  });
  it("shows independent review only for server-authorized current proposals", () => {
    const view = render(<JuboAdmissionPreparation snapshot={{ ...snapshot, proposals: [record] }} />);
    expect(screen.getByRole("button", { name: "保存主任核對" })).toBeEnabled();
    view.rerender(<JuboAdmissionPreparation snapshot={{ ...snapshot, proposals: [{ ...record, ownProposal: true, canReview: false }] }} />);
    expect(screen.queryByRole("button", { name: "保存主任核對" })).not.toBeInTheDocument();
    expect(screen.getByText("請另一位有權限的主任覆核。")).toBeVisible();
  });
  it("keeps closed-source records from offering an admission submission", () => {
    render(<JuboAdmissionPreparation snapshot={{ ...snapshot, sourceStatus: "結案", canSubmit: false }} />);
    expect(screen.queryByRole("button", { name: "提交給主任核對" })).not.toBeInTheDocument();
    expect(screen.getByText(/原始清冊狀態為「結案」/u)).toBeVisible();
  });
});
