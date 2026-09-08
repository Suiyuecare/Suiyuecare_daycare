import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import vm from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCentralCareHtml } from "./parser";
import { CURRENT_MAPPING_VERSION } from "./types";
import { validateHtmlImportFile } from "./validation";

const sentinel = "__syntheticImportExecution";

/** Capability tripwires are supplementary evidence, not an OS network sandbox. */
function guardCapabilities() {
  const forbidden = () => { throw new Error("IMPORT_CAPABILITY_USED"); };
  const fetch = vi.fn(forbidden);
  vi.stubGlobal("fetch", fetch);
  const execution = [
    vi.spyOn(vm, "runInNewContext").mockImplementation(forbidden),
    vi.spyOn(vm, "runInContext").mockImplementation(forbidden),
    vi.spyOn(vm, "runInThisContext").mockImplementation(forbidden),
    vi.spyOn(globalThis, "eval").mockImplementation(forbidden),
  ];
  const network = [
    fetch,
    vi.spyOn(http, "request").mockImplementation(forbidden),
    vi.spyOn(http, "get").mockImplementation(forbidden),
    vi.spyOn(https, "request").mockImplementation(forbidden),
    vi.spyOn(https, "get").mockImplementation(forbidden),
    vi.spyOn(net, "connect").mockImplementation(forbidden),
    vi.spyOn(net, "createConnection").mockImplementation(forbidden),
    vi.spyOn(tls, "connect").mockImplementation(forbidden),
  ];
  return { execution, network };
}

const cases = [
  {
    name: "script and module script",
    active: `<script>globalThis.${sentinel}=true;fetch('https://synthetic.invalid/collect')</script>
      <script type="module" src="https://synthetic.invalid/module.js"></script>`,
    expected: { scriptElementsBlocked: 2, externalReferencesBlocked: 1 },
  },
  {
    name: "CSS fonts, redirects and external document containers",
    active: `<style>@import 'https://synthetic.invalid/style.css';@font-face{font-family:test;src:url('https://synthetic.invalid/font')}</style>
      <meta http-equiv="refresh" content="0;url=https://synthetic.invalid/redirect">
      <link rel="stylesheet" href="https://synthetic.invalid/style.css">
      <iframe src="https://synthetic.invalid/frame"></iframe>
      <object data="https://synthetic.invalid/object"></object>`,
    expected: { redirectElementsBlocked: 1, activeElementsBlocked: 2, externalReferencesBlocked: 3 },
  },
  {
    name: "form actions, SVG handlers and javascript URLs",
    active: `<form action="https://synthetic.invalid/form" onsubmit="globalThis.${sentinel}=true">
      <button formaction="https://synthetic.invalid/override">提交</button></form>
      <svg onload="globalThis.${sentinel}=true"></svg>
      <a href="javascript:globalThis.${sentinel}=true">測試連結</a>
      <img src="https://synthetic.invalid/image" onerror="globalThis.${sentinel}=true">`,
    expected: { formElementsNeutralized: 1, inlineEventHandlersBlocked: 3, externalReferencesBlocked: 4 },
  },
  {
    name: "DTD and entities do not resolve local or network resources",
    active: `<!DOCTYPE html [<!ENTITY synthetic SYSTEM "https://synthetic.invalid/entity">]>
      <p>&synthetic;</p><embed src="https://synthetic.invalid/embed">`,
    expected: { activeElementsBlocked: 1, externalReferencesBlocked: 1 },
  },
] as const;

describe("central HTML static parser capability boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, sentinel);
  });

  it.each(cases)("never invokes intercepted capabilities for $name", ({ active, expected }) => {
    const probes = guardCapabilities();
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
      ${active}<h5>申請表</h5><table><tr><th>合成欄位</th><td>純合成測試值</td></tr></table>
      <h5>未發布的合成區段</h5><table><tr><th>未知欄位</th><td>不可遺失</td></tr></table></body></html>`;
    const result = parseCentralCareHtml(validateHtmlImportFile({
      fileName: "synthetic-capability-test.html", mimeType: "text/html",
      bytes: new TextEncoder().encode(html),
    }), CURRENT_MAPPING_VERSION);
    expect(result.security).toMatchObject({ ...expected, externalRequestCount: 0 });
    expect(result.sections).toHaveLength(2);
    expect(result.fields.find((field) => field.source.label === "合成欄位")?.normalizedValue)
      .toBe("純合成測試值");
    expect(result.fields.find((field) => field.source.label === "未知欄位"))
      .toMatchObject({ normalizedValue: "不可遺失", mappingState: "unknown", targetPath: null });
    expect(Reflect.get(globalThis, sentinel)).toBeUndefined();
    for (const probe of [...probes.network, ...probes.execution]) expect(probe).not.toHaveBeenCalled();
  });
});
