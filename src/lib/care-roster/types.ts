export const ROSTER_TASK_LABELS = {
  temperature: "體溫", pulse: "脈搏", blood_pressure: "血壓", oxygen_saturation: "血氧", care_diary: "照顧日誌",
} as const;
export type RosterTaskKind = keyof typeof ROSTER_TASK_LABELS;
export type RosterShift = "morning" | "afternoon";
export type ServiceEligibility = "eligible" | "not_admitted" | "inactive";
export type RosterTask = { kind: RosterTaskKind; status: "pending" | "recorded" | "restricted"; evidenceAt: string | null };
export type CareRosterAssignment = {
  id: string; clientId: string; staffUserId: string | null; staffName: string | null;
  serviceDate: string; shift: RosterShift; version: number; state: "scheduled" | "cancelled";
  isServiceEligible: boolean; serviceEligibility: ServiceEligibility;
  /** Joined only through the existing audited directory, never raw roster data. */
  clientIdentity?: { displayName: string; clientCode: string } | null;
  sourceNote: string; tasks: RosterTask[];
};
export type CareRosterSnapshot = {
  status: "ready" | "empty" | "unavailable";
  manager: boolean; assignments: CareRosterAssignment[];
  staffOptions: { userId: string; name: string }[];
  demo: boolean;
};
