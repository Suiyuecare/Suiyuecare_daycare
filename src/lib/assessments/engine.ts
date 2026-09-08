import { getAssessmentDefinition } from "./definitions";
import type {
  AssessmentAlert,
  AssessmentAnswer,
  AssessmentAnswers,
  AssessmentIssue,
  AssessmentResult,
  AssessmentRuleSnapshot,
  AssessmentSubmission,
} from "./types";

export function answered<TValue extends string>(
  value: TValue,
): AssessmentAnswer<TValue> {
  return { state: "answered", value };
}

export function missingAnswer(): AssessmentAnswer {
  return { state: "missing" };
}

export function notApplicableAnswer(reason?: string): AssessmentAnswer {
  return reason === undefined
    ? { state: "not_applicable" }
    : { state: "not_applicable", reason };
}

function ruleSnapshot(
  definition: NonNullable<ReturnType<typeof getAssessmentDefinition>>,
): AssessmentRuleSnapshot {
  return {
    versionId: definition.versionId,
    instrument: definition.instrument,
    title: definition.title,
    ruleRevision: definition.ruleRevision,
    activatedAt: definition.activatedAt,
    reviewRequired: definition.reviewRequired,
    scoringPolicy: definition.scoringPolicy,
    disclaimer: definition.disclaimer,
    sources: definition.sources.map((source) => ({ ...source })),
  };
}

function copyContext(
  context: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(context ?? {}).map(([key, value]) => [key, value]),
  );
}

function copyKnownAnswer(
  value: unknown,
): AssessmentAnswer<string> | undefined {
  if (!value || typeof value !== "object" || !("state" in value)) {
    return undefined;
  }

  const candidate = value as {
    state?: unknown;
    value?: unknown;
    reason?: unknown;
  };
  if (candidate.state === "missing") return { state: "missing" };
  if (candidate.state === "answered" && typeof candidate.value === "string") {
    return { state: "answered", value: candidate.value };
  }
  if (candidate.state === "not_applicable") {
    return typeof candidate.reason === "string"
      ? { state: "not_applicable", reason: candidate.reason }
      : { state: "not_applicable" };
  }
  return undefined;
}

function copyAnswersForUnknownVersion(
  answers: AssessmentAnswers,
): AssessmentAnswers {
  const copied: Record<string, AssessmentAnswer<string>> = {};
  for (const key of Object.keys(answers).sort()) {
    const answer = copyKnownAnswer(answers[key]);
    copied[key] = answer ?? { state: "missing" };
  }
  return copied;
}

function governanceAlerts(
  definition: NonNullable<ReturnType<typeof getAssessmentDefinition>>,
): readonly AssessmentAlert[] {
  const alerts: AssessmentAlert[] = [];
  if (definition.reviewRequired) {
    alerts.push({
      code: "RULE_REVIEW_REQUIRED",
      level: "warning",
      message: "此規則版本仍須業務、法遵與量表授權確認。",
    });
  }
  if (definition.activatedAt === null) {
    alerts.push({
      code: "RULE_NOT_ACTIVATED",
      level: "warning",
      message: "此規則版本尚未核准生效，不得作為正式照顧決策依據。",
    });
  }
  return alerts;
}

export function scoreAssessment(
  submission: AssessmentSubmission,
): AssessmentResult {
  const definition = getAssessmentDefinition(submission.versionId);
  const context = copyContext(submission.context);

  if (!definition) {
    return {
      versionId: submission.versionId,
      instrument: null,
      status: "invalid",
      answers: copyAnswersForUnknownVersion(submission.answers),
      context,
      score: null,
      classification: null,
      alerts: [],
      issues: [
        {
          code: "VERSION_NOT_FOUND",
          field: "versionId",
          message: `找不到評估規則版本：${submission.versionId}`,
          category: "invalid",
        },
      ],
      rule: null,
    };
  }

  const issues: AssessmentIssue[] = [];
  const normalizedAnswers: Record<string, AssessmentAnswer<string>> = {};
  const points: number[] = [];
  const expectedItemIds = new Set(definition.items.map((item) => item.id));

  for (const item of definition.items) {
    const rawAnswer = submission.answers[item.id];
    if (rawAnswer === undefined) {
      normalizedAnswers[item.id] = { state: "missing" };
      issues.push({
        code: "MISSING_REQUIRED_ANSWER",
        field: item.id,
        message: `${item.label}尚未作答。`,
        category: "incomplete",
      });
      continue;
    }

    const normalized = copyKnownAnswer(rawAnswer);
    if (!normalized) {
      normalizedAnswers[item.id] = { state: "missing" };
      issues.push({
        code: "INVALID_ANSWER",
        field: item.id,
        message: `${item.label}的答案格式無效。`,
        category: "invalid",
      });
      continue;
    }
    normalizedAnswers[item.id] = normalized;

    if (normalized.state === "missing") {
      issues.push({
        code: "MISSING_REQUIRED_ANSWER",
        field: item.id,
        message: `${item.label}尚未作答。`,
        category: "incomplete",
      });
      continue;
    }
    if (normalized.state === "not_applicable") {
      issues.push({
        code: "NOT_APPLICABLE_ANSWER",
        field: item.id,
        message: item.allowNotApplicable
          ? `${item.label}標記為不適用，本版本不會推估分數。`
          : `${item.label}在此規則版本不可標記為不適用。`,
        category: "incomplete",
      });
      continue;
    }

    const choice = item.choices.find(
      (candidate) => candidate.value === normalized.value,
    );
    if (!choice) {
      issues.push({
        code: "INVALID_ANSWER",
        field: item.id,
        message: `${item.label}的選項不在規則版本允許範圍內。`,
        category: "invalid",
      });
      continue;
    }
    points.push(choice.points);
  }

  for (const answerId of Object.keys(submission.answers).sort()) {
    if (expectedItemIds.has(answerId)) continue;
    const copied = copyKnownAnswer(submission.answers[answerId]);
    if (copied) normalizedAnswers[answerId] = copied;
    issues.push({
      code: "UNKNOWN_ANSWER",
      field: answerId,
      message: `規則版本不包含答案欄位：${answerId}`,
      category: "invalid",
    });
  }

  const expectedContextIds = new Set(
    definition.context.map((contextField) => contextField.id),
  );
  for (const contextField of definition.context) {
    const value = context[contextField.id];
    if (value === undefined || value.length === 0) {
      if (contextField.required) {
        issues.push({
          code: "MISSING_REQUIRED_CONTEXT",
          field: contextField.id,
          message: `${contextField.label}尚未提供。`,
          category: "incomplete",
        });
      }
      continue;
    }
    if (!contextField.choices.includes(value)) {
      issues.push({
        code: "INVALID_CONTEXT",
        field: contextField.id,
        message: `${contextField.label}不在規則版本允許範圍內。`,
        category: "invalid",
      });
    }
  }
  for (const contextId of Object.keys(context).sort()) {
    if (expectedContextIds.has(contextId)) continue;
    issues.push({
      code: "UNKNOWN_CONTEXT",
      field: contextId,
      message: `規則版本不包含情境欄位：${contextId}`,
      category: "invalid",
    });
  }

  const status = issues.some((issue) => issue.category === "invalid")
    ? "invalid"
    : issues.length > 0
      ? "incomplete"
      : "complete";
  const rule = ruleSnapshot(definition);
  const baseAlerts = governanceAlerts(definition);

  if (status !== "complete") {
    return {
      versionId: definition.versionId,
      instrument: definition.instrument,
      status,
      answers: normalizedAnswers,
      context,
      score: {
        raw: null,
        adjusted: null,
        min: definition.scoreMin,
        max: definition.scoreMax,
        unit: definition.scoreUnit,
      },
      classification: null,
      alerts: baseAlerts,
      issues,
      rule,
    };
  }

  const rawScore = points.reduce((total, value) => total + value, 0);
  const adjustedScore = definition.adjustScore(rawScore, context);
  const classification = definition.classify(adjustedScore);

  return {
    versionId: definition.versionId,
    instrument: definition.instrument,
    status: "complete",
    answers: normalizedAnswers,
    context,
    score: {
      raw: rawScore,
      adjusted: adjustedScore,
      min: definition.scoreMin,
      max: definition.scoreMax,
      unit: definition.scoreUnit,
    },
    classification,
    alerts: [
      ...baseAlerts,
      ...definition.buildAlerts(adjustedScore, classification),
    ],
    issues,
    rule,
  };
}

