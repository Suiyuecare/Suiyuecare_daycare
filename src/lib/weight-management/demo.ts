import { projectWeightManagementSnapshot } from "./projection";
import type { WeightManagementFilters, WeightManagementSnapshot } from "./types";

const ids = {
  clients: ["30000000-0000-4000-8000-000000000026", "30000000-0000-4000-8000-000000000027", "30000000-0000-4000-8000-000000000028"],
  current: ["31000000-0000-4000-8000-000000000026", "31000000-0000-4000-8000-000000000028"],
  prior: "32000000-0000-4000-8000-000000000026",
  rule: "33000000-0000-4000-8000-000000000026",
};

function monthTimestamp(month: string, day: string) {
  return `${month.slice(0, 7)}-${day}T10:00:00+08:00`;
}

export function buildDemoWeightSnapshot(organizationId: string, branchId: string, month: string) {
  const priorDate = new Date(`${month}T12:00:00+08:00`);
  priorDate.setMonth(priorDate.getMonth() - 1);
  const priorMonth = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, "0")}-01`;
  const generated = new Date().toISOString();
  const commonRule = { rule_version_id: ids.rule, rule_version_number: 1, absolute_kg_threshold: "1.00", percent_threshold: "2.00", trigger_mode: "either" };
  return projectWeightManagementSnapshot({
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    expectedTargetMonth: month, demo: true,
    row: {
      organization_id: organizationId, branch_id: branchId, target_month: month,
      generated_at: generated, item_total: 3, matching_total: 3,
      measured_total: 2, missing_total: 1, alert_total: 1,
      acknowledged_total: 0, unacknowledged_total: 1, items_truncated: false,
      client_option_total: 3, client_options_truncated: false,
      threshold_rule_status: "published", threshold_rule_id: ids.rule,
      threshold_version_number: 1, absolute_kg_threshold: "1.00",
      percent_threshold: "2.00", trigger_mode: "either",
      client_options: [
        { client_id: ids.clients[0], display_name: "示範個案 林阿姨", client_status: "active", can_record: true },
        { client_id: ids.clients[1], display_name: "示範個案 王伯伯", client_status: "active", can_record: true },
        { client_id: ids.clients[2], display_name: "示範個案 陳女士", client_status: "active", can_record: true },
      ],
      items: [
        {
          client_id: ids.clients[0], client_display_name: "示範個案 林阿姨", client_status: "active",
          current_state: "provided", current_observation_id: ids.current[0], current_original_weight_kg: "70.00", current_weight_kg: "70.00",
          current_observed_at: monthTimestamp(month, "25"), current_source: "人工量測",
          current_recorded_at: monthTimestamp(month, "25"), recorder_display_name: "示範護理師",
          current_correction_id: null, current_correction_version: 0, current_correction_kind: null,
          current_correction_reason: null, prior_state: "provided", prior_observation_id: ids.prior,
          prior_weight_kg: "72.00", prior_observed_at: monthTimestamp(priorMonth, "24"),
          prior_correction_id: null, prior_correction_version: 0, delta_kg: "-2.00",
          delta_percent: "-2.78", change_direction: "loss", alert_status: "unacknowledged",
          ...commonRule, acknowledgement_id: null, acknowledgement_note: null,
          acknowledged_at: null, acknowledged_by: null,
        },
        {
          client_id: ids.clients[1], client_display_name: "示範個案 王伯伯", client_status: "active",
          current_state: "missing", current_observation_id: null, current_original_weight_kg: null, current_weight_kg: null,
          current_observed_at: null, current_source: null, current_recorded_at: null,
          recorder_display_name: null, current_correction_id: null, current_correction_version: 0,
          current_correction_kind: null, current_correction_reason: null, prior_state: "missing",
          prior_observation_id: null, prior_weight_kg: null, prior_observed_at: null,
          prior_correction_id: null, prior_correction_version: 0, delta_kg: null,
          delta_percent: null, change_direction: "unavailable", alert_status: "not_comparable",
          ...commonRule, acknowledgement_id: null, acknowledgement_note: null,
          acknowledged_at: null, acknowledged_by: null,
        },
        {
          client_id: ids.clients[2], client_display_name: "示範個案 陳女士", client_status: "active",
          current_state: "provided", current_observation_id: ids.current[1], current_original_weight_kg: "60.00", current_weight_kg: "60.00",
          current_observed_at: monthTimestamp(month, "20"), current_source: "外部設備匯入",
          current_recorded_at: monthTimestamp(month, "20"), recorder_display_name: "示範護理師",
          current_correction_id: null, current_correction_version: 0, current_correction_kind: null,
          current_correction_reason: null, prior_state: "not_applicable", prior_observation_id: null,
          prior_weight_kg: null, prior_observed_at: null, prior_correction_id: null,
          prior_correction_version: 0, delta_kg: null, delta_percent: null,
          change_direction: "unavailable", alert_status: "not_comparable",
          ...commonRule, acknowledgement_id: null, acknowledgement_note: null,
          acknowledged_at: null, acknowledged_by: null,
        },
      ],
    },
  });
}

export function filterDemoWeightSnapshot(snapshot: WeightManagementSnapshot, filters: WeightManagementFilters): WeightManagementSnapshot {
  const items = snapshot.items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.changeDirection === "all" || item.changeDirection === filters.changeDirection) &&
    (filters.alertStatus === "all" || item.alertStatus === filters.alertStatus ||
      (filters.alertStatus === "alert" && ["acknowledged", "unacknowledged"].includes(item.alertStatus))),
  );
  return {
    ...snapshot, items, itemTotal: items.length, matchingTotal: items.length,
    metrics: {
      measured: items.filter((item) => item.currentState === "provided").length,
      missing: items.filter((item) => item.currentState === "missing").length,
      alerts: items.filter((item) => ["acknowledged", "unacknowledged"].includes(item.alertStatus)).length,
      acknowledged: items.filter((item) => item.alertStatus === "acknowledged").length,
      unacknowledged: items.filter((item) => item.alertStatus === "unacknowledged").length,
    }, itemsTruncated: false,
  };
}
