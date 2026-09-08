import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), server: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isSyntheticPreviewMode: mocks.preview }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.server }));
import { config, proxy } from "@/proxy";

beforeEach(() => { vi.clearAllMocks(); mocks.preview.mockReturnValue(true); });

describe("proxy closes preview before consuming user data", () => {
  it("covers every route including static assets", () => {
    expect(config.matcher).toEqual(["/:path*"]);
  });
  it("rejects multipart HTML and forged demo identity before reading a body", async () => {
    const request = new NextRequest("https://preview.invalid/api/imports/html", {
      method: "POST", body: "synthetic-untrusted-body",
      headers: { "content-type": "multipart/form-data; boundary=test", "x-demo-user-id": "forged" },
    });
    const response = await proxy(request);
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect((await response.json()).errors[0].code).toBe("SYNTHETIC_PREVIEW_READ_ONLY");
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD", "OPTIONS", "DELETE"])("rejects %s API access", async (method) => {
    const response = await proxy(new NextRequest("https://preview.invalid/api/context/branch", { method }));
    expect(response.status).toBe(403);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it("blocks server-action POST and permits page GET without auth traffic", async () => {
    const action = new NextRequest("https://preview.invalid/app/dashboard", { method: "POST", body: "input", headers: { "next-action": "forged" } });
    expect((await proxy(action)).status).toBe(403);
    expect(action.bodyUsed).toBe(false);
    expect((await proxy(new NextRequest("https://preview.invalid/app/dashboard"))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.server).not.toHaveBeenCalled();
  });
});
