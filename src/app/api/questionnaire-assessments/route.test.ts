import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "12900000-0000-4000-8000-000000000099";
    try { return await operation(requestId); }
    catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { getQuestionnaireForm } from "@/lib/questionnaire-assessments/forms";
import { POST } from "./route";

const organizationId = "12100000-0000-4000-8000-000000000091";
const branchId = "12200000-0000-4000-8000-000000000091";
const clientId = "12300000-0000-4000-8000-000000000091";
const idempotencyKey = "12800000-0000-4000-8000-000000000091";
const form = getQuestionnaireForm("mna_sf")!;
const answers = Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }]));
const actor = {
  organizationId, branchId, userId: "12400000-0000-4000-8000-000000000091",
  displayName: "合成測試評估員", demo: false,
  scopes: ["clients.read", "questionnaire_nutrition.read", "questionnaire_nutrition.manage"],
};

function request() {
  return new Request("https://example.invalid/api/questionnaire-assessments?form_key=mna_sf", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: "{}",
  });
}

function body(context: Record<string, string>, anthropometryValue: string) {
  return {
    action: "create", clientId, formKey: "mna_sf", formVersion: form.version,
    assessedOn: "2026-10-08", context,
    answers: { ...answers, anthropometry: { state: "answered", value: anthropometryValue } },
  };
}

describe("MNA-SF questionnaire API consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data: { recordState: "draft" }, error: null });
  });

  it.each([
    [{ height_cm: "160", weight_kg: "60" }, "bmi_lt_19"],
    [{ calf_circumference_cm: "31" }, "calf_lt_31"],
    [{ height_cm: "160", weight_kg: "60", calf_circumference_cm: "31" }, "bmi_gte_23"],
    [{ weight_kg: "60" }, "bmi_gte_23"],
  ])("keeps the existing 400 response and avoids DB writes for inconsistent MNA measurements", async (context, choice) => {
    stubs.readJsonObject.mockResolvedValue(body(context, choice));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("QUESTIONNAIRE_INVALID");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("writes a valid MNA draft with unchanged tenant, client and idempotency binding", async () => {
    const context = { height_cm: "160", weight_kg: "60" };
    stubs.readJsonObject.mockResolvedValue(body(context, "bmi_gte_23"));
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_questionnaire_assessment", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_idempotency_key: idempotencyKey,
      p_payload: expect.objectContaining({
        client_id: clientId, form_key: "mna_sf", context,
        answers: expect.objectContaining({ anthropometry: { state: "answered", value: "bmi_gte_23" } }),
      }),
    });
    expect((await response.json()).data).toMatchObject({ recordState: "draft" });
  });
});
