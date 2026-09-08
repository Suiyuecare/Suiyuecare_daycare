/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ refresh: vi.fn(), fetchWithTimeout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: stubs.fetchWithTimeout,
  isClientFetchTimeoutError: () => false }));

import { buildDemoClientServicePlanSnapshot } from "@/lib/client-service-plan-workflow/demo";
import type { ClientServicePlanMutationInput } from "@/lib/client-service-plan-workflow/types";
import { parseClientServicePlanMutation } from "@/lib/client-service-plan-workflow/parser";
import type { PageCatalogEntry } from "@/lib/catalog";

import { ClientServicePlanActions, CreateClientServicePlan,
  clientServicePlanMutationBody } from "./client-service-plan-actions";
import { ClientServicePlanWorkspace } from "./client-service-plan-workspace";

const filters = { clientId: null, status: "all" as const, asOf: "2026-09-08", query: null };
const demo = buildDemoClientServicePlanSnapshot(filters);
const writable = { ...demo, demo: false };
const page = { slug: "service-management/client-service-plan", title: "個案服務計畫",
  description: "保存目標、措施、頻率與負責人。" } as PageCatalogEntry;

function apiEnvelope(input: ClientServicePlanMutationInput, replayed = true) {
  if (input.action !== "create_draft" && input.action !== "revise_draft") throw new Error("content expected");
  const payload = { schemaVersion: 1, organizationId: writable.organizationId,
    branchId: writable.branchId, clientId: input.clientId, planKey: input.planKey,
    version: input.action === "create_draft" ? 1 : input.expectedTerminalVersion + 1,
    previousVersionId: input.expectedTerminalId, status: "draft" as const,
    authorizedCarePlanId: input.expectedAuthorizedCarePlanId,
    authorizedContentHash: input.expectedAuthorizedContentHash,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
    reviewDueOn: input.reviewDueOn, responsibleUserId: input.responsibleUserId,
    sourceSystem: "local" as const, sourceRecordId: null,
    sourceProvenance: { schemaVersion: 1 as const, sourceSystem: "local" as const,
      captureMethod: "staff_entry" as const, authority: "facility" as const,
      workflow: "page52_client_service_plan_v1" as const, legalRuleStatus: "not_configured" as const,
      claimEligibilityStatus: "blocked_not_configured" as const }, goals: input.goals,
    plannedServices: input.plannedServices.map((item) => ({ ...item,
      responsibleDisplayName: "合成個管員", qualificationStatus: "active_membership_only" as const })),
    reason: input.reason };
  return { requestId: "52410000-0000-4000-8000-000000000001", status: "ok", errors: [], data: {
    operationId: input.idempotencyKey, action: input.action,
    planId: "52420000-0000-4000-8000-000000000001", planKey: input.planKey,
    version: payload.version, previousVersionId: payload.previousVersionId, status: "draft",
    clientId: input.clientId, authorizedCarePlanId: input.expectedAuthorizedCarePlanId,
    authorizedContentHash: input.expectedAuthorizedContentHash,
    previousPayloadHash: input.expectedTerminalPayloadHash, payloadHash: "f".repeat(64),
    persistedPayload: payload, committedAt: "2026-09-08T02:00:00Z", replayed,
    legalRuleStatus: "not_configured", claimEligibilityStatus: "blocked_not_configured",
    persisted: true, demo: false } };
}

function fillCreate() {
  fireEvent.change(screen.getByLabelText("生效日"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("結束日"), { target: { value: "2026-12-31" } });
  fireEvent.change(screen.getByLabelText("檢討日"), { target: { value: "2026-10-31" } });
  fireEvent.change(screen.getByLabelText("目標"), { target: { value: "維持日間活動參與" } });
  fireEvent.change(screen.getByLabelText("預期成果"), { target: { value: "由人工檢討參與情形" } });
  fireEvent.change(screen.getByLabelText("措施"), { target: { value: "提供結構化活動支持" } });
  fireEvent.change(screen.getByLabelText("頻率"), { target: { value: "服務日依計畫執行" } });
}

function rejected(status: number, code: string) {
  return new Response(JSON.stringify({ requestId: "52410000-0000-4000-8000-000000000001",
    status: "error", data: null, errors: [{ code, message: "合成拒絕回覆" }] }), { status });
}
function captured(index = 0) {
  const options = stubs.fetchWithTimeout.mock.calls[index]![1] as RequestInit;
  const key = (options.headers as Record<string, string>)["idempotency-key"]!;
  return { options, input: parseClientServicePlanMutation(JSON.parse(String(options.body)), key) };
}

describe("Page 52 dedicated workspace", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(cleanup);

  it("renders the explicit claim boundary, full goals and legacy unmapped content", () => {
    render(<ClientServicePlanWorkspace page={page} snapshot={demo} filters={filters}
      loadError={false} canManage canApprove canSign hasRecentAal2 />);
    expect(screen.getByText("申報規則尚未配置，已強制阻擋申報資格")).toBeInTheDocument();
    expect(screen.getAllByText(/可供服務執行追溯/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("舊格式內容待人工映射").length).toBeGreaterThan(0);
    expect(screen.queryByText("建立個案服務計畫草稿")).not.toBeInTheDocument();
  });

  it("shows an actionable fail-closed load state", () => {
    render(<ClientServicePlanWorkspace page={page} snapshot={null} filters={filters}
      loadError canManage={false} canApprove={false} canSign={false} hasRecentAal2={false} />);
    expect(screen.getByRole("heading", { name: "個案服務計畫" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "清除篩選並重試" })).toHaveAttribute("href", "?");
  });

  it("does not offer approval for legacy content or an outdated authorization", () => {
    const plan = writable.plans.find((item) => item.contentMappingStatus === "needs_mapping")!;
    render(<ClientServicePlanActions plan={plan} snapshot={writable} canManage canApprove canSign hasRecentAal2 />);
    fireEvent.click(screen.getByText("版本操作"));
    const values = [...screen.getByLabelText("操作").querySelectorAll("option")].map((item) => item.value);
    expect(values).toEqual(["revise_draft", "void"]);
    expect(values).not.toContain("approve");
    expect(values).not.toContain("sign");
  });

  it("freezes an unknown create and retries the byte-equivalent body and keys", async () => {
    stubs.fetchWithTimeout.mockRejectedValueOnce(new TypeError("network"));
    render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立不可變草稿版本" }));
    const retry = await screen.findByRole("button", { name: "以完全相同內容與操作鍵重試" });
    const firstOptions = stubs.fetchWithTimeout.mock.calls[0]![1] as RequestInit;
    const firstBody = JSON.parse(String(firstOptions.body));
    const firstKey = (firstOptions.headers as Record<string, string>)["idempotency-key"];
    const input = parseClientServicePlanMutation(firstBody, firstKey);
    stubs.fetchWithTimeout.mockResolvedValueOnce(new Response(JSON.stringify(apiEnvelope(input)), {
      status: 200, headers: { "content-type": "application/json" } }));
    fireEvent.click(retry);
    await waitFor(() => expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(2));
    const secondOptions = stubs.fetchWithTimeout.mock.calls[1]![1] as RequestInit;
    expect(secondOptions.body).toBe(firstOptions.body);
    expect((secondOptions.headers as Record<string, string>)["idempotency-key"]).toBe(firstKey);
    await waitFor(() => expect(stubs.refresh).toHaveBeenCalledTimes(1));
  });

  it("serializes content as form fields and never adds browser signature evidence", () => {
    const auth = writable.authorizations[0]!; const staff = writable.staff[0]!;
    const input = parseClientServicePlanMutation({ action: "create_draft", client_id: auth.clientId,
      plan_key: "52430000-0000-4000-8000-000000000001", expected_terminal_id: null,
      expected_terminal_version: 0, expected_terminal_payload_hash: null,
      expected_authorized_care_plan_id: auth.authorizedCarePlanId,
      expected_authorized_content_hash: auth.contentHash, effective_from: "2026-09-01",
      effective_to: "2026-12-31", review_due_on: "2026-10-31",
      responsible_user_id: staff.userId, goals: [{ goal_id: "52440000-0000-4000-8000-000000000001",
        item_order: 1, goal: "合成目標內容", target_outcome: "合成預期成果" }],
      planned_services: [{ measure_id: "52450000-0000-4000-8000-000000000001", item_order: 1,
        goal_id: "52440000-0000-4000-8000-000000000001", measure: "合成服務措施",
        frequency: "合成服務頻率", responsible_user_id: staff.userId }],
      reason: "建立完整合成計畫初稿" }, "52460000-0000-4000-8000-000000000001");
    const result = clientServicePlanMutationBody(input);
    expect(result).toHaveProperty("goals"); expect(result).toHaveProperty("planned_services");
    expect(result).not.toHaveProperty("signature"); expect(result).not.toHaveProperty("signed_at");
    expect(JSON.stringify(result)).not.toContain("approval_evidence_hash");
  });

  it("remounts only editable fields when a refreshed terminal version replaces the base", () => {
    const plan = writable.plans.find((item) => item.contentMappingStatus === "configured")!;
    const { rerender } = render(<ClientServicePlanActions plan={plan} snapshot={writable}
      canManage canApprove canSign hasRecentAal2 />);
    fireEvent.click(screen.getByText("版本操作"));
    expect(screen.getByLabelText("目標")).toHaveValue(plan.goals[0]!.goal);
    const refreshed = { ...plan, planId: "52470000-0000-4000-8000-000000000001",
      version: plan.version + 1, previousVersionId: plan.planId, status: "draft" as const,
      payloadHash: "e".repeat(64), goals: [{ ...plan.goals[0]!, goal: "重新載入後的新版本目標" }] };
    rerender(<ClientServicePlanActions plan={refreshed} snapshot={writable}
      canManage canApprove canSign hasRecentAal2 />);
    expect(screen.getByLabelText("目標")).toHaveValue("重新載入後的新版本目標");
  });

  it("does not call a read-only demo plan a terminated version chain", () => {
    render(<ClientServicePlanActions plan={demo.plans[0]!} snapshot={demo}
      canManage={false} canApprove={false} canSign={false} hasRecentAal2={false} />);
    expect(screen.getByText("合成展示唯讀")).toBeInTheDocument();
    expect(screen.queryByText("此版本鏈已終止")).not.toBeInTheDocument();
  });

  it.each([[409, "CLIENT_SERVICE_PLAN_RESULT_UNCERTAIN"], [502, "CLIENT_SERVICE_PLAN_RECEIPT_INVALID"],
    [500, "UNKNOWN_PROVIDER_FAILURE"]])("preserves uncertain HTTP %s replies as frozen operations", async (status, code) => {
    stubs.fetchWithTimeout.mockResolvedValueOnce(rejected(Number(status), String(code)));
    render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立不可變草稿版本" }));
    expect(await screen.findByRole("button", { name: "以完全相同內容與操作鍵重試" })).toBeEnabled();
    expect(screen.getByLabelText("目標")).toBeDisabled(); expect(stubs.refresh).not.toHaveBeenCalled();
  });

  it("does not treat an unstructured proxy error as proof of rollback", async () => {
    stubs.fetchWithTimeout.mockResolvedValueOnce(new Response("<html>gateway failure</html>", { status: 403 }));
    render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立不可變草稿版本" }));
    expect(await screen.findByRole("button", { name: "以完全相同內容與操作鍵重試" })).toBeInTheDocument();
  });

  it("unlocks a confirmed first rejection without discarding entered content", async () => {
    stubs.fetchWithTimeout.mockResolvedValueOnce(rejected(400, "INVALID_CLIENT_SERVICE_PLAN_OPERATION"));
    render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立不可變草稿版本" }));
    await screen.findByText("合成拒絕回覆");
    expect(screen.getByLabelText("目標")).toBeEnabled();
    expect(screen.getByLabelText("目標")).toHaveValue("維持日間活動參與");
    expect(screen.queryByRole("region", { name: "原操作結果待核對" })).not.toBeInTheDocument();
  });

  it("keeps an unknown create after later rejection, lost scope and a refreshed empty list", async () => {
    stubs.fetchWithTimeout.mockRejectedValueOnce(new TypeError("network"));
    const { rerender } = render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "建立不可變草稿版本" }));
    const retryLabel = "以完全相同內容與操作鍵重試";
    await screen.findByRole("button", { name: retryLabel }); const original = captured();
    stubs.fetchWithTimeout.mockResolvedValueOnce(rejected(403, "CLIENT_SERVICE_PLAN_NOT_AUTHORIZED"));
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    await waitFor(() => expect(screen.getByRole("button", { name: retryLabel })).toBeEnabled());
    expect(screen.getByLabelText("目標")).toBeDisabled();
    rerender(<CreateClientServicePlan snapshot={{ ...writable, clients: [], staff: [], authorizations: [] }} canManage={false} />);
    expect(screen.getByRole("region", { name: "原操作結果待核對" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: retryLabel })).toBeDisabled();
    rerender(<CreateClientServicePlan snapshot={{ ...writable,
      branchId: "52490000-0000-4000-8000-000000000001" }} canManage />);
    expect(screen.getByRole("button", { name: retryLabel })).toBeDisabled();
    rerender(<CreateClientServicePlan snapshot={writable} canManage />);
    stubs.fetchWithTimeout.mockResolvedValueOnce(new Response(JSON.stringify(apiEnvelope(original.input)), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    await waitFor(() => expect(stubs.refresh).toHaveBeenCalledTimes(1));
    expect(captured(1).options).toEqual(original.options); expect(captured(2).options).toEqual(original.options);
  });

  it("keeps an unknown revision visible across a voided head, then replays the original payload", async () => {
    const plan = writable.plans.find((item) => item.contentMappingStatus === "configured")!;
    stubs.fetchWithTimeout.mockRejectedValueOnce(new TypeError("network"));
    const { rerender } = render(<ClientServicePlanActions plan={plan} snapshot={writable}
      canManage canApprove canSign hasRecentAal2 />);
    fireEvent.click(screen.getByText("版本操作"));
    fireEvent.change(screen.getByLabelText("修訂理由（至少 8 字）"), { target: { value: "依定期檢討建立修訂草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    const retryLabel = "以完全相同版本、內容與操作鍵重試";
    await screen.findByRole("button", { name: retryLabel }); const original = captured();
    stubs.fetchWithTimeout.mockResolvedValueOnce(rejected(409, "CLIENT_SERVICE_PLAN_VERSION_CONFLICT"));
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    await waitFor(() => expect(screen.getByRole("button", { name: retryLabel })).toBeEnabled());
    const voided = { ...plan, status: "voided" as const };
    rerender(<ClientServicePlanActions plan={voided} snapshot={writable}
      canManage={false} canApprove={false} canSign={false} hasRecentAal2={false} />);
    expect(screen.queryByText("此版本鏈已終止")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: retryLabel })).toBeDisabled();
    rerender(<ClientServicePlanActions plan={voided} snapshot={writable}
      canManage canApprove canSign hasRecentAal2 />);
    stubs.fetchWithTimeout.mockResolvedValueOnce(new Response(JSON.stringify(apiEnvelope(original.input)), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    await waitFor(() => expect(stubs.refresh).toHaveBeenCalledTimes(1));
    expect(captured(1).options).toEqual(original.options); expect(captured(2).options).toEqual(original.options);
  });

  it("keeps the original signature permission and recent-MFA requirement on retry", async () => {
    const plan = { ...writable.plans.find((item) => item.contentMappingStatus === "configured")!, status: "approved" as const };
    stubs.fetchWithTimeout.mockRejectedValueOnce(new TypeError("network"));
    const { rerender } = render(<ClientServicePlanActions plan={plan} snapshot={writable}
      canManage canApprove canSign hasRecentAal2 />);
    fireEvent.click(screen.getByText("版本操作"));
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "sign" } });
    fireEvent.change(screen.getByLabelText("簽署目的／理由（至少 8 字）"), { target: { value: "確認核准版本並完成簽署" } });
    fireEvent.click(screen.getByRole("button", { name: "鎖定版本並送出" }));
    const label = "以完全相同版本、內容與操作鍵重試";
    await screen.findByRole("button", { name: label });
    rerender(<ClientServicePlanActions plan={{ ...plan, status: "signed" }} snapshot={writable}
      canManage canApprove canSign hasRecentAal2={false} />);
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    rerender(<ClientServicePlanActions plan={plan} snapshot={writable}
      canManage canApprove canSign={false} hasRecentAal2 />);
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate synchronous submits while the first response is pending", async () => {
    stubs.fetchWithTimeout.mockReturnValueOnce(new Promise(() => undefined));
    render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    const form = screen.getByRole("button", { name: "建立不可變草稿版本" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(stubs.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not call a non-voided chain terminated when sources or permissions leave no action", () => {
    render(<ClientServicePlanActions plan={writable.plans[0]!} snapshot={{ ...writable, authorizations: [] }}
      canManage canApprove={false} canSign={false} hasRecentAal2 />);
    expect(screen.getByText("目前沒有可執行的版本操作；請確認核定來源與權限。")).toBeInTheDocument();
    expect(screen.queryByText("此版本鏈已終止")).not.toBeInTheDocument();
  });

  it("selects a valid refreshed client and clears editable fields when changing clients", async () => {
    const { rerender } = render(<CreateClientServicePlan snapshot={{ ...writable, clients: [] }} canManage />);
    rerender(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿"));
    expect(screen.getByLabelText("個案")).toHaveValue(writable.clients[0]!.clientId);
    fillCreate();
    fireEvent.change(screen.getByLabelText("個案"), { target: { value: writable.clients[1]!.clientId } });
    expect(screen.getByLabelText("目標")).toHaveValue("");
    expect(screen.getByLabelText("生效日")).toHaveValue("");
    expect(stubs.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("never silently replaces an unavailable responsible worker on snapshot refresh", () => {
    const { rerender } = render(<CreateClientServicePlan snapshot={writable} canManage />);
    fireEvent.click(screen.getByText("建立個案服務計畫草稿")); fillCreate();
    const original = writable.staff[0]!.userId;
    rerender(<CreateClientServicePlan snapshot={{ ...writable, staff: writable.staff.slice(1) }} canManage />);
    expect(screen.getByLabelText("主要負責人")).toHaveValue(original);
    expect(screen.getByLabelText("負責人")).toHaveValue(original);
    expect(screen.getAllByRole("option", { name: "原負責人已不可選，請重新指定" })).toHaveLength(2);
    expect(stubs.fetchWithTimeout).not.toHaveBeenCalled();
  });
});
