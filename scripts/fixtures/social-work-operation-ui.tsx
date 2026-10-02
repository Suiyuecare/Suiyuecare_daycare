// Actual UI against synthetic in-memory transport. No cloud, PHI, auth proof,
// browser persistence or production writes. The fake endpoint is loopback only.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/app-shell";
import { SocialWorkRecordsWorkspace } from "@/components/social-work-records/social-work-records-workspace";
import { PsychosocialAssessmentsWorkspace } from "@/components/psychosocial-assessments/psychosocial-assessments-workspace";
import { buildDemoSocialWorkRecordSnapshot } from "@/lib/social-work-records/demo";
import { buildDemoPsychosocialAssessmentSnapshot } from "@/lib/psychosocial-assessments/demo";
import type { SocialWorkOperationResult, SocialWorkRecordSnapshot, SocialWorkServiceRecord } from "@/lib/social-work-records/types";
import type { PsychosocialAssessmentOperationResult, PsychosocialAssessmentSnapshot, PsychosocialAssessmentListItem } from "@/lib/psychosocial-assessments/types";
import type { TenantContext } from "@/lib/domain/types";
import { staffPages } from "@/lib/catalog";
import { socialWorkAuthoritySignature } from "@/lib/social-work-records/pending";

const uuid = (n: number) => `69000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: TenantContext = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成測試機構（非正式）", branchName: "合成測試分支",
  displayName: "合成社工", roles: ["case_manager_social_worker"], scopes: ["clients.read", "social_work_records.read", "social_work_records.manage", "social_work_records.sign"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };
const socialBase: SocialWorkRecordSnapshot = { ...buildDemoSocialWorkRecordSnapshot(), demo: false };
const psychosocialBase: PsychosocialAssessmentSnapshot = { ...buildDemoPsychosocialAssessmentSnapshot(), demo: false };
const pageNumber = new URL(location.href).searchParams.get("page") === "28" ? 28 : 29;
type Receipt = SocialWorkOperationResult | PsychosocialAssessmentOperationResult;
type RequestBody = Record<string, unknown> & { action: string; clientId: string };
type State = { mode: "success" | "unknown" | "denied" | "invalid" | "deferred"; writes: { key: string; body: string; method: string }[];
  readMode: "success" | "denied" | "invalid" | "deferred"; reads: { path: string; method: string; filters: string | null }[];
  readResolve: (() => void) | null; readIncludesReceipt: boolean;
  refreshes: number; resolve: (() => void) | null; remount: () => void; foreign: (value: boolean) => void; allowed: (value: boolean) => void;
  fresh: (includeReceipt?: boolean) => void; assignment: (value: boolean) => void; offpage: (value: boolean) => void; last: Receipt | null; lastBody: RequestBody | null; branchRequests: string[] };
const state: State = { mode: "success", writes: [], readMode: "success", reads: [], readResolve: null, readIncludesReceipt: false, refreshes: 0, resolve: null, remount: () => {}, foreign: () => {}, allowed: () => {}, fresh: () => {}, assignment: () => {}, offpage: () => {}, last: null, lastBody: null, branchRequests: [] };
(window as unknown as Window & { fixture: State }).fixture = state;
const receipts = new Map<string, Receipt>();
function existingSocial(body: RequestBody) { return socialBase.records.find((item) => item.recordKey === body.recordKey); }
function existingPsychosocial(body: RequestBody) { return psychosocialBase.items.find((item) => item.clientId === body.clientId); }
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== location.origin) throw new Error("External fixture requests are blocked");
  if (url.pathname === "/api/context/branch") {
    state.branchRequests.push(init?.method ?? "GET");
    return Response.json({ requestId: uuid(90), status: "ok", errors: [], data: init?.method === "DELETE" ? { cleared: true }
      : { currentBranchId: actor.branchId, branches: [{ id: actor.branchId, name: actor.branchName }] } });
  }
  if (["/api/social-work-records/snapshot", "/api/psychosocial-assessments/snapshot"].includes(url.pathname)) {
    if (init?.method !== "GET" || url.search) throw new Error("Only explicit synthetic recovery GET is accepted");
    const headers = new Headers(init.headers); const prefix = url.pathname.startsWith("/api/social-work") ? "social-work" : "psychosocial";
    const filterHeader = headers.get(`x-${prefix}-read-filters`);
    state.reads.push({ path: url.pathname, method: init.method, filters: filterHeader });
    const mode = state.readMode;
    if (mode === "deferred") await new Promise<void>((resolve) => { state.readResolve = resolve; });
    if (mode === "denied") return Response.json({ requestId: uuid(93), status: "error", data: null, errors: [{ code: "FORBIDDEN", message: "Synthetic denied recovery read" }] }, { status: 403 });
    if (mode === "invalid") return Response.json({});
    return Response.json({ requestId: uuid(94), status: "ok", errors: [], data: { schemaVersion: 1,
      organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId,
      nonce: headers.get(`x-${prefix}-read-nonce`), filters: JSON.parse(decodeURIComponent(filterHeader ?? "")),
      snapshot: prefix === "social-work" ? freshSocial(state.readIncludesReceipt) : freshPsychosocial(state.readIncludesReceipt),
      capabilities: { canManage: true, canSign: true, hasRecentAal2: true }, authoritySignature: socialWorkAuthoritySignature(actor), demo: false } });
  }
  if (!["/api/social-work-records", "/api/psychosocial-assessments"].includes(url.pathname) || !["POST", "PATCH"].includes(init?.method ?? "")) throw new Error("Only synthetic social-work writes are allowed");
  const key = new Headers(init?.headers).get("idempotency-key") ?? ""; const serialized = String(init?.body);
  const body = JSON.parse(serialized) as RequestBody;
  state.writes.push({ key, body: serialized, method: init?.method ?? "" }); const mode = state.mode;
  if (mode === "deferred") await new Promise<void>((resolve) => { state.resolve = resolve; });
  if (mode === "denied") return Response.json({ requestId: uuid(91), status: "error", data: null, errors: [{ code: "FORBIDDEN", message: "Synthetic permission rejection" }] }, { status: 403 });
  const prior = receipts.get(key); const replayed = !!prior; const committedAt = new Date().toISOString();
  const common = { operationId: uuid(100 + receipts.size), persisted: true as const, demo: false as const, replayed, committedAt };
  let result: Receipt;
  if (prior) result = { ...prior, replayed: true };
  else if (url.pathname.endsWith("/psychosocial-assessments")) {
    const source = existingPsychosocial(body); const signing = body.action === "sign";
    result = { ...common, action: body.action as PsychosocialAssessmentOperationResult["action"], clientId: body.clientId,
      assessmentKey: String(body.assessmentKey ?? uuid(200 + receipts.size)), versionId: uuid(300 + receipts.size), assessmentVersion: Number(body.expectedVersion ?? 0) + 1,
      recordState: signing ? "signed" : body.action === "correct" ? "corrected" : "draft",
      assessedOn: String(signing ? source!.assessedOn : body.assessedOn), reassessmentDueOn: String(signing ? source!.reassessmentDueOn : body.reassessmentDueOn),
      responsibleUserId: body.action === "create_draft" ? actor.userId : source!.responsibleUserId!,
      serviceStatusAtAssessment: body.action === "create_draft" ? source!.serviceStatus : source!.serviceStatusAtAssessment!, formVersionReference: "manual-psychosocial-v1" };
  } else if (["track", "complete_follow_up", "cancel_follow_up"].includes(body.action)) result = { ...common, receiptKind: "follow_up",
    action: body.action as "track" | "complete_follow_up" | "cancel_follow_up", recordKey: String(body.recordKey), followUpEventId: uuid(400 + receipts.size),
    followUpSequence: Number(body.expectedSequence) + 1, followUpStatus: body.action === "track" ? "pending" : body.action === "complete_follow_up" ? "completed" : "cancelled" };
  else result = { ...common, receiptKind: "record", action: body.action as "create_draft" | "revise_draft" | "sign" | "correct", recordKey: String(body.recordKey ?? uuid(200 + receipts.size)),
    versionId: uuid(300 + receipts.size), recordVersion: Number(body.expectedVersion ?? 0) + 1, recordState: body.action === "sign" ? "signed" : body.action === "correct" ? "corrected" : "draft" };
  receipts.set(key, result); state.last = result; state.lastBody = body;
  if (mode === "unknown") throw new Error("Synthetic acknowledgement lost after commit");
  if (mode === "invalid") return Response.json({});
  return Response.json({ requestId: uuid(92), status: "ok", data: result, errors: [] }, { status: replayed ? 200 : 201 });
};
function freshSocial(includeReceipt: boolean): SocialWorkRecordSnapshot {
  const generated = new Date().toISOString(); const result = state.last; const body = state.lastBody;
  if (!includeReceipt || !result || !body || !("receiptKind" in result)) return { ...socialBase, generatedAt: generated, staleAfter: new Date(Date.parse(generated) + 60_000).toISOString() };
  const source = existingSocial(body) ?? socialBase.records[1]; const record: SocialWorkServiceRecord = structuredClone(source);
  record.recordKey = result.recordKey; record.clientId = body.clientId; record.clientDisplayName = socialBase.clientOptions.find((item) => item.clientId === body.clientId)!.displayName;
  if (result.receiptKind === "record") {
    record.versionId = result.versionId; record.recordVersion = result.recordVersion; record.recordState = result.recordState;
    record.occurredAt = String(body.occurredAt ?? source.occurredAt); record.serviceType = String(body.serviceType ?? source.serviceType);
    record.serviceContent = String(body.serviceContent ?? source.serviceContent); record.serviceResult = String(body.serviceResult ?? source.serviceResult);
    record.correctionReason = body.action === "correct" ? String(body.correctionReason) : null; record.createdAt = result.committedAt;
    record.signedAt = result.recordState === "draft" ? null : result.committedAt; record.signerDisplayName = record.signedAt ? actor.displayName : null;
    const version = { versionId: result.versionId, recordVersion: result.recordVersion, recordState: result.recordState, occurredAt: record.occurredAt,
      serviceType: record.serviceType, serviceContent: record.serviceContent, serviceResult: record.serviceResult, correctionReason: record.correctionReason,
      authorDisplayName: record.authorDisplayName, signedAt: record.signedAt, signerDisplayName: record.signerDisplayName, createdAt: result.committedAt };
    record.versionHistory = body.action === "create_draft" ? [version] : [...source.versionHistory, version]; record.versionHistoryTotal = record.versionHistory.length;
    if (body.action === "create_draft") { record.followUpEventId = null; record.followUpSequence = 0; record.followUpStatus = null; record.followUpDueOn = null;
      record.followUpPlan = null; record.followUpOutcome = null; record.followUpTransitionReason = null; record.followUpCommittedAt = null; record.followUpCommitterDisplayName = null;
      record.followUpOverdue = false; record.followUpHistory = []; record.followUpHistoryTotal = 0; }
  } else {
    record.followUpEventId = result.followUpEventId; record.followUpSequence = result.followUpSequence; record.followUpStatus = result.followUpStatus;
    record.followUpDueOn = result.followUpStatus === "pending" ? String(body.dueOn) : null; record.followUpPlan = body.followUpPlan ? String(body.followUpPlan) : null;
    record.followUpOutcome = body.followUpOutcome ? String(body.followUpOutcome) : null; record.followUpTransitionReason = body.transitionReason ? String(body.transitionReason) : null;
    record.followUpCommittedAt = result.committedAt; record.followUpCommitterDisplayName = actor.displayName; record.followUpOverdue = false;
    record.followUpHistory = [...source.followUpHistory, { eventId: result.followUpEventId, sequence: result.followUpSequence, status: result.followUpStatus,
      dueOn: record.followUpDueOn, plan: record.followUpPlan, outcome: record.followUpOutcome, transitionReason: record.followUpTransitionReason, committerDisplayName: actor.displayName, committedAt: result.committedAt }];
    record.followUpHistoryTotal = record.followUpHistory.length;
  }
  const records = body.action === "create_draft" ? [record, ...socialBase.records] : socialBase.records.map((item) => item.recordKey === record.recordKey ? record : item);
  const sorted = [...records].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return { ...socialBase, records: sorted, recordTotal: records.length, matchingTotal: records.length, generatedAt: generated, staleAfter: new Date(Date.parse(generated) + 60_000).toISOString(),
    metrics: { currentMonth: records.filter((item) => item.occurredAt.slice(0, 7) === generated.slice(0, 7)).length, drafts: records.filter((item) => item.recordState === "draft").length,
      signed: records.filter((item) => item.recordState !== "draft").length, pendingFollowUp: records.filter((item) => item.followUpStatus === "pending").length, overdueFollowUp: records.filter((item) => item.followUpOverdue).length } };
}
function freshPsychosocial(includeReceipt: boolean): PsychosocialAssessmentSnapshot {
  const generatedAt = new Date().toISOString(); const fresh = { ...psychosocialBase, generatedAt, staleAfter: new Date(Date.parse(generatedAt) + 60_000).toISOString() };
  const receipt = state.last; const body = state.lastBody; if (!includeReceipt || !receipt || !body || "receiptKind" in receipt) return fresh;
  const source = existingPsychosocial(body)!; const item: PsychosocialAssessmentListItem = { ...structuredClone(source), assessmentKey: receipt.assessmentKey, versionId: receipt.versionId,
    assessmentVersion: receipt.assessmentVersion, recordState: receipt.recordState, assessedOn: receipt.assessedOn, responsibleUserId: receipt.responsibleUserId,
    responsibleDisplayName: body.action === "create_draft" ? actor.displayName : source.responsibleDisplayName, serviceStatusAtAssessment: receipt.serviceStatusAtAssessment,
    reassessmentDueOn: receipt.reassessmentDueOn, reassessmentDue: false, dueBasis: String(body.dueBasis ?? source.dueBasis), dimensions: (body.dimensions ?? source.dimensions) as NonNullable<PsychosocialAssessmentListItem["dimensions"]>,
    assessmentSummary: String(body.assessmentSummary ?? source.assessmentSummary), correctionReason: body.action === "correct" ? String(body.correctionReason) : null,
    formBasis: "manual_unstandardized", formVersionReference: "manual-psychosocial-v1", createdAt: receipt.committedAt,
    signedAt: receipt.recordState === "draft" ? null : receipt.committedAt, signerDisplayName: receipt.recordState === "draft" ? null : actor.displayName };
  const version = { versionId: item.versionId!, assessmentVersion: item.assessmentVersion!, recordState: item.recordState!, assessedOn: item.assessedOn!, responsibleUserId: item.responsibleUserId!,
    responsibleDisplayName: item.responsibleDisplayName!, serviceStatusAtAssessment: item.serviceStatusAtAssessment!, reassessmentDueOn: item.reassessmentDueOn!, dueBasis: item.dueBasis!, dimensions: item.dimensions!,
    assessmentSummary: item.assessmentSummary!, formBasis: item.formBasis!, formVersionReference: item.formVersionReference!, correctionReason: item.correctionReason,
    signedAt: item.signedAt, signerDisplayName: item.signerDisplayName, createdAt: item.createdAt! };
  item.versionHistory = body.action === "create_draft" ? [version] : [...source.versionHistory, version]; item.versionHistoryTotal = item.versionHistory.length;
  const items = fresh.items.map((value) => value.clientId === item.clientId ? item : value);
  return { ...fresh, items, metrics: { ...fresh.metrics, assessed: items.filter((value) => value.recordState !== null).length, notAssessed: items.filter((value) => value.recordState === null).length,
    drafts: items.filter((value) => value.recordState === "draft").length, completed: items.filter((value) => value.recordState === "signed" || value.recordState === "corrected").length,
    due: items.filter((value) => value.reassessmentDue).length, upcoming: items.filter((value) => value.reassessmentDueOn && !value.reassessmentDue).length } };
}
function Fixture() {
  const [epoch, setEpoch] = useState(0); const [foreign, setForeign] = useState(false); const [allowed, setAllowed] = useState(true); const [offpage, setOffpage] = useState(false);
  const [social, setSocial] = useState(socialBase); const [psychosocial, setPsychosocial] = useState(psychosocialBase);
  useEffect(() => { state.remount = () => setEpoch((value) => value + 1); state.foreign = setForeign; state.allowed = setAllowed; state.offpage = setOffpage;
    state.assignment = (value) => setSocial(value ? socialBase : { ...socialBase, clientOptions: [], records: [], recordTotal: 0, matchingTotal: 0, metrics: { currentMonth: 0, drafts: 0, signed: 0, pendingFollowUp: 0, overdueFollowUp: 0 } });
    state.fresh = (includeReceipt = true) => { setSocial(freshSocial(includeReceipt)); setPsychosocial(freshPsychosocial(includeReceipt)); }; }, []);
  const context = { ...actor, branchId: foreign ? uuid(999) : actor.branchId, scopes: allowed ? actor.scopes : [], assuranceLevel: allowed ? "aal2" as const : "aal1" as const };
  return <AppShell context={context} navigation={[]}>
    <aside className="callout">本機合成操作，不連雲端。UI 通過不代表正式登入、RLS、實際保存或部署通過。</aside>
    {!offpage && (pageNumber === 29 ? <SocialWorkRecordsWorkspace key={epoch} context={context} page={staffPages.find((page) => page.number === 29)!}
      snapshot={social} filters={{ dateFrom: null, dateTo: null, clientId: null, serviceType: null, authorUserId: null }} canManage={allowed} canSign={allowed} hasRecentAal2={allowed}/>
      : <PsychosocialAssessmentsWorkspace key={epoch} context={context} page={staffPages.find((page) => page.number === 28)!}
        snapshot={psychosocial} filters={{ clientId: null, responsibleUserId: null, serviceStatus: null, dueStatus: "all" }} canManage={allowed} canSign={allowed} hasRecentAal2={allowed}/>)}
  </AppShell>;
}
createRoot(document.getElementById("fixture-root")!).render(<Fixture />);
