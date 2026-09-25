export type AssessmentInstrument =
  | "spmsq"
  | "gds_15"
  | "barthel_adl"
  | "lawton_iadl"
  | "mna_sf"
  | "fall_risk_taipei_115"
  | "nsi_determine"
  | "eat10"
  | "bsrs5";

export type AssessmentVersionId =
  | "spmsq-pfeiffer-10-education-adjusted-v1"
  | "gds-15-strict-complete-v1"
  | "barthel-adl-0-100-v1"
  | "lawton-iadl-8-domain-expanded-v1"
  | "mna-sf-revised-2009-v1"
  | "fall-risk-taipei-115-b12-v1"
  | "nsi-determine-10-weighted-v1"
  | "eat10-tw-v1"
  | "bsrs5-zh-tw-v1";

export type AssessmentAnswer<TValue extends string = string> =
  | { readonly state: "answered"; readonly value: TValue }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason?: string };

export type AssessmentAnswers = Readonly<
  Record<string, AssessmentAnswer<string>>
>;

export interface AssessmentSubmission {
  readonly versionId: AssessmentVersionId | (string & {});
  readonly answers: AssessmentAnswers;
  readonly context?: Readonly<Record<string, string>>;
}

export interface AssessmentChoiceDefinition {
  readonly value: string;
  readonly points: number;
}

export interface AssessmentItemDefinition {
  readonly id: string;
  readonly label: string;
  readonly required: true;
  readonly allowNotApplicable: boolean;
  readonly choices: readonly AssessmentChoiceDefinition[];
}

export interface AssessmentContextDefinition {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly choices: readonly string[];
}

export interface AssessmentRuleSource {
  readonly label: string;
  readonly url: string;
}

export interface AssessmentClassification {
  readonly key: string;
  readonly label: string;
  readonly minInclusive: number;
  readonly maxInclusive: number;
  readonly interpretation: "screening_only" | "functional_description";
}

export interface AssessmentAlert {
  readonly code: string;
  readonly level: "info" | "warning";
  readonly message: string;
}

export type AssessmentIssueCode =
  | "VERSION_NOT_FOUND"
  | "MISSING_REQUIRED_ANSWER"
  | "NOT_APPLICABLE_ANSWER"
  | "INVALID_ANSWER"
  | "UNKNOWN_ANSWER"
  | "MISSING_REQUIRED_CONTEXT"
  | "INVALID_CONTEXT"
  | "UNKNOWN_CONTEXT";

export interface AssessmentIssue {
  readonly code: AssessmentIssueCode;
  readonly field: string;
  readonly message: string;
  readonly category: "incomplete" | "invalid";
}

export interface AssessmentScore {
  readonly raw: number | null;
  readonly adjusted: number | null;
  readonly min: number;
  readonly max: number;
  readonly unit: "points" | "errors";
}

export interface AssessmentRuleSnapshot {
  readonly versionId: AssessmentVersionId;
  readonly instrument: AssessmentInstrument;
  readonly title: string;
  readonly ruleRevision: number;
  readonly activatedAt: string | null;
  readonly reviewRequired: boolean;
  readonly scoringPolicy: string;
  readonly disclaimer: string;
  readonly sources: readonly AssessmentRuleSource[];
}

export interface AssessmentResult {
  readonly versionId: string;
  readonly instrument: AssessmentInstrument | null;
  readonly status: "complete" | "incomplete" | "invalid";
  readonly answers: AssessmentAnswers;
  readonly context: Readonly<Record<string, string>>;
  readonly score: AssessmentScore | null;
  readonly classification: AssessmentClassification | null;
  readonly alerts: readonly AssessmentAlert[];
  readonly issues: readonly AssessmentIssue[];
  readonly rule: AssessmentRuleSnapshot | null;
}

export interface AssessmentTestVector {
  readonly id: string;
  readonly submission: AssessmentSubmission;
  readonly expected: {
    readonly status: AssessmentResult["status"];
    readonly rawScore: number | null;
    readonly adjustedScore: number | null;
    readonly classificationKey: string | null;
  };
}
