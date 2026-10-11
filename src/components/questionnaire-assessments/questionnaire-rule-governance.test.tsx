// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionnaireRuleGovernance } from "./questionnaire-rule-governance";
import type { QuestionnaireGovernanceSnapshot } from "@/lib/questionnaire-assessments/governance";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const snapshot: QuestionnaireGovernanceSnapshot = { generatedAt: "2026-10-11T01:00:00Z",
  catalogue: [{ formKey: "spmsq", formVersion: "test-v1", catalogHash: "a".repeat(64), title: "合成 SPMSQ", questionCount: 10, sources: [], rule: {} }],
  publications: [{ publicationId: "11111111-1111-4111-8111-111111111111", formKey: "spmsq", formVersion: "test-v1", effectiveFrom: "2026-10-10", effectiveTo: null,
    evidenceReference: "合成審查文件", requestedAt: "2026-10-10T01:00:00Z", requestedBy: "22222222-2222-4222-8222-222222222222", requestedName: "合成提案人",
    approvedAt: null, approvedName: null, canApprove: false, status: "pending" }],
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("questionnaire governance UI", () => {
  it("does not offer self-approval and names pending status accurately", () => {
    render(<QuestionnaireRuleGovernance snapshot={snapshot} />);
    expect(screen.getByText("待第二人覆核")).toBeVisible();
    expect(screen.queryByRole("button", { name: "核對公式、題目與文件後發布" })).not.toBeInTheDocument();
  });
  it("allows only an independent approver to call the bound approval action", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { publicationId: snapshot.publications[0].publicationId, status: "approved" } }));
    vi.stubGlobal("fetch", fetch);
    render(<QuestionnaireRuleGovernance snapshot={{ ...snapshot, publications: [{ ...snapshot.publications[0], canApprove: true }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "核對公式、題目與文件後發布" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "approve", publicationId: snapshot.publications[0].publicationId });
    expect(screen.getByText("規則已由第二人覆核發布。")).toBeVisible();
  });
});
