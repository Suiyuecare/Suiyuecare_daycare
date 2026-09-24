import rules from "./rules.json";
import type { ImportPreviewField, ImportStagingField } from "@/lib/imports/types";

export const CARE_REMINDER_RULE_VERSION = "cms-explicit-attention@1";
export { rules as CARE_REMINDER_RULES };
export interface ReminderSuggestion {
  ruleId: string; ruleVersion: string; title: string; text: string;
  fieldId: string; sectionCode: string; label: string; parentPath: string;
  targetPath: string; mappingKey: string; sourceValue: string;
}

/** Explicit option text only. Numeric CMS choices require a reviewed dictionary
 * before use. Generic parser 'mapped' is NOT proof of clinical meaning.
 * This previews review candidates, never a diagnosis or approved care plan. */
export function suggestCareReminders(
  fields: readonly (ImportPreviewField | ImportStagingField)[], mappingVersion: string, conflictKeys: readonly string[] = [],
): ReminderSuggestion[] {
  if (mappingVersion !== "central-care-plan-html@1") return [];
  const valueOf = (field: ImportPreviewField | ImportStagingField) =>
    "displayValue" in field ? field.displayValue : field.normalizedValue;
  return rules.flatMap((rule) => {
    const matches = fields.filter((field) => field.source.sectionCode === rule.section && rule.labels.includes(field.source.label));
    if (!matches.length || matches.some((field) => field.mappingState !== "mapped" || field.warnings.length > 0 || conflictKeys.includes(field.mappingKey) ||
      ("isMasked" in field && field.isMasked) ||
      ("mappingVersion" in field && field.mappingVersion !== mappingVersion) ||
      !field.source.parentPath.startsWith(`${rule.section}/`) ||
      field.mappingKey !== `${rule.section}\u001f${field.source.label}\u001f${field.source.parentPath}` ||
      !field.targetPath?.startsWith(`central.${rule.section.toLowerCase()}.`) ||
      !rule.values.includes(valueOf(field)))) return [];
    if (new Set(matches.map(valueOf)).size !== 1) return [];
    const first = matches[0]!;
    return [{ ruleId: rule.id, ruleVersion: CARE_REMINDER_RULE_VERSION, title: rule.title, text: rule.text,
      fieldId: first.id, sectionCode: first.source.sectionCode, label: first.source.label,
      parentPath: first.source.parentPath, targetPath: first.targetPath!, mappingKey: first.mappingKey,
      sourceValue: valueOf(first) }];
  });
}
