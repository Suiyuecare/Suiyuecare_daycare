import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const context: TenantContext = { organizationId: "10000000-0000-4000-8000-000000000001", branchId: "10000000-0000-4000-8000-000000000002",
  userId: "10000000-0000-4000-8000-000000000003", organizationName: "合成測試", branchName: "合成分支", displayName: "合成人員",
  roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const now = Date.parse("2026-09-27T00:00:00.000Z");
const stamp = (offset = 0) => new Date(now + offset).toISOString();
describe("questionnaire clinical view authority and source watermarks", () => {
  beforeEach(() => vi.resetModules());
  it("requires actual clients and form read scopes, never manage or an invented AAL2", async () => {
    const view = await import("./readiness-view");
    expect(view.canReadQuestionnaireView(context, "spmsq")).toBe(true);
    expect(view.canReadQuestionnaireView({ ...context, scopes: ["questionnaire_cognition.read"] }, "spmsq")).toBe(false);
    expect(view.canReadQuestionnaireView(context, "barthel_adl")).toBe(false);
    expect(view.canReadQuestionnaireView({ ...context, demo: true }, "spmsq")).toBe(false);
  });
  it.each(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf"] as const)("maps %s to the existing API read capability", async form => {
    const view = await import("./readiness-view");
    const scope = view.questionnaireReadPermission(form);
    expect(scope).toMatch(/^questionnaire_(cognition|emotion|adl|swallowing|fall|nutrition)\.read$/u);
    expect(view.canReadQuestionnaireView({ ...context, scopes: ["clients.read", scope] }, form)).toBe(true);
  });
  it("canonicalizes order but changes on each actual authority dimension", async () => {
    const view = await import("./readiness-view");
    const signature = view.questionnaireViewAuthority(context);
    expect(view.questionnaireViewAuthority({ ...context, scopes: [...context.scopes].reverse() })).toBe(signature);
    for (const change of [{ organizationId: "other" }, { branchId: "other" }, { userId: "other" }, { roles: [] }, { scopes: [] },
      { assuranceLevel: "aal2" as const }, { recentAal2At: stamp() }, { demo: true }]) {
      expect(view.questionnaireViewAuthority({ ...context, ...change })).not.toBe(signature);
    }
  });
  it("only admits a bounded fresh source for the current authority", async () => {
    const view = await import("./readiness-view");
    const authority = view.questionnaireViewAuthority(context);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(false);
    view.observeQuestionnaireViewAuthority(authority);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(true);
    for (const at of [stamp(60_001), stamp(-60_001), "bad"]) expect(view.admitQuestionnaireViewSource(authority, at, now)).toBe(false);
    expect(view.admitQuestionnaireViewSource("other", stamp(), now)).toBe(false);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), NaN)).toBe(false);
  });
  it.each(["authority-ABA", "denial", "logout"] as const)("%s rejects the identical/older source across remount and requires newer SSR admission", async boundary => {
    const view = await import("./readiness-view");
    const authority = view.questionnaireViewAuthority(context);
    view.observeQuestionnaireViewAuthority(authority);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(true);
    const before = view.getQuestionnaireViewState().epoch;
    if (boundary === "authority-ABA") view.observeQuestionnaireViewAuthority(view.questionnaireViewAuthority({ ...context, scopes: [] }));
    else if (boundary === "denial") view.quarantineQuestionnaireView(authority);
    else view.clearQuestionnaireViewOnLogout();
    view.observeQuestionnaireViewAuthority(authority);
    expect(view.getQuestionnaireViewState().epoch).toBeGreaterThan(before);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(false);
    expect(view.admitQuestionnaireViewSource(authority, stamp(-1), now)).toBe(false);
    expect(view.admitQuestionnaireViewSource(authority, stamp(1), now + 1)).toBe(true);
  });
  it("does not roll back an admitted source and render checks never advance its watermark", async () => {
    const view = await import("./readiness-view");
    const authority = view.questionnaireViewAuthority(context);
    view.observeQuestionnaireViewAuthority(authority);
    expect(view.canAdmitQuestionnaireViewSource(authority, stamp(2), now + 2)).toBe(true);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(true);
    expect(view.admitQuestionnaireViewSource(authority, stamp(1), now + 1)).toBe(true);
    expect(view.canAdmitQuestionnaireViewSource(authority, stamp(), now)).toBe(false);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(false);
    expect(view.canAdmitQuestionnaireViewSource(authority, stamp(1), now + 1)).toBe(true);
  });
  it("foreign denial cannot quarantine the current actor; repeated observation is stable", async () => {
    const view = await import("./readiness-view");
    const authority = view.questionnaireViewAuthority(context);
    view.observeQuestionnaireViewAuthority(authority);
    const before = view.getQuestionnaireViewState();
    view.quarantineQuestionnaireView("foreign"); view.observeQuestionnaireViewAuthority(authority);
    expect(view.getQuestionnaireViewState()).toBe(before);
  });
  it("has a bounded fail-closed subject registry, without evicting denial watermarks", async () => {
    const view = await import("./readiness-view");
    for (let index = 0; index < 129; index++) view.observeQuestionnaireViewAuthority(view.questionnaireViewAuthority({ ...context, userId: String(index) }));
    expect(view.getQuestionnaireViewState().exhausted).toBe(true);
    const authority = view.questionnaireViewAuthority(context);
    view.observeQuestionnaireViewAuthority(authority);
    expect(view.admitQuestionnaireViewSource(authority, stamp(), now)).toBe(false);
  });
});
