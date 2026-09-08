import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve, relative } from "node:path";

// Read Vercel's actual dry-run manifest. Never print file contents or credentials.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const manifest = JSON.parse(input);
if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("PREVIEW_MANIFEST_EMPTY");
const root = process.cwd();
const required = ["src/lib/supabase/server.ts", "src/lib/supabase/browser.ts", "src/lib/supabase/admin.ts",
  "src/lib/synthetic-preview/policy.ts", "src/lib/env.ts", "src/proxy.ts",
  "src/lib/data-inventory/snapshot.ts", "src/app/api/data-inventory/route.ts",
  "src/components/data-inventory/data-inventory-workspace.tsx", "src/components/imports/import-readiness-panel.tsx"];
const prohibited = /(?:^|\/)\.env[^/]*$|^(?:supabase|docs|tests|scripts|output|artifacts|test-results|\.git|node_modules|\.next)\/|\.(?:html?|pdf|docx|xlsx|log|tsbuildinfo)$|\.test\.tsx?$/iu;
const paths = new Set(); const files = []; let bytes = 0;
for (const entry of manifest.files) {
  if (typeof entry.path !== "string" || isAbsolute(entry.path)) throw new Error("PREVIEW_MANIFEST_PATH_INVALID");
  const target = resolve(root, entry.path); const normalized = relative(root, target);
  if (normalized.startsWith("..") || paths.has(normalized)) throw new Error("PREVIEW_MANIFEST_SCOPE_INVALID");
  paths.add(normalized);
  if (prohibited.test(normalized)) throw new Error("PREVIEW_PROHIBITED_FILE");
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw new Error("PREVIEW_SYMLINK_NOT_ALLOWED");
  if (stat.isDirectory()) continue;
  if (!stat.isFile()) throw new Error("PREVIEW_SPECIAL_FILE_NOT_ALLOWED");
  const contents = await readFile(target);
  const text = contents.toString("utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text) ||
    /(?:SUPABASE_SERVICE_ROLE_KEY|AWS_SECRET_ACCESS_KEY|LINE_CHANNEL_ACCESS_TOKEN)\s*[:=]\s*["'](?:eyJ[A-Za-z0-9._-]{30,}|[A-Za-z0-9/+]{40,})["']/u.test(text)) throw new Error("PREVIEW_SECRET_LITERAL_DETECTED");
  bytes += contents.length;
  files.push({ path: normalized, sha256: createHash("sha256").update(contents).digest("hex"), bytes: contents.length });
}
if (required.some((path) => !paths.has(path))) throw new Error("PREVIEW_REQUIRED_SOURCE_MISSING");
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
const sourceManifestHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
console.log(JSON.stringify({ status: "passed", entries: manifest.files.length, regularFiles: files.length,
  bytes, prohibitedFiles: 0, symlinks: 0, secretLiteralsDetected: 0, sourceManifestHash,
  limitation: "Scoped upload preflight, not a universal PII or secret detector." }));
