import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// These subprocess tests use a disposable synthetic source tree, never the
// actual repository, uploaded case data, deployment credentials or network.
const verifier = fileURLToPath(new URL("../verify-preview-upload.mjs", import.meta.url));
const required = [
  "src/lib/supabase/server.ts", "src/lib/supabase/browser.ts", "src/lib/supabase/admin.ts",
  "src/lib/synthetic-preview/policy.ts", "src/lib/env.ts", "src/proxy.ts",
  "src/lib/data-inventory/snapshot.ts", "src/app/api/data-inventory/route.ts",
  "src/components/data-inventory/data-inventory-workspace.tsx", "src/components/imports/import-readiness-panel.tsx",
];
// Base64 alphabet only so the fake literal exercises the scanner's intended
// credential pattern. This marker is not an actual usable credential.
const syntheticSecret = "SYNTHETICDONOTPRINT" + "X".repeat(64);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "daycare-preview-upload-"));
  t.after(async () => {
    // Only remove the exact generated tree; unlinking its test symlinks does
    // not follow their targets. No broad workspace or home cleanup is used.
    assert.ok(root.startsWith(join(tmpdir(), "daycare-preview-upload-")));
    await rm(root, { recursive: true, force: true });
  });
  const sources = new Map(required.map((path, index) => [path, `export const synthetic${index} = ${index};\n`]));
  async function put(path, content) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  for (const [path, content] of sources) await put(path, content);
  return { root, sources, put, files: required.map((path) => ({ path })) };
}

function run(root, input) {
  const result = spawnSync(process.execPath, [verifier], {
    cwd: root,
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {}, // Never inherit hosted keys or authenticated CLI state.
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "The preflight must finish without attempting to read a FIFO or hanging.");
  return result;
}

function denied(result, code) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "", "A rejected manifest cannot print a success result.");
  assert.match(result.stderr, new RegExp(`\\b${code}\\b`, "u"));
  assert.ok(!result.stderr.includes(syntheticSecret), "Errors cannot echo synthetic credential contents.");
}

test("all ten required synthetic sources pass with deterministic aggregate hash, no source content", async (t) => {
  const f = await fixture(t);
  const first = run(f.root, { files: f.files });
  assert.equal(first.status, 0);
  assert.equal(first.stderr, "");
  const result = JSON.parse(first.stdout);
  const expectedFiles = [...f.sources].map(([path, source]) => ({ path,
    sha256: createHash("sha256").update(source).digest("hex"), bytes: Buffer.byteLength(source) }));
  expectedFiles.sort((a, b) => a.path.localeCompare(b.path, "en"));
  assert.equal(result.status, "passed");
  assert.equal(result.entries, 10);
  assert.equal(result.regularFiles, 10);
  assert.equal(result.bytes, expectedFiles.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(result.sourceManifestHash, createHash("sha256").update(JSON.stringify(expectedFiles)).digest("hex"));
  assert.equal(result.prohibitedFiles, 0);
  assert.equal(result.symlinks, 0);
  assert.equal(result.secretLiteralsDetected, 0);
  assert.match(result.limitation, /not a universal PII or secret detector/u);
  for (const [path, content] of f.sources) {
    assert.ok(!first.stdout.includes(path));
    assert.ok(!first.stdout.includes(content));
  }
  const reversed = run(f.root, { files: [...f.files].reverse() });
  assert.equal(reversed.status, 0);
  assert.equal(JSON.parse(reversed.stdout).sourceManifestHash, result.sourceManifestHash);
});

test("missing required source is rejected", async (t) => {
  const f = await fixture(t);
  denied(run(f.root, { files: f.files.slice(1) }), "PREVIEW_REQUIRED_SOURCE_MISSING");
});

test("a directory cannot impersonate a required source", async (t) => {
  const f = await fixture(t);
  const path = required[4];
  await rename(join(f.root, path), join(f.root, "synthetic-env-original.ts"));
  await mkdir(join(f.root, path));
  denied(run(f.root, { files: f.files }), "PREVIEW_REQUIRED_SOURCE_MISSING");
});

for (const files of [[], null, "files"]) {
  test(`empty or non-array files shape is rejected (${JSON.stringify(files)})`, async (t) => {
    const f = await fixture(t);
    denied(run(f.root, { files }), "PREVIEW_MANIFEST_EMPTY");
  });
}

test("malformed manifest errors are sanitized instead of echoing raw stdin", async (t) => {
  const f = await fixture(t);
  denied(run(f.root, `{\"files\": [${syntheticSecret}]}`), "PREVIEW_MANIFEST_INVALID");
});

test("manifest null is rejected with a safe error", async (t) => {
  const f = await fixture(t);
  const result = run(f.root, "null");
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.ok(!result.stderr.includes(syntheticSecret));
});

for (const directory of ["supabase", "docs", "tests", "scripts", "infra", "output", "artifacts",
  "test-results", "playwright-report", "private", "recovery", "uploads", "imports", "exports", "backups",
  ".git", ".vercel", "node_modules", ".next"]) {
  test(`prohibited ${directory} directory is denied before opening that path`, async (t) => {
    const f = await fixture(t);
    // Deliberately absent: a filesystem access would produce ENOENT instead of
    // the path policy error. The verifier must reject solely from the manifest.
    const result = run(f.root, { files: [...f.files, { path: `${directory}/absent-synthetic.ts` }] });
    denied(result, "PREVIEW_PROHIBITED_FILE");
    assert.ok(!result.stderr.includes("ENOENT"));
  });
}

for (const extension of ["html", "htm", "pdf", "docx", "xlsx", "csv", "log", "tsbuildinfo", "aes", "dump",
  "sqlite", "sqlite3", "db", "key", "p12", "pfx", "pem", "sql.gz"]) {
  test(`prohibited .${extension} container is denied without reading it`, async (t) => {
    const f = await fixture(t);
    const result = run(f.root, { files: [...f.files, { path: `public/absent-synthetic.${extension}` }] });
    denied(result, "PREVIEW_PROHIBITED_FILE");
    assert.ok(!result.stderr.includes("ENOENT"));
  });
}

for (const path of [".env", ".env.local", "src/.env.production", "public/synthetic.test.ts", "public/synthetic.test.tsx"]) {
  test(`configuration or test source excluded (${path})`, async (t) => {
    const f = await fixture(t);
    denied(run(f.root, { files: [...f.files, { path }] }), "PREVIEW_PROHIBITED_FILE");
  });
}

for (const path of ["../outside.ts", "src/../../outside.ts"]) {
  test(`root-escaping traversal denied (${path})`, async (t) => {
    const f = await fixture(t);
    denied(run(f.root, { files: [...f.files, { path }] }), "PREVIEW_MANIFEST_SCOPE_INVALID");
  });
}

test("internal parent traversal is not an alternate required-source spelling", async (t) => {
  const f = await fixture(t);
  const files = f.files.map((entry) => entry.path === required[4] ? { path: "src/lib/../lib/env.ts" } : entry);
  const result = run(f.root, { files });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /PREVIEW_MANIFEST_(?:PATH|SCOPE)_INVALID/u);
});

for (const bad of ["/tmp/absolute.ts", "src\\lib\\env.ts", 1, null]) {
  test(`invalid absolute, backslash or non-string path denied (${JSON.stringify(bad)})`, async (t) => {
    const f = await fixture(t);
    denied(run(f.root, { files: [...f.files, { path: bad }] }), "PREVIEW_MANIFEST_PATH_INVALID");
  });
}

test("duplicate source is rejected instead of double-counted", async (t) => {
  const f = await fixture(t);
  denied(run(f.root, { files: [...f.files, f.files[0]] }), "PREVIEW_MANIFEST_SCOPE_INVALID");
});

test("normalized duplicate source is rejected", async (t) => {
  const f = await fixture(t);
  denied(run(f.root, { files: [...f.files, { path: `./${required[0]}` }] }), "PREVIEW_MANIFEST_SCOPE_INVALID");
});

test("final-file symlink cannot replace a required source", async (t) => {
  const f = await fixture(t);
  const original = join(f.root, required[4]);
  await rename(original, join(f.root, "synthetic-env-original.ts"));
  await symlink("../../synthetic-env-original.ts", original);
  denied(run(f.root, { files: f.files }), "PREVIEW_SYMLINK_NOT_ALLOWED");
});

test("symlinked parent within the source root is denied before content inspection", async (t) => {
  const f = await fixture(t);
  await f.put("real-assets/example.ts", `const synthetic = \"-----BEGIN PRIVATE KEY-----${syntheticSecret}\";\n`);
  await mkdir(join(f.root, "public"));
  await symlink("../real-assets", join(f.root, "public", "current"));
  denied(run(f.root, { files: [...f.files, { path: "public/current/example.ts" }] }), "PREVIEW_SYMLINK_NOT_ALLOWED");
});

test("symlinked parent outside the source root is denied before content inspection", async (t) => {
  const f = await fixture(t);
  // The target is another disposable synthetic directory, never a real file.
  const external = await mkdtemp(join(tmpdir(), "daycare-preview-upload-symlink-target-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, "example.ts"), `const synthetic = \"-----BEGIN PRIVATE KEY-----${syntheticSecret}\";\n`);
  await mkdir(join(f.root, "public"));
  await symlink(external, join(f.root, "public", "current"));
  denied(run(f.root, { files: [...f.files, { path: "public/current/example.ts" }] }), "PREVIEW_SYMLINK_NOT_ALLOWED");
});

for (const literal of [
  `const synthetic = \"-----BEGIN PRIVATE KEY-----${syntheticSecret}\";`,
  `const synthetic = \"-----BEGIN RSA PRIVATE KEY-----${syntheticSecret}\";`,
  `const synthetic = \"-----BEGIN EC PRIVATE KEY-----${syntheticSecret}\";`,
  `const synthetic = \"-----BEGIN OPENSSH PRIVATE KEY-----${syntheticSecret}\";`,
  `const SUPABASE_SERVICE_ROLE_KEY = \"${syntheticSecret}\";`,
  `const AWS_SECRET_ACCESS_KEY = \"${syntheticSecret}\";`,
  `const LINE_CHANNEL_ACCESS_TOKEN = \"${syntheticSecret}\";`,
]) {
  const label = literal.includes("PRIVATE KEY") ? literal.match(/BEGIN (.*?)PRIVATE KEY/u)[1].trim() || "PKCS8" : literal.match(/const (\w+)/u)[1];
  test(`synthetic credential literal is rejected without output contents (${label})`, async (t) => {
    const f = await fixture(t);
    await f.put(required[4], literal);
    const result = run(f.root, { files: f.files });
    denied(result, "PREVIEW_SECRET_LITERAL_DETECTED");
    assert.ok(!result.stderr.includes(literal));
  });
}

test("safe source comments naming environment variables do not pretend to contain real keys", async (t) => {
  const f = await fixture(t);
  await f.put(required[4], "// SUPABASE_SERVICE_ROLE_KEY is server-only.\nconst AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;\n");
  const result = run(f.root, { files: f.files });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).secretLiteralsDetected, 0);
});

test("non-regular FIFO is rejected before a blocking read", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, "public"));
  const created = spawnSync("mkfifo", [join(f.root, "public", "synthetic-pipe")], { encoding: "utf8" });
  assert.ifError(created.error);
  assert.equal(created.status, 0);
  denied(run(f.root, { files: [...f.files, { path: "public/synthetic-pipe" }] }), "PREVIEW_SPECIAL_FILE_NOT_ALLOWED");
});
