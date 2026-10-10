import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";

vi.mock("server-only", () => ({}));

import { normalizeJuboIdentity, planJuboImport } from "./planner";
import { APPROVED_JUBO_SOURCE_SHA256, readApprovedJuboXlsx, type JuboXlsxInput } from "./xlsx-reader";

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";
const HMAC = "synthetic parity audit secret longer than 32 bytes";
const MASTER_FIELD_INDICES = [2, 3, 23, 25, 32, 35, 48, 54, 78, 79, 80, 81] as const;
const MONTHLY_FIELD_INDICES = [3, 7, 29] as const;

type Category = "missing_in_sql" | "extra_in_sql" | "null_to_value" |
  "value_to_null" | "type_mismatch" | "value_mismatch";

/** Report only schema paths and counts; never stringify a source value in failures. */
function leafValues(value: unknown, prefix = "", output = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    output.set(`${prefix}.length`, value.length);
    value.forEach((entry, index) => leafValues(entry, `${prefix}[${index}]`, output));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) leafValues(entry, prefix ? `${prefix}.${key}` : key, output);
  } else {
    output.set(prefix, value);
  }
  return output;
}

function profileDiff(expected: unknown, actual: unknown) {
  const left = leafValues(expected);
  const right = leafValues(actual);
  const differences: Partial<Record<Category, number>> = {};
  const fieldPaths = new Set([...left.keys(), ...right.keys()]);
  let compared = 0;
  for (const field of fieldPaths) {
    let category: Category | null = null;
    if (!left.has(field)) category = "extra_in_sql";
    else if (!right.has(field)) category = "missing_in_sql";
    else {
      compared += 1;
      const expectedValue = left.get(field);
      const actualValue = right.get(field);
      if (expectedValue === null && actualValue !== null) category = "null_to_value";
      else if (expectedValue !== null && actualValue === null) category = "value_to_null";
      else if (typeof expectedValue !== typeof actualValue) category = "type_mismatch";
      else if (expectedValue !== actualValue) category = "value_mismatch";
    }
    if (category) differences[category] = (differences[category] ?? 0) + 1;
  }
  return { compared, differences };
}

async function approvedBytes(directory: string) {
  const found = new Map<string, Uint8Array>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".xlsx")) continue;
    const bytes = Uint8Array.from(await readFile(path.join(directory, entry.name)));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (Object.values(APPROVED_JUBO_SOURCE_SHA256).includes(hash as typeof APPROVED_JUBO_SOURCE_SHA256.master)) {
      if (found.has(hash)) throw new Error("duplicate approved source hash");
      found.set(hash, bytes);
    }
  }
  if (found.size !== 2) throw new Error(`approved source hash count: ${found.size}`);
  const makeInput = (kind: "master" | "monthlySummary"): JuboXlsxInput => ({
    kind, fileName: `approved-${kind}.xlsx`, mimeType: MIME,
    bytes: found.get(APPROVED_JUBO_SOURCE_SHA256[kind])!,
  });
  return { master: makeInput("master"), monthlySummary: makeInput("monthlySummary") };
}

async function databaseWithCandidateMigrations() {
  const database = new PGlite();
  try {
    await database.exec(bootstrapSql);
    const migrationDirectory = path.resolve(import.meta.dirname, "../../../supabase/migrations");
    const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of migrationFiles) {
      try { await database.exec(await readFile(path.join(migrationDirectory, file), "utf8")); }
      catch { throw new Error(`candidate migration compile failed: ${file}`); }
    }
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

describe("JUBO profile parity audit (isolated candidate only)", () => {
  it("reports only diff categories for synthetic missing and not-applicable values", () => {
    const expected = { displayName: "Synthetic", cmsLevel: null, disability: "不適用", contacts: [] };
    const matching = { contacts: [], disability: "不適用", cmsLevel: null, displayName: "Synthetic" };
    expect(profileDiff(expected, matching)).toEqual({ compared: 4, differences: {} });
    expect(profileDiff(expected, { ...matching, disability: null, cmsLevel: 3 }).differences)
      .toEqual({ null_to_value: 1, value_to_null: 1 });
  });

  const realSources = process.env.JUBO_APPROVED_SOURCE_DIR ? it : it.skip;
  realSources("compares all approved source rows and mapped leaves to the actual candidate SQL builder", async () => {
    // No file contents or row-level hashes leave this process. The database is in-memory only.
    const approved = await approvedBytes(process.env.JUBO_APPROVED_SOURCE_DIR!);
    const master = readApprovedJuboXlsx(approved.master);
    const monthly = readApprovedJuboXlsx(approved.monthlySummary);
    const plan = planJuboImport({ organizationId: ORG, branchId: BRANCH, hmacSecret: HMAC,
      master: master.sheet, monthlySummary: monthly.sheet,
      expectedCounts: { master: 23, monthlySummary: 17 } });
    const result = {
      approvedHashes: [master.sha256, monthly.sha256], master: plan.masterRowCount,
      monthly: plan.monthlySummaryRowCount, matchedMonthly: plan.matchedSummaryRowCount,
      rawFieldChecks: 0, profileLeafChecks: 0, sqlIdentityChecks: 0,
      stagedCoreChecks: 0, monthlyCrossChecks: 0,
      normalizationLeafChecks: 0, normalizedClientCount: 0,
      nfkcChangedFields: 0, separatorChangedFields: 0,
      reviewFingerprintCount: 0, reviewFingerprintAggregate: "",
      nullCells: 0, notApplicableCells: 0,
      sqlErrorClasses: {} as Record<string, number>,
      planValidationErrors: {} as Record<string, number>,
      sourceTextStates: {} as Record<string, number>,
      sqlStates: {} as Record<string, number>,
      differences: {} as Partial<Record<Category | "source_path" | "sql_error" | "monthly_link" | "identity" | "normalization_warning" | "staged_core" | "monthly_cross", number>>,
    };
    const difference = (category: keyof typeof result.differences, amount = 1) => {
      result.differences[category] = (result.differences[category] ?? 0) + amount;
    };
    const database = await databaseWithCandidateMigrations();
    const reviewAggregate = createHash("sha256");
    try {
      const monthlyIdentityHashes = new Map<string, number>();
      for (let index = 0; index < monthly.sheet.rows.length; index += 1) {
        const raw = monthly.sheet.rawRows![index];
        const normalized = normalizeJuboIdentity(monthly.sheet.rows[index][29], "monthlySummary", index + 5, 29);
        const expectedHash = createHash("sha256").update(normalized, "utf8").digest("hex");
        const { rows } = await database.query<{ digest: string }>(
          "select encode(sha256(convert_to(upper(replace(regexp_replace($1::text,'[[:space:]-]','','g'),'－','')),'UTF8')),'hex') as digest",
          [raw[29]]);
        result.sqlIdentityChecks += 1;
        if (rows[0]?.digest !== expectedHash) difference("identity");
        monthlyIdentityHashes.set(rows[0]!.digest, index + 5);
      }
      for (let index = 0; index < plan.clients.length; index += 1) {
        const client = plan.clients[index];
        const raw = master.sheet.rawRows![index];
        const original = client.master.columns;
        for (const column of MASTER_FIELD_INDICES) {
          result.rawFieldChecks += 1;
          if (original[column]?.value !== raw[column]) difference("source_path");
          if (raw[column] === null || raw[column] === "") result.nullCells += 1;
          if (raw[column] === "不適用") result.notApplicableCells += 1;
          if ([78, 79, 80, 81].includes(column) && typeof raw[column] === "string") {
            const originalText = raw[column];
            if (originalText !== originalText.trim()) result.sourceTextStates.edgeWhitespace = (result.sourceTextStates.edgeWhitespace ?? 0) + 1;
            if (originalText !== originalText.normalize("NFKC")) result.sourceTextStates.nfkcChange = (result.sourceTextStates.nfkcChange ?? 0) + 1;
            if (/[\u0000-\u001f\u007f]/u.test(originalText)) result.sourceTextStates.controlCharacter = (result.sourceTextStates.controlCharacter ?? 0) + 1;
          }
        }
        try {
          await database.query("select private.validate_intake_profile($1::jsonb)", [JSON.stringify(client.profile)]);
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          const label = /\b(?:JUBO|INTAKE)_[A-Z_]+\b/u.exec(message)?.[0] ?? "OTHER";
          result.planValidationErrors[label] = (result.planValidationErrors[label] ?? 0) + 1;
        }
        const expectedHash = createHash("sha256").update(client.profile.identityNumber!, "utf8").digest("hex");
        const identity = await database.query<{ digest: string }>(
          "select encode(sha256(convert_to(upper(replace(regexp_replace($1::text,'[[:space:]-]','','g'),'－','')),'UTF8')),'hex') as digest",
          [raw[25]]);
        result.sqlIdentityChecks += 1;
        if (identity.rows[0]?.digest !== expectedHash) difference("identity");
        const linkedRow = monthlyIdentityHashes.get(identity.rows[0]!.digest) ?? null;
        if ((client.monthlySummary?.sheetRow ?? null) !== linkedRow) difference("monthly_link");
        const core = await database.query<{
          staged_name: string; staged_dob: string | null; staged_sex: string | null;
          staged_phone: string | null; staged_opened: string | null;
          staged_first: string | null; staged_closed: string | null;
        }>(`select btrim($1::text) as staged_name,
          private.jubo_source_date_iso($2::text)::text as staged_dob,
          private.jubo_source_sex($3::text) as staged_sex,
          nullif(btrim($4::text),'') as staged_phone,
          private.jubo_source_date_iso($5::text)::text as staged_opened,
          private.jubo_source_date_iso($6::text)::text as staged_first,
          private.jubo_source_date_iso($7::text)::text as staged_closed`,
        [raw[2], raw[23], raw[3], raw[29], raw[8], raw[9], raw[11]]);
        const staged = core.rows[0];
        const corePairs: [unknown, unknown][] = [
          [staged.staged_name, client.profile.displayName],
          [staged.staged_dob, client.profile.dateOfBirth],
          [staged.staged_sex, client.profile.sex],
          [staged.staged_opened, client.dates.sourceOpenedOn],
          [staged.staged_first, client.dates.sourceFirstServiceOn],
          [staged.staged_closed, client.dates.sourceClosedOn],
        ];
        result.stagedCoreChecks += corePairs.length;
        for (const [fromStage, fromPlan] of corePairs) if (fromStage !== fromPlan) difference("staged_core");
        if (client.monthlySummary) {
          const monthlyIndex = client.monthlySummary.sheetRow - 5;
          const monthlyRaw = monthly.sheet.rawRows![monthlyIndex];
          for (const column of MONTHLY_FIELD_INDICES) {
            result.rawFieldChecks += 1;
            if (client.monthlySummary.columns[column]?.value !== monthlyRaw[column]) difference("source_path");
          }
          const monthlyCore = await database.query<{
            staged_name: string; staged_dob: string | null; staged_sex: string | null;
            staged_phone: string | null; staged_status: string | null;
          }>(`select btrim($1::text) as staged_name,
            private.jubo_source_date_iso($2::text)::text as staged_dob,
            private.jubo_source_sex($3::text) as staged_sex,
            btrim($4::text) as staged_phone,$5::text as staged_status`,
          [monthlyRaw[7], monthlyRaw[9], monthlyRaw[8], monthlyRaw[22], monthlyRaw[3]]);
          const month = monthlyCore.rows[0];
          const crossPairs: [unknown, unknown][] = [
            [month.staged_name, staged.staged_name], [month.staged_dob, staged.staged_dob],
            [month.staged_sex, staged.staged_sex], [month.staged_phone, staged.staged_phone],
            [month.staged_status, "服務中"],
          ];
          result.monthlyCrossChecks += crossPairs.length;
          for (const [fromMonthly, fromMaster] of crossPairs) if (fromMonthly !== fromMaster) difference("monthly_cross");
        }
        const pending = {
          identity_sha256: expectedHash,
          display_name: client.profile.displayName,
          date_of_birth: client.profile.dateOfBirth,
          sex: client.profile.sex,
          admitted_on: null,
          care_eligible: false,
        };
        try {
          const normalizationResult = await database.query<{ evidence: unknown }>(
            "select private.jubo_normalization_evidence($1::jsonb) as evidence",
            [JSON.stringify(raw)]);
          const normalization = normalizationResult.rows[0]?.evidence;
          const normalizationParity = profileDiff(client.normalizationFieldIndices, normalization);
          result.normalizationLeafChecks += normalizationParity.compared;
          for (const [category, count] of Object.entries(normalizationParity.differences)) difference(category as Category, count);
          result.nfkcChangedFields += client.normalizationFieldIndices.nfkc.length;
          result.separatorChangedFields += client.normalizationFieldIndices.contactSeparator.length;
          if (client.normalizationFieldIndices.nfkc.length || client.normalizationFieldIndices.contactSeparator.length) result.normalizedClientCount += 1;
          if (client.warnings.includes("REVIEW_SOURCE_NORMALIZATION") !==
            Boolean(client.normalizationFieldIndices.nfkc.length || client.normalizationFieldIndices.contactSeparator.length)) {
            difference("normalization_warning");
          }
          const fingerprint = await database.query<{ digest: string }>(
            "select private.jubo_profile_mapping_fingerprint($1::jsonb,jsonb_populate_record(null::private.jubo_pending_master_rows,$2::jsonb)) as digest",
            [JSON.stringify(raw), JSON.stringify(pending)]);
          if (!/^[a-f0-9]{64}$/u.test(fingerprint.rows[0]?.digest ?? "")) difference("sql_error");
          else {
            reviewAggregate.update(fingerprint.rows[0].digest, "ascii");
            result.reviewFingerprintCount += 1;
          }
          const { rows } = await database.query<{ profile: unknown }>(
            "select private.jubo_profile_from_master($1::jsonb,jsonb_populate_record(null::private.jubo_pending_master_rows,$2::jsonb),$3::text) as profile",
            [JSON.stringify(raw), JSON.stringify(pending), client.profile.clientCode]);
          const parity = profileDiff(client.profile, rows[0]?.profile);
          result.profileLeafChecks += parity.compared;
          for (const [category, count] of Object.entries(parity.differences)) difference(category as Category, count);
        } catch (error) {
          difference("sql_error");
          // Whitelist constant error labels only; never print error.message,
          // query parameters or source content from a clinical record.
          const message = error instanceof Error ? error.message : "";
          const label = /\b(?:JUBO|INTAKE)_[A-Z_]+\b/u.exec(message)?.[0] ?? "OTHER";
          result.sqlErrorClasses[label] = (result.sqlErrorClasses[label] ?? 0) + 1;
          const sqlState = error && typeof error === "object" && "code" in error &&
            typeof error.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code) ? error.code : "NO_SQLSTATE";
          result.sqlStates[sqlState] = (result.sqlStates[sqlState] ?? 0) + 1;
        }
      }
    } catch {
      // A database driver error may include bound clinical parameters; only a
      // fixed audit error may reach Vitest output.
      throw new Error("JUBO_PARITY_QUERY_FAILED");
    } finally {
      await database.close();
      approved.master.bytes.fill(0);
      approved.monthlySummary.bytes.fill(0);
    }
    result.reviewFingerprintAggregate = reviewAggregate.digest("hex");
    // Output is deliberately aggregate only. No names, IDs, addresses, phones,
    // individual row digests or unredacted SQL exception text.
    console.log(`JUBO_PARITY_AGGREGATE ${JSON.stringify(result)}`);
    expect(result.master).toBe(23);
    expect(result.monthly).toBe(17);
    expect(result.matchedMonthly).toBe(17);
    expect(result.rawFieldChecks).toBe(23 * MASTER_FIELD_INDICES.length + 17 * MONTHLY_FIELD_INDICES.length);
    expect(result.sqlIdentityChecks).toBe(40);
    expect(result.stagedCoreChecks).toBe(23 * 6);
    expect(result.monthlyCrossChecks).toBe(17 * 5);
    expect(result.profileLeafChecks).toBeGreaterThan(23 * 10);
    expect(result.normalizationLeafChecks).toBeGreaterThanOrEqual(23 * 2);
    expect(result.reviewFingerprintCount).toBe(23);
    expect(result.planValidationErrors).toEqual({});
    expect(result.differences).toEqual({});
  }, 300_000);
});
