// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AbcdRecoveryGateProvider, useAbcdRecoveryGate } from "./abcd-recovery-gate";

const clientA = "21010000-0000-4000-8000-000000000001";
const clientB = "21010000-0000-4000-8000-000000000002";
function Probe() {
  const gate = useAbcdRecoveryGate();
  return <><button disabled={!gate.canStart(clientA)} type="button">A</button>
    <button disabled={!gate.canStart(clientB)} type="button">B</button>
    <p>{gate.reasonFor(clientA)}</p>
    <button onClick={() => gate.report({ kind: "ready", pendingClientIds: [clientA],
      pendingTruncated: false })} type="button">有待確認</button>
    <button onClick={() => gate.report({ kind: "ready", pendingClientIds: [],
      pendingTruncated: false })} type="button">查證完成</button>
    <button onClick={() => gate.report({ kind: "error", pendingClientIds: [],
      pendingTruncated: false })} type="button">查證失敗</button>
    <button onClick={() => gate.report({ kind: "ready", pendingClientIds: [],
      pendingTruncated: true })} type="button">結果過多</button></>;
}

describe("ABCD recovery gate", () => {
  afterEach(() => cleanup());

  it("pauses new writes until the read succeeds, and blocks only the pending client", () => {
    render(<AbcdRecoveryGateProvider scope="branch:all"><Probe /></AbcdRecoveryGateProvider>);
    expect(screen.getByRole("button", { name: "A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "B" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "有待確認" }));
    expect(screen.getByRole("button", { name: "A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "B" })).toBeEnabled();
    expect(screen.getByText(/原筆待確認/u)).toBeVisible();
  });

  it("keeps writes paused on failed or truncated lookup and a changed scope", () => {
    const view = render(<AbcdRecoveryGateProvider scope="branch:all"><Probe /></AbcdRecoveryGateProvider>);
    fireEvent.click(screen.getByRole("button", { name: "查證完成" }));
    expect(screen.getByRole("button", { name: "A" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "查證失敗" }));
    expect(screen.getByRole("button", { name: "A" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "結果過多" }));
    expect(screen.getByRole("button", { name: "B" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "查證完成" }));
    view.rerender(<AbcdRecoveryGateProvider scope="branch:client-A"><Probe /></AbcdRecoveryGateProvider>);
    expect(screen.getByRole("button", { name: "A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "B" })).toBeDisabled();
  });
});
