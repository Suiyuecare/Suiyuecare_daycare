import { describe, expect, it } from "vitest";

import { buildDemoBehaviorEventSnapshot } from "./demo";
import { parseBehaviorEventMutation, parseBehaviorEventReceipt } from "./parser";
import { projectBehaviorEventSnapshot } from "./projection";
import { parseBehaviorEventFilters } from "./query";

const org = "20100000-0000-4000-8000-000000000001";
const branch = "20200000-0000-4000-8000-000000000001";
const client = "20300000-0000-4000-8000-000000000001";
const user = "20400000-0000-4000-8000-000000000001";
const challenge = "20500000-0000-4000-8000-000000000001";
const key = "20600000-0000-4000-8000-000000000001";
const eventKey = "20700000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const filters = { dateFrom: null, dateTo: null, clientId: null, eventType: null, state: "all" as const };

function row(input: { suffix?: string; occurred?: string; state?: "draft" | "signed" } = {}) {
  const suffix = input.suffix ?? "1"; const state = input.state ?? "draft";
  const tail = suffix.padStart(12, "0");
  const id1 = `20800000-0000-4000-8000-${tail}`;
  const id2 = `20900000-0000-4000-8000-${tail}`;
  const common = { event_key: `20700000-0000-4000-8000-${tail}`, client_id: client,
    client_display_name: "合成個案", occurred_at: input.occurred ?? "2026-09-07T01:00:00Z",
    event_type: "活動參與", antecedent_state: "missing", antecedent_text: null,
    behavior_state: "recorded", behavior_text: "人工觀察內容", intervention_state: "not_applicable",
    intervention_text: null, outcome_state: "missing", outcome_text: null,
    author_user_id: user, author_display_name: "合成紀錄員", correction_reason: null,
    void_reason: null };
  const draft = { ...common, version_id: id1, version: 1, previous_version_id: null,
    content_hash: ((Number(suffix) % 9) + 1).toString().repeat(64), event_state: "draft", signed_at: null,
    signed_by_user_id: null, signer_display_name: null, signer_role_keys: null,
    signature_purpose: null, signature_reauth_challenge_id: null,
    created_at: "2026-09-07T03:00:00Z" };
  if (state === "draft") return { ...draft, history: [draft], history_total: 1 };
  const signed = { ...common, version_id: id2, version: 2, previous_version_id: id1,
    content_hash: (Number(suffix) + 3).toString().repeat(64), event_state: "signed",
    signed_at: "2026-09-07T03:10:00Z", signed_by_user_id: user,
    signer_display_name: "合成簽署員", signer_role_keys: ["care_worker"],
    signature_purpose: "行為與情緒事件簽署", signature_reauth_challenge_id: challenge,
    created_at: "2026-09-07T03:10:00Z" };
  return { ...signed, history: [draft, signed], history_total: 2 };
}

function source(events = [row()]) {
  const missing = events.filter((item) => [item.antecedent_state, item.behavior_state,
    item.intervention_state, item.outcome_state].includes("missing")).length;
  return { organization_id: org, branch_id: branch, generated_at: "2026-09-07T03:00:00Z",
    events, matching_total: events.length, events_truncated: false, event_total: events.length,
    missing_field_total: missing, draft_total: events.filter((item) => item.event_state === "draft").length,
    signed_total: events.filter((item) => item.event_state === "signed").length,
    voided_total: 0,
    clients: [{ client_id: client, display_name: "合成個案" }], client_total: 1,
    clients_truncated: false, event_types: ["活動參與"], event_type_total: 1,
    event_types_truncated: false, attachment_status: "not_configured", notification_status: "not_configured",
    export_status: "not_configured", offline_status: "not_configured" };
}

const createBody = { action: "save_event", mode: "create", event_key: null,
  previous_version_id: null, expected_version: 0, expected_content_hash: null,
  client_id: client, occurred_at: "2026-09-07T09:00:00+08:00", event_type: "活動參與",
  antecedent: { state: "missing", text: null }, behavior: { state: "recorded", text: "人工行為" },
  intervention: { state: "not_applicable", text: null }, outcome: { state: "missing", text: null },
  revision_reason: "建立事件初稿" };

describe("Page 20 behavior-event contracts", () => {
  it("parses only strict, explicit three-state manual fields", () => {
    const parsed = parseBehaviorEventMutation(createBody, key);
    expect(parsed).toMatchObject({ action: "save_event", mode: "create",
      behavior: { state: "recorded", text: "人工行為" }, antecedent: { state: "missing", text: null } });
    expect(() => parseBehaviorEventMutation({ ...createBody,
      behavior: { state: "missing", text: "不得同時有文字" } }, key)).toThrow(/人工紀錄欄位/u);
    expect(() => parseBehaviorEventMutation({ ...createBody, inferred_diagnosis: "不得接受" }, key)).toThrow();
  });

  it("requires exact linear baselines and UUID idempotency", () => {
    expect(() => parseBehaviorEventMutation({ ...createBody, expected_version: 1 }, key)).toThrow(/版本基準/u);
    expect(() => parseBehaviorEventMutation(createBody, "not-a-uuid")).toThrow(/冪等鍵/u);
  });

  it("requires a reason for void and forbids one for sign", () => {
    const base = { action: "finalize_event", client_id: client, event_key: eventKey,
      previous_version_id: "20800000-0000-4000-8000-000000000001", expected_version: 1,
      expected_content_hash: hash };
    expect(() => parseBehaviorEventMutation({ ...base, decision: "void", reason: null }, key)).toThrow();
    expect(() => parseBehaviorEventMutation({ ...base, decision: "sign", reason: "不應出現理由" }, key)).toThrow();
  });

  it("accepts only receipts that correlate action, state, key and next version", () => {
    const input = parseBehaviorEventMutation(createBody, key);
    const receipt = { operation_id: key, action: "save_event", decision: null,
      event_key: eventKey, version_id: "20800000-0000-4000-8000-000000000001", version: 1,
      event_state: "draft", content_hash: hash, committed_at: "2026-09-07T01:00:00Z", replayed: false };
    expect(parseBehaviorEventReceipt(receipt, input)).toMatchObject({ persisted: true, demo: false, version: 1 });
    expect(() => parseBehaviorEventReceipt({ ...receipt, event_state: "signed" }, input)).toThrow(/回執/u);
  });

  it("strictly parses filters and rejects unknown, repeated or inverted inputs", () => {
    expect(parseBehaviorEventFilters(new URLSearchParams("from=2026-09-01&state=signed")))
      .toMatchObject({ dateFrom: "2026-09-01", state: "signed" });
    expect(() => parseBehaviorEventFilters(new URLSearchParams("from=2026-09-02&to=2026-09-01"))).toThrow();
    expect(() => parseBehaviorEventFilters(new URLSearchParams("state=draft&state=signed"))).toThrow();
    expect(() => parseBehaviorEventFilters(new URLSearchParams("q=secret"))).toThrow();
  });

  it("orders by occurred_at instead of created_at and preserves explicit states", () => {
    const first = row({ suffix: "1", occurred: "2026-09-07T02:00:00Z" });
    const second = row({ suffix: "2", occurred: "2026-09-07T01:00:00Z" });
    const projected = projectBehaviorEventSnapshot({ row: source([first, second]),
      expectedOrganizationId: org, expectedBranchId: branch, filters, demo: false });
    expect(projected.events.map((item) => item.eventKey)).toEqual([first.event_key, second.event_key]);
    expect(projected.events[0]?.antecedent).toEqual({ state: "missing", text: null });
  });

  it("validates signed evidence and every history transition", () => {
    const projected = projectBehaviorEventSnapshot({ row: source([row({ state: "signed" })]),
      expectedOrganizationId: org, expectedBranchId: branch, filters, demo: false });
    expect(projected.events[0]?.history[1]).toMatchObject({ signerDisplayName: "合成簽署員",
      signaturePurpose: "行為與情緒事件簽署", signerRoleKeys: ["care_worker"] });
    const forged = source([row({ state: "signed" })]);
    forged.events[0]!.signature_purpose = "錯誤目的";
    expect(() => projectBehaviorEventSnapshot({ row: forged, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_BEHAVIOR/u);
  });

  it("rejects forged full-set state metrics when untruncated", () => {
    const forged = source([row()]); forged.draft_total = 0; forged.signed_total = 1;
    expect(() => projectBehaviorEventSnapshot({ row: forged, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_BEHAVIOR/u);
  });

  it("rejects forged missing-field metrics when untruncated", () => {
    const forged = source([row()]); forged.missing_field_total = 0;
    expect(() => projectBehaviorEventSnapshot({ row: forged, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_BEHAVIOR/u);
  });

  it("rejects visible counts greater than full totals when truncated", () => {
    const forged = source(Array.from({ length: 200 }, (_, index) => row({ suffix: String(index + 1) })));
    forged.events_truncated = true; forged.matching_total = 201;
    forged.event_total = 201; forged.draft_total = 0; forged.signed_total = 201;
    expect(() => projectBehaviorEventSnapshot({ row: forged, expectedOrganizationId: org,
      expectedBranchId: branch, filters, demo: false })).toThrow(/INVALID_BEHAVIOR/u);
  });

  it("keeps all unconfigured delivery boundaries explicit in synthetic demo", () => {
    const demo = buildDemoBehaviorEventSnapshot(filters);
    expect(demo).toMatchObject({ attachmentStatus: "not_configured", notificationStatus: "not_configured",
      exportStatus: "not_configured", offlineStatus: "not_configured", demo: true });
    expect(demo.events.map(({ eventState }) => eventState)).toEqual(["signed", "draft", "voided"]);
  });
});
