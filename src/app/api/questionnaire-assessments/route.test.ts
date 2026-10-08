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
    stubs.rpc.mockResolvedValue({ data: {
      action: "create", clientId, formKey: "mna_sf",
      assessmentKey: "12500000-0000-4000-8000-000000000091",
      versionId: "12600000-0000-4000-8000-000000000091",
      version: 1, recordState: "draft", assessedOn: "2026-10-08",
      contentHash: "a".repeat(64), committedAt: "2026-10-08T01:00:00Z",
      replayed: false,
    }, error: null });
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

describe("AD8 candidate answer draft API", () => {
  const ad8 = getQuestionnaireForm("ad8")!;
  const candidateActor = {
    ...actor,
    scopes: ["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage"],
  };
  const requestAd8 = (key = idempotencyKey) => new Request(
    "https://example.invalid/api/questionnaire-assessments?form_key=ad8",
    { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: "{}" },
  );
  const candidateBody = () => ({
    action: "create", clientId, formKey: "ad8", formVersion: ad8.version,
    assessedOn: "2026-10-08", context: {},
    answers: Object.fromEntries(ad8.questions.map(({ id }, index) => [id,
      index === 0 ? { state: "answered", value: "unknown" } : { state: "missing" }])),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(candidateActor);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data: { recordState: "draft", replayed: false }, error: null });
  });

  it("keeps unknown, missing, tenant and retry key separate in one candidate-only draft", async () => {
    const payload = candidateBody();
    stubs.readJsonObject.mockResolvedValue(payload);
    expect((await POST(requestAd8())).status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_questionnaire_assessment", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_idempotency_key: idempotencyKey,
      p_payload: expect.objectContaining({
        form_key: "ad8", form_version: ad8.version, client_id: clientId,
        answers: expect.objectContaining({
          ad8_01: { state: "answered", value: "unknown" },
          ad8_02: { state: "missing" },
        }),
      }),
    });
    stubs.rpc.mockResolvedValue({ data: { recordState: "draft", replayed: true }, error: null });
    expect((await (await POST(requestAd8())).json()).data.replayed).toBe(true);
    expect(stubs.rpc).toHaveBeenCalledTimes(2);
    expect(stubs.rpc.mock.calls[0][1]).toEqual(stubs.rpc.mock.calls[1][1]);
  });

  it.each([
    ["not-applicable", (input: ReturnType<typeof candidateBody>) => ({
      ...input, answers: { ...input.answers, ad8_01: { state: "not_applicable", reason: "合成原因" } },
    })],
    ["unknown option", (input: ReturnType<typeof candidateBody>) => ({
      ...input, answers: { ...input.answers, ad8_01: { state: "answered", value: "diagnosed" } },
    })],
    ["missing item key", (input: ReturnType<typeof candidateBody>) => ({
      ...input, answers: Object.fromEntries(Object.entries(input.answers).filter(([key]) => key !== "ad8_08")),
    })],
    ["forged score", (input: ReturnType<typeof candidateBody>) => ({ ...input, score: 2 })],
  ])("rejects %s before the database RPC", async (_, change) => {
    stubs.readJsonObject.mockResolvedValue(change(candidateBody()));
    const response = await POST(requestAd8());
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("denies a staff account without the cognition read scope", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...candidateActor, scopes: ["clients.read", "questionnaire_cognition.manage"],
    });
    stubs.readJsonObject.mockResolvedValue(candidateBody());
    const response = await POST(requestAd8());
    expect(response.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
