import type {
  FeedbackComplaintFilters,
  FeedbackComplaintSnapshot,
  FeedbackComplaintItem,
} from "./types";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const ASSIGNEE = "56000000-0000-4000-8000-000000000001";
const SECOND_ASSIGNEE = "56000000-0000-4000-8000-000000000002";
const GENERATED_AT = "2026-09-07T04:00:00.000Z";

const items: readonly FeedbackComplaintItem[] = [
  {
    id: "56100000-0000-4000-8000-000000000001",
    caseNumber: "FC-20260906-00000001",
    receivedAt: "2026-09-06T02:20:00.000Z",
    source: "family",
    caseType: "safety",
    reportedRisk: "high",
    effectiveRisk: "high",
    status: "escalated",
    dueAt: "2026-09-08T02:20:00.000Z",
    overdue: false,
    escalationReason: "high_risk",
    assigneeMembershipId: ASSIGNEE,
    assigneeDisplayName: "合成承辦甲",
    chainVersion: 2,
    latestEventAt: "2026-09-06T03:00:00.000Z",
    reporterName: "合成陳述人甲",
    reporterContact: "demo-feedback@example.invalid",
    subject: "合成安全流程意見",
    description: "合成資料：建議調整接待區的引導流程。",
    sensitiveMasked: false,
    timelineTotal: 2,
    timelineTruncated: false,
    timeline: [
      {
        id: "56200000-0000-4000-8000-000000000001", version: 1,
        eventType: "created", occurredAt: "2026-09-06T02:20:00.000Z",
        resultingStatus: "escalated", riskAfter: "high",
        automaticReason: "high_risk", assigneeMembershipId: null,
        assigneeDisplayName: null, correctedEventId: null, note: null,
        sensitiveMasked: false, actorDisplayName: "合成受理人",
        committedAt: "2026-09-06T02:21:00.000Z",
      },
      {
        id: "56200000-0000-4000-8000-000000000002", version: 2,
        eventType: "assignment", occurredAt: "2026-09-06T03:00:00.000Z",
        resultingStatus: "escalated", riskAfter: "high",
        automaticReason: "high_risk", assigneeMembershipId: ASSIGNEE,
        assigneeDisplayName: "合成承辦甲", correctedEventId: null,
        note: "合成指派說明。", sensitiveMasked: false,
        actorDisplayName: "合成督導", committedAt: "2026-09-06T03:00:30.000Z",
      },
    ],
  },
  {
    id: "56100000-0000-4000-8000-000000000002",
    caseNumber: "FC-20260904-00000002",
    receivedAt: "2026-09-04T01:00:00.000Z",
    source: "anonymous",
    caseType: "service",
    reportedRisk: "standard",
    effectiveRisk: "high",
    status: "escalated",
    dueAt: "2026-09-05T01:00:00.000Z",
    overdue: true,
    escalationReason: "overdue",
    assigneeMembershipId: SECOND_ASSIGNEE,
    assigneeDisplayName: "合成承辦乙",
    chainVersion: 1,
    latestEventAt: "2026-09-04T01:00:10.000Z",
    reporterName: null,
    reporterContact: null,
    subject: null,
    description: null,
    sensitiveMasked: true,
    timelineTotal: 1,
    timelineTruncated: false,
    timeline: [{
      id: "56200000-0000-4000-8000-000000000003", version: 1,
      eventType: "created", occurredAt: "2026-09-04T01:00:00.000Z",
      resultingStatus: "received", riskAfter: "standard",
      automaticReason: null, assigneeMembershipId: null,
      assigneeDisplayName: null, correctedEventId: null, note: null,
      sensitiveMasked: true, actorDisplayName: "合成受理人",
      committedAt: "2026-09-04T01:00:10.000Z",
    }],
  },
  {
    id: "56100000-0000-4000-8000-000000000003",
    caseNumber: "FC-20260902-00000003",
    receivedAt: "2026-09-02T06:00:00.000Z",
    source: "client",
    caseType: "feedback",
    reportedRisk: "standard",
    effectiveRisk: "standard",
    status: "closed",
    dueAt: "2026-09-06T06:00:00.000Z",
    overdue: false,
    escalationReason: null,
    assigneeMembershipId: ASSIGNEE,
    assigneeDisplayName: "合成承辦甲",
    chainVersion: 3,
    latestEventAt: "2026-09-05T05:00:00.000Z",
    reporterName: "合成陳述人乙",
    reporterContact: null,
    subject: "合成活動安排建議",
    description: "合成資料：建議增加室內活動選項。",
    sensitiveMasked: false,
    timelineTotal: 3,
    timelineTruncated: false,
    timeline: [
      {
        id: "56200000-0000-4000-8000-000000000004", version: 1,
        eventType: "created", occurredAt: "2026-09-02T06:00:00.000Z",
        resultingStatus: "received", riskAfter: "standard",
        automaticReason: null, assigneeMembershipId: null,
        assigneeDisplayName: null, correctedEventId: null, note: null,
        sensitiveMasked: false, actorDisplayName: "合成受理人",
        committedAt: "2026-09-02T06:00:30.000Z",
      },
      {
        id: "56200000-0000-4000-8000-000000000005", version: 2,
        eventType: "assignment", occurredAt: "2026-09-02T07:00:00.000Z",
        resultingStatus: "assigned", riskAfter: "standard",
        automaticReason: null, assigneeMembershipId: ASSIGNEE,
        assigneeDisplayName: "合成承辦甲", correctedEventId: null,
        note: "合成指派。", sensitiveMasked: false,
        actorDisplayName: "合成督導", committedAt: "2026-09-02T07:00:10.000Z",
      },
      {
        id: "56200000-0000-4000-8000-000000000006", version: 3,
        eventType: "closure", occurredAt: "2026-09-05T05:00:00.000Z",
        resultingStatus: "closed", riskAfter: "standard",
        automaticReason: null, assigneeMembershipId: ASSIGNEE,
        assigneeDisplayName: "合成承辦甲", correctedEventId: null,
        note: "合成結案結果：已回覆並完成流程調整。", sensitiveMasked: false,
        actorDisplayName: "合成督導", committedAt: "2026-09-05T05:00:30.000Z",
      },
    ],
  },
] as const;

function matches(record: FeedbackComplaintItem, filters: FeedbackComplaintFilters) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(record.receivedAt));
  const query = filters.query.toLocaleLowerCase("zh-TW");
  return (!filters.receivedFrom || day >= filters.receivedFrom) &&
    (!filters.receivedTo || day <= filters.receivedTo) &&
    (filters.source === "all" || record.source === filters.source) &&
    (filters.caseType === "all" || record.caseType === filters.caseType) &&
    (filters.risk === "all" || record.effectiveRisk === filters.risk) &&
    (filters.assignee === "all" ||
      (filters.assignee === "unassigned" && record.assigneeMembershipId === null) ||
      record.assigneeMembershipId === filters.assignee) &&
    (filters.status === "all" ||
      (filters.status === "overdue" ? record.overdue : record.status === filters.status)) &&
    (!query || [record.caseNumber, record.subject ?? ""].some((value) =>
      value.toLocaleLowerCase("zh-TW").includes(query)));
}

export function buildDemoFeedbackComplaintSnapshot(
  filters: FeedbackComplaintFilters,
): FeedbackComplaintSnapshot {
  const filtered = items.filter((record) => matches(record, filters));
  return {
    organizationId: ORGANIZATION,
    branchId: BRANCH,
    generatedAt: GENERATED_AT,
    staleAfter: "2026-09-07T04:05:00.000Z",
    filters,
    items: filtered,
    matchingTotal: filtered.length,
    itemsTruncated: false,
    metrics: {
      cases: filtered.length,
      highRisk: filtered.filter((record) => record.effectiveRisk === "high").length,
      inProgress: filtered.filter((record) => record.status !== "closed").length,
      overdue: filtered.filter((record) => record.overdue).length,
    },
    assignees: [
      { membershipId: ASSIGNEE, displayName: "合成承辦甲", scope: "branch" },
      { membershipId: SECOND_ASSIGNEE, displayName: "合成承辦乙", scope: "organization" },
    ],
    assigneesTruncated: false,
    deadlineRules: [{
      id: "56300000-0000-4000-8000-000000000001",
      label: "合成示範：家屬／安全／高風險 48 小時",
      source: "family", caseType: "safety", risk: "high", responseHours: 48,
      effectiveFrom: "2026-01-01", effectiveThrough: null,
    }],
    deadlineRuleStatus: "configured",
    escalationEvaluationStatus: "server_clock",
    escalationDeliveryStatus: "not_configured",
    exportStatus: "not_configured",
    canViewSensitive: true,
    demo: true,
  };
}
