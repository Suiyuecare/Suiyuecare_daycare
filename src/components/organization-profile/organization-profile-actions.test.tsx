// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoOrganizationProfileSnapshot } from "@/lib/organization-profile/demo";

import {
  OrganizationProfileDecisionForm,
  OrganizationProfileProposalForm,
} from "./organization-profile-actions";
import { OrganizationProfileWorkspace } from "./organization-profile-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "58000000-0000-4000-8000-000000000101";
const BRANCH = "58000000-0000-4000-8000-000000000102";
const REVIEWER = "58000000-0000-4000-8000-000000000103";
const filters = { status: "all" as const, effectiveOn: null, query: "" };
const snapshot = buildDemoOrganizationProfileSnapshot({
  organizationId: ORG,
  branchId: BRANCH,
  filters,
  now: new Date("2026-09-02T04:00:00.000Z"),
});
const page = staffPages.find((entry) => entry.number === 58)!;

function request(call: unknown[]) {
  const init = call[1] as RequestInit;
  return {
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    idempotencyKey: (init.headers as Record<string, string>)["idempotency-key"],
  };
}

function fillProposal() {
  fireEvent.change(screen.getByLabelText("生效起日"), {
    target: { value: "2027-01-01" },
  });
  fireEvent.change(screen.getByLabelText("許可字號"), {
    target: { value: "SYNTHETIC-PERMIT-NEW" },
  });
  fireEvent.change(screen.getByLabelText("發證單位"), {
    target: { value: "合成發證單位" },
  });
  fireEvent.change(screen.getByLabelText("許可發出日"), {
    target: { value: "2026-12-01" },
  });
  fireEvent.change(screen.getByLabelText("許可狀態（人工文字）"), {
    target: { value: "合成人工狀態" },
  });
  fireEvent.change(screen.getByLabelText("機構類型（人工文字）"), {
    target: { value: "合成人工類型" },
  });
  fireEvent.change(screen.getByLabelText("服務 1 名稱"), {
    target: { value: "合成人工服務" },
  });
  fireEvent.change(screen.getByLabelText("費目 1"), {
    target: { value: "合成人工費目" },
  });
  fireEvent.change(screen.getByLabelText("費目 1 精確金額文字"), {
    target: { value: "001200.00" },
  });
  fireEvent.change(screen.getByLabelText("費目 1 幣別"), {
    target: { value: "TWD" },
  });
  fireEvent.change(screen.getByLabelText("費目 1 生效起日"), {
    target: { value: "2027-01-01" },
  });
  fireEvent.change(screen.getByLabelText("核定容量"), {
    target: { value: "30" },
  });
  fireEvent.change(screen.getByLabelText("容量單位（人工文字）"), {
    target: { value: "合成人數單位" },
  });
  fireEvent.change(screen.getByLabelText("容量核定依據"), {
    target: { value: "合成容量依據" },
  });
  fireEvent.change(screen.getByLabelText("聯絡窗口"), {
    target: { value: "合成聯絡窗口" },
  });
  fireEvent.change(screen.getByLabelText("聯絡電話"), {
    target: { value: "02-0000-0000" },
  });
  fireEvent.change(screen.getByLabelText("聯絡地址"), {
    target: { value: "合成地址（非真實地點）" },
  });
  fireEvent.change(screen.getByLabelText("異動理由"), {
    target: { value: "合成異動理由" },
  });
}

describe("Page 58 organization profile UI", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 200;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `58000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fails closed without one complete scoped snapshot", () => {
    render(<OrganizationProfileWorkspace canApprove={false} canManage={false}
      currentUserId={REVIEWER} filters={filters} hasRecentAal2={false}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得機構資料快照" }))
      .toBeInTheDocument();
    expect(screen.queryByText("SYNTHETIC-PERMIT-001")).not.toBeInTheDocument();
  });

  it("shows honest demo and unconfigured integration boundaries", () => {
    render(<OrganizationProfileWorkspace canApprove canManage
      currentUserId={REVIEWER} filters={filters} hasRecentAal2
      loadError={false} page={page} snapshot={snapshot} />);
    expect(screen.getByText(/展示模式：以下均為合成機構/u)).toBeInTheDocument();
    expect(screen.getByText(/正式許可、機構類型、服務與費率代碼表尚未發布/u))
      .toBeInTheDocument();
    expect(screen.getByText(/正式附件／掃毒、匯出、離線與主管機關同步皆未設定或停用/u))
      .toBeInTheDocument();
    expect(screen.queryByText("建立機構資料異動提案")).not.toBeInTheDocument();
  });

  it("lets desktop users keyboard-expand the complete service, rate, and contact version", () => {
    const { container } = render(<OrganizationProfileWorkspace canApprove={false}
      canManage={false} currentUserId={REVIEWER} filters={filters}
      hasRecentAal2={false} loadError={false} page={page} snapshot={snapshot} />);
    const desktop = screen.getByRole("group", {
      name: "桌機版生效版本完整內容",
    });
    const summary = within(desktop).getByText(/核對 SYNTHETIC-PERMIT-001.*完整服務、費率與聯絡資料/u);
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(within(desktop).getByText((_, node) => node?.tagName === "LI" &&
      node.textContent?.includes("合成自費費目：001200.00 TWD") === true))
      .toBeInTheDocument();
    expect(within(desktop).getByText("synthetic@example.invalid"))
      .toBeInTheDocument();
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("requires recent AAL2 before exposing proposal fields", () => {
    render(<OrganizationProfileProposalForm canManage hasRecentAal2={false}
      snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "建立異動前需重新驗證" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("許可字號")).not.toBeInTheDocument();
  });

  it("reuses exact unknown-result keys and rotates them after content changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrganizationProfileProposalForm canManage hasRecentAal2 snapshot={snapshot} />);
    fillProposal();
    fireEvent.click(screen.getByRole("button", { name: "凍結完整提案並送審" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = request(fetchMock.mock.calls[0]!);

    fireEvent.click(screen.getByRole("button", { name: "凍結完整提案並送審" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = request(fetchMock.mock.calls[1]!);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body.proposal_key).toBe(first.body.proposal_key);
    expect(second.body.profile_key).toBe(first.body.profile_key);
    expect(second.body.service_items).toEqual(first.body.service_items);
    expect(second.body.rate_items).toEqual(first.body.rate_items);

    fireEvent.change(screen.getByLabelText("許可字號"), {
      target: { value: "SYNTHETIC-PERMIT-CHANGED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "凍結完整提案並送審" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = request(fetchMock.mock.calls[2]!);
    expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(third.body.proposal_key).not.toBe(first.body.proposal_key);
    expect(third.body.profile_key).not.toBe(first.body.profile_key);
  });

  it("binds an independent reject decision to the exact frozen proposal", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrganizationProfileDecisionForm canApprove currentUserId={REVIEWER}
      hasRecentAal2 snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("決定"), { target: { value: "reject" } });
    fireEvent.change(screen.getByLabelText("審核理由"), {
      target: { value: "合成駁回理由，保留原提案。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "駁回提案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const sent = request(fetchMock.mock.calls[0]!);
    const proposal = snapshot.proposals[0]!;
    expect(sent.body).toMatchObject({
      proposal_id: proposal.proposalId,
      expected_proposal_number: proposal.proposalNumber,
      expected_base_version: proposal.expectedBaseVersion,
      expected_profile_key: proposal.profileKey,
      expected_content_hash: proposal.contentHash,
      expected_effective_from: proposal.effectiveFrom,
      expected_effective_to: proposal.effectiveTo,
      decision: "reject",
    });
  });

  it("does not expose self-approval controls", () => {
    render(<OrganizationProfileDecisionForm canApprove
      currentUserId={snapshot.proposals[0]!.proposedBy} hasRecentAal2
      snapshot={snapshot} />);
    expect(screen.queryByText("獨立核准或駁回待審提案"))
      .not.toBeInTheDocument();
  });
});
