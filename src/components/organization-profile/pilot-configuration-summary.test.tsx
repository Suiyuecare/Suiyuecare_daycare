// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { pilotProfile } from "@/lib/config/pilot-profile";
import { buildDemoOrganizationProfileSnapshot } from "@/lib/organization-profile/demo";
import { OrganizationProfileWorkspace } from "./organization-profile-workspace";
import { PilotConfigurationSummary } from "./pilot-configuration-summary";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const filters = { status: "all" as const, effectiveOn: null, query: "" };
const snapshot = buildDemoOrganizationProfileSnapshot({
  organizationId: "58000000-0000-4000-8000-000000000101",
  branchId: "58000000-0000-4000-8000-000000000102",
  filters, now: new Date("2026-09-08T04:00:00Z"),
});
const workspaceProps = {
  canApprove: false, canManage: false, currentUserId: "58000000-0000-4000-8000-000000000103",
  filters, hasRecentAal2: false, loadError: false,
  page: staffPages.find((entry) => entry.number === 58)!,
};

describe("pilot identity display boundary", () => {
  it("shows exact name and city separately from synthetic permits and rates", () => {
    render(<PilotConfigurationSummary demo />);
    expect(screen.getByRole("heading", { name: pilotProfile.legalName })).toBeInTheDocument();
    expect(screen.getByText("臺北市")).toBeInTheDocument();
    expect(screen.getByText("名稱已確認 · 正式環境未建立")).toBeInTheDocument();
    expect(screen.getByText(/不屬於本機構的核定資料/u)).toBeInTheDocument();
  });

  it("does not expose the pilot profile for a production render", () => {
    const { container } = render(<PilotConfigurationSummary demo={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the normal scoped production workspace free of pilot overrides", () => {
    render(<OrganizationProfileWorkspace {...workspaceProps} snapshot={{ ...snapshot, demo: false }} />);
    expect(screen.getByRole("heading", { name: "機構資料", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(pilotProfile.legalName)).not.toBeInTheDocument();
    expect(screen.queryByText(/正式環境未建立/u)).not.toBeInTheDocument();
  });

  it("does not render the pilot summary after a snapshot load or authorization failure", () => {
    render(<OrganizationProfileWorkspace {...workspaceProps} loadError snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "無法取得機構資料快照" })).toBeInTheDocument();
    expect(screen.queryByText(pilotProfile.legalName)).not.toBeInTheDocument();
  });

  it("uses collapsed native disclosures and read-only official links without submit controls", () => {
    const { container } = render(<PilotConfigurationSummary demo />);
    const disclosures = Array.from(container.querySelectorAll("details"));
    expect(disclosures).toHaveLength(2);
    expect(disclosures.every((item) => !item.open)).toBe(true);
    fireEvent.click(screen.getByText("官方來源清單（8 筆，全部待審查、未啟用）"));
    expect(disclosures[1].open).toBe(true);
    expect(screen.getAllByText("待審查 · 未啟用")).toHaveLength(8);
    expect(screen.getAllByRole("link")).toHaveLength(8);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAccessibleName(/另開官方網站/u);
    }
    expect(container.querySelector("form,button,input,iframe,script,img")).toBeNull();
  });
});
