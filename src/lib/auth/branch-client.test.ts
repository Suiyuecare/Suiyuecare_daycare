import { describe, expect, it } from "vitest";

import {
  BranchClientContractError,
  parseBranchListEnvelope,
  parseBranchSwitchEnvelope,
} from "./branch-client";

const current = { id: "22000000-0000-4000-8000-000000000001", name: "甲分支" };
const other = { id: "22000000-0000-4000-8000-000000000002", name: "乙分支" };
const wrap = (data: unknown) => ({
  requestId: "22000000-0000-4000-8000-000000000003",
  status: "ok",
  data,
  errors: [],
});

describe("branch browser response contract", () => {
  it("accepts a unique list that contains the exact current branch", () => {
    const parsed = parseBranchListEnvelope(
      wrap({ branches: [current, other], currentBranchId: current.id }),
      200,
      current.id,
    );
    expect(parsed.data.branches).toHaveLength(2);
  });

  it("rejects a forged current branch, duplicates and unknown fields", () => {
    expect(() => parseBranchListEnvelope(
      wrap({ branches: [current, other], currentBranchId: other.id }), 200, current.id,
    )).toThrow(BranchClientContractError);
    expect(() => parseBranchListEnvelope(
      wrap({ branches: [current, current], currentBranchId: current.id }), 200, current.id,
    )).toThrow(BranchClientContractError);
    expect(() => parseBranchListEnvelope(
      wrap({ branches: [current], currentBranchId: current.id, injected: true }), 200, current.id,
    )).toThrow(BranchClientContractError);
  });

  it("correlates the switch receipt to the selected id and name", () => {
    expect(parseBranchSwitchEnvelope(wrap({ branch: other, demo: false }), 200, other).data.branch).toEqual(other);
    expect(() => parseBranchSwitchEnvelope(
      wrap({ branch: { ...other, name: "偽造分支" }, demo: false }), 200, other,
    )).toThrow(BranchClientContractError);
  });
});
