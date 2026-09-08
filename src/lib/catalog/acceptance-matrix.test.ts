import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { catalogModules, pageCatalog } from "./index";

const matrix = readFileSync(
  resolve(process.cwd(), "docs/R0_PAGE_ACCEPTANCE_MATRIX.md"),
  "utf8",
);
const implementationStatus = readFileSync(
  resolve(process.cwd(), "docs/IMPLEMENTATION_STATUS.md"),
  "utf8",
);

const maturities = [
  "route-only",
  "shared workspace",
  "partial",
  "dedicated",
  "verified",
] as const;
type Maturity = (typeof maturities)[number];

type MatrixPage = {
  number: number;
  slug: string;
  title: string;
  maturity: Maturity;
  evidence: string;
};

function parsePageRows(): MatrixPage[] {
  return matrix.split("\n").flatMap((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 9 || !/^\d+$/u.test(cells[1] ?? "") ||
        !/^(?:staff|family)\//u.test(cells[2] ?? "") ||
        !maturities.includes(cells[4] as Maturity)) return [];
    return [{
      number: Number(cells[1]),
      slug: cells[2]!,
      title: cells[3]!,
      maturity: cells[4] as Maturity,
      evidence: cells[5]!,
    }];
  });
}

function countMaturities(rows: readonly MatrixPage[]) {
  return Object.fromEntries(maturities.map((maturity) => [
    maturity,
    rows.filter((row) => row.maturity === maturity).length,
  ])) as Record<Maturity, number>;
}

describe("R0 acceptance matrix documentation contract", () => {
  const rows = parsePageRows();

  it("keeps all 89 matrix rows aligned with the frozen catalog", () => {
    expect(rows).toHaveLength(89);
    expect(rows.map(({ number, slug, title }) => ({ number, slug, title })))
      .toEqual(pageCatalog.map(({ number, slug, title }) => ({ number, slug, title })));
  });

  it("keeps the global maturity statement derived from the page rows", () => {
    const counts = countMaturities(rows);
    const match = matrix.match(
      /目前分布：route-only=(\d+)、shared workspace=(\d+)、partial=(\d+)、dedicated=(\d+)、verified=(\d+)，合計 \*\*(\d+)\*\* 頁。/u,
    );
    expect(match).not.toBeNull();
    expect(match?.slice(1).map(Number)).toEqual([
      counts["route-only"],
      counts["shared workspace"],
      counts.partial,
      counts.dedicated,
      counts.verified,
      rows.length,
    ]);
    expect(Array.from(matrix.matchAll(/route-only=(\d+)/gu))).toHaveLength(1);

    const statusMatch = implementationStatus.match(
      /成熟度為 `dedicated=(\d+)`、`partial=(\d+)`、`shared workspace=(\d+)`、`verified=(\d+)`/u,
    );
    expect(statusMatch?.slice(1).map(Number)).toEqual([
      counts.dedicated,
      counts.partial,
      counts["shared workspace"],
      counts.verified,
    ]);
  });

  it("keeps every module subtotal derived from its catalog pages", () => {
    const moduleLines = matrix.split("\n").flatMap((line) => {
      const match = line.match(
        /^\| (\d+) \| ([^|]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/u,
      );
      return match ? [{ moduleOrder: Number(match[1]), title: match[2]!.trim(),
        values: match.slice(3).map(Number) }] : [];
    });
    expect(moduleLines).toHaveLength(11);
    for (const moduleLine of moduleLines) {
      const catalogModule = catalogModules.find(
        (item) => item.order === moduleLine.moduleOrder,
      );
      expect(catalogModule?.title).toBe(moduleLine.title);
      const moduleRows = rows.filter((row) =>
        pageCatalog.find((page) => page.number === row.number)?.moduleId ===
          catalogModule?.id);
      const counts = countMaturities(moduleRows);
      expect(moduleLine.values).toEqual([
        moduleRows.length,
        counts["route-only"],
        counts["shared workspace"],
        counts.partial,
        counts.dedicated,
        counts.verified,
      ]);
    }
  });

  it("defines every evidence code referenced by a page row", () => {
    const defined = new Set(Array.from(
      matrix.matchAll(/^\| (E-[A-Z0-9-]+) \|/gmu),
      (match) => match[1],
    ));
    expect(defined.size).toBeGreaterThan(0);
    for (const row of rows) {
      const references = row.evidence.match(/E-[A-Z0-9-]+/gu) ?? [];
      expect(references.length, `page ${row.number} has evidence`).toBeGreaterThan(0);
      for (const reference of references) {
        expect(defined.has(reference), `page ${row.number}: ${reference}`).toBe(true);
      }
    }
  });

  it("does not classify the shared workspace alone as dedicated evidence", () => {
    for (const row of rows) {
      const references = row.evidence.match(/E-[A-Z0-9-]+/gu) ?? [];
      if (row.maturity === "shared workspace") {
        expect(references, `page ${row.number}`).toContain("E-SHARED");
      }
      if (row.maturity === "dedicated") {
        expect(references, `page ${row.number}`).not.toContain("E-SHARED");
        expect(
          references.some((reference) =>
            !["E-CAT", "E-ROUTE", "E-AUTH", "E-DB"].includes(reference)),
          `page ${row.number} has page-specific evidence`,
        ).toBe(true);
      }
    }
  });

  it("lists every dedicated page once in the implementation summary", () => {
    const listed = Array.from(
      implementationStatus.matchAll(/^\| #(\d+) [^|]+ \|/gmu),
      (match) => Number(match[1]),
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort((left, right) => left - right)).toEqual(
      rows.filter((row) => row.maturity === "dedicated")
        .map((row) => row.number)
        .sort((left, right) => left - right),
    );
  });
});
