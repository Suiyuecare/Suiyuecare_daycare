// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FamilyPortalSnapshot } from "@/lib/family/snapshot";
import { FamilyHome } from "./family-home";

const clientId = "84000000-0000-4000-8000-000000000001";
const snapshot: FamilyPortalSnapshot = { state: "ready", authorizedClients: [{ clientId, clientName: "合成個案" }],
  clientId, clientName: "合成個案", attendance: null, latestMeasurement: null, todayCompletedServices: null,
  latestCareSummary: null, updatedAt: null, publicationStatus: "not_configured" };
describe("family home publication boundary", () => {
  afterEach(cleanup);
  it("does not infer attendance, medication completion or a publication timestamp from identity permission", () => {
    render(<FamilyHome branchName="合成分支" demo={false} snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "今日出勤" })).toBeInTheDocument();
    expect(screen.queryByText("今天已到中心")).not.toBeInTheDocument();
    expect(screen.queryByText(/用藥已完成/u)).not.toBeInTheDocument();
    expect(screen.getByText(/尚無已發布資料更新時間/u)).toBeInTheDocument();
    expect(screen.queryByText(/今日 0 筆/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/最近更新/u)).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toContain(`client=${clientId}`);
  });
  it("does not show demo cards when no authorized client exists", () => {
    render(<FamilyHome branchName="合成分支" demo={false} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "目前沒有可顯示的授權個案" })).toBeInTheDocument();
    expect(screen.queryByText("今天已到中心")).not.toBeInTheDocument();
  });
  it("requires a choice for multiple authorized clients", () => {
    render(<FamilyHome branchName="合成分支" demo={false} snapshot={{ state: "selection_required", authorizedClients: [
      { clientId, clientName: "合成甲" }, { clientId: "84000000-0000-4000-8000-000000000002", clientName: "合成乙" },
    ] }} />);
    expect(screen.getByRole("heading", { name: "請選擇要查看的個案" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
  it("retains explicitly requested synthetic demo content", () => {
    render(<FamilyHome branchName="合成分支" demo snapshot={null} />);
    expect(screen.getByRole("heading", { name: "今天已到中心" })).toBeInTheDocument();
  });
});
