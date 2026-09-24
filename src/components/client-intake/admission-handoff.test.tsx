// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyIntakeProfile } from "@/lib/client-intake/model";
import { AdmissionHandoff } from "./admission-handoff";
const snapshot = { clientId: "c1600000-0000-4000-8000-000000000001", pending: true, profileVersion: 1, clientRowVersion: 1, profile: emptyIntakeProfile, fieldAuthority: {}, sourceBatchId: null };
afterEach(cleanup);
describe("intake admission handoff", () => {
  it("carries only the stable client ID, not names, identity or a submit instruction", () => {
    render(<AdmissionHandoff snapshot={snapshot} canRead blocked={false} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/app/staff/operations/client-transitions?client=${snapshot.clientId}`);
    expect(screen.getByText(/建檔與每週安排不代表已收案/)).toBeTruthy();
  });
  it("blocks navigation while edits, saves or readback errors remain", () => {
    render(<AdmissionHandoff snapshot={snapshot} canRead blocked />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });
  it("does not offer a destination without its read permission", () => {
    render(<AdmissionHandoff snapshot={snapshot} canRead={false} blocked={false} />);
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("never labels an already registered client as automatically active", () => {
    render(<AdmissionHandoff snapshot={{ ...snapshot, pending: false }} canRead blocked={false} />);
    expect(screen.getByText(/依正式收案、暫停及結案日期/)).toBeTruthy();
    expect(screen.queryByText("下一步：確認正式收案")).toBeNull();
  });
});
