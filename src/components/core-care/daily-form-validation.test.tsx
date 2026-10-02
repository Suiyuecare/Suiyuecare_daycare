// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AttendanceComposer } from "./attendance-composer";
import { CareDiaryComposer } from "./care-diary-composer";
import { VitalSignComposer } from "./vital-sign-composer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const clients = [{ id: "a1111111-1111-4111-8111-111111111111", name: "合成個案", code: "SYN-01", attendance: null }];
const props = { clients, serviceDate: "2026-09-28", enabled: true, demo: false, selectedClientId: clients[0]!.id };
const specs = [
  { kind: "attendance", trigger: "登錄出勤", field: /補登理由/u, value: "合成補登理由" },
  { kind: "vitals", trigger: "新增量測", field: "脈搏 bpm", value: "75" },
  { kind: "diary", trigger: "新增日誌草稿", field: "照顧項目 *", value: "合成照顧觀察" },
] as const;
function mount(spec: typeof specs[number], selected = true) {
  const passed = { ...props, selectedClientId: selected ? props.selectedClientId : undefined };
  render(spec.kind === "attendance" ? <AttendanceComposer {...passed} /> : spec.kind === "vitals" ? <VitalSignComposer {...passed} /> : <CareDiaryComposer {...passed} />);
  fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
  const dialog = screen.getByRole("dialog");
  if (spec.kind === "diary") {
    fireEvent.change(within(dialog).getByLabelText("班別 *"), { target: { value: "full_day" } });
    fireEvent.change(within(dialog).getByLabelText("發生日期與時間 *"), { target: { value: "2026-09-28T09:00" } });
  }
  return { dialog, form: dialog.querySelector("form")! };
}
function expectFieldError(field: HTMLElement) {
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute("aria-invalid", "true");
  const id = field.getAttribute("aria-describedby")!.split(" ").find((item) => item.endsWith("-error"))!;
  expect(document.getElementById(id)).toHaveTextContent(/請/u);
}
function control(form: HTMLFormElement, name: string) {
  const element = form.elements.namedItem(name);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing control: ${name}`);
  return element;
}

describe.each(specs)("$kind app-owned validation", (spec) => {
  it("focuses the missing selected person and preserves the other entered fields without a write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { dialog, form } = mount(spec, false);
    fireEvent.change(within(dialog).getByLabelText(spec.field), { target: { value: spec.value } });
    fireEvent.submit(form);
    expect(form).toHaveAttribute("novalidate");
    expectFieldError(within(dialog).getByLabelText("個案 *"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("內容已保留");
    expect(fetch).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(spec.field)).toHaveValue(spec.kind === "vitals" ? 75 : spec.value);
    fireEvent.change(within(dialog).getByLabelText("個案 *"), { target: { value: props.selectedClientId } });
    expect(within(dialog).getByLabelText("個案 *")).not.toHaveAttribute("aria-invalid");
  });
  it("prevents IME Enter and direct submission during composition, then permits the original operation", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetch);
    const { dialog, form } = mount(spec);
    const field = within(dialog).getByLabelText(spec.field);
    fireEvent.change(field, { target: { value: spec.value } });
    fireEvent.compositionStart(field);
    expect(fireEvent.keyDown(field, { key: "Enter", isComposing: true })).toBe(false);
    fireEvent.submit(form);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    expect(fireEvent.keyDown(field, { key: "Enter", keyCode: 229 })).toBe(false);
    fireEvent.submit(form);
    expect(form).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await within(dialog).findByRole("alert");
    expect(form).toHaveAttribute("aria-busy", "false");
  });
});

describe("daily form correction hints", () => {
  it.each([
    { values: {}, first: "收縮壓 mmHg", hint: "至少填寫一項" },
    { values: { systolic: "120" }, first: "舒張壓 mmHg", hint: "一起填寫" },
    { values: { pulse: "351" }, first: "脈搏 bpm", hint: "10 至 350" },
    { values: { temperature: "36.55" }, first: "體溫 °C", hint: "小數點後一位" },
  ])("guides invalid vital values to $first", ({ values, first, hint }) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { dialog, form } = mount(specs[1]);
    for (const [name, value] of Object.entries(values)) fireEvent.change(control(form, name), { target: { value } });
    fireEvent.submit(form);
    expectFieldError(within(dialog).getByLabelText(first));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(hint);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects whitespace-only care items before freezing a write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { dialog, form } = mount(specs[2]);
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "   " } });
    fireEvent.submit(form);
    expectFieldError(within(dialog).getByLabelText("照顧項目 *"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("associates missing observed water with its control, never with a measured zero", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { dialog, form } = mount(specs[2]);
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "合成觀察" } });
    fireEvent.change(within(dialog).getByLabelText("本次飲水量（毫升）"), { target: { value: "observed" } });
    fireEvent.submit(form);
    expectFieldError(control(form, "water"));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(control(form, "water_state"), { target: { value: "unknown" } });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});
