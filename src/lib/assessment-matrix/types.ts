import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";

export type AssessmentMatrixCell =
  | { state: "none" }
  | { state: "draft"; versionId: string; version: number; assessedOn: string };

export interface AssessmentMatrixClient {
  clientId: string;
  clientCode: string;
  displayName: string;
  serviceStatus: "active" | "suspended";
  cells: Partial<Record<QuestionnaireFormKey, AssessmentMatrixCell>>;
}

export interface AssessmentMatrixSnapshot {
  month: string;
  generatedAt: string;
  page: number;
  pageSize: number;
  totalClients: number;
  forms: QuestionnaireFormKey[];
  clients: AssessmentMatrixClient[];
  demo?: boolean;
}
