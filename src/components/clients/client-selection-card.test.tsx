// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientSelectionCard } from "./client-selection-card";

const options = [
  { value: "client-a", label: "合成個案甲 · TEST-01" },
  { value: "client-b", label: "合成個案乙 · TEST-02" },
];

afterEach(cleanup);

describe("ClientSelectionCard", () => {
  it("uses the shared frame for an immediate client choice and preserves its change behavior", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <ClientSelectionCard
        id="intake-client"
        label="個案"
        value="client-a"
        onValueChange={onValueChange}
        options={options}
        supplement={<span>尚未建檔</span>}
      />,
    );

    expect(container.querySelector(".client-selection-card")).toBeInTheDocument();
    expect(container.querySelector(".client-selection-card__heading")).toHaveTextContent("尚未建檔");
    expect(screen.getByLabelText("個案")).toHaveValue("client-a");
    fireEvent.change(screen.getByLabelText("個案"), { target: { value: "client-b" } });
    expect(onValueChange).toHaveBeenCalledWith("client-b");
  });

  it("keeps the GET-submit variant and its existing submit action", () => {
    render(
      <form action="/app/staff/assessments/spmsq" method="get" noValidate>
        <ClientSelectionCard
          id="questionnaire-client"
          label="個案"
          defaultValue=""
          placeholderDisabled
          actionLabel="選取個案"
          options={options}
        />
      </form>,
    );

    expect(screen.getByLabelText("個案")).toHaveAttribute("name", "client");
    expect(screen.getByRole("button", { name: "選取個案" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("option", { name: "請選擇個案" })).toBeDisabled();
  });
});
