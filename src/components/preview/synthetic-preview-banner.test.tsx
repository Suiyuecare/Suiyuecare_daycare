// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyntheticPreviewBanner } from "./synthetic-preview-banner";

describe("synthetic preview warning", () => {
  it("keeps the no-real-data boundary visible in two concise lines", () => {
    render(<SyntheticPreviewBanner />);
    const banner = screen.getByRole("complementary", { name: /禁止輸入或上傳真實個資/ });
    expect(banner).toHaveClass("synthetic-preview-banner");
    expect(banner).toHaveTextContent("合成資料・唯讀試用");
    expect(banner.querySelector("p")).toHaveTextContent("不保存或傳送業務資料；勿填或上傳真實個資。");
    expect(banner.querySelector("button, input, a")).toBeNull();
  });
});
