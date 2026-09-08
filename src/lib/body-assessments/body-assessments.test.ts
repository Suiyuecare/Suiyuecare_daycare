import { describe, expect, it } from "vitest";
import { buildDemoBodyAssessmentSnapshot } from "./demo";
import { bodyObservationsReady, parseBodyAssessmentMutation, parseBodyAssessmentReceipt, parseBodyAssessmentSuccess } from "./parser";
import { projectBodyAssessmentSnapshot } from "./projection";
import { parseBodyAssessmentFilters } from "./query";
const key = "19000000-1111-4000-8000-000000000001";
const body = { action: "create", assessment_key: null, previous_version_id: null, expected_version: 0,
  expected_content_hash: null, client_id: "19000000-1111-4000-8000-000000000002", observed_at: "2026-09-07T09:00:00+08:00",
  instrument: "manual_nonstandard_body_observation_v1", reason: "人工建立觀察紀錄", observations: [
    { area: "left_arm", state: "abnormal", description: null, reason: null, disposition: null },
  ] };
const filters = { clientId: null, state: "all" as const };
const demo = buildDemoBodyAssessmentSnapshot(filters);
function source() { return { organization_id: demo.organizationId, branch_id: demo.branchId, generated_at: demo.generatedAt,
  records: demo.records.map(({ historyTotal, historyTruncated, ...record }) => ({ ...record, history_total: historyTruncated ? 51 : historyTotal })),
  matching_total: demo.matchingTotal, records_truncated: false,
  clients: demo.clients.map((c) => ({ client_id: c.clientId, display_name: c.displayName })), client_total: demo.clientTotal,
  clients_truncated: false, attachment_status: "not_configured" }; }
function project(row: unknown) { return projectBodyAssessmentSnapshot({ row, expectedOrganizationId: demo.organizationId,
  expectedBranchId: demo.branchId, filters, demo: false }); }
describe("Page 19 manual body observation contracts", () => {
  it("requires explicit fields but preserves incomplete abnormal drafts", () => {
    const input = parseBodyAssessmentMutation(body,key);
    expect(input.payload).toMatchObject({ observed_at: "2026-09-07T01:00:00.000Z", observations: body.observations });
    expect(bodyObservationsReady(body.observations as never)).toBe(false);
  });
  it.each([
    { ...body, observations: [] }, { ...body, observations: [...body.observations,...body.observations] },
    { ...body, automatic_score: 0 }, { ...body, instrument: "official_body_form" },
    { ...body, observations: [{ area: "back", state: "missing", description: null, reason: null, disposition: null }] },
    { ...body, observations: [{ area: "back", state: "normal", description: null, reason: "inferred", disposition: null }] },
    { ...body, observed_at: "2026-02-31T09:00:00+08:00" },
  ])("rejects malformed state, unofficial instruments and invalid time", (invalid) => {
    expect(() => parseBodyAssessmentMutation(invalid,key)).toThrow();
  });
  it("requires abnormal description and human disposition in corrections", () => {
    expect(() => parseBodyAssessmentMutation({ ...body, action: "correct", assessment_key: key, previous_version_id: body.client_id,
      expected_version: 2, expected_content_hash: "a".repeat(64), reason: "查核原始內容後修正人工紀錄" },key)).toThrow();
  });
  it("rejects missing idempotency and inconsistent create baseline", () => {
    expect(() => parseBodyAssessmentMutation(body,null)).toThrow();
    expect(() => parseBodyAssessmentMutation({ ...body, expected_version: 1 },key)).toThrow();
  });
  it("binds receipt to original request, actor, client and operation key", () => {
    const input = parseBodyAssessmentMutation(body,key); const scope = { organizationId: demo.organizationId, branchId: demo.branchId, userId: key };
    const receipt = { operation_id: key, organization_id: scope.organizationId, branch_id: scope.branchId,
      actor_user_id: key, client_id: body.client_id, idempotency_key: key, request_payload: input.payload,
      assessment_key: key, version_id: body.client_id, version: 1, record_state: "draft", content_hash: "a".repeat(64),
      committed_at: "2026-09-07T01:01:00Z", replayed: false };
    expect(parseBodyAssessmentReceipt(receipt,input,scope).version).toBe(1);
    const envelope = { requestId: key, status: "ok", data: receipt, errors: [] };
    expect(parseBodyAssessmentSuccess(envelope,input,scope,201).version).toBe(1);
    expect(() => parseBodyAssessmentSuccess({ ...envelope, errors: [{ code: "PARTIAL" }] },input,scope,201)).toThrow();
    expect(() => parseBodyAssessmentSuccess(envelope,input,scope,200)).toThrow();
    for (const patch of [{ actor_user_id: body.client_id }, { idempotency_key: body.client_id }, { client_id: key },
      { version: 2 }, { request_payload: { ...input.payload, reason: "替換內容" } }]) {
      expect(() => parseBodyAssessmentReceipt({ ...receipt, ...patch }, input, scope)).toThrow();
    }
  });
  it("projects only consistent scoped history and shows explicit missing reasons", () => {
    expect(project(source()).records[0].history).toHaveLength(1);
    expect(demo.records[0].observations[1].state).toBe("missing");
    expect(demo.records[0].observations[1].reason).toContain("不願受評");
  });
  it("fails closed on mixed tenants, unlisted clients and truncated count contradictions", () => {
    for (const row of [{ ...source(), organization_id: key }, { ...source(), clients: [], client_total: 0 },
      { ...source(), records_truncated: true }, { ...source(), matching_total: 0 },
      { ...source(), generated_at: "2099-01-01T00:00:00Z" }, { ...source(), generated_at: "2001-01-01T00:00:00Z" }]) expect(() => project(row)).toThrow();
  });
  it("rejects broken version links and mutation of signed content", () => {
    const row = source(); row.records[0].previous_version_id = key; expect(() => project(row)).toThrow();
    const changed = source(); changed.records[0].observations = [{ area: "head", state: "normal", description: null, reason: null, disposition: null }];
    expect(() => project(changed)).toThrow();
  });
  it("rejects partial signature metadata in drafts", () => {
    const row = source(); row.records[0].history = [{ ...row.records[0].history[0], signed_by: key }];
    expect(() => project(row)).toThrow();
  });
  it("does not ignore unknown or duplicate filters", () => {
    expect(parseBodyAssessmentFilters(new URLSearchParams())).toEqual(filters);
    expect(parseBodyAssessmentFilters(new URLSearchParams("client=&state=all"))).toEqual(filters);
    for (const query of ["client=bad", "state=draft&state=signed", "score=0", "state=unknown"]) {
      expect(() => parseBodyAssessmentFilters(new URLSearchParams(query))).toThrow();
    }
  });
});
