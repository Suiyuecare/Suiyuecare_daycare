import type { TenantContext } from "@/lib/domain/types";
import { buildDemoSocialWorkRecordSnapshot } from "./demo";
import { parseSocialWorkActionSuccess } from "./parser";
import { parseSocialWorkInput, socialWorkExpectation, type SocialWorkInput } from "./pending";
import type { SocialWorkRecordSnapshot, SocialWorkServiceRecord } from "./types";
export const swUuid = (n: number) => `29990000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function swFixture() {
  const snapshot = { ...buildDemoSocialWorkRecordSnapshot(), demo: false };
  const context: TenantContext = { organizationId: snapshot.organizationId, branchId: snapshot.branchId, userId: swUuid(1), organizationName: "合成機構", branchName: "合成分支", displayName: "合成社工", roles: ["case_manager_social_worker"], scopes: ["clients.read", "social_work_records.read", "social_work_records.manage", "social_work_records.sign"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
  return { snapshot, context, scope: { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, caps: { canManage: true, canSign: true, hasRecentAal2: true } };
}
export function swInput(snapshot: SocialWorkRecordSnapshot, action: SocialWorkInput["action"] = "create_draft", key = swUuid(2), selected?: SocialWorkServiceRecord) {
  const target = selected ?? snapshot.records.find((record) => record.recordState === (action === "correct" || ["track", "complete_follow_up", "cancel_follow_up"].includes(action) ? "signed" : "draft"))!;
  const service = { clientId: target.clientId, occurredAt: target.occurredAt, serviceType: target.serviceType, serviceContent: "合成服務內容", serviceResult: "合成服務結果" };
  const base = { action, clientId: target.clientId, recordKey: target.recordKey };
  const body = action === "create_draft" ? { action, ...service } : action === "sign" ? { ...base, previousVersionId: target.versionId, expectedVersion: target.recordVersion } : action === "revise_draft" || action === "correct" ? { ...base, ...service, previousVersionId: target.versionId, expectedVersion: target.recordVersion, ...(action === "correct" ? { correctionReason: "合成更正理由" } : {}) } : { ...base, serviceVersionId: target.versionId, expectedSequence: target.followUpSequence, ...(action === "track" ? { dueOn: "2026-10-01", followUpPlan: "合成追蹤計畫" } : action === "complete_follow_up" ? { followUpOutcome: "合成追蹤結果" } : { transitionReason: "合成取消理由" }) };
  return { input: parseSocialWorkInput(body, key), target };
}
export function swSuccess(input: SocialWorkInput, replayed = false, committedAt = new Date().toISOString()) {
  const followUp = ["track", "complete_follow_up", "cancel_follow_up"].includes(input.action);
  const data = followUp ? { receiptKind: "follow_up", action: input.action, operationId: swUuid(3), recordKey: "recordKey" in input ? input.recordKey : swUuid(4), followUpEventId: swUuid(6), followUpSequence: "expectedSequence" in input ? input.expectedSequence + 1 : 1, followUpStatus: input.action === "track" ? "pending" : input.action === "complete_follow_up" ? "completed" : "cancelled", committedAt, replayed, persisted: true, demo: false } : { receiptKind: "record", action: input.action, operationId: swUuid(3), recordKey: "recordKey" in input ? input.recordKey : swUuid(4), versionId: swUuid(5), recordVersion: "expectedVersion" in input ? input.expectedVersion + 1 : 1, recordState: input.action === "sign" ? "signed" : input.action === "correct" ? "corrected" : "draft", committedAt, replayed, persisted: true, demo: false };
  return parseSocialWorkActionSuccess({ requestId: swUuid(7), status: "ok", data, errors: [] }, socialWorkExpectation(input), replayed ? 200 : 201);
}
export function swFresh(snapshot: SocialWorkRecordSnapshot, advance = 1000): SocialWorkRecordSnapshot { const generatedAt = new Date(Date.parse(snapshot.generatedAt) + advance).toISOString(); return { ...snapshot, generatedAt, staleAfter: new Date(Date.parse(generatedAt) + 60_000).toISOString() }; }
export function swNoFollowUp(snapshot: SocialWorkRecordSnapshot): SocialWorkRecordSnapshot {
  const next = structuredClone(snapshot); const source = next.records[0]!;
  Object.assign(source, { followUpEventId: null, followUpSequence: 0, followUpStatus: null, followUpDueOn: null, followUpPlan: null, followUpOutcome: null, followUpTransitionReason: null, followUpCommitterDisplayName: null, followUpCommittedAt: null, followUpOverdue: false, followUpHistory: [], followUpHistoryTotal: 0, followUpHistoryTruncated: false }); next.metrics.pendingFollowUp -= 1; return next;
}
export function swProvenSnapshot(snapshot: SocialWorkRecordSnapshot, input: SocialWorkInput, receipt: ReturnType<typeof swSuccess>) {
  const next = swFresh(structuredClone(snapshot)); const data = receipt.data;
  let source = next.records.find((record) => record.recordKey === ("recordKey" in input ? input.recordKey : ""));
  if (!source) { source = structuredClone(next.records.find((record) => record.clientId === input.clientId)!); source.recordKey = data.recordKey; source.versionHistory = []; source.versionHistoryTotal = 0; Object.assign(source, { followUpEventId: null, followUpSequence: 0, followUpStatus: null, followUpDueOn: null, followUpPlan: null, followUpOutcome: null, followUpTransitionReason: null, followUpCommitterDisplayName: null, followUpCommittedAt: null, followUpOverdue: false, followUpHistory: [], followUpHistoryTotal: 0, followUpHistoryTruncated: false }); next.records = [...next.records, source]; }
  if (data.receiptKind === "record") {
    const version = { versionId: data.versionId, recordVersion: data.recordVersion, recordState: data.recordState, occurredAt: "occurredAt" in input ? input.occurredAt : source.occurredAt, serviceType: "serviceType" in input ? input.serviceType : source.serviceType, serviceContent: "serviceContent" in input ? input.serviceContent : source.serviceContent, serviceResult: "serviceResult" in input ? input.serviceResult : source.serviceResult, correctionReason: input.action === "correct" ? input.correctionReason : null, authorDisplayName: "合成社工", signedAt: data.recordState === "draft" ? null : data.committedAt, signerDisplayName: data.recordState === "draft" ? null : "合成社工", createdAt: data.committedAt };
    Object.assign(source, version); source.versionHistory = [...source.versionHistory, version]; source.versionHistoryTotal += 1;
  } else if ("followUpPlan" in input) {
    const event = { eventId: data.followUpEventId, sequence: data.followUpSequence, status: data.followUpStatus, dueOn: input.dueOn, plan: input.followUpPlan, outcome: input.followUpOutcome, transitionReason: input.transitionReason, committerDisplayName: "合成社工", committedAt: data.committedAt };
    source.followUpHistory = [...source.followUpHistory, event]; source.followUpHistoryTotal += 1; Object.assign(source, { followUpEventId: event.eventId, followUpSequence: event.sequence, followUpStatus: event.status, followUpDueOn: event.dueOn, followUpPlan: event.plan, followUpOutcome: event.outcome, followUpTransitionReason: event.transitionReason, followUpCommitterDisplayName: event.committerDisplayName, followUpCommittedAt: event.committedAt, followUpOverdue: false });
  }
  next.records = [...next.records].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.recordKey.localeCompare(b.recordKey, "en")); next.recordTotal = next.records.length; next.matchingTotal = next.recordTotal;
  const month = new Date(Date.parse(next.generatedAt) + 8 * 60 * 60_000).toISOString().slice(0, 7);
  next.metrics = { currentMonth: next.records.filter((record) => new Date(Date.parse(record.occurredAt) + 8 * 60 * 60_000).toISOString().slice(0, 7) === month).length, pendingFollowUp: next.records.filter((record) => record.followUpStatus === "pending").length, overdueFollowUp: next.records.filter((record) => record.followUpOverdue).length, drafts: next.records.filter((record) => record.recordState === "draft").length, signed: next.records.filter((record) => record.recordState !== "draft").length }; return next;
}
