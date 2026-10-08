// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageCatalog } from "@/lib/catalog";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { CoreDailyWorkspace } from "./core-daily-workspace";

vi.mock("./client-continuation", () => ({
  ClientContinuation: ({ action }: { action?: React.ReactNode }) => <div>{action}</div>,
}));
vi.mock("./attendance-composer", () => ({
  AttendanceComposer: ({ canContinueToNext }: { canContinueToNext: boolean }) =>
    <output data-testid="attendance-next">{String(canContinueToNext)}</output>,
}));
vi.mock("./vital-sign-composer", () => ({
  VitalSignComposer: ({ canContinueToNext }: { canContinueToNext: boolean }) =>
    <output data-testid="vitals-next">{String(canContinueToNext)}</output>,
}));
vi.mock("./care-diary-composer", () => ({ CareDiaryComposer: () => null }));

afterEach(cleanup);

const base = buildDemoDailySnapshot("2026-10-03");
const client = base.clients[4]!;
const allSources = { attendance: true, measurements: true, careDiaries: true, serviceEvents: true };

function workspace(pageNumber: 46 | 3, options: {
  clientAccess?: typeof allSources;
  sourceAccess?: typeof base.sourceAccess;
  canWriteNextStep?: boolean;
  selectedClientId?: string;
} = {}) {
  const selectedClient = { ...client, sourceAccess: options.clientAccess ?? allSources };
  return <CoreDailyWorkspace page={pageCatalog.find((page) => page.number === pageNumber)!}
    moduleTitle="每日照顧" serviceDate={base.serviceDate}
    selectedClientId={options.selectedClientId ?? client.clientId}
    snapshot={{ ...base, demo: false, sourceAccess: options.sourceAccess ?? base.sourceAccess, clients: [selectedClient] }}
    canWrite canWriteNextStep={options.canWriteNextStep ?? true} />;
}

describe("next-step access for one selected client", () => {
  it("allows a same-person continuation only when the next source and preflight are available", () => {
    render(workspace(46));
    expect(screen.getByTestId("attendance-next")).toHaveTextContent("true");
  });

  it("does not offer measurement after attendance when that client cannot read measurement data", () => {
    render(workspace(46, { clientAccess: { ...allSources, measurements: false } }));
    expect(screen.getByTestId("attendance-next")).toHaveTextContent("false");
  });

  it("does not offer diary after measurement when the branch source is unavailable", () => {
    render(workspace(3, { sourceAccess: { ...base.sourceAccess, careDiaries: false } }));
    expect(screen.getByTestId("vitals-next")).toHaveTextContent("false");
  });

  it("does not offer diary when the next write preflight fails despite read access", () => {
    render(workspace(3, { canWriteNextStep: false }));
    expect(screen.getByTestId("vitals-next")).toHaveTextContent("false");
  });

  it("does not substitute another person for a selected ID outside the current authorized snapshot", () => {
    render(workspace(46, { selectedClientId: "a9999999-9999-4999-8999-999999999999" }));
    expect(screen.queryByTestId("attendance-next")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
