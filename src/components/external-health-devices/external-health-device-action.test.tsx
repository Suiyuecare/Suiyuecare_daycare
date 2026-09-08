// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoExternalHealthDeviceSnapshot } from "@/lib/external-health-devices/demo";

import {
  ExternalHealthDeviceAction,
  ExternalHealthMeasurementMatchAction,
} from "./external-health-device-action";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "65000000-0000-4000-8000-000000000001";
const BRANCH = "65000000-0000-4000-8000-000000000002";
const snapshot = { ...buildDemoExternalHealthDeviceSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { dateFrom: null, dateTo: null, clientId: null, deviceId: null,
    matchStatus: "all", deviceStatus: "all", metricCode: null },
  now: new Date("2026-09-02T05:00:00.000Z"),
}), demo: false as const };
const device = snapshot.devices[0]!;
const measurement = snapshot.measurements[2]!;

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}

describe("external health device actions", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `65000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps an unchanged unknown-result key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExternalHealthDeviceAction canManage device={device} snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("操作理由"), {
      target: { value: "確認設備目前不再使用" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加設備狀態" }));
    await screen.findByText("網路中斷，結果未知；內容未修改時請使用相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加設備狀態" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("操作理由"), {
      target: { value: "重新核對後解除設備配對" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加設備狀態" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("labels bounded timeout as unknown and locks fields while pending", async () => {
    const timeoutFetch = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", timeoutFetch);
    render(<ExternalHealthMeasurementMatchAction canManage
      measurement={measurement} snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("修正理由"), {
      target: { value: "核對紙本設備標籤" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await screen.findByText("連線逾時，操作結果未知；請保留內容並以相同操作重試。");
    cleanup();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ExternalHealthMeasurementMatchAction canManage
      measurement={measurement} snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("修正理由"), {
      target: { value: "核對紙本設備標籤" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    const fieldset = screen.getByLabelText("修正理由")
      .closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("does not refresh for a forged successful HTTP status", async () => {
    const payload = { requestId: "65000000-0000-4000-8000-000000000099",
      status: "ok", data: { receiptKind: "measurement_match",
        action: "correct_measurement_match", organizationId: ORG, branchId: BRANCH,
        operationId: "65000000-0000-4000-8000-000000000030",
        measurementId: measurement.measurementId,
        correctionId: "65000000-0000-4000-8000-000000000031",
        correctionSequence: measurement.correctionSequence + 1,
        matchStatus: "matched", clientId: snapshot.clientOptions[0]!.clientId,
        committedAt: "2026-09-02T05:00:00.000Z", replayed: false,
        persisted: true, demo: false }, errors: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    render(<ExternalHealthMeasurementMatchAction canManage
      measurement={measurement} snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("個案"), {
      target: { value: snapshot.clientOptions[0]!.clientId },
    });
    fireEvent.change(screen.getByLabelText("修正理由"), {
      target: { value: "核對紙本設備標籤" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await screen.findByText("操作結果未確認；請重新檢查，內容未修改時可使用相同操作鍵重試。");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never renders mutation controls in demo or without manage permission", () => {
    const { rerender } = render(<ExternalHealthDeviceAction canManage={false}
      device={device} snapshot={snapshot} />);
    expect(screen.queryByText("管理設備")).toBeNull();
    rerender(<ExternalHealthDeviceAction canManage device={device}
      snapshot={{ ...snapshot, demo: true }} />);
    expect(screen.queryByText("管理設備")).toBeNull();
  });
});
