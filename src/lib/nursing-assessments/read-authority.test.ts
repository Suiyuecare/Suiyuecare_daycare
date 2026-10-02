import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { nursingAssessmentAuthoritySignature } from "./pending";
import { nursingReadAuthoritySignature, validateNursingReadAuthority } from "./read-authority";

const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T11:00:00.000Z");
const scope = { organizationId: id(80), branchId: id(81), userId: id(13) };
const actor: TenantContext = { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理",
  roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-27T10:59:00.000Z", demo: false };
const flags = { canManage: true, canSign: true, hasRecentAal2: true };
afterEach(() => { vi.useRealTimers(); });

describe("pure canonical nursing read authority", () => {
  it("is exactly the journal's five-part authority, normalized without client imports", () => {
    const value = { ...actor, recentAal2At: "2026-09-27T18:59:00+08:00", roles: ["nurse", "nurse"] as TenantContext["roles"] };
    expect(nursingReadAuthoritySignature(value)).toBe(nursingAssessmentAuthoritySignature(value));
    expect(JSON.parse(nursingReadAuthoritySignature(value))[4]).toBe("2026-09-27T10:59:00.000Z");
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(value), scope, flags, now)).not.toThrow();
  });
  it("keeps synthetic demo tuple compatibility but never admits it as formal read evidence", () => {
    const context = { ...actor, organizationId: "demo-org", branchId: "demo-branch", userId: "demo-user", demo: true };
    expect(nursingReadAuthoritySignature(context)).toBe(nursingAssessmentAuthoritySignature(context));
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(context), scope, flags, now)).toThrow();
  });
  it("permits read-only supervisor histories without nurse authority or reauthentication", () => {
    const context: TenantContext = { ...actor, roles: ["branch_supervisor"], scopes: ["clients.read", "nursing_assessments.read"], recentAal2At: null };
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(context), scope,
      { canManage: false, canSign: false, hasRecentAal2: false }, now)).not.toThrow();
  });
  it.each(["canManage", "canSign", "hasRecentAal2"] as const)("does not invent %s from a supervisor scope", (flag) => {
    const context: TenantContext = { ...actor, roles: ["branch_supervisor"], recentAal2At: null };
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(context), scope,
      { canManage: false, canSign: false, hasRecentAal2: false, [flag]: true }, now)).toThrow();
  });
  it.each([null, "2026-09-27T10:44:59.999Z"])("stale/absent proof allows read/sign capability but not recent flag %s", (recentAal2At) => {
    const signature = nursingReadAuthoritySignature({ ...actor, recentAal2At });
    expect(() => validateNursingReadAuthority(signature, scope, { ...flags, hasRecentAal2: false }, now)).not.toThrow();
    expect(() => validateNursingReadAuthority(signature, scope, flags, now)).toThrow();
  });
  it("binds the exact 15-minute boundary and refuses a future proof", () => {
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature({ ...actor, recentAal2At: "2026-09-27T10:45:00.000Z" }), scope, flags, now)).not.toThrow();
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature({ ...actor, recentAal2At: "2026-09-27T11:00:00.001Z" }), scope, { ...flags, hasRecentAal2: false }, now)).toThrow();
  });
  it.each(["organizationId", "branchId", "userId"] as const)("binds current %s exactly", (key) => {
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(actor), { ...scope, [key]: id(99) }, flags, now)).toThrow();
  });
  it.each([{ scopes: ["clients.read"] }, { scopes: ["nursing_assessments.read"] }, { scopes: [] },
    { assuranceLevel: "aal1" as const }, { demo: true }])("refuses missing formal read authority %#", (change) => {
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature({ ...actor, ...change }), scope, flags, now)).toThrow();
  });
  it.each(["duplicate", "order", "whitespace", "timestamp offset", "four parts", "extra part", "uppercase"])("refuses noncanonical or partial tuple %s", (kind) => {
    const tuple = JSON.parse(nursingReadAuthoritySignature(actor));
    if (kind === "duplicate") tuple[2].push(tuple[2][0]);
    if (kind === "order") tuple[2].reverse();
    if (kind === "timestamp offset") tuple[4] = "2026-09-27T18:59:00+08:00";
    if (kind === "four parts") tuple.pop();
    if (kind === "extra part") tuple.push(null);
    if (kind === "uppercase") tuple[0][0] = "51000000-0000-4000-8000-0000000000AB";
    const signature = JSON.stringify(tuple) + (kind === "whitespace" ? " " : "");
    expect(() => validateNursingReadAuthority(signature, scope, flags, now)).toThrow();
  });
  it.each(["", "not-json", "x".repeat(20_001)])("rejects invalid signature %#", (signature) => {
    expect(() => validateNursingReadAuthority(signature, scope, flags, now)).toThrow();
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite observation %#", (time) => {
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(actor), scope, flags, time)).toThrow();
  });
  it("default observation uses current time rather than inventing a recent timestamp", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(actor), scope, flags)).not.toThrow();
    vi.advanceTimersByTime(15 * 60_000);
    expect(() => validateNursingReadAuthority(nursingReadAuthoritySignature(actor), scope, flags)).toThrow();
  });
});
