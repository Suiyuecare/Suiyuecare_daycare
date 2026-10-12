import { execFileSync, spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { cleanupNativeRestoreDirectory, createNativeRestoreDirectory } from "../lib/native-restore-cleanup.mjs";

// Operator-only drill. Database credentials and restored rows never reach stdout.
const PROJECT = "diompsnswchpfguvryan";
const BIN = "/Users/seniorlifepr/.local/share/edoc-backup-runtime/Postgres.app/Contents/Versions/17/bin";
const DIR = resolve("private/tokyo-transfer-20261011");
const KEY_SERVICE = "suiyuecare-daycare-transfer-backup-20261011";
const SCHEMAS = ["public", "private", "auth", "storage", "supabase_migrations"];
const keychain = (service) => execFileSync("security", ["find-generic-password", "-s", service, "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const key = () => Buffer.from(keychain(KEY_SERVICE), "hex");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ident = (value) => `"${value.replaceAll('"', '""')}"`;
function encrypt(bytes) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  return Buffer.concat([Buffer.from("DCN1"), nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
function decrypt(bytes) {
  if (bytes.subarray(0, 4).toString() !== "DCN1") throw new Error("INVALID_NATIVE_BACKUP");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(4, 16));
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(16, -16)), cipher.final()]);
}
async function run(name, args, environment, input, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(join(BIN, name), args, { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", () => reject(new Error(`NATIVE_${name.toUpperCase()}_UNAVAILABLE`)));
    child.on("close", (code) => {
      if (code === 0 || options.acceptExitCodes?.includes(code))
        resolveRun(options.returnExitCode ? code : Buffer.concat(output));
      else {
        // Only classifications, not SQL statements or data, are exposed.
        const raw = Buffer.concat(errors).toString();
        const kind = /server version mismatch/u.test(raw) ? "VERSION_MISMATCH"
          : /certificate/u.test(raw) ? "TLS" : /permission denied/u.test(raw) ? "PERMISSION"
          : /already exists/u.test(raw) ? "DUPLICATE_OBJECT" : /does not exist/u.test(raw) ? "MISSING_OBJECT"
          : /could not connect|connection/u.test(raw) ? "CONNECTION" : "OTHER";
        const error = new Error(`NATIVE_${name.toUpperCase()}_${kind}`);
        error.object = /(?:relation|schema|function|type|extension) "([a-z_][a-z0-9_. -]*)"/u.exec(raw)?.[1];
        reject(error);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
async function connectRemote() {
  const response = await fetch("https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt",
    { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("TRUSTED_CA_DOWNLOAD_FAILED");
  const ca = await response.text();
  const certificate = new X509Certificate(ca);
  if (!certificate.ca || !certificate.subject.includes("Supabase") || Date.parse(certificate.validTo) < Date.now())
    throw new Error("INVALID_DATABASE_CA");
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const caPath = join(DIR, "supabase-database-ca.crt");
  writeFileSync(caPath, ca, { mode: 0o600 });
  const password = keychain("suiyuecare-daycare-tokyo-db-20261008");
  for (const host of ["aws-1-ap-northeast-1.pooler.supabase.com", "aws-0-ap-northeast-1.pooler.supabase.com"]) {
    const config = { host, port: 5432, user: `postgres.${PROJECT}`, database: "postgres", password,
      ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10_000 };
    const client = new pg.Client(config);
    try {
      await client.connect();
      await client.query("select 1");
      return { client, env: { ...process.env, PGHOST: host, PGPORT: "5432", PGUSER: config.user,
        PGDATABASE: "postgres", PGPASSWORD: password, PGSSLMODE: "verify-full", PGSSLROOTCERT: caPath } };
    } catch { await client.end().catch(() => {}); }
  }
  throw new Error("VERIFIED_TOKYO_DATABASE_CONNECTION_UNAVAILABLE");
}
async function fingerprint(client) {
  // Timestamp JSON must use the same zone on cloud and local instances.
  await client.query("set time zone 'UTC'");
  const { rows: tables } = await client.query(`select n.nspname as schema,c.relname as name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) and c.relkind='r' and not c.relispartition order by 1,2`, [SCHEMAS]);
  const result = [];
  for (const table of tables) {
    const { rows: [value] } = await client.query(`select count(*)::integer as count,
      md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' order by row_to_json(t)::text),'')) as digest
      from ${ident(table.schema)}.${ident(table.name)} t`);
    result.push({ table: `${table.schema}.${table.name}`, ...value });
  }
  return result;
}
async function backup() {
  const { client, env } = await connectRemote();
  try {
    // Native pg_dump provides a single database snapshot of schema and rows.
    const before = await fingerprint(client);
    const archive = await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl",
      ...SCHEMAS.flatMap((schema) => ["--schema", schema])], env);
    if (archive.subarray(0, 5).toString() !== "PGDMP") throw new Error("INVALID_DUMP_FORMAT");
    const after = await fingerprint(client);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("DATABASE_CHANGED_DURING_BACKUP");
    const roles = (await client.query("select rolname from pg_roles where rolname not like 'pg_%' order by rolname")).rows.map((r) => r.rolname);
    const envelope = Buffer.from(JSON.stringify({ version: 1, project: PROJECT, capturedAt: new Date().toISOString(),
      archive: archive.toString("base64"), fingerprint: after, roles }));
    const bytes = encrypt(envelope), filename = `${PROJECT}-native-${Date.now()}.aes`;
    writeFileSync(join(DIR, filename), bytes, { mode: 0o600, flag: "wx" });
    if (!decrypt(bytes).equals(envelope)) throw new Error("ENCRYPTED_BACKUP_VERIFY_FAILED");
    console.log(JSON.stringify({ operation: "native_backup", project: PROJECT, filename, bytes: bytes.length,
      sha256: sha256(bytes), tables: after.length, rows: after.reduce((n, t) => n + t.count, 0),
      tlsVerified: true, nativeFormat: "pg_dump_custom", restoreVerified: false }));
  } finally { await client.end(); }
}
async function restore(filename) {
  if (!/^diompsnswchpfguvryan-native-\d+\.aes$/u.test(filename ?? "")) throw new Error("INVALID_BACKUP_FILENAME");
  const startedAt = Date.now();
  const envelope = JSON.parse(decrypt(readFileSync(join(DIR, filename))).toString());
  if (envelope.version !== 1 || envelope.project !== PROJECT) throw new Error("INVALID_BACKUP_PROJECT");
  const restoreDirectory = createNativeRestoreDirectory();
  const local = restoreDirectory.path;
  const data = join(local, "data"), socket = join(local, "socket"); mkdirSync(socket, { mode: 0o700 });
  const port = "55471", user = "daycare_restore_operator";
  const env = { ...process.env, PGHOST: socket, PGPORT: port, PGUSER: user,
    PGDATABASE: "postgres", PGSSLMODE: "disable", PGPASSWORD: "" };
  let startAttempted = false, client, report, cleanup;
  try {
    await run("initdb", ["-D", data, "--username", user, "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8"], env);
    // Real restored rows are reachable only through the operator-owned 0700
    // Unix socket directory. No TCP listener or host trust authentication.
    startAttempted = true;
    await run("pg_ctl", ["-D", data, "-l", join(local, "server.log"), "-o", `-c listen_addresses='' -p ${port} -k ${socket}`, "-w", "start"], env);
    client = new pg.Client({ host: socket, port: Number(port), user, database: "postgres" }); await client.connect();
    const isolation = (await client.query("show listen_addresses")).rows[0]?.listen_addresses;
    if (isolation !== "") throw new Error("RESTORE_TCP_LISTENER_NOT_DISABLED");
    // These roles have no passwords/login and exist only in the isolated local drill.
    for (const role of envelope.roles) {
      if (role !== user && role !== "postgres") await client.query(`create role ${ident(role)} nologin`);
    }
    await client.query("create schema extensions; create extension pgcrypto with schema extensions; create extension \"uuid-ossp\" with schema extensions; drop schema public;");
    await run("pg_restore", ["--dbname", "postgres", "--no-owner", "--no-acl", "--exit-on-error"], env, Buffer.from(envelope.archive, "base64"));
    const restored = await fingerprint(client);
    if (JSON.stringify(restored) !== JSON.stringify(envelope.fingerprint)) {
      const difference = restored.filter((value, index) => JSON.stringify(value) !== JSON.stringify(envelope.fingerprint[index]));
      console.error(JSON.stringify({ difference: difference.map((value) => ({ table: value.table, count: value.count })) }));
      throw new Error("RESTORED_ROW_FINGERPRINT_MISMATCH");
    }
    report = { operation: "native_restore", project: PROJECT, filename, restoredTables: restored.length,
      restoredRows: restored.reduce((n, table) => n + table.count, 0), exactRowFingerprintMatch: true,
      durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)), scope: "isolated native PostgreSQL schema and row recovery; not managed platform/PITR or Storage object recovery",
      tcpListenerDisabled: true, socketDirectoryMode: "0700", serverStopped: false, plaintextDirectoryRemoved: false };
  } finally {
    await client?.end().catch(() => {});
    cleanup = await cleanupNativeRestoreDirectory({ directory: restoreDirectory, startAttempted,
      runPgCtl: (args, acceptExitCodes) => run("pg_ctl", args, env, undefined, { acceptExitCodes, returnExitCode: true }) });
  }
  // A success receipt is written only after pg_ctl has actually stopped the
  // restored cluster. A failed cleanup must not leave a false proof on disk.
  Object.assign(report, cleanup);
  writeFileSync(join(DIR, `${filename}.restore-report.json`), JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(report));
}
try {
  if (process.argv[2] === "backup") await backup();
  else if (process.argv[2] === "restore") await restore(process.argv[3]);
  else throw new Error("EXPECTED_BACKUP_OR_RESTORE");
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error.message, object: error.object }));
  process.exitCode = 1;
}
