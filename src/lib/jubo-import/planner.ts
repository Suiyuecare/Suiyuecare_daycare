import "server-only";

import { createHmac } from "node:crypto";
import { intakeProfileSchema, isCalendarDate, type IntakeProfile } from "@/lib/client-intake/model";

/**
 * This module plans an import only. It does not read XLSX files, query the
 * database, or create clients. Callers must keep the resulting raw rows in a
 * protected staging area and obtain human approval before any write.
 */
export type JuboSheet = {
  readonly sheetName: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /** Optional original cell values before trusted XLSX date normalization. */
  readonly rawRows?: readonly (readonly unknown[])[];
  /** Optional OOXML cell types aligned to each source row and column. */
  readonly rawCellTypes?: readonly (readonly (string | null)[])[];
  /** Sparse, non-client source footer rows, retained with original coordinates. */
  readonly nonRecordRows?: readonly {
    readonly sheetRow: number;
    readonly normalizedValues: readonly unknown[];
    readonly rawValues: readonly unknown[];
    readonly rawCellTypes: readonly (string | null)[];
  }[];
};

export type JuboRawColumn = {
  /** Zero-based array index; duplicate headers remain separate columns. */
  readonly index: number;
  /** One-based spreadsheet column number. */
  readonly columnNumber: number;
  readonly header: string;
  readonly value: unknown;
  readonly sourceCellType?: string | null;
};

export type JuboRawRow = {
  readonly sheetName: string;
  readonly sheetRow: number;
  readonly columns: readonly JuboRawColumn[];
};

export type JuboOperationalDates = {
  /** Jubo 開案日期 is source evidence, never an admitted_on value. */
  readonly sourceOpenedOn: string | null;
  readonly sourceFirstServiceOn: string | null;
  readonly sourceClosedOn: string | null;
  readonly admittedOn: null;
};

/** Mirrors public.client_status without implying that a status was approved for persistence. */
export type JuboServiceStatus = "active" | "suspended" | "closed";
export type JuboWarningCode =
  | "MISSING_MONTHLY_SUMMARY"
  | "MISSING_DATE_OF_BIRTH"
  | "MISSING_CONTACT_PHONE"
  | "REVIEW_WEEKLY_SCHEDULE"
  | "REVIEW_TRANSPORT"
  | "REVIEW_ABCD_ASSESSMENTS"
  | "REVIEW_IDENTITY_DOCUMENT"
  | "REVIEW_MEDICATION_EVIDENCE"
  | "REVIEW_HEALTH_EXAM"
  | "REVIEW_CONSENT";

export type JuboPlannedClient = {
  readonly profile: IntakeProfile;
  readonly serviceStatus: JuboServiceStatus;
  readonly dates: JuboOperationalDates;
  readonly master: JuboRawRow;
  readonly monthlySummary: JuboRawRow | null;
  readonly warnings: readonly JuboWarningCode[];
};

export type JuboImportPlan = {
  readonly mappingVersion: "jubo-master-monthly-202610-v1";
  readonly organizationId: string;
  readonly branchId: string;
  readonly masterRowCount: number;
  readonly monthlySummaryRowCount: number;
  readonly matchedSummaryRowCount: number;
  readonly clients: readonly JuboPlannedClient[];
};

export type JuboImportInput = {
  readonly organizationId: string;
  readonly branchId: string;
  /** A server-only, deployment-managed secret containing at least 32 UTF-8 bytes. */
  readonly hmacSecret: string | Uint8Array;
  readonly master: JuboSheet;
  readonly monthlySummary: JuboSheet;
  /** Pin the first migration's expected 23/17 rows before approving it. */
  readonly expectedCounts?: { readonly master: number; readonly monthlySummary: number };
};

export type JuboPlanningErrorCode =
  | "INVALID_SCOPE"
  | "WEAK_SECRET"
  | "INVALID_SHEET"
  | "INVALID_HEADER"
  | "INVALID_ROW_WIDTH"
  | "INVALID_COUNT"
  | "INVALID_IDENTITY"
  | "DUPLICATE_IDENTITY"
  | "UNMATCHED_SUMMARY"
  | "UNKNOWN_STATUS"
  | "UNKNOWN_SEX"
  | "INVALID_DATE"
  | "INVALID_FIELD"
  | "HASH_COLLISION"
  | "INVALID_PROFILE";

export class JuboPlanningError extends Error {
  constructor(
    public readonly code: JuboPlanningErrorCode,
    public readonly location?: { readonly source: "master" | "monthlySummary"; readonly sheetRow?: number; readonly columnIndex?: number },
  ) {
    // Never include names, identity numbers, other source values or secrets.
    super(`Jubo import planning failed: ${code}`);
    this.name = "JuboPlanningError";
  }
}

const MASTER_WIDTH = 95;
const SUMMARY_WIDTH = 191;
const MASTER_FIRST_DATA_ROW = 6;
const SUMMARY_FIRST_DATA_ROW = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const masterColumns = {
  name: 2, sex: 3, openedOn: 8, firstServiceOn: 9, closedOn: 11,
  status: 15, dateOfBirth: 23, identity: 25, registeredAddress: 32,
  residentialAddress: 35, cmsLevel: 48, disability: 54,
  primaryContact: 78, primaryContactPhone: 79, proxy: 80, proxyPhone: 81,
} as const;
const summaryColumns = { name: 7, identity: 29 } as const;

const requiredHeaders = {
  master: [
    [masterColumns.name, "姓名"], [masterColumns.sex, "性別"],
    [masterColumns.openedOn, "開案日期"], [masterColumns.firstServiceOn, "首次服務日期"],
    [masterColumns.closedOn, "結案日期"], [masterColumns.status, "狀態"],
    [masterColumns.dateOfBirth, "生日"], [masterColumns.identity, "身分證字號"],
    [masterColumns.registeredAddress, "戶籍地址"], [masterColumns.residentialAddress, "居住地址"],
    [masterColumns.cmsLevel, "CMS等級"], [masterColumns.disability, "身心障礙證明手冊"],
    [masterColumns.primaryContact, "主要聯絡人"], [masterColumns.primaryContactPhone, "主要聯絡人聯絡方式"],
    [masterColumns.proxy, "代理人"], [masterColumns.proxyPhone, "代理人聯絡方式"],
  ],
  monthlySummary: [[summaryColumns.name, "姓名"], [summaryColumns.identity, "身分證字號"]],
} as const;

function normalizedHeader(value: string) {
  return value.normalize("NFKC").replace(/[\s（）()／/：:、-]/gu, "").toUpperCase();
}

function validateSheet(sheet: JuboSheet, source: "master" | "monthlySummary", width: number) {
  if (!sheet.sheetName || sheet.headers.length !== width || sheet.headers.some((header) => typeof header !== "string")) {
    throw new JuboPlanningError("INVALID_SHEET", { source });
  }
  for (const [index, expected] of requiredHeaders[source]) {
    if (normalizedHeader(sheet.headers[index] ?? "") !== normalizedHeader(expected)) {
      throw new JuboPlanningError("INVALID_HEADER", { source, columnIndex: index });
    }
  }
  for (let index = 0; index < sheet.rows.length; index += 1) {
    if (sheet.rows[index]?.length !== width || (sheet.rawRows && sheet.rawRows[index]?.length !== width) || (sheet.rawCellTypes && sheet.rawCellTypes[index]?.length !== width)) {
      throw new JuboPlanningError("INVALID_ROW_WIDTH", {
        source, sheetRow: (source === "master" ? MASTER_FIRST_DATA_ROW : SUMMARY_FIRST_DATA_ROW) + index,
      });
    }
  }
  if (sheet.rawRows && sheet.rawRows.length !== sheet.rows.length) throw new JuboPlanningError("INVALID_ROW_WIDTH", { source });
  if (sheet.rawCellTypes && sheet.rawCellTypes.length !== sheet.rows.length) throw new JuboPlanningError("INVALID_ROW_WIDTH", { source });
}

function location(source: "master" | "monthlySummary", sheetRow: number, columnIndex: number) {
  return { source, sheetRow, columnIndex } as const;
}

function sourceString(value: unknown, source: "master" | "monthlySummary", sheetRow: number, columnIndex: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new JuboPlanningError("INVALID_FIELD", location(source, sheetRow, columnIndex));
  const trimmed = value.normalize("NFKC").trim();
  return trimmed || null;
}

export function normalizeJuboIdentity(value: unknown, source: "master" | "monthlySummary", sheetRow: number, columnIndex: number): string {
  const text = sourceString(value, source, sheetRow, columnIndex);
  const normalized = text?.replace(/[\s\-－]/gu, "").toUpperCase() ?? "";
  if (!/^[A-Z0-9]{8,20}$/u.test(normalized)) {
    throw new JuboPlanningError("INVALID_IDENTITY", location(source, sheetRow, columnIndex));
  }
  return normalized;
}

function sourceDate(value: unknown, source: "master" | "monthlySummary", sheetRow: number, columnIndex: number): string | null {
  const text = sourceString(value, source, sheetRow, columnIndex);
  if (!text) return null;
  const canonical = text.replaceAll("/", "-");
  if (!isCalendarDate(canonical)) throw new JuboPlanningError("INVALID_DATE", location(source, sheetRow, columnIndex));
  return canonical;
}

function serviceStatus(value: unknown, sheetRow: number): JuboServiceStatus {
  const text = sourceString(value, "master", sheetRow, masterColumns.status);
  switch (text) {
    case "服務中": return "active";
    case "暫停服務": return "suspended";
    case "結案": return "closed";
    default: throw new JuboPlanningError("UNKNOWN_STATUS", location("master", sheetRow, masterColumns.status));
  }
}

function sex(value: unknown, sheetRow: number): IntakeProfile["sex"] {
  const text = sourceString(value, "master", sheetRow, masterColumns.sex);
  switch (text) {
    case "男": case "男性": return "male";
    case "女": case "女性": return "female";
    case null: return "unknown";
    default: throw new JuboPlanningError("UNKNOWN_SEX", location("master", sheetRow, masterColumns.sex));
  }
}

function cmsLevel(value: unknown, sheetRow: number) {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? String(value) : sourceString(value, "master", sheetRow, masterColumns.cmsLevel);
  // The source uses "第 3 級" style spacing; do not accept arbitrary prose.
  const match = text?.replace(/\s/gu, "").match(/^(?:第)?([1-8])(?:級)?$/u);
  if (!match) throw new JuboPlanningError("INVALID_FIELD", location("master", sheetRow, masterColumns.cmsLevel));
  return Number(match[1]);
}

function rawRow(sheet: JuboSheet, row: readonly unknown[], sheetRow: number, rowIndex: number): JuboRawRow {
  const original = sheet.rawRows?.[rowIndex] ?? row;
  return {
    sheetName: sheet.sheetName,
    sheetRow,
    columns: sheet.headers.map((header, index) => ({
      index, columnNumber: index + 1, header, value: original[index],
      ...(sheet.rawCellTypes ? { sourceCellType: sheet.rawCellTypes[rowIndex][index] } : {}),
    })),
  };
}

function validatedProfile(row: readonly unknown[], sheetRow: number, clientCode: string, identity: string): IntakeProfile {
  const name = sourceString(row[masterColumns.name], "master", sheetRow, masterColumns.name);
  if (!name) throw new JuboPlanningError("INVALID_FIELD", location("master", sheetRow, masterColumns.name));
  const primaryName = sourceString(row[masterColumns.primaryContact], "master", sheetRow, masterColumns.primaryContact);
  const primaryPhone = sourceString(row[masterColumns.primaryContactPhone], "master", sheetRow, masterColumns.primaryContactPhone);
  const proxyName = sourceString(row[masterColumns.proxy], "master", sheetRow, masterColumns.proxy);
  const proxyPhone = sourceString(row[masterColumns.proxyPhone], "master", sheetRow, masterColumns.proxyPhone);
  // A phone without a contact name cannot be safely attributed to a person.
  if ((!primaryName && primaryPhone) || (!proxyName && proxyPhone)) {
    throw new JuboPlanningError("INVALID_FIELD", location("master", sheetRow, !primaryName ? masterColumns.primaryContactPhone : masterColumns.proxyPhone));
  }
  const contacts: IntakeProfile["contacts"] = [];
  if (primaryName) contacts.push({ name: primaryName, relationship: "", phone: primaryPhone ?? "", address: "", isPrimary: true, isEmergency: false });
  if (proxyName) contacts.push({ name: proxyName, relationship: "", phone: proxyPhone ?? "", address: "", isPrimary: false, isEmergency: false });
  const candidate = {
    displayName: name,
    clientCode,
    dateOfBirth: sourceDate(row[masterColumns.dateOfBirth], "master", sheetRow, masterColumns.dateOfBirth),
    identityNumber: identity,
    sex: sex(row[masterColumns.sex], sheetRow),
    phone: null,
    registeredAddress: sourceString(row[masterColumns.registeredAddress], "master", sheetRow, masterColumns.registeredAddress),
    residentialAddress: sourceString(row[masterColumns.residentialAddress], "master", sheetRow, masterColumns.residentialAddress),
    cmsLevel: cmsLevel(row[masterColumns.cmsLevel], sheetRow),
    disability: sourceString(row[masterColumns.disability], "master", sheetRow, masterColumns.disability),
    contacts,
    consent: { status: "pending", confirmedOn: null },
    notes: "",
  };
  const parsed = intakeProfileSchema.safeParse(candidate);
  if (!parsed.success) throw new JuboPlanningError("INVALID_PROFILE", { source: "master", sheetRow });
  return parsed.data;
}

function hmacCode(secret: Buffer, organizationId: string, branchId: string, identity: string) {
  const digest = createHmac("sha256", secret)
    .update(JSON.stringify(["jubo-client-code:v1", organizationId, branchId, identity]), "utf8")
    .digest("hex");
  return `JUBO-${digest.slice(0, 32)}`;
}

/** Exported to regression-test the collision branch without weakening HMAC generation. */
export function assertUniqueJuboClientCodes(rows: readonly { readonly clientCode: string; readonly sheetRow: number }[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.clientCode)) throw new JuboPlanningError("HASH_COLLISION", { source: "master", sheetRow: row.sheetRow });
    seen.add(row.clientCode);
  }
}

function warnings(profile: IntakeProfile, hasSummary: boolean): JuboWarningCode[] {
  const result: JuboWarningCode[] = [];
  if (!hasSummary) result.push("MISSING_MONTHLY_SUMMARY");
  if (!profile.dateOfBirth) result.push("MISSING_DATE_OF_BIRTH");
  if (profile.contacts.some((contact) => !contact.phone)) result.push("MISSING_CONTACT_PHONE");
  // These workbooks are not evidence of an approved schedule, signed form,
  // medication order/administration, identity scan, or health examination.
  result.push(
    "REVIEW_WEEKLY_SCHEDULE", "REVIEW_TRANSPORT", "REVIEW_ABCD_ASSESSMENTS",
    "REVIEW_IDENTITY_DOCUMENT", "REVIEW_MEDICATION_EVIDENCE", "REVIEW_HEALTH_EXAM", "REVIEW_CONSENT",
  );
  return result;
}

export function planJuboImport(input: JuboImportInput): JuboImportPlan {
  if (!UUID_PATTERN.test(input.organizationId) || !UUID_PATTERN.test(input.branchId)) {
    throw new JuboPlanningError("INVALID_SCOPE");
  }
  const organizationId = input.organizationId.toLowerCase();
  const branchId = input.branchId.toLowerCase();
  const secret = Buffer.from(input.hmacSecret);
  if (secret.byteLength < 32) throw new JuboPlanningError("WEAK_SECRET");
  validateSheet(input.master, "master", MASTER_WIDTH);
  validateSheet(input.monthlySummary, "monthlySummary", SUMMARY_WIDTH);
  if (input.expectedCounts && (input.master.rows.length !== input.expectedCounts.master || input.monthlySummary.rows.length !== input.expectedCounts.monthlySummary)) {
    throw new JuboPlanningError("INVALID_COUNT");
  }

  const summaryByIdentity = new Map<string, JuboRawRow>();
  input.monthlySummary.rows.forEach((row, index) => {
    const sheetRow = SUMMARY_FIRST_DATA_ROW + index;
    const identity = normalizeJuboIdentity(row[summaryColumns.identity], "monthlySummary", sheetRow, summaryColumns.identity);
    if (summaryByIdentity.has(identity)) throw new JuboPlanningError("DUPLICATE_IDENTITY", { source: "monthlySummary", sheetRow });
    summaryByIdentity.set(identity, rawRow(input.monthlySummary, row, sheetRow, index));
  });

  const seenMaster = new Set<string>();
  const codeRows: { clientCode: string; sheetRow: number }[] = [];
  const clients = input.master.rows.map((row, index): JuboPlannedClient => {
    const sheetRow = MASTER_FIRST_DATA_ROW + index;
    const identity = normalizeJuboIdentity(row[masterColumns.identity], "master", sheetRow, masterColumns.identity);
    if (seenMaster.has(identity)) throw new JuboPlanningError("DUPLICATE_IDENTITY", { source: "master", sheetRow });
    seenMaster.add(identity);
    const clientCode = hmacCode(secret, organizationId, branchId, identity);
    codeRows.push({ clientCode, sheetRow });
    const profile = validatedProfile(row, sheetRow, clientCode, identity);
    const summary = summaryByIdentity.get(identity) ?? null;
    return {
      profile,
      serviceStatus: serviceStatus(row[masterColumns.status], sheetRow),
      dates: {
        sourceOpenedOn: sourceDate(row[masterColumns.openedOn], "master", sheetRow, masterColumns.openedOn),
        sourceFirstServiceOn: sourceDate(row[masterColumns.firstServiceOn], "master", sheetRow, masterColumns.firstServiceOn),
        sourceClosedOn: sourceDate(row[masterColumns.closedOn], "master", sheetRow, masterColumns.closedOn),
        admittedOn: null,
      },
      master: rawRow(input.master, row, sheetRow, index),
      monthlySummary: summary,
      warnings: warnings(profile, summary !== null),
    };
  });
  assertUniqueJuboClientCodes(codeRows);
  for (const identity of summaryByIdentity.keys()) {
    if (!seenMaster.has(identity)) throw new JuboPlanningError("UNMATCHED_SUMMARY", { source: "monthlySummary" });
  }
  return {
    mappingVersion: "jubo-master-monthly-202610-v1",
    organizationId,
    branchId,
    masterRowCount: input.master.rows.length,
    monthlySummaryRowCount: input.monthlySummary.rows.length,
    matchedSummaryRowCount: summaryByIdentity.size,
    clients,
  };
}
