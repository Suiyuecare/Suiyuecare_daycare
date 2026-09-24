import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = new URL(process.env.ROUTE_SMOKE_BASE_URL ?? "http://127.0.0.1:3000");
const matrixPath = resolve(process.cwd(), "docs/R0_PAGE_ACCEPTANCE_MATRIX.md");
const matrix = await readFile(matrixPath, "utf8");
const routeHeadingOverrides = new Map([
  [1, "今天的照顧工作，一眼掌握。"],
  [17, "選個案"],
  [84, "今天一切平安，下午會再更新返家時間。"],
]);

const pages = matrix.split("\n").flatMap((line) => {
  const cells = line.split("|").map((cell) => cell.trim());
  if (!/^\d+$/u.test(cells[1] ?? "") ||
      !/^(?:staff|family)\//u.test(cells[2] ?? "")) return [];
  return [{ number: Number(cells[1]), slug: cells[2], title: cells[3] }];
});

if (pages.length !== 89 || new Set(pages.map((page) => page.number)).size !== 89 ||
    new Set(pages.map((page) => page.slug)).size !== 89) {
  throw new Error("The R0 matrix must contain exactly 89 unique page routes.");
}

async function verifyPage(page) {
  const pathname = page.slug.startsWith("family/")
    ? `/${page.slug}`
    : `/app/${page.slug}`;
  try {
    const response = await fetch(new URL(pathname, baseUrl), {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    const errors = [];
    if (response.status !== 200) errors.push(`HTTP ${response.status}`);
    const expectedHeading = routeHeadingOverrides.get(page.number) ?? page.title;
    if (!body.includes(`<h1>${expectedHeading}</h1>`)) {
      errors.push("route heading missing");
    }
    if (body.length < 1_000) errors.push("response unexpectedly small");
    return { ...page, pathname, errors };
  } catch (error) {
    return {
      ...page,
      pathname,
      errors: [error instanceof Error ? error.message : "request failed"],
    };
  }
}

const results = [];
for (let index = 0; index < pages.length; index += 6) {
  results.push(...await Promise.all(pages.slice(index, index + 6).map(verifyPage)));
}

const failures = results.filter((result) => result.errors.length > 0);
if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(
      `Page ${failure.number} ${failure.pathname}: ${failure.errors.join(", ")}\n`,
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Route smoke: ${results.length}/89 pages passed at ${baseUrl.origin}.\n`);
}
