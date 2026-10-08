import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertUniqueJuboClientCodes, JuboPlanningError, normalizeJuboIdentity, planJuboImport,
  type JuboImportInput,
} from "./planner";

const header = (width: number) => Array.from({ length: width }, (_, index) => `未映射欄 ${index + 1}`);

function syntheticInput(): JuboImportInput {
  const masterHeaders = header(95);
  const summaryHeaders = header(191);
  const masterLabels: Record<number, string> = {
    2: "姓名", 3: "性別", 8: "開案日期", 9: "首次服務日期", 11: "結案日期", 15: "狀態",
    23: "生日", 25: "身分證字號", 32: "戶籍地址", 35: "居住地址", 48: "CMS等級",
    54: "身心障礙證明/手冊", 78: "主要聯絡人", 79: "主要聯絡人聯絡方式",
    80: "代理人", 81: "代理人聯絡方式",
  };
  for (const [index, label] of Object.entries(masterLabels)) masterHeaders[Number(index)] = label;
  summaryHeaders[3] = "狀態";
  summaryHeaders[7] = "姓名";
  summaryHeaders[29] = "身分證字號";
  masterHeaders[0] = "重複欄";
  masterHeaders[1] = "重複欄";
  summaryHeaders[0] = "重複欄";
  summaryHeaders[1] = "重複欄";

  const masterRows = Array.from({ length: 23 }, (_, index) => {
    const row: unknown[] = Array(95).fill(null);
    row[0] = `原始值 ${index}`;
    row[1] = 0;
    row[2] = `合成測試個案 ${index + 1}`;
    row[3] = index % 2 === 0 ? "女性" : "男性";
    row[8] = "2026/01/02";
    row[9] = index < 5 ? "2026/01/05" : null;
    row[11] = index >= 18 ? "2026/09/30" : null;
    row[15] = index < 17 ? "服務中" : index === 17 ? "暫停服務" : "結案";
    row[23] = "1950/03/04";
    row[25] = `ZZ000000${String(index + 1).padStart(2, "0")}`;
    row[32] = "虛構戶籍地址";
    row[35] = "虛構居住地址";
    row[48] = "第 3 級";
    row[54] = "虛構身障資料";
    row[78] = `合成聯絡人 ${index + 1}`;
    row[79] = "0000000000";
    row[80] = null;
    row[81] = null;
    return row;
  });
  const summaryRows = Array.from({ length: 17 }, (_, index) => {
    const row: unknown[] = Array(191).fill(null);
    row[0] = `月表原始值 ${index}`;
    row[1] = false;
    row[3] = "服務中";
    row[7] = `合成測試個案 ${index + 1}`;
    row[29] = ` zz-000000${String(index + 1).padStart(2, "0")} `;
    row[190] = 123;
    return row;
  });
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    branchId: "00000000-0000-4000-8000-000000000002",
    hmacSecret: "synthetic secret with at least 32 bytes only for tests",
    master: { sheetName: "個案主檔", headers: masterHeaders, rows: masterRows },
    monthlySummary: { sheetName: "日照個案總表_202610", headers: summaryHeaders, rows: summaryRows },
    expectedCounts: { master: 23, monthlySummary: 17 },
  };
}

function mutableInput() {
  const input = syntheticInput();
  return {
    ...input,
    master: { ...input.master, headers: [...input.master.headers], rows: input.master.rows.map((row) => [...row]) },
    monthlySummary: { ...input.monthlySummary, headers: [...input.monthlySummary.headers], rows: input.monthlySummary.rows.map((row) => [...row]) },
  };
}

function errorCode(action: () => unknown) {
  try { action(); }
  catch (error) {
    expect(error).toBeInstanceOf(JuboPlanningError);
    return (error as JuboPlanningError).code;
  }
  throw new Error("Expected the import planner to fail closed");
}

describe("Jubo master + monthly import plan (synthetic data only)", () => {
  it("joins 17 of 23 by normalized ID, verifies names and statuses, and keeps every source cell", () => {
    const input = syntheticInput();
    const plan = planJuboImport(input);
    expect([plan.masterRowCount, plan.monthlySummaryRowCount, plan.matchedSummaryRowCount]).toEqual([23, 17, 17]);
    expect(plan.clients).toHaveLength(23);
    expect(plan.clients[0].monthlySummary?.sheetRow).toBe(5);
    expect(plan.clients[17].monthlySummary).toBeNull();
    expect(plan.clients[0].master.columns).toHaveLength(95);
    expect(plan.clients[0].monthlySummary?.columns).toHaveLength(191);
    expect(plan.clients[0].master.columns.slice(0, 2)).toEqual([
      { index: 0, columnNumber: 1, header: "重複欄", value: "原始值 0" },
      { index: 1, columnNumber: 2, header: "重複欄", value: 0 },
    ]);
    expect(plan.clients[0].monthlySummary?.columns[190].value).toBe(123);
    expect(plan.clients[0].profile.displayName).toBe("合成測試個案 1");
    expect(plan.clients[0].profile.identityNumber).toBe("ZZ00000001");
    expect(plan.clients[0].profile.consent).toEqual({ status: "pending", confirmedOn: null });
    expect(plan.clients[0].dates).toEqual({ sourceOpenedOn: "2026-01-02", sourceFirstServiceOn: "2026-01-05", sourceClosedOn: null, admittedOn: null });
    expect(plan.clients.map((client) => client.serviceStatus).filter((status) => status === "active")).toHaveLength(17);
    expect(plan.clients.map((client) => client.serviceStatus).filter((status) => status === "suspended")).toHaveLength(1);
    expect(plan.clients.map((client) => client.serviceStatus).filter((status) => status === "closed")).toHaveLength(5);
    expect(plan.clients[17].warnings).toContain("MISSING_MONTHLY_SUMMARY");
    expect(plan.clients[0].warnings).toContain("REVIEW_MEDICATION_EVIDENCE");
    expect(plan.clients[0].warnings).toContain("REVIEW_ABCD_ASSESSMENTS");
    expect(input.master.rows[0][8]).toBe("2026/01/02");
  });

  it("makes scoped HMAC codes stable across row order but different across organization and branch", () => {
    const input = mutableInput();
    const first = planJuboImport(input).clients[0].profile.clientCode;
    input.master.rows.reverse();
    expect(planJuboImport(input).clients.at(-1)?.profile.clientCode).toBe(first);
    expect(first).toMatch(/^JUBO-[a-f0-9]{32}$/u);
    expect(planJuboImport({ ...input, organizationId: "00000000-0000-4000-8000-000000000003" }).clients.at(-1)?.profile.clientCode).not.toBe(first);
    expect(planJuboImport({ ...input, branchId: "00000000-0000-4000-8000-000000000004" }).clients.at(-1)?.profile.clientCode).not.toBe(first);
    expect(planJuboImport({ ...input, organizationId: input.organizationId.toUpperCase() }).clients.at(-1)?.profile.clientCode).toBe(first);
    expect(planJuboImport({ ...input, hmacSecret: "different synthetic 32-byte secret value for tests" }).clients.at(-1)?.profile.clientCode).not.toBe(first);
    expect(errorCode(() => planJuboImport({ ...input, hmacSecret: "short" }))).toBe("WEAK_SECRET");
  });

  it("rejects duplicate IDs in either source and unmatched monthly IDs without name fallback", () => {
    const duplicateMaster = mutableInput();
    duplicateMaster.master.rows[1][25] = duplicateMaster.master.rows[0][25];
    expect(errorCode(() => planJuboImport(duplicateMaster))).toBe("DUPLICATE_IDENTITY");
    const duplicateSummary = mutableInput();
    duplicateSummary.monthlySummary.rows[1][29] = duplicateSummary.monthlySummary.rows[0][29];
    expect(errorCode(() => planJuboImport(duplicateSummary))).toBe("DUPLICATE_IDENTITY");
    const unmatched = mutableInput();
    const extra = [...unmatched.monthlySummary.rows[0]];
    extra[29] = "ZZ99999999";
    extra[7] = unmatched.master.rows[0][2];
    unmatched.monthlySummary.rows.push(extra);
    expect(errorCode(() => planJuboImport({ ...unmatched, expectedCounts: undefined }))).toBe("UNMATCHED_SUMMARY");
  });

  it("rejects missing active rows and mismatched name or status without falling back to fuzzy matching", () => {
    const missingActive = mutableInput();
    missingActive.monthlySummary.rows[0][29] = missingActive.master.rows[17][25];
    missingActive.monthlySummary.rows[0][7] = missingActive.master.rows[17][2];
    expect(errorCode(() => planJuboImport(missingActive))).toBe("MISSING_ACTIVE_SUMMARY");

    const mismatchedName = mutableInput();
    mismatchedName.monthlySummary.rows[0][7] = "另一位測試個案";
    expect(errorCode(() => planJuboImport(mismatchedName))).toBe("SUMMARY_NAME_MISMATCH");

    const mismatchedStatus = mutableInput();
    mismatchedStatus.monthlySummary.rows[0][3] = "結案";
    expect(errorCode(() => planJuboImport(mismatchedStatus))).toBe("SUMMARY_STATUS_MISMATCH");

    const closedInMonth = mutableInput();
    closedInMonth.master.rows[0][15] = "結案";
    expect(errorCode(() => planJuboImport(closedInMonth))).toBe("SUMMARY_STATUS_MISMATCH");
  });

  it("rejects unknown status, invalid dates, invalid IDs, and an unverified spreadsheet layout", () => {
    const unknownStatus = mutableInput();
    unknownStatus.master.rows[0][15] = "等待確認";
    expect(errorCode(() => planJuboImport(unknownStatus))).toBe("UNKNOWN_STATUS");
    const invalidDate = mutableInput();
    invalidDate.master.rows[0][23] = "2026/02/30";
    expect(errorCode(() => planJuboImport(invalidDate))).toBe("INVALID_DATE");
    const invalidIdentity = mutableInput();
    invalidIdentity.master.rows[0][25] = "***";
    expect(errorCode(() => planJuboImport(invalidIdentity))).toBe("INVALID_IDENTITY");
    const wrongHeader = mutableInput();
    wrongHeader.monthlySummary.headers[29] = "不是身分證字號";
    expect(errorCode(() => planJuboImport(wrongHeader))).toBe("INVALID_HEADER");
    const wrongWidth = mutableInput();
    wrongWidth.master.rows[0].pop();
    expect(errorCode(() => planJuboImport(wrongWidth))).toBe("INVALID_ROW_WIDTH");
    const wrongCount = mutableInput();
    wrongCount.master.rows.pop();
    expect(errorCode(() => planJuboImport(wrongCount))).toBe("INVALID_COUNT");
  });

  it("checks even cryptographically unlikely code collisions and never exposes source values in errors", () => {
    expect(errorCode(() => assertUniqueJuboClientCodes([
      { clientCode: "same", sheetRow: 6 }, { clientCode: "same", sheetRow: 7 },
    ]))).toBe("HASH_COLLISION");
    expect(normalizeJuboIdentity(" zz-00000001 ", "master", 6, 25)).toBe("ZZ00000001");
    const input = mutableInput();
    input.master.rows[0][25] = "SECRET-SYNTHETIC-ID";
    input.master.rows[0][15] = "不明狀態";
    try { planJuboImport(input); }
    catch (error) {
      expect(String(error)).not.toContain("SECRET-SYNTHETIC-ID");
      expect(String(error)).not.toContain("不明狀態");
    }
  });
});
