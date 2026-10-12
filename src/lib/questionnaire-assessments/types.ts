import type { QuestionnairePrompt } from "@/lib/assessments/question-content";
import type { AssessmentVersionId } from "@/lib/assessments/types";

export type QuestionnaireFormKey =
  | "spmsq"
  | "gds_15"
  | "barthel_adl"
  | "lawton_iadl"
  | "eat10_swallowing"
  | "bsrs5"
  | "fall_risk_taipei_115"
  | "nsi_determine"
  | "mna_sf"
  | "full_mna";

export interface QuestionnaireFormDefinition {
  readonly key: QuestionnaireFormKey;
  readonly version: string;
  readonly title: string;
  readonly instructions: string;
  readonly sourceLabel: string;
  readonly sourceUrl?: string;
  readonly sourceHash?: string;
  readonly scoreVersionId?: AssessmentVersionId;
  readonly allowQualitativeNotes?: boolean;
  readonly contextFields?: readonly {
    readonly key: string;
    readonly label: string;
    readonly required?: boolean;
    readonly questionId?: string;
    readonly choices: readonly { readonly value: string; readonly label: string }[];
  }[];
  readonly measurementFields?: readonly { readonly key: string; readonly label: string; readonly questionId?: string }[];
  readonly questions: readonly QuestionnairePrompt[];
}

export type QuestionnaireAnswer =
  | { readonly state: "answered"; readonly value: string }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };

export type QuestionnaireAnswers = Readonly<Record<string, QuestionnaireAnswer>>;

export interface QuestionnaireDraft {
  readonly assessmentKey: string;
  readonly versionId: string;
  readonly version: number;
  readonly formVersion: string;
  readonly assessedOn: string;
  readonly answers: QuestionnaireAnswers;
  readonly context: Readonly<Record<string, string>>;
  readonly authorDisplayName: string;
  readonly createdAt: string;
  readonly contentHash: string;
  readonly recordState?: "draft" | "submitted" | "signed";
  readonly formSnapshot?: QuestionnaireFormDefinition;
  readonly isLatest?: boolean;
  readonly correctionOfVersionId?: string | null;
  readonly changeReason?: string | null;
  readonly followUpDueOn?: string | null;
  readonly signedAt?: string | null;
  readonly signerDisplayName?: string | null;
  readonly ruleAvailable?: boolean;
  readonly resultSnapshot?: {
    readonly status: "complete" | "incomplete";
    readonly raw: number | null;
    readonly adjusted: number | null;
    readonly classification: { readonly label: string; readonly [key: string]: unknown } | null;
    readonly unit: string;
    readonly incompleteCount: number;
  } | null;
}

export interface QuestionnaireSelection {
  readonly versionId: string | null;
  readonly month: string | null;
  readonly newAssessment: boolean;
  readonly historyPage?: number;
}

export interface QuestionnaireHistory {
  readonly assessmentKey: string;
  readonly versionId: string;
  readonly version: number;
  readonly assessedOn: string;
  readonly recordState: "draft" | "submitted" | "signed";
  readonly authorDisplayName: string;
  readonly followUpDueOn: string | null;
  readonly signedAt: string | null;
  readonly correctionOfVersionId: string | null;
  readonly versions: readonly { versionId: string; version: number; recordState: "draft" | "submitted" | "signed"; createdAt: string }[];
}

export interface QuestionnaireClient {
  readonly clientId: string;
  readonly displayName: string;
  readonly serviceStatus: "pending" | "active" | "suspended";
  readonly latest: QuestionnaireDraft | null;
}

export interface QuestionnaireSnapshot {
  readonly formKey: QuestionnaireFormKey;
  readonly generatedAt: string;
  readonly matchingTotal: number;
  readonly clients: readonly QuestionnaireClient[];
  readonly demo?: boolean;
  readonly history?: readonly QuestionnaireHistory[];
  readonly historyTotal?: number;
  readonly historyPage?: number;
  readonly canSign?: boolean;
  readonly selection?: QuestionnaireSelection;
}
