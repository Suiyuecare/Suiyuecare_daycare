import { projectInfectionEventSnapshot } from "./projection";
import type { InfectionEventFilters, InfectionEventSnapshot } from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const clientA = "25000000-0000-4000-8000-000000000101";
const clientB = "25000000-0000-4000-8000-000000000102";
const clusterId = "25000000-0000-4000-8000-000000000401";
function ago(hours: number) { return new Date(Date.now() - hours * 3_600_000).toISOString(); }

export function buildDemoInfectionEventSnapshot(): InfectionEventSnapshot {
  const generatedAt = new Date().toISOString();
  const firstOccurredAt = ago(5);
  const firstReportedAt = ago(4.8);
  const secondOccurredAt = ago(30);
  const secondReportedAt = ago(29.5);
  const treatmentOccurredAt = ago(29);
  const treatmentCommittedAt = ago(28.8);
  const clusterOccurredAt = ago(9);
  const clusterCommittedAt = ago(8);
  return projectInfectionEventSnapshot({ expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: true, row: {
    organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
    items: [
      {
        incident_id: "25000000-0000-4000-8000-000000000201", client_id: clientA,
        client_display_name: "陳美芳", occurred_at: firstOccurredAt, reported_at: firstReportedAt,
        location: "日照活動區", event_summary: "工作人員記錄當日觀察與已採取的機構處置。",
        infection_type_state: "provided", infection_type_text: "機構人工輸入：呼吸道症狀事件",
        current_cluster_id: null, current_cluster_label: null, reporter_display_name: "李護理師",
        handling_status: "reported", chain_version: 0, last_activity_at: firstReportedAt,
        timeline_total: 0, timeline_truncated: false, timeline: [],
      },
      {
        incident_id: "25000000-0000-4000-8000-000000000202", client_id: clientB,
        client_display_name: "林進財", occurred_at: secondOccurredAt, reported_at: secondReportedAt,
        location: "休息區", event_summary: "依機構流程記錄事件，未由系統判定診斷或群聚。",
        infection_type_state: "missing", infection_type_text: null,
        current_cluster_id: clusterId, current_cluster_label: "8 月人工群聚 A",
        reporter_display_name: "王照服員", handling_status: "in_progress", chain_version: 2,
        last_activity_at: clusterCommittedAt, timeline_total: 2, timeline_truncated: false,
        timeline: [
          { entry_id: "25000000-0000-4000-8000-000000000301", sequence_number: 1,
            entry_type: "treatment", occurred_at: treatmentOccurredAt, entry_text: "完成機構指定處置與聯絡。",
            cluster_id: null, cluster_label: null, closure_outcome: null, closure_reason: null,
            committer_display_name: "李護理師", committed_at: treatmentCommittedAt },
          { entry_id: "25000000-0000-4000-8000-000000000302", sequence_number: 2,
            entry_type: "cluster_link", occurred_at: clusterOccurredAt, entry_text: null,
            cluster_id: clusterId, cluster_label: "8 月人工群聚 A", closure_outcome: null,
            closure_reason: null, committer_display_name: "周督導", committed_at: clusterCommittedAt },
        ],
      },
    ],
    item_total: 2, matching_total: 2, infection_provided_total: 1, linked_total: 1,
    awaiting_action_total: 1, awaiting_closure_total: 1, closed_total: 0, items_truncated: false,
    client_options: [
      { client_id: clientA, display_name: "陳美芳", client_status: "active", admitted_on: "2025-01-10", ended_on: null, can_report: true },
      { client_id: clientB, display_name: "林進財", client_status: "active", admitted_on: "2025-03-12", ended_on: null, can_report: true },
    ], client_options_available_total: 2, client_options_truncated: false,
    infection_type_options: ["機構人工輸入：呼吸道症狀事件"], infection_options_available_total: 1,
    infection_options_truncated: false,
    cluster_options: [{ cluster_id: clusterId, label: "8 月人工群聚 A", created_at: clusterOccurredAt }],
    cluster_options_available_total: 1, cluster_options_truncated: false,
    infection_taxonomy_status: "not_configured", cluster_threshold_status: "not_configured",
    legal_reporting_status: "not_configured",
  } });
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function filterDemoInfectionEventSnapshot(snapshot: InfectionEventSnapshot, filters: InfectionEventFilters): InfectionEventSnapshot {
  const items = snapshot.items.filter((item) => {
    const eventDate = taipeiDate(item.occurredAt);
    return (!filters.dateFrom || eventDate >= filters.dateFrom) && (!filters.dateTo || eventDate <= filters.dateTo) &&
      (!filters.clientId || item.clientId === filters.clientId) &&
      (filters.handlingStatus === "all" || item.handlingStatus === filters.handlingStatus) &&
      (filters.clusterMode === "all" || (filters.clusterMode === "linked") === (item.currentClusterId !== null)) &&
      (!filters.clusterId || item.currentClusterId === filters.clusterId) &&
      (!filters.infectionType ||
        (filters.infectionType === "__missing__" && item.infectionTypeState === "missing") ||
        (filters.infectionType === "__not_applicable__" && item.infectionTypeState === "not_applicable") ||
        (item.infectionTypeState === "provided" && item.infectionTypeText === filters.infectionType));
  });
  return { ...snapshot, items, itemTotal: items.length, matchingTotal: items.length, itemsTruncated: false,
    metrics: { infectionProvided: items.filter((item) => item.infectionTypeState === "provided").length,
      linked: items.filter((item) => item.currentClusterId !== null).length,
      awaitingAction: items.filter((item) => item.handlingStatus === "reported").length,
      awaitingClosure: items.filter((item) => item.handlingStatus === "in_progress").length,
      closed: items.filter((item) => item.handlingStatus === "closed").length } };
}
