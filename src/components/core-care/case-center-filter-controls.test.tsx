// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => ({ pending: true }),
}));

import { CaseCenterSubmitButton } from "./case-center-filter-controls";

afterEach(cleanup);

it("keeps the search button's geometry while pending and offers a native GET recovery", () => {
  render(<form><CaseCenterSubmitButton label="搜尋" recovery /></form>);

  const search = screen.getByRole("button", { name: /搜尋/ });
  const retry = screen.getByRole("button", { name: "重新載入個案結果" });
  expect((search as HTMLButtonElement).disabled).toBe(true);
  expect(search.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("正在更新個案清單");
  expect(retry.getAttribute("formmethod")).toBe("get");
  expect(retry.getAttribute("formaction")).toBe("/app/staff/workspace/case-center#case-center-list");
});
