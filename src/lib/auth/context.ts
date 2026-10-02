import "server-only";

import { cache } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { RoleKey, TenantContext } from "@/lib/domain/types";
import { demoBranding } from "@/lib/config/branding";
import { isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getNursingRecentAal2At } from "@/lib/nursing-assessments/reauth";
import { withServerReadDeadline } from "@/lib/api/server-read-deadline";
import { IntegrationError } from "@/lib/integrations/errors";

type MembershipRecord = {
  organization_id: string;
  branch_id: string | null;
  display_name: string | null;
  role_keys: RoleKey[] | null;
  scopes: string[] | null;
};

const demoStaffContext: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: demoBranding.organizationName,
  branchId: "22222222-2222-4222-8222-222222222222",
  branchName: demoBranding.branchName,
  userId: "33333333-3333-4333-8333-333333333333",
  displayName: "林督導",
  roles: ["branch_supervisor", "nurse"],
  scopes: ["branch:read", "assigned_clients:write", "records:sign"],
  assuranceLevel: "aal2",
  recentAal2At: new Date().toISOString(),
  demo: true,
};

const demoFamilyContext: TenantContext = {
  organizationId: demoStaffContext.organizationId,
  organizationName: demoStaffContext.organizationName,
  branchId: demoStaffContext.branchId,
  branchName: demoStaffContext.branchName,
  userId: "44444444-4444-4444-8444-444444444444",
  displayName: "陳小姐",
  roles: ["family"],
  scopes: ["family:authorized_client"],
  assuranceLevel: "aal1",
  recentAal2At: null,
  demo: true,
};

export const getTenantContext = cache(
  async (audience: "staff" | "family" = "staff"): Promise<TenantContext | null> => {
    if (isSyntheticPreviewMode()) {
      const context = audience === "family" ? demoFamilyContext : demoStaffContext;
      return { ...context, roles: [...context.roles], scopes: [...context.scopes],
        displayName: audience === "family" ? "合成家屬檢視者" : "合成員工檢視者",
        recentAal2At: null };
    }
    if (isDemoMode()) {
      return audience === "family" ? demoFamilyContext : demoStaffContext;
    }

    try {
      return await withServerReadDeadline((signal) => loadLiveTenantContext(audience, signal));
    } catch {
      // A slow/unavailable authority source is not an absent or denied login.
      // APIs retain 503, while requireTenantContext must not redirect to login.
      throw new IntegrationError("AUTH_CONTEXT_UNAVAILABLE", "登入資料暫時無法讀取，請稍後重試。", 503);
    }
  },
);

async function loadLiveTenantContext(audience: "staff" | "family", signal: AbortSignal): Promise<TenantContext | null> {
    const supabase = await createServerSupabaseClient({ signal });
    signal.throwIfAborted();
    if (!supabase) return null;
    const db = supabase;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    signal.throwIfAborted();

    if (userError && (isAuthRetryableFetchError(userError) || (userError.status ?? 0) >= 500)) {
      throw new IntegrationError("AUTH_CONTEXT_UNAVAILABLE", "登入資料暫時無法讀取，請稍後重試。", 503);
    }
    if (userError || !user) return null;

    // Admission is database-owned and independent of editable user metadata.
    // Staff use the pinned CEO or individually approved Google identity gate.
    // Family admission is not expanded by the staff rollout. Missing policy
    // never falls back to an email/domain or JavaScript role check.
    try {
      const { data: allowed, error } = await supabase.rpc(
        audience === "staff" ? "is_staff_login_allowed" : "is_executive_login_allowed",
      );
      signal.throwIfAborted();
      if (error || allowed !== true) return null;
    } catch {
      return null;
    }

    // After verified user and admission, assurance and membership can load
    // together. Both still use this exact authenticated request-owned client.
    const assurancePromise = supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const membershipPromise = (async () => {
    const cookieStore = await cookies();
    signal.throwIfAborted();
    const selectedOrganizationId = cookieStore.get("daycare_organization")?.value;
    const selectedBranchId = cookieStore.get("daycare_branch")?.value;
    let membershipQuery = supabase
      .from("active_memberships")
      .select(
        "organization_id, branch_id, display_name, role_keys, scopes",
      )
      .eq("user_id", user.id);
    if (selectedOrganizationId) {
      membershipQuery = membershipQuery.eq("organization_id", selectedOrganizationId);
    }
    const result = await membershipQuery.returns<MembershipRecord[]>();
    signal.throwIfAborted();
    return { ...result, selectedBranchId };
    })();
    const [{ data: aalData }, { data: memberships, error: membershipError, selectedBranchId }] =
      await Promise.all([assurancePromise, membershipPromise]);
    signal.throwIfAborted();

    if (membershipError || !memberships?.length) return null;

    const exactBranchMembership = selectedBranchId
      ? memberships.find((item) => item.branch_id === selectedBranchId)
      : null;
    const organizationMembership = memberships.find((item) => item.branch_id === null);
    const membership =
      exactBranchMembership ?? organizationMembership ?? memberships[0]!;

    const requestedBranchId = membership.branch_id ?? selectedBranchId;
    async function findBranch(branchId?: string) {
      signal.throwIfAborted();
      let query = db
        .from("branches")
        .select("id, name")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true);
      if (branchId) query = query.eq("id", branchId);
      return query
        .order("code")
        .limit(1)
        .returns<Array<{ id: string; name: string }>>();
    }
    const organizationPromise = supabase
      .from("organizations")
      .select("name")
      .eq("id", membership.organization_id)
      .maybeSingle<{ name: string }>();
    const [initialBranch, { data: organization, error: organizationError }] = await Promise.all([
      findBranch(requestedBranchId), organizationPromise,
    ]);
    signal.throwIfAborted();
    let branchResult = initialBranch;
    if (
      !branchResult.error &&
      !branchResult.data?.length &&
      membership.branch_id === null &&
      requestedBranchId
    ) {
      branchResult = await findBranch();
      signal.throwIfAborted();
    }
    if (branchResult.error || !branchResult.data?.length) return null;
    const branch = branchResult.data[0]!;

    if (organizationError || !organization) return null;

    const roles = membership.role_keys ?? [];
    if (audience === "family" && !roles.includes("family")) return null;
    if (audience === "staff" && roles.includes("family") && roles.length === 1) {
      return null;
    }

    const context: TenantContext = {
      organizationId: membership.organization_id,
      organizationName: organization.name,
      branchId: branch.id,
      branchName: branch.name,
      userId: user.id,
      displayName: membership.display_name ?? user.email ?? "使用者",
      roles,
      scopes: membership.scopes ?? [],
      assuranceLevel:
        aalData?.currentLevel === "aal2" ? "aal2" : "aal1",
      recentAal2At: null,
      demo: false,
    };
    // Populate only a database-verified nursing timestamp. No global admission
    // or high-risk permission is expanded and missing evidence stays null.
    if (audience === "staff") context.recentAal2At = await getNursingRecentAal2At(context, db, signal);
    signal.throwIfAborted();
    return context;
}

export async function requireTenantContext(
  audience: "staff" | "family" = "staff",
) {
  const context = await getTenantContext(audience);
  if (!context) {
    redirect(`/login?audience=${audience}`);
  }
  return context;
}

export async function hasRecentAal2() {
  try {
    return await withServerReadDeadline(async (signal) => {
  const context = await getTenantContext("staff");
  signal.throwIfAborted();
  if (!context) return false;
  if (context.demo) return true;
  if (context.assuranceLevel !== "aal2") return false;

  const supabase = await createServerSupabaseClient({ signal });
  signal.throwIfAborted();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_recent_aal2", {
    max_age_minutes: 15,
  });
  signal.throwIfAborted();

  return !error && data === true;
    });
  } catch {
    throw new IntegrationError("AUTH_CONTEXT_UNAVAILABLE", "身分確認暫時無法完成，請稍後重試。", 503);
  }
}
