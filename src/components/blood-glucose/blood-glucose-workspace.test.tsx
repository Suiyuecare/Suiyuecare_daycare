// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageCatalog } from "@/lib/catalog";
import { buildDemoBloodGlucoseSnapshot } from "@/lib/blood-glucose/demo";
import { BloodGlucoseWorkspace } from "./blood-glucose-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

describe("blood glucose read-only rollout boundary", () => {
  const snapshot = buildDemoBloodGlucoseSnapshot("2026-09-13");
  const reason = "本批一般帳號尚未開放新增血糖紀錄，請交由已核准人員處理。";
  function workspace(canWrite: boolean) {
    return <BloodGlucoseWorkspace page={pageCatalog.find((page) => page.number === 4)!}
      snapshot={snapshot} allClients={snapshot.clients} serviceDate={snapshot.serviceDate}
      measurementStatus="all" canWrite={canWrite} writeUnavailableReason={reason} />;
  }
  it("explains the limitation before input and disables creation without hiding readable records", () => {
    render(workspace(false));
    expect(screen.getByRole("note")).toHaveTextContent(reason);
    expect(screen.getByRole("button", { name: "新增血糖" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "血糖紀錄" })).toBeInTheDocument();
    expect(screen.getAllByText("陳O華").length).toBeGreaterThan(0);
  });
  it("does not show a read-only warning for an authorized writer", () => {
    render(workspace(true));
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增血糖" })).toBeEnabled();
  });
});
