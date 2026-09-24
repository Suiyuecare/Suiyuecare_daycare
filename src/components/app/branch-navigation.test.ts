import { describe, expect, it } from "vitest";
import { safeStaffReloadPath } from "./branch-navigation";

describe("branch full-navigation target", () => {
  it("retains only the staff page, never previous client/filter query or hash", () => {
    expect(safeStaffReloadPath("/app/client-intake?client=synthetic-old-case&step=abcd#private-note")).toBe("/app/client-intake");
    expect(safeStaffReloadPath("/app/staff/workspace/dashboard")).toBe("/app/staff/workspace/dashboard");
  });
  it.each(["https://evil.example/app", "//evil.example/app", "javascript:alert(1)", "/api/context/branch", "/app/../../login", "/app/%2f%2fevil.example", "/app\\evil.example"])("never navigates outside an unambiguous staff path: %s", (path) => {
    expect(safeStaffReloadPath(path)).toBe("/app/staff/workspace/dashboard");
  });
});
