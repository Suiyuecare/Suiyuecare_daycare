import { fail, ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { demoBranding } from "@/lib/config/branding";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const demoBranches = [
  { id: "22222222-2222-4222-8222-222222222222", name: demoBranding.branchName },
  { id: "22222222-2222-4222-8222-222222222223", name: demoBranding.otherBranchName },
];

async function accessibleBranches() {
  const context = await getTenantContext("staff");
  if (!context) return { context: null, branches: null, error: "AUTH_REQUIRED" } as const;
  if (isDemoMode()) return { context, branches: demoBranches, error: null } as const;
  if (context.assuranceLevel !== "aal2") {
    return { context, branches: null, error: "AAL2_REQUIRED" } as const;
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { context, branches: null, error: "SERVICE_NOT_CONFIGURED" } as const;
  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("organization_id", context.organizationId)
    .eq("is_active", true)
    .order("code")
    .returns<Array<{ id: string; name: string }>>();
  return { context, branches: error ? null : data, error: error ? "BRANCH_LOOKUP_FAILED" : null } as const;
}

export async function GET() {
  const result = await accessibleBranches();
  if (!result.context) return fail(401, { code: "AUTH_REQUIRED", message: "請先登入。" });
  if (result.error === "AAL2_REQUIRED") return fail(403, { code: "AAL2_REQUIRED", message: "請先完成雙因素驗證。" });
  if (!result.branches) return fail(503, { code: result.error ?? "BRANCH_LOOKUP_FAILED", message: "目前無法讀取可用分支。" });
  return ok({ branches: result.branches, currentBranchId: result.context.branchId });
}

export async function POST(request: Request) {
  let branchId = "";
  try {
    const body = (await request.json()) as { branchId?: unknown };
    branchId = typeof body.branchId === "string" ? body.branchId : "";
  } catch {
    return fail(400, { code: "INVALID_REQUEST", message: "請提供有效的分支識別碼。", field: "branchId" });
  }
  if (!uuidPattern.test(branchId)) {
    return fail(400, { code: "INVALID_BRANCH_ID", message: "分支識別碼格式錯誤。", field: "branchId" });
  }

  const result = await accessibleBranches();
  if (!result.context) return fail(401, { code: "AUTH_REQUIRED", message: "請先登入。" });
  if (result.error === "AAL2_REQUIRED") return fail(403, { code: "AAL2_REQUIRED", message: "請先完成雙因素驗證。" });
  const selected = result.branches?.find((branch) => branch.id === branchId);
  if (!selected) return fail(403, { code: "BRANCH_NOT_ACCESSIBLE", message: "您沒有此分支的資料範圍。" });

  const response = ok({ branch: selected, demo: isDemoMode() });
  if (!isDemoMode()) {
    response.cookies.set("daycare_branch", selected.id, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
  }
  return response;
}

export async function DELETE() {
  const response = ok({ cleared: true });
  response.cookies.set("daycare_branch", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("daycare_organization", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
