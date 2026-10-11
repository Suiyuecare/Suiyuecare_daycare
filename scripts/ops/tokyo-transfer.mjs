import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Operator-only migration tooling. Secrets and row contents are never printed.
const SOURCE = "mmxqxsokpcdvuzmdhptg";
const TARGET = "diompsnswchpfguvryan";
const DIR = resolve("private/tokyo-transfer-20261011");
const KEY_SERVICE = "suiyuecare-daycare-transfer-backup-20261011";
function keychain(service) {
  return execFileSync("security", ["find-generic-password", "-s", service, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const rawToken = keychain("Supabase CLI");
const token = [rawToken, Buffer.from(rawToken, "base64").toString(),
  Buffer.from(rawToken.split(":").at(-1), "base64").toString()]
  .find((value) => /^sbp_[A-Za-z0-9]+$/u.test(value));
if (!token) throw new Error("MANAGEMENT_CREDENTIAL_UNAVAILABLE");
async function api(project, suffix, method = "GET", body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${suffix}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`MANAGEMENT_REQUEST_FAILED_${response.status}`);
    error.databaseCode = /(?:ERROR:|SQLSTATE)\s*([A-Z0-9]{5})/u.exec(body)?.[1];
    error.databaseKind = /permission denied/u.test(body) ? "permission" : /syntax error/u.test(body) ? "syntax"
      : /does not exist/u.test(body) ? "missing_object" : /constraint/u.test(body) ? "constraint"
      : /type|cast/u.test(body) ? "type" : "other";
    // Only reviewed identifier names, never the offending row/value.
    error.object = /(?:constraint|column|relation) ["\\]*([a-z_][a-z0-9_.]*)/u.exec(body)?.[1];
    throw error;
  }
  return response.json();
}
const query = (project, sql) => api(project, "database/query", "POST", { query: sql });
const ident = (value) => `"${value.replaceAll('"', '""')}"`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
async function tables(project) {
  return query(project, `select n.nspname as schema,c.relname as name,
    to_jsonb(array(select a.attname from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and a.attgenerated='' order by a.attnum)) as columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private','auth','storage','supabase_migrations')
      and c.relkind='r' and not c.relispartition order by 1,2`);
}
async function snapshot(project) {
  const catalog = await tables(project);
  const branches = catalog.map((table) => `select ${literal(`${table.schema}.${table.name}`)} as name,
    coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) as rows
    from ${ident(table.schema)}.${ident(table.name)} t`);
  const [result] = await query(project, `select jsonb_object_agg(name,rows) as data from (${branches.join(" union all ")}) q`);
  return { version: 1, project, capturedAt: new Date().toISOString(), catalog, data: result.data };
}
function encryptionKey(create = false) {
  try { return Buffer.from(keychain(KEY_SERVICE), "hex"); } catch {
    if (!create) throw new Error("BACKUP_KEY_UNAVAILABLE");
    const key = randomBytes(32);
    execFileSync("security", ["add-generic-password", "-U", "-a", "daycare-transfer",
      "-s", KEY_SERVICE, "-w", key.toString("hex")], { stdio: ["ignore", "pipe", "pipe"] });
    return key;
  }
}
function saveBackup(value, filename) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(true), nonce);
  const bytes = Buffer.concat([Buffer.from("DCT1"), nonce,
    cipher.update(JSON.stringify(value), "utf8"), cipher.final(), cipher.getAuthTag()]);
  writeFileSync(resolve(DIR, filename), bytes, { mode: 0o600, flag: "wx" });
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function loadBackup(filename) {
  const bytes = readFileSync(resolve(DIR, filename));
  if (bytes.subarray(0, 4).toString() !== "DCT1") throw new Error("INVALID_BACKUP");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(4, 16));
  cipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(16, -16)), cipher.final()]).toString());
}
function summary(value) {
  return Object.entries(value.data).filter(([, rows]) => rows.length)
    .map(([table, rows]) => ({ table, count: rows.length }));
}
async function inspect() {
  for (const project of [SOURCE, TARGET]) {
    const value = await snapshot(project);
    const config = await api(project, "config/auth");
    console.log(JSON.stringify({ project, tables: value.catalog.length,
      rowCounts: summary(value), googleEnabled: config.external_google_enabled,
      siteUrl: config.site_url }));
  }
}
async function backup() {
  for (const project of [SOURCE, TARGET]) {
    const value = await snapshot(project);
    const file = `${project}-${Date.now()}.aes`;
    const digest = saveBackup(value, file);
    // A successful decrypt/parse is necessary, but does not prove DB recovery.
    const replay = loadBackup(file);
    if (JSON.stringify(value) !== JSON.stringify(replay)) throw new Error("BACKUP_VERIFICATION_FAILED");
    console.log(JSON.stringify({ project, file, ...digest, tables: value.catalog.length,
      rows: summary(value).reduce((n, item) => n + item.count, 0), decryptVerified: true }));
  }
}
async function copyAuthConfig() {
  const source = await api(SOURCE, "config/auth");
  if (!source.external_google_enabled || !source.external_google_secret ||
    /^\*+$/u.test(source.external_google_secret)) throw new Error("GOOGLE_CREDENTIAL_UNAVAILABLE");
  await api(TARGET, "config/auth", "PATCH", {
    external_google_enabled: true, external_google_client_id: source.external_google_client_id,
    external_google_secret: source.external_google_secret,
    site_url: source.site_url, uri_allow_list: source.uri_allow_list,
    disable_signup: source.disable_signup,
  });
  const target = await api(TARGET, "config/auth");
  console.log(JSON.stringify({ project: TARGET, googleEnabled: target.external_google_enabled,
    clientMatches: target.external_google_client_id === source.external_google_client_id,
    siteMatches: target.site_url === source.site_url,
    providerCallbackNeedsConsoleVerification: true }));
}
async function renewDirectorApproval() {
  // This is the directly authorized initial director, not an invitation
  // approval forged on behalf of a second human. Activation still requires
  // the actual verified Google identity and a live OAuth session.
  const [result] = await query(TARGET, `begin;set local lock_timeout='5s';
    do $renew$ declare prior private.pending_staff_google_activations; begin
      select a.* into prior from private.pending_staff_google_activations a
      join auth.users u on u.id=a.user_id join public.roles r on r.id=a.role_id
      join public.branches b on b.id=a.branch_id and b.organization_id=a.organization_id
      join public.organizations o on o.id=b.organization_id
      where lower(u.email)='daycare.wanhua@suiyuecare.com' and a.allowed_email=lower(u.email)
        and r.role_key='branch_director' and b.code='wanhua'
        and o.name='樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構'
        and a.replaced_at is null for update of a;
      if not found then raise exception 'DIRECTOR_APPROVAL_TARGET_UNRESOLVED';end if;
      if prior.activated_at is not null or prior.expires_at>clock_timestamp() then return;end if;
      if prior.revoked_at is not null then raise exception 'DIRECTOR_APPROVAL_REVOKED';end if;
      update private.pending_staff_google_activations set replaced_at=clock_timestamp() where id=prior.id;
      insert into private.pending_staff_google_activations(user_id,organization_id,branch_id,role_id,allowed_email,
        display_name,approved_at,expires_at,approval_reference,replaces_id)
      values(prior.user_id,prior.organization_id,prior.branch_id,prior.role_id,prior.allowed_email,
        '楊晴懿',clock_timestamp(),clock_timestamp()+interval '7 days',
        'direct-owner-authorization:20261011:wanhua-director',prior.id);
    end $renew$;
    select count(*) as current_approved, count(*) filter(where activated_at is not null) as activated
    from private.pending_staff_google_activations where allowed_email='daycare.wanhua@suiyuecare.com'
      and replaced_at is null and revoked_at is null and expires_at>clock_timestamp();commit;`);
  console.log(JSON.stringify({ project: TARGET, directorApprovals: result,
    actualGoogleFirstLoginRequired: true, productionCutover: false }));
}
async function restoreData(filename) {
  if (!/^mmxqxsokpcdvuzmdhptg-\d+\.aes$/u.test(filename ?? "")) throw new Error("INVALID_BACKUP_FILE");
  const source = loadBackup(filename);
  if (source.project !== SOURCE || source.version !== 1) throw new Error("INVALID_BACKUP_SOURCE");
  for (const table of source.catalog) {
    if (typeof table.columns === "string" && /^\{[a-z0-9_,]+\}$/u.test(table.columns))
      table.columns = table.columns.slice(1, -1).split(",");
    if (!Array.isArray(table.columns)) throw new Error("INVALID_BACKUP_CATALOG");
  }
  const target = await snapshot(TARGET);
  // Never overwrite a project that has started real operations. A later
  // increment needs a reviewed cutover window, not this bootstrap command.
  for (const table of ["auth.users", "public.clients", "public.memberships", "public.organizations"])
    if (target.data[table]?.length) throw new Error("TARGET_ALREADY_IN_USE");
  const skip = new Set(["public.roles", "public.permissions", "public.role_permissions",
    "auth.schema_migrations", "storage.migrations", "supabase_migrations.schema_migrations",
    "storage.buckets", "auth.sessions", "auth.refresh_tokens", "auth.flow_state",
    "auth.mfa_amr_claims", "auth.one_time_tokens", "auth.sso_sessions"]);
  const copied = source.catalog.filter((table) => !skip.has(`${table.schema}.${table.name}`) &&
    source.data[`${table.schema}.${table.name}`]?.length);
  const targetNames = new Set(target.catalog.map((t) => `${t.schema}.${t.name}`));
  if (copied.some((t) => !targetNames.has(`${t.schema}.${t.name}`))) throw new Error("TARGET_SCHEMA_INCOMPLETE");
  const inserts = copied.map((table) => {
    const name = `${table.schema}.${table.name}`;
    const type = `${ident(table.schema)}.${ident(table.name)}`;
    const cols = table.columns.map(ident).join(",");
    if (name === "public.audit_events") {
      // Existing target deployment audits keep their IDs. Source audits use a
      // collision-free offset and immutable provenance retains the full
      // original record. No source foreign keys reference this audit PK.
      const offset = Math.max(0, ...target.data[name].map((row) => Number(row.id)));
      if (!Number.isSafeInteger(offset)) throw new Error("AUDIT_ID_OUT_OF_RANGE");
      return `insert into ${type} (${cols}) overriding system value select ${table.columns.map((col) => col === "id" ? `id + ${offset}` : ident(col)).join(",")}
        from jsonb_populate_recordset(null::${type},${literal(JSON.stringify(source.data[name]))}::jsonb);
        insert into private.source_audit_transfer_provenance(source_project,source_audit_id,organization_id,branch_id,target_audit_id,original_record,original_sha256)
        select ${literal(SOURCE)},(r->>'id')::bigint,(r->>'organization_id')::uuid,(r->>'branch_id')::uuid,(r->>'id')::bigint+${offset},r,
        encode(sha256(convert_to(r::text,'UTF8')),'hex') from jsonb_array_elements(${literal(JSON.stringify(source.data[name]))}::jsonb) r;
        select setval(pg_get_serial_sequence('public.audit_events','id'),(select max(id) from public.audit_events),true);`;
    }
    return `insert into ${type} (${cols}) overriding system value select ${cols} from jsonb_populate_recordset(null::${type},
      ${literal(JSON.stringify(source.data[name]))}::jsonb) on conflict do nothing;`;
  });
  // Restoring frozen audit/history rows must not run live business triggers or
  // manufacture a second audit chain. Re-enable triggers before integrity
  // checks and commit. All writes are in this one transaction.
  const integrity = `do $check$ declare f record; bad boolean; predicate text; joins text;
    begin for f in select c.*,n.nspname as ns,t.relname as tab,rn.nspname as refns,rt.relname as reftab
      from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
      join pg_class rt on rt.oid=c.confrelid join pg_namespace rn on rn.oid=rt.relnamespace
      where c.contype='f' and n.nspname in ('public','private','auth','storage') loop
      select string_agg(format('s.%I is not null',a.attname),' and '),
        string_agg(format('s.%I = r.%I',a.attname,b.attname),' and ')
        into predicate,joins from unnest(f.conkey,f.confkey) k(l,r)
        join pg_attribute a on a.attrelid=f.conrelid and a.attnum=k.l
        join pg_attribute b on b.attrelid=f.confrelid and b.attnum=k.r;
      execute format('select exists(select 1 from %I.%I s where %s and not exists
        (select 1 from %I.%I r where %s))',f.ns,f.tab,predicate,f.refns,f.reftab,joins) into bad;
      if bad then raise exception 'RESTORE_FOREIGN_KEY_VALIDATION_FAILED'; end if;
    end loop; end $check$;`;
  await query(TARGET, `begin; set local lock_timeout='5s'; set local statement_timeout='60s';
    set local session_replication_role=replica; ${inserts.join("\n")}
    set local session_replication_role=origin; ${integrity} commit;`);
  const restored = await snapshot(TARGET);
  const checked = copied.map((table) => {
    const name = `${table.schema}.${table.name}`;
    const rows = restored.data[name];
    const normalize = (value) => JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
    const present = new Set(rows.map(normalize));
    // Target schema may have additive columns. Compare the source columns,
    // not object ordering or newer target defaults.
    const auditOffset = name === "public.audit_events" ? Math.max(0, ...target.data[name].map((row) => Number(row.id))) : 0;
    const actual = new Set(rows.map((row) => normalize(Object.fromEntries(table.columns.map((col) => [col,
      col === "id" && name === "public.audit_events" ? Number(row[col]) - auditOffset : row[col]])))));
    const exact = source.data[name].every((row) => actual.has(normalize(Object.fromEntries(table.columns.map((col) => [col, row[col]])))));
    void present;
    if (!exact) throw new Error("RESTORE_ROW_RECONCILIATION_FAILED");
    return { table: name, sourceRows: source.data[name].length, targetRows: rows.length, exact: true };
  });
  console.log(JSON.stringify({ target: TARGET, restored: checked, sessionsCopied: false,
    productionCutover: false }));
}
try {
  if (process.argv[2] === "inspect") await inspect();
  else if (process.argv[2] === "backup") await backup();
  else if (process.argv[2] === "copy-auth-config") await copyAuthConfig();
  else if (process.argv[2] === "restore-data") await restoreData(process.argv[3]);
  else if (process.argv[2] === "renew-director-approval") await renewDirectorApproval();
  else throw new Error("INVALID_OPERATION");
} catch (error) {
  // Error bodies may include SQL, rows, access tokens or connection strings.
  console.error(JSON.stringify({ operation: process.argv[2], error:
    /^([A-Z][A-Z0-9_]+)$/u.test(error.message) ? error.message : "TRANSFER_FAILED",
    errorType: error.name, failureKind: /timeout/i.test(error.message) ? "timeout"
      : /fetch/i.test(error.message) ? "network" : /replaceAll|\.map|iterable|undefined/i.test(error.message) ? "shape" : "other",
    location: error.stack?.split("\n").find((line) => /^\s+at /u.test(line))?.replace(process.cwd(), "<workspace>"),
    databaseCode: error.databaseCode, databaseKind: error.databaseKind, object: error.object }));
  process.exitCode = 1;
}
