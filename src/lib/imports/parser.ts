import { createHash } from "node:crypto";

import { load, type CheerioAPI } from "cheerio/slim";

import { ImportError } from "./errors";
import type {
  ImportConflict,
  ImportFieldSource,
  ImportSection,
  ImportSecurityReport,
  ImportStagingField,
  ImportWarning,
  ParsedHtmlImport,
  SupportedMappingVersion,
  ValidatedHtmlImport,
} from "./types";

type Selection = ReturnType<CheerioAPI>;

const SECTION_SELECTOR = "h5, [data-import-section]";
export const MAX_HTML_MARKUP_TOKENS = 200_000;
export const MAX_IMPORT_SECTIONS = 500;
export const MAX_IMPORT_FIELDS = 50_000;
export const MAX_IMPORT_FIELD_CHARACTERS = 250_000;
const ACTIVE_ELEMENT_SELECTOR = "iframe,frame,object,embed,applet";
const STRIPPED_ELEMENT_SELECTOR =
  "script,style,noscript,template,iframe,frame,object,embed,applet,link,base";
const URL_ATTRIBUTES = new Set([
  "src",
  "srcset",
  "href",
  "action",
  "formaction",
  "poster",
  "data",
  "codebase",
]);

const KNOWN_SECTIONS: ReadonlyArray<{
  code: string;
  matches: (title: string) => boolean;
}> = [
  { code: "SUPERVISOR_CARE_PLAN", matches: (value) => value.includes("照顧計畫-簽審督導") },
  { code: "A_UNIT_CARE_PLAN", matches: (value) => value.includes("個案管理照顧計畫") },
  { code: "A_UNIT_RECOMMENDATIONS", matches: (value) => value.includes("綜合問題與建議") },
  { code: "A_UNIT_CONTACT", matches: (value) => value.includes("個管聯絡資訊") },
  { code: "A_UNIT_CORRECTION", matches: (value) => value.includes("A單位希望修正內容") },
  { code: "ASSESSMENT_EF_GUIDE", matches: (value) => value.startsWith("E 大題日常活動功能量表") },
  { code: "ASSESSMENT_A", matches: (value) => /^A[.．]個案基本資料/u.test(value) },
  { code: "ASSESSMENT_B", matches: (value) => /^B[.．]/u.test(value) },
  { code: "ASSESSMENT_C", matches: (value) => /^C[.．]/u.test(value) },
  { code: "ASSESSMENT_D", matches: (value) => /^D[.．]/u.test(value) },
  { code: "ASSESSMENT_E", matches: (value) => /^E[.．]/u.test(value) },
  { code: "ASSESSMENT_F", matches: (value) => /^F[.．]/u.test(value) },
  { code: "ASSESSMENT_G", matches: (value) => /^G[.．]/u.test(value) },
  { code: "ASSESSMENT_H", matches: (value) => /^H[.．]/u.test(value) },
  { code: "ASSESSMENT_I", matches: (value) => /^I[.．]/u.test(value) },
  { code: "ASSESSMENT_J", matches: (value) => /^J[.．]/u.test(value) },
  { code: "ASSESSMENT_K", matches: (value) => /^K[.．]/u.test(value) },
  { code: "APPLICATION_INFO", matches: (value) => value.startsWith("申請資訊") },
  { code: "APPLICATION", matches: (value) => value.startsWith("申請表") },
  { code: "PROCESS_STATUS", matches: (value) => value.startsWith("處理狀態") },
  { code: "CLIENT_BASIC", matches: (value) => value.includes("需要服務者基本資料") },
  { code: "ICF", matches: (value) => value.includes("身心障礙證明") && value.includes("ICF") },
  { code: "AGENT", matches: (value) => value.startsWith("代理人") },
  { code: "PRIMARY_CONTACT", matches: (value) => value.startsWith("主要聯絡人資料") },
  { code: "ASSESSMENT_RESULT", matches: (value) => value.startsWith("評估結果") },
  { code: "PLAN_SUMMARY", matches: (value) => value.startsWith("計畫簡述") },
  { code: "CARE_PLAN", matches: (value) => value === "照顧計畫" || value.startsWith("照顧計畫 ") },
  { code: "IMAGES", matches: (value) => value.startsWith("圖片上傳") },
  { code: "PAYMENT_ATTACHMENTS", matches: (value) => value.includes("支付Excel") || value.includes("支付 EXCEL") },
  { code: "DIAGNOSIS_ATTACHMENT", matches: (value) => value.startsWith("診斷書上傳") },
  { code: "ASSISTIVE_REPORT", matches: (value) => value.startsWith("輔具評估報告書") },
  { code: "SERVICE_B", matches: (value) => value.includes("服務(B)") },
  { code: "SERVICE_C", matches: (value) => value.includes("服務(C)") },
  { code: "SERVICE_D", matches: (value) => value.includes("接送(D)") },
  { code: "SERVICE_EI", matches: (value) => value.includes("輔具(EI)") },
  { code: "SERVICE_EF", matches: (value) => value.includes("服務(EF)") },
  { code: "SERVICE_G", matches: (value) => value.includes("服務(G)") },
  { code: "SERVICE_S", matches: (value) => value.includes("短照(S)") },
  { code: "SERVICE_OTHT", matches: (value) => value.includes("其他(OTHT)") },
  { code: "SERVICE_Z", matches: (value) => value.includes("項目(Z)") },
  { code: "SUPERVISOR_1", matches: (value) => value.startsWith("簽審督導一") },
  { code: "SUPERVISOR_2", matches: (value) => value.startsWith("簽審督導二") },
];

const SENSITIVE_LABEL =
  /(?:姓名|身分證|居留證|護照|電話|手機|地址|住址|生日|出生|電子郵件|email|帳號|診斷|病歷|聯絡人)/iu;

function shortHash(value: string, length = 16) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function enforcePreParseComplexityLimit(text: string) {
  let markupTokens = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 60) continue;
    const next = text.charCodeAt(index + 1);
    const couldStartMarkup =
      next === 33 ||
      next === 47 ||
      next === 63 ||
      (next >= 65 && next <= 90) ||
      (next >= 97 && next <= 122);
    if (!couldStartMarkup) continue;
    markupTokens += 1;
    if (markupTokens > MAX_HTML_MARKUP_TOKENS) {
      throw new ImportError(
        "HTML_COMPLEXITY_LIMIT_EXCEEDED",
        "HTML 結構過於複雜，已停止解析；正式資料未變更。",
        413,
        "file",
      );
    }
  }
}

export function normalizeImportText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/\u00A0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeHeading(value: string) {
  return normalizeImportText(value)
    .replace(/勾選後此區不列印/gu, "")
    .replace(/查看服務項目明細/gu, "")
    .replace(/介接說明/gu, "")
    .replace(/說明\s*$/gu, "")
    .replace(/setQtip\([^)]*\)/giu, "")
    .replace(/A單位編輯C碼後才可勾選/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanElementText($: CheerioAPI, element: Selection) {
  const clone = element.clone();
  clone
    .find(
      "script,style,noscript,template,button,input,select,textarea,.no-print,.noprint",
    )
    .remove();
  return normalizeImportText(clone.text());
}

function classifySection(title: string, sourceHeadingId: string | null) {
  const known = KNOWN_SECTIONS.find((candidate) => candidate.matches(title));
  if (known) {
    return { code: known.code, recognized: true };
  }

  const stableSourceId = sourceHeadingId
    ?.replace(/-header$/iu, "")
    .replace(/[^a-zA-Z0-9_-]/gu, "_")
    .toUpperCase();
  return {
    code: stableSourceId || `UNKNOWN_${shortHash(title, 10).toUpperCase()}`,
    recognized: false,
  };
}

function inspectAndNeutralizeDocument($: CheerioAPI): ImportSecurityReport {
  const scriptElementsBlocked = $("script").length;
  const formElementsNeutralized = $("form").length;
  const redirectElementsBlocked = $("meta").filter((_, element) =>
    /^refresh$/iu.test($(element).attr("http-equiv") ?? ""),
  ).length;
  const activeElementsBlocked = $(ACTIVE_ELEMENT_SELECTOR).length;

  let inlineEventHandlersBlocked = 0;
  let externalReferencesBlocked = 0;

  $("*").each((_, element) => {
    for (const attributeName of Object.keys($(element).attr() ?? {})) {
      if (/^on/iu.test(attributeName)) {
        inlineEventHandlersBlocked += 1;
        $(element).removeAttr(attributeName);
      }
      if (URL_ATTRIBUTES.has(attributeName.toLowerCase())) {
        const attributeValue = $(element).attr(attributeName);
        if (attributeValue && attributeValue.trim() !== "") {
          externalReferencesBlocked += 1;
        }
        $(element).removeAttr(attributeName);
      }
    }
  });

  $("meta").filter((_, element) =>
    /^refresh$/iu.test($(element).attr("http-equiv") ?? ""),
  ).remove();
  $(STRIPPED_ELEMENT_SELECTOR).remove();
  $("form").removeAttr("method enctype target autocomplete novalidate");

  return {
    parser: "cheerio-static",
    scriptElementsBlocked,
    formElementsNeutralized,
    redirectElementsBlocked,
    activeElementsBlocked,
    inlineEventHandlersBlocked,
    externalReferencesBlocked,
    externalRequestCount: 0,
  };
}

function buildSectionScope(
  $: CheerioAPI,
  heading: Selection,
  sourceHeadingId: string | null,
) {
  const wrapper = $("<section-scope></section-scope>");
  const bodyId = sourceHeadingId?.replace(/-header$/iu, "-body");
  const body = bodyId
    ? heading.siblings().filter((_, element) => $(element).attr("id") === bodyId).first()
    : $([]);

  if (body.length > 0) {
    const directNestedHeading = body.children(SECTION_SELECTOR).first();
    if (directNestedHeading.length > 0) {
      directNestedHeading.prevAll().toArray().reverse().forEach((node) => {
        wrapper.append($(node).clone());
      });
    } else {
      wrapper.append(body.clone());
    }
    return wrapper;
  }

  heading.nextUntil(SECTION_SELECTOR).each((_, element) => {
    wrapper.append($(element).clone());
  });
  return wrapper;
}

function safePathToken(value: string | undefined) {
  if (!value || value.length > 80 || !/^[\w:.-]+$/u.test(value)) {
    return null;
  }
  return value;
}

function parentPath($: CheerioAPI, element: Selection, sectionCode: string) {
  const path: string[] = [];
  let current = element.parent();

  while (current.length > 0 && current[0]?.tagName !== "section-scope") {
    const tag = current[0]?.tagName ?? "node";
    const id = safePathToken(current.attr("id"));
    const classes = (current.attr("class") ?? "")
      .split(/\s+/u)
      .map((item) => safePathToken(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 2);
    path.push(`${tag}${id ? `#${id}` : ""}${classes.map((item) => `.${item}`).join("")}`);
    current = current.parent();
  }

  return `${sectionCode}/${path.reverse().join("/") || "root"}`;
}

function normalizeLabel(value: string) {
  return normalizeImportText(value)
    .replace(/^[＊*※\s]+/gu, "")
    .replace(/[：:]\s*$/gu, "")
    .slice(0, 500);
}

function fieldTargetPath(sectionCode: string, label: string, path: string) {
  return `central.${sectionCode.toLowerCase()}.${shortHash(`${label}\u0000${path}`, 20)}`;
}

function controlLabel($: CheerioAPI, control: Selection) {
  const id = control.attr("id");
  if (id) {
    const matchingLabel = $("label").filter(
      (_, element) => $(element).attr("for") === id,
    ).first();
    const labelText = cleanElementText($, matchingLabel);
    if (labelText) return normalizeLabel(labelText);
  }

  const wrappedLabel = control.closest("label");
  const wrappedText = cleanElementText($, wrappedLabel);
  if (wrappedText) return normalizeLabel(wrappedText);

  const cell = control.closest("th,td");
  if (cell.length > 0) {
    const previousCell = cell.prev("th,td");
    const previousText = cleanElementText($, previousCell);
    if (previousText) return normalizeLabel(previousText);

    const cellClone = cell.clone();
    cellClone.find("input,select,textarea,button").remove();
    const cellText = normalizeLabel(cleanElementText($, cellClone));
    if (cellText) return cellText;
  }

  return normalizeLabel(
    control.attr("aria-label") ??
      control.attr("name") ??
      control.attr("id") ??
      "",
  );
}

function controlValue($: CheerioAPI, control: Selection) {
  const tag = control.prop("tagName")?.toString().toLowerCase();
  if (tag === "select") {
    const selected = control.find("option:selected");
    const options = (selected.length > 0 ? selected : control.find("option").first())
      .toArray()
      .map((element) => normalizeImportText($(element).text() || $(element).attr("value") || ""))
      .filter(Boolean);
    return options.join("；");
  }
  if (tag === "textarea") {
    return normalizeImportText(control.text() || control.attr("value") || "");
  }

  const type = (control.attr("type") ?? "text").toLowerCase();
  if (type === "checkbox" || type === "radio") {
    return control.is(":checked")
      ? normalizeImportText(control.attr("value") ?? "已勾選")
      : "未勾選";
  }
  return normalizeImportText(control.attr("value") ?? "");
}

function extractSectionFields(
  $: CheerioAPI,
  scope: Selection,
  section: ImportSection,
  mappingVersion: SupportedMappingVersion,
) {
  const candidates: Array<{
    label: string;
    rawValue: string;
    path: string;
    controlName: string | null;
  }> = [];

  scope
    .find("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea")
    .each((_, element) => {
      const control = $(element);
      const label = controlLabel($, control);
      if (!label) return;
      candidates.push({
        label,
        rawValue: controlValue($, control),
        path: parentPath($, control, section.code),
        controlName: control.attr("name") ?? control.attr("id") ?? null,
      });
    });

  scope.find("tr").each((_, rowElement) => {
    const row = $(rowElement);
    const cells = row.children("th,td");
    if (cells.length < 2) return;

    const headerCells = cells.filter("th");
    if (headerCells.length > 0) {
      headerCells.each((__, headerElement) => {
        const header = $(headerElement);
        const valueCell = header.next("td");
        const label = normalizeLabel(cleanElementText($, header));
        if (!label || valueCell.length === 0) return;
        candidates.push({
          label,
          rawValue: cleanElementText($, valueCell),
          path: parentPath($, header, section.code),
          controlName: null,
        });
      });
      return;
    }

    const first = cells.first();
    const label = normalizeLabel(cleanElementText($, first));
    if (!label) return;
    const rawValue = cells
      .slice(1)
      .toArray()
      .map((element) => cleanElementText($, $(element)))
      .filter(Boolean)
      .join("；");
    candidates.push({
      label,
      rawValue,
      path: parentPath($, first, section.code),
      controlName: null,
    });
  });

  const exactSeen = new Set<string>();
  const fields: ImportStagingField[] = [];
  for (const candidate of candidates) {
    if (candidate.rawValue.length > MAX_IMPORT_FIELD_CHARACTERS) {
      throw new ImportError(
        "HTML_FIELD_LIMIT_EXCEEDED",
        "HTML 單一欄位內容超過安全上限，已停止解析；正式資料未變更。",
        413,
        "file",
      );
    }
    const normalizedValue = normalizeImportText(candidate.rawValue);
    const source: ImportFieldSource = {
      sectionCode: section.code,
      sectionTitle: section.title,
      label: candidate.label,
      parentPath: candidate.path,
      controlName: candidate.controlName,
    };
    const mappingKey = `${section.code}\u001f${candidate.label}\u001f${candidate.path}`;
    const exactKey = `${mappingKey}\u001f${normalizedValue}`;
    if (exactSeen.has(exactKey)) continue;
    exactSeen.add(exactKey);

    const warnings = normalizedValue ? [] : ["EMPTY_VALUE"];
    fields.push({
      id: `field_${shortHash(`${mappingVersion}\u0000${exactKey}`, 24)}`,
      mappingKey,
      mappingVersion,
      mappingState: section.recognized ? "mapped" : "unknown",
      targetPath: section.recognized
        ? fieldTargetPath(section.code, candidate.label, candidate.path)
        : null,
      source,
      rawValue: candidate.rawValue,
      normalizedValue,
      sensitive: SENSITIVE_LABEL.test(candidate.label),
      warnings,
    });
    if (fields.length > MAX_IMPORT_FIELDS) {
      throw new ImportError(
        "HTML_FIELD_COUNT_LIMIT_EXCEEDED",
        "HTML 欄位數超過安全上限，已停止解析；正式資料未變更。",
        413,
        "file",
      );
    }
  }

  return fields;
}

function detectConflicts(fields: ImportStagingField[]) {
  const groups = new Map<string, ImportStagingField[]>();
  for (const field of fields) {
    const group = groups.get(field.mappingKey) ?? [];
    group.push(field);
    groups.set(field.mappingKey, group);
  }

  const conflicts: ImportConflict[] = [];
  for (const [mappingKey, group] of groups) {
    const candidates = group.filter(
      (field, index, all) =>
        all.findIndex(
          (candidate) => candidate.normalizedValue === field.normalizedValue,
        ) === index,
    );
    if (candidates.length < 2) continue;
    for (const field of group) field.mappingState = "conflict";
    const first = group[0];
    if (!first) continue;
    conflicts.push({
      id: `conflict_${shortHash(`${mappingKey}\u0000${candidates.map((candidate) => candidate.normalizedValue).join("\u001f")}`, 24)}`,
      mappingKey,
      sectionCode: first.source.sectionCode,
      label: first.source.label,
      candidates: candidates.map((candidate) => ({
        fieldId: candidate.id,
        value: candidate.normalizedValue,
      })),
      reason: "multiple_source_values",
    });
  }
  return conflicts;
}

function fingerprint(
  mappingVersion: string,
  sections: ImportSection[],
  fields: ImportStagingField[],
) {
  const canonical = {
    mappingVersion,
    sections: sections.map(({ code, title }) => ({ code, title })),
    fields: fields
      .map((field) => ({
        mappingKey: field.mappingKey,
        normalizedValue: field.normalizedValue,
      }))
      .sort((left, right) =>
        `${left.mappingKey}\u0000${left.normalizedValue}`.localeCompare(
          `${right.mappingKey}\u0000${right.normalizedValue}`,
        ),
      ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function parseCentralCareHtml(
  file: ValidatedHtmlImport,
  mappingVersion: SupportedMappingVersion,
): ParsedHtmlImport {
  enforcePreParseComplexityLimit(file.text);
  // `load` parses an already supplied string. It never invokes Cheerio's
  // network-capable `fromURL`, and scripting is explicitly disabled.
  const $ = load(file.text, { scriptingEnabled: false });
  const security = inspectAndNeutralizeDocument($);
  const warnings: ImportWarning[] = [];
  const sections: ImportSection[] = [];
  const fields: ImportStagingField[] = [];

  $(SECTION_SELECTOR).each((index, element) => {
    if (sections.length >= MAX_IMPORT_SECTIONS) {
      throw new ImportError(
        "HTML_SECTION_COUNT_LIMIT_EXCEEDED",
        "HTML 區段數超過安全上限，已停止解析；正式資料未變更。",
        413,
        "file",
      );
    }
    const heading = $(element);
    const sourceHeadingId = heading.attr("id") ?? null;
    const title = normalizeHeading(cleanElementText($, heading));
    if (!title) return;
    const classification = classifySection(title, sourceHeadingId);
    const section: ImportSection = {
      id: `section_${shortHash(`${index}\u0000${classification.code}\u0000${title}`, 20)}`,
      index: sections.length,
      code: classification.code,
      title,
      sourceHeadingId,
      recognized: classification.recognized,
    };
    sections.push(section);

    if (!section.recognized) {
      warnings.push({
        id: `warning_${shortHash(`unknown-section\u0000${section.id}`, 20)}`,
        code: "UNKNOWN_SECTION",
        severity: "warning",
        message: "此區段尚未列入目前的欄位映射版本，內容已保留待人工映射。",
        sectionCode: section.code,
      });
    }

    const scope = buildSectionScope($, heading, sourceHeadingId);
    fields.push(...extractSectionFields($, scope, section, mappingVersion));
  });

  if (sections.length === 0) {
    throw new ImportError(
      "NO_IMPORT_SECTIONS",
      "HTML 中找不到可辨識的中央照顧計畫區段。",
      422,
      "file",
    );
  }

  if (security.externalReferencesBlocked > 0) {
    warnings.push({
      id: `warning_${shortHash("external-references", 20)}`,
      code: "EXTERNAL_REFERENCES_BLOCKED",
      severity: "info",
      message: "檔案中的外部資源參照已封鎖，解析期間未發出任何網路請求。",
    });
  }

  const hiddenFieldCount = $("input[type=hidden]").length;
  if (hiddenFieldCount > 0) {
    warnings.push({
      id: `warning_${shortHash("hidden-fields", 20)}`,
      code: "HIDDEN_FIELDS_IGNORED",
      severity: "info",
      message: "隱藏控制欄位已忽略，不會匯入工作階段或內部識別資料。",
    });
  }

  const conflicts = detectConflicts(fields);
  return {
    mappingVersion,
    sections,
    fields,
    warnings,
    conflicts,
    contentFingerprint: fingerprint(mappingVersion, sections, fields),
    security,
  };
}

export function isSensitiveImportLabel(label: string) {
  return SENSITIVE_LABEL.test(label);
}
