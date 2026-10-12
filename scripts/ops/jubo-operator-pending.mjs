import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, createHmac, randomUUID, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import pg from "pg";

// Explicit, source-pinned operator task, never a browser API or automatic job.
// Default is read-only preflight. No patient value, source bytes or credential
// is written to stdout; failures expose a stable code only.
const PROJECT = "diompsnswchpfguvryan";
const SOURCE = "/Users/seniorlifepr/Documents/歲悅日照資料移轉/2026-10-03-Jubo";
const DIR = resolve("private/tokyo-transfer-20261011");
const keychain = service => execFileSync("security", ["find-generic-password", "-s", service, "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const mode = process.argv[2] ?? "preflight";
if (!["preflight", "commit", "verify"].includes(mode)) throw new Error("INVALID_OPERATOR_ACTION");
const marker = import.meta.resolve("server-only");
if (!marker.endsWith("/empty.js")) throw new Error("RUN_WITH_REACT_SERVER_CONDITION");
const jiti = createJiti(import.meta.url, { alias: { "server-only": fileURLToPath(marker), "@": resolve("src") } });
const { prepareJuboOperatorPending, JUBO_OPERATOR_AUTHORIZATION } = await jiti.import("../../src/lib/jubo-import/operator-pending.ts");
const ca = readFileSync(resolve(DIR, "supabase-database-ca.crt"), "utf8");
const certificate = new X509Certificate(ca);
if (!certificate.ca || !certificate.subject.includes("Supabase") || Date.parse(certificate.validTo) <= Date.now())
  throw new Error("INVALID_DATABASE_CA");
const client = new pg.Client({ host: "aws-0-ap-northeast-1.pooler.supabase.com", port: 5432,
  user: `postgres.${PROJECT}`, database: "postgres", password: keychain("suiyuecare-daycare-tokyo-db-20261008"),
  ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10_000 });
function verifyBackup(filename) {
  if (!/^diompsnswchpfguvryan-native-\d+\.aes$/u.test(filename ?? "")) throw new Error("VERIFIED_NATIVE_BACKUP_REQUIRED");
  const encrypted = readFileSync(resolve(DIR, filename));
  if (encrypted.subarray(0, 4).toString() !== "DCN1") throw new Error("INVALID_NATIVE_BACKUP");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keychain("suiyuecare-daycare-transfer-backup-20261011"), "hex"), encrypted.subarray(4, 16));
  decipher.setAuthTag(encrypted.subarray(-16));
  const envelope = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(16, -16)), decipher.final()]).toString());
  const report = JSON.parse(readFileSync(resolve(DIR, `${filename}.restore-report.json`), "utf8"));
  const age = Date.now() - Date.parse(envelope.capturedAt);
  if (envelope.version !== 1 || envelope.project !== PROJECT || !Number.isFinite(age) || age < 0 || age > 86_400_000 ||
    !Array.isArray(envelope.fingerprint) || envelope.fingerprint.length === 0 ||
    report.operation !== "native_restore" || report.project !== PROJECT || report.filename !== filename ||
    report.exactRowFingerprintMatch !== true || report.serverStopped !== true ||
    report.restoredTables !== envelope.fingerprint.length ||
    report.restoredRows !== envelope.fingerprint.reduce((total, table) => total + table.count, 0))
    throw new Error("NATIVE_RESTORE_PROOF_REQUIRED");
}
try {
  await client.connect();
  const { rows: [authority] } = await client.query("select current_user='postgres' and auth.uid() is null as allowed");
  if (authority.allowed !== true) throw new Error("NATIVE_OPERATOR_REQUIRED");
  const { rows: scopes } = await client.query(`select o.id as organization_id,b.id as branch_id
    from public.organizations o join public.branches b on b.organization_id=o.id
    where o.name=$1 and b.code='wanhua' and o.is_active and b.is_active`,
  ["樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構"]);
  if (scopes.length !== 1) throw new Error("EXACT_TARGET_SCOPE_REQUIRED");
  const scope = scopes[0];
  const { rows: [existing] } = await client.query(`select count(*)::integer as operations,
    (select count(*)::integer from private.jubo_operator_master_links where organization_id=$1 and branch_id=$2) as masters,
    (select count(*)::integer from private.jubo_operator_master_links where organization_id=$1 and branch_id=$2 and monthly_source_sheet_row is not null) as reconciled,
    (select count(*)::integer from private.jubo_operator_master_links l join public.clients c on c.id=l.client_id
      where l.organization_id=$1 and l.branch_id=$2 and c.status='pending' and c.admitted_on is null) as pending
    from private.jubo_operator_imports where organization_id=$1 and branch_id=$2`, [scope.organization_id, scope.branch_id]);
  if (mode === "verify") {
    if (existing.operations !== 1 || existing.masters !== 23 || existing.reconciled !== 17 || existing.pending !== 23)
      throw new Error("OPERATOR_READBACK_FAILED");
    console.log(JSON.stringify({ operation: mode, project: PROJECT, ...existing, tlsVerified: true, productionCutover: false }));
  } else {
    const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const input = kind => { const fileName = kind === "master" ? "jubo-all-status-client-master-20261003.xlsx" : "jubo-daycare-summary-20261003.xlsx";
      return { kind, fileName, mimeType, bytes: readFileSync(resolve(SOURCE, fileName)) }; };
    const prepared = prepareJuboOperatorPending({ organizationId: scope.organization_id, branchId: scope.branch_id,
      idempotencyKey: randomUUID(), authorizationReference: JUBO_OPERATOR_AUTHORIZATION,
      hmacSecret: createHmac("sha256", Buffer.from(keychain("suiyuecare-daycare-transfer-backup-20261011"), "hex")).update("jubo-operator-mapping-v1").digest(),
      master: input("master"), monthly: input("monthlySummary") });
    const { rows: [mapping] } = await client.query("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') as hash", [prepared.parameters[6]]);
    if (mapping.hash !== "21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da")
      throw new Error("OPERATOR_MAPPING_MISMATCH");
    if (mode === "preflight") console.log(JSON.stringify({ operation: mode, project: PROJECT,
      counts: prepared.counts, mappingSha256: mapping.hash, ...existing, tlsVerified: true, writes: 0 }));
    else {
      verifyBackup(process.argv[3]);
      if (existing.operations !== 0) throw new Error("SOURCE_ALREADY_IMPORTED_USE_VERIFY");
      const { rows: [result] } = await client.query(prepared.sql, [...prepared.parameters]);
      const receipt = result.receipt;
      if (receipt.masterRows !== 23 || receipt.monthlyReferences !== 17 || receipt.publicPendingClients !== 23 ||
          receipt.formalAdmissions !== 0 || receipt.attendanceRecords !== 0 || receipt.serviceRecords !== 0 ||
          receipt.clinicalApprovals !== 0 || receipt.executionMode !== "database_operator") throw new Error("OPERATOR_RECEIPT_MISMATCH");
      console.log(JSON.stringify({ operation: mode, project: PROJECT, operationId: receipt.operationId,
        masterRows: receipt.masterRows, monthlyReferences: receipt.monthlyReferences, publicPendingClients: receipt.publicPendingClients,
        formalAdmissions: 0, attendanceRecords: 0, serviceRecords: 0, clinicalApprovals: 0,
        productionCutover: false, nativeOperator: true, sourceSha256: prepared.parameters.slice(4, 6).map(bytes => createHash("sha256").update(bytes).digest("hex")) }));
    }
  }
} catch (error) {
  const code = typeof error.code === "string" && /^[A-Z0-9_]{1,70}$/u.test(error.code) ? error.code
    : /^[A-Z0-9_]{1,70}$/u.test(error.message ?? "") ? error.message : "OPERATOR_TASK_FAILED";
  console.error(JSON.stringify({ operation: mode, project: PROJECT, error: code })); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
