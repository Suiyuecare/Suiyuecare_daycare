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
  | "mna_sf";

export interface QuestionnaireFormDefinition {
  readonly key: QuestionnaireFormKey;
  readonly version: string;
  readonly title: string;
  readonly instructions: string;
  readonly sourceLabel: string;
  readonly sourceUrl?: string;
  readonly scoreVersionId?: AssessmentVersionId;
  readonly allowQualitativeNotes?: boolean;
  readonly contextFields?: readonly {
    readonly key: string;
    readonly label: string;
    readonly required?: boolean;
    readonly choices: readonly { readonly value: string; readonly label: string }[];
  }[];
  readonly measurementFields?: readonly { readonly key: string; readonly label: string }[];
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
}

export interface QuestionnaireAssessment extends QuestionnaireDraft {
  readonly assessmentCreatedAt: string;
}

export interface QuestionnaireAssessmentCursor {
  readonly createdAt: string;
  readonly assessmentKey: string;
}

export interface QuestionnaireAssessmentPage {
  readonly formKey: QuestionnaireFormKey;
  readonly clientId: string;
  readonly assessments: readonly QuestionnaireAssessment[];
  readonly total: number;
  readonly nextCursor: QuestionnaireAssessmentCursor | null;
}

export interface QuestionnaireAssessmentDateMatch {
  readonly assessmentKey: string;
  readonly versionId: string;
  readonly version: number;
  readonly assessedOn: string;
  readonly savedAt: string;
  readonly recordState: "draft";
  readonly assessmentCreatedAt: string;
}

export interface QuestionnaireAssessmentDatePage {
  readonly formKey: QuestionnaireFormKey;
  readonly clientId: string;
  readonly assessedOn: string;
  readonly assessments: readonly QuestionnaireAssessmentDateMatch[];
  readonly total: number;
  readonly nextCursor: QuestionnaireAssessmentCursor | null;
}

export interface QuestionnaireHistoryPage {
  readonly formKey: QuestionnaireFormKey;
  readonly clientId: string;
  readonly assessmentKey: string;
  readonly versions: readonly QuestionnaireDraft[];
  readonly total: number;
  readonly nextBeforeVersion: number | null;
}

export interface QuestionnaireClient {
  readonly clientId: string;
  readonly displayName: string;
  readonly serviceStatus: "active" | "suspended";
  readonly latest: QuestionnaireDraft | null;
  readonly assessments?: readonly QuestionnaireAssessment[];
  readonly assessmentTotal?: number;
  readonly nextAssessmentCursor?: QuestionnaireAssessmentCursor | null;
}

export interface QuestionnaireSnapshot {
  readonly formKey: QuestionnaireFormKey;
  readonly generatedAt: string;
  readonly matchingTotal: number;
  readonly clients: readonly QuestionnaireClient[];
  readonly demo?: boolean;
}
