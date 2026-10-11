import "server-only";

import { cache } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { RoleKey, TenantContext } from "@/lib/domain/types";
import { demoBranding } from "@/lib/config/branding";
import { isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

    const supabase = await createServerSupabaseClient();
    if (!supabase) return null;
    const db = supabase;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return null;

    // Admission is database-owned and independent of editable user metadata.
    // Staff use the pinned CEO or individually approved Google identity gate.
    // Family admission is not expanded by the staff rollout. Missing policy
    // never falls back to an email/domain or JavaScript role check.
    // These preflights depend only on the authenticated user, not on one
    // another. Both may start after getUser, but no tenant data is queried
    // until the database-owned admission decision is confirmed true.
    const [admission, assurance] = await Promise.allSettled([
      Promise.resolve().then(() => supabase.rpc(
        audience === "staff" ? "is_staff_login_allowed" : "is_family_login_allowed",
      )),
      Promise.resolve().then(() => supabase.auth.mfa.getAuthenticatorAssuranceLevel()),
    ]);
    if (
      admission.status !== "fulfilled" ||
      admission.value.error ||
      admission.value.data !== true
    ) return null;
    if (assurance.status === "rejected") throw assurance.reason;
    const { data: aalData } = assurance.value;

    const cookieStore = await cookies();
    const selectedOrganizationId = cookieStore.get("daycare_organization")?.value;
    const selectedBranchId = cookieStore.get("daycare_branch")?.value;
    if (audience === "family") {
      // Family context is self-only and consent-bound. Staff membership views
      // require employee assurance and must not be used as a family fallback.
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
      if ((selectedOrganizationId && !uuid.test(selectedOrganizationId)) ||
        (selectedBranchId && !uuid.test(selectedBranchId))) return null;
      const { data, error } = await supabase.rpc("family_tenant_context", {
        p_expected_organization_id: selectedOrganizationId ?? null,
        p_expected_branch_id: selectedBranchId ?? null,
      });
      const record = Array.isArray(data) ? data[0] : null;
      if (error || !record || !uuid.test(record.organization_id ?? "") ||
        !uuid.test(record.branch_id ?? "") || !Array.isArray(record.role_keys) ||
        (selectedOrganizationId && record.organization_id !== selectedOrganizationId) ||
        (selectedBranchId && record.branch_id !== selectedBranchId) ||
        record.role_keys.length !== 1 || record.role_keys[0] !== "family" ||
        !Array.isArray(record.scopes) || record.scopes.some((scope: unknown) => typeof scope !== "string") ||
        typeof record.organization_name !== "string" || typeof record.branch_name !== "string") return null;
      return {
        organizationId: record.organization_id, organizationName: record.organization_name,
        branchId: record.branch_id, branchName: record.branch_name, userId: user.id,
        displayName: typeof record.display_name === "string" ? record.display_name : "家屬",
        roles: ["family"], scopes: record.scopes,
        assuranceLevel: aalData?.currentLevel === "aal2" ? "aal2" : "aal1",
        recentAal2At: null, demo: false,
      };
    }
    let membershipQuery = supabase
      .from("active_memberships")
      .select(
        "organization_id, branch_id, display_name, role_keys, scopes",
      )
      .eq("user_id", user.id);
    if (selectedOrganizationId) {
      membershipQuery = membershipQuery.eq("organization_id", selectedOrganizationId);
    }
    const { data: memberships, error: membershipError } =
      await membershipQuery.returns<MembershipRecord[]>();

    if (membershipError || !memberships?.length) return null;

    const exactBranchMembership = selectedBranchId
      ? memberships.find((item) => item.branch_id === selectedBranchId)
      : null;
    const organizationMembership = memberships.find((item) => item.branch_id === null);
    const membership =
      exactBranchMembership ?? organizationMembership ?? memberships[0]!;

    const requestedBranchId = membership.branch_id ?? selectedBranchId;
    async function findBranch(branchId?: string) {
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
    // Both reads are scoped to the membership already admitted above. Running
    // them together removes one network wait without moving the login gate,
    // MFA check, or membership selection ahead of authorization.
    const [initialBranchResult, organizationResult] = await Promise.all([
      findBranch(requestedBranchId),
      supabase
        .from("organizations")
        .select("name")
        .eq("id", membership.organization_id)
        .maybeSingle<{ name: string }>(),
    ]);
    let branchResult = initialBranchResult;
    if (
      !branchResult.error &&
      !branchResult.data?.length &&
      membership.branch_id === null &&
      requestedBranchId
    ) {
      branchResult = await findBranch();
    }
    if (branchResult.error || !branchResult.data?.length) return null;
    const branch = branchResult.data[0]!;

    const { data: organization, error: organizationError } = organizationResult;
    if (organizationError || !organization) return null;

    const roles = membership.role_keys ?? [];
    if (roles.includes("family") && roles.length === 1) {
      return null;
    }

    return {
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
  },
);

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
  const context = await getTenantContext("staff");
  if (!context) return false;
  if (context.demo) return true;
  if (context.assuranceLevel !== "aal2") return false;

  const supabase = await createServerSupabaseClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_recent_aal2", {
    max_age_minutes: 15,
  });

  return !error && data === true;
}
