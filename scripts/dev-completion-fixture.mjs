import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { createServer } = await import(require.resolve("vite", { paths: [dirname(require.resolve("vitest/package.json"))] }));
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root: resolve(project, "tests/browser"), configFile: false, envDir: false,
  server: { host: "127.0.0.1", port: 3115, strictPort: true, fs: { allow: [project] } },
  resolve: { alias: { "@": resolve(project, "src"), "next/link": resolve(project, "tests/browser/completion-next-mocks.tsx"), "next/image": resolve(project, "tests/browser/completion-image-mock.tsx") } },
  // Only this local all-fetch-intercepted harness may store synthetic drafts.
  // The published read-only preview still prohibits device writes.
  define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://invalid.invalid"), "process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW": JSON.stringify("false") },
  esbuild: { jsx: "automatic" },
});
await server.listen();
console.log("Local synthetic components only: http://127.0.0.1:3115/completion-fixture.html");
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
