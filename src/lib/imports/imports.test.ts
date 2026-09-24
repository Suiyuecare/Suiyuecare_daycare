import { readFileSync } from "node:fs";
import { delimiter } from "node:path";
import http from "node:http";
import https from "node:https";

import { describe, expect, it, vi } from "vitest";

import { ImportError } from "./errors";
import {
  MAX_HTML_MARKUP_TOKENS,
  MAX_IMPORT_FIELD_CHARACTERS,
  MAX_IMPORT_SECTIONS,
  parseCentralCareHtml,
} from "./parser";
import {
  approveHtmlImport,
  getImportPreview,
  reparseHtmlImport,
  uploadHtmlImport,
} from "./service";
import { DemoMemoryImportRepository } from "./memory-repository";
import {
  CURRENT_MAPPING_VERSION,
  MAX_HTML_IMPORT_BYTES,
} from "./types";
import type { HtmlImportFile, ImportActor } from "./types";
import { validateHtmlImportFile } from "./validation";

const encoder = new TextEncoder();
const fixtureUrl = new URL(
  "../../../tests/fixtures/imports/synthetic-central.html",
  import.meta.url,
);

function htmlFile(html: string, fileName = "synthetic.html"): HtmlImportFile {
  return {
    fileName,
    mimeType: "text/html",
    bytes: encoder.encode(html),
  };
}

function parsed(html: string) {
  return parseCentralCareHtml(
    validateHtmlImportFile(htmlFile(html)),
    CURRENT_MAPPING_VERSION,
  );
}

const knownCoreHeadings = [
  "申請表",
  "申請資訊",
  "處理狀態",
  "需要服務者基本資料",
  "身心障礙證明、ICF資料介接",
  "代理人 (本人申請可不填)",
  "主要聯絡人資料 (獨居者可不填)",
  "評估結果",
  "A.個案基本資料",
  "B.主要及次要照顧者基本資料",
  "C.個案溝通能力",
  "D.短期記憶評估",
  "E 大題日常活動功能量表（ADLs）、F 大題工具性日常活動功能量表（IADLs）說明",
  "E.個案日常活動功能量表（ADLs）",
  "F.個案工具性日常活動功能量表（IADLs）",
  "G.特殊複雜照護需要",
  "H.居家環境與社會參與",
  "I.情緒及行為型態",
  "J.主要照顧者負荷",
  "K.主要照顧者工作與支持",
  "計畫簡述",
  "照顧計畫",
  "圖片上傳",
  "上傳支付Excel及其他附件",
  "診斷書上傳",
  "輔具評估報告書",
  "個案管理照顧計畫 (A單位專區)",
  "綜合問題與建議 (A單位專區)",
  "個管聯絡資訊 (A單位專區)",
  "照顧及專業服務(B)[每月]",
  "照顧及專業服務(C)[每月]",
  "交通接送(D)[每月]",
  "輔具服務(EF)",
  "喘息服務(G)[每年]",
  "勞動部短照(S)[每年]",
  "其他(OTHT)",
  "縣市自辦項目(Z)",
  "簽審督導一",
  "簽審督導二",
  "照顧計畫-簽審督導",
] as const;

function headingDocument(extra: readonly string[] = []) {
  const headings = [...knownCoreHeadings, ...extra];
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${headings
    .map(
      (heading, index) =>
        `<h5>${heading}</h5><table><tr><th>欄位 ${index + 1}</th><td>值 ${index + 1}</td></tr></table>`,
    )
    .join("")}</body></html>`;
}

const actor: ImportActor = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  branchId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  assuranceLevel: "aal2",
  recentAal2At: new Date().toISOString(),
};

describe("HTML import validation", () => {
  it("validates extension, MIME, UTF-8 and SHA-256", () => {
    const result = validateHtmlImportFile(
      htmlFile("<!doctype html><meta charset=utf-8><title>安全測試</title>"),
    );
    expect(result.charset).toBe("utf-8");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects incorrect metadata and oversized bytes", () => {
    expect(() =>
      validateHtmlImportFile({
        ...htmlFile("<!doctype html><p>test</p>"),
        fileName: "not-html.txt",
      }),
    ).toThrowError(ImportError);
    expect(() =>
      validateHtmlImportFile({
        ...htmlFile("<!doctype html><p>test</p>"),
        mimeType: "text/plain",
      }),
    ).toThrowError(ImportError);
    expect(() =>
      validateHtmlImportFile({
        fileName: "large.html",
        mimeType: "text/html",
        bytes: new Uint8Array(MAX_HTML_IMPORT_BYTES + 1),
      }),
    ).toThrowError(ImportError);
  });
});

describe("static central HTML parser", () => {
  it("fails closed before parsing an excessive number of markup tokens", () => {
    const excessive = `<div></div>`.repeat(MAX_HTML_MARKUP_TOKENS / 2 + 1);
    expect(() => parsed(`<!doctype html><html><body>${excessive}</body></html>`))
      .toThrowError(expect.objectContaining({ code: "HTML_COMPLEXITY_LIMIT_EXCEEDED" }));
  });

  it("rejects excessive section and field value complexity", () => {
    const sections = `<h5>申請表</h5>`.repeat(MAX_IMPORT_SECTIONS + 1);
    expect(() => parsed(`<!doctype html><html><body>${sections}</body></html>`))
      .toThrowError(expect.objectContaining({ code: "HTML_SECTION_COUNT_LIMIT_EXCEEDED" }));

    const largeValue = "值".repeat(MAX_IMPORT_FIELD_CHARACTERS + 1);
    expect(() =>
      parsed(
        `<!doctype html><html><body><h5>申請表</h5><table><tr><th>說明</th><td>${largeValue}</td></tr></table></body></html>`,
      ),
    ).toThrowError(expect.objectContaining({ code: "HTML_FIELD_LIMIT_EXCEEDED" }));
  });

  it("blocks active content without performing external requests", () => {
    const result = parsed(readFileSync(fixtureUrl, "utf8"));
    expect(result.security).toMatchObject({
      parser: "cheerio-static",
      scriptElementsBlocked: 1,
      formElementsNeutralized: 1,
      redirectElementsBlocked: 1,
      externalRequestCount: 0,
    });
    expect(result.security.externalReferencesBlocked).toBeGreaterThanOrEqual(3);
    expect(result.security.inlineEventHandlersBlocked).toBeGreaterThanOrEqual(2);
    expect(result.fields.some((field) => field.rawValue.includes("must-not-import"))).toBe(false);
  });

  it("retains unknown sections and keys fields by section, label and parent path", () => {
    const result = parsed(readFileSync(fixtureUrl, "utf8"));
    const unknown = result.sections.find((section) => !section.recognized);
    const retained = result.fields.find(
      (field) => field.source.label === "自訂欄位",
    );
    expect(unknown).toBeDefined();
    expect(retained).toMatchObject({
      mappingState: "unknown",
      targetPath: null,
      normalizedValue: "保留待映射",
    });
    expect(retained?.mappingKey).toContain("自訂欄位");
    expect(retained?.mappingKey).toContain("UNKNOWN_");
  });

  it("recognizes 40 core sections and the two optional sections", () => {
    const core = parsed(headingDocument());
    const withEi = parsed(headingDocument(["智慧科技輔具(EI)"]));
    const withBoth = parsed(
      headingDocument(["A單位希望修正內容", "智慧科技輔具(EI)"]),
    );
    expect(core.sections).toHaveLength(40);
    expect(core.sections.every((section) => section.recognized)).toBe(true);
    expect(withEi.sections).toHaveLength(41);
    expect(withBoth.sections).toHaveLength(42);
  });
});

describe("import lifecycle", () => {
  it("does not create rows for an exact duplicate and replays idempotently", async () => {
    const repository = new DemoMemoryImportRepository();
    const file = htmlFile(headingDocument());
    const first = await uploadHtmlImport(repository, actor, file, "upload-1");
    const replay = await uploadHtmlImport(repository, actor, file, "upload-1");
    const duplicate = await uploadHtmlImport(repository, actor, file, "upload-2");

    expect(first.status).toBe("ready_for_approval");
    expect(replay.replayed).toBe(true);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.batch.id).toBe(first.batch.id);
    expect(repository.size).toBe(1);
    await expect(
      getImportPreview(
        repository,
        { ...actor, organizationId: "99999999-9999-4999-8999-999999999999" },
        first.batch.id,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_NOT_FOUND" });
  });

  it("requires an explicit conflict choice and leaves no partial approval", async () => {
    const repository = new DemoMemoryImportRepository();
    const upload = await uploadHtmlImport(
      repository,
      actor,
      htmlFile(
        "<!doctype html><html><head><meta charset=utf-8></head><body><h5>需要服務者基本資料</h5><table><tr><th>服務狀態</th><td><input aria-label='服務狀態' value='啟用'><input aria-label='服務狀態' value='暫停'></td></tr></table></body></html>",
      ),
      "upload-conflict",
    );
    const preview = await getImportPreview(repository, actor, upload.batch.id);
    const conflict = preview.conflicts[0];
    expect(conflict?.candidates).toHaveLength(2);

    await expect(
      approveHtmlImport(repository, actor, upload.batch.id, {
        idempotencyKey: "approve-missing-choice",
        conflictResolutions: {},
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_RESOLUTION_REQUIRED" });
    expect(
      (await getImportPreview(repository, actor, upload.batch.id)).batch.status,
    ).toBe("ready_for_approval");

    const approved = await approveHtmlImport(
      repository,
      actor,
      upload.batch.id,
      {
        idempotencyKey: "approve-with-choice",
        conflictResolutions: {
          [conflict!.id]: conflict!.candidates[0]!.fieldId,
        },
      },
    );
    expect(approved).toMatchObject({ staging_only: true, formally_imported: false, batch: { status: "ready_for_approval" } });
  });

  it("masks sensitive preview values and approves atomically with recent AAL2", async () => {
    const repository = new DemoMemoryImportRepository();
    const upload = await uploadHtmlImport(
      repository,
      actor,
      htmlFile(
        "<!doctype html><html><head><meta charset=utf-8></head><body><h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>測試個案</td></tr></table></body></html>",
      ),
      "upload-sensitive",
    );
    const preview = await getImportPreview(repository, actor, upload.batch.id);
    expect(preview.fields[0]).toMatchObject({
      displayValue: "••••",
      isMasked: true,
    });

    const approved = await approveHtmlImport(
      repository,
      actor,
      upload.batch.id,
      { idempotencyKey: "approve-1", conflictResolutions: {} },
    );
    expect(approved).toMatchObject({ staging_only: true, formally_imported: false, batch: { status: "ready_for_approval" } });
    expect(repository.size).toBe(1);
  });

  it("reparses the immutable original and rejects stale AAL2", async () => {
    const repository = new DemoMemoryImportRepository();
    const upload = await uploadHtmlImport(
      repository,
      actor,
      htmlFile(headingDocument()),
      "upload-reparse",
    );
    const reparsed = await reparseHtmlImport(
      repository,
      actor,
      upload.batch.id,
      { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-1" },
    );
    const replay = await reparseHtmlImport(
      repository,
      actor,
      upload.batch.id,
      { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-1" },
    );
    expect(replay.version).toBe(reparsed.version);

    await expect(
      approveHtmlImport(
        repository,
        {
          ...actor,
          recentAal2At: new Date(Date.now() - 16 * 60_000).toISOString(),
        },
        upload.batch.id,
        { idempotencyKey: "approve-stale", conflictResolutions: {} },
      ),
    ).rejects.toMatchObject({ code: "RECENT_AAL2_REQUIRED" });
  });
});

const liveSamplePaths = (process.env.IMPORT_SAMPLE_PATHS ?? "")
  .split(delimiter)
  .filter(Boolean);
const liveExpectedCounts = (process.env.IMPORT_SAMPLE_EXPECTED_COUNTS ?? "")
  .split(",")
  .filter(Boolean)
  .map(Number);

describe.skipIf(liveSamplePaths.length === 0)("local read-only golden samples", () => {
  it.each(
    liveSamplePaths.map((path, index) => [
      path,
      liveExpectedCounts[index],
      index + 1,
    ]),
  )(
    "statically parses a local sample without external requests",
    (path, expectedCount, sampleNumber) => {
      const blockedRequest = () => { throw new Error("NETWORK_REQUEST_BLOCKED_DURING_STATIC_PARSE"); };
      const networkSpies = [
        vi.spyOn(globalThis, "fetch").mockImplementation(blockedRequest),
        vi.spyOn(http, "request").mockImplementation(blockedRequest),
        vi.spyOn(http, "get").mockImplementation(blockedRequest),
        vi.spyOn(https, "request").mockImplementation(blockedRequest),
        vi.spyOn(https, "get").mockImplementation(blockedRequest),
      ];
      try {
        const bytes = readFileSync(path);
        const result = parseCentralCareHtml(
          validateHtmlImportFile({
            fileName: "local-sample.html",
            mimeType: "text/html",
            bytes,
          }),
          CURRENT_MAPPING_VERSION,
        );
        // Count-only failure output must not serialize actual source sections.
        expect(result.sections.length).toBe(expectedCount);
        expect(result.security.externalRequestCount).toBe(0);
        for (const spy of networkSpies) expect(spy.mock.calls.length).toBe(0);
        if (process.env.IMPORT_SAMPLE_REPORT === "true") {
          console.info(
            JSON.stringify({
              sample: sampleNumber,
              sections: result.sections.length,
              fields: result.fields.length,
              warnings: result.warnings.length,
              conflicts: result.conflicts.length,
              scriptElementsBlocked: result.security.scriptElementsBlocked,
              externalReferencesBlocked:
                result.security.externalReferencesBlocked,
              externalRequestCount: result.security.externalRequestCount,
            }),
          );
        }
      } finally {
        for (const spy of networkSpies) spy.mockRestore();
      }
    },
  );
});
