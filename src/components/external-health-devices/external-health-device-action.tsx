"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseExternalHealthActionInput,
  parseExternalHealthApiError,
  parseExternalHealthApiSuccess,
} from "@/lib/external-health-devices/parser";
import type {
  ExternalHealthDevice,
  ExternalHealthDeviceStateInput,
  ExternalHealthMeasurement,
} from "@/lib/external-health-devices/types";
import type { ExternalHealthDeviceSnapshot } from "@/lib/external-health-devices/types";

import styles from "./external-health-devices.module.css";

function failureMessage(value: unknown) {
  if (isClientFetchTimeoutError(value)) return value.message;
  if (value instanceof Error && value.message.includes("fetch")) {
    return "網路中斷，結果未知；內容未修改時請使用相同操作鍵重試。";
  }
  return "操作結果未確認；請重新檢查，內容未修改時可使用相同操作鍵重試。";
}

async function sendAction({
  body,
  key,
  snapshot,
}: {
  body: Record<string, unknown>;
  key: string;
  snapshot: ExternalHealthDeviceSnapshot;
}) {
  const input = parseExternalHealthActionInput(body, key);
  const response = await fetchWithTimeout("/api/external-health-devices/actions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = parseExternalHealthApiError(payload);
    if (parsed) throw new Error(`API:${parsed.errors[0]!.message}`);
    throw new Error("INVALID_RESPONSE");
  }
  parseExternalHealthApiSuccess(payload, input, snapshot.organizationId,
    snapshot.branchId, response.status);
}

export function ExternalHealthDeviceAction({ canManage, device, snapshot }: {
  canManage: boolean;
  device: ExternalHealthDevice;
  snapshot: ExternalHealthDeviceSnapshot;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<ExternalHealthDeviceStateInput["action"]>(
    device.assignedClientId ? "unassign_device" : "assign_device",
  );
  if (!canManage || snapshot.demo) return null;

  return <details className={styles.actionDetails}>
    <summary>管理設備</summary>
    <form onChange={() => {
      if (uncertain.current) {
        operationKey.current = null; uncertain.current = false; setMessage(null);
      }
    }} onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      const key = operationKey.current ?? crypto.randomUUID();
      operationKey.current = key; setPending(true); setMessage(null);
      const clientId = action === "assign_device" ? data.get("clientId") : null;
      const body = { action, deviceId: device.deviceId,
        expectedStateSequence: device.stateSequence, clientId,
        reason: data.get("reason") };
      try {
        await sendAction({ body, key, snapshot });
        operationKey.current = null; uncertain.current = false;
        setMessage("設備狀態已追加保存；來源設備與先前狀態均未被覆寫。");
        router.refresh();
      } catch (error) {
        uncertain.current = operationKey.current !== null;
        setMessage(error instanceof Error && error.message.startsWith("API:")
          ? error.message.slice(4) : failureMessage(error));
      } finally { setPending(false); }
    }}>
      <fieldset className={styles.actionGrid} disabled={pending}>
        <label><span>操作</span><select value={action} onChange={(event) =>
          setAction(event.target.value as ExternalHealthDeviceStateInput["action"])}>
          <option value="assign_device">配對個案</option>
          <option value="unassign_device">解除配對</option>
          <option value="disable_device">停用設備</option>
          <option value="enable_device">啟用設備</option>
        </select></label>
        <label><span>個案</span><select disabled={action !== "assign_device"}
          name="clientId" required={action === "assign_device"}
          defaultValue={device.assignedClientId ?? ""}>
          <option value="">請選擇目前可存取個案</option>
          {snapshot.clientOptions.map((client) => <option key={client.clientId}
            value={client.clientId}>{client.clientCode} · {client.displayName}</option>)}
        </select></label>
        <label className={styles.wide}><span>操作理由</span>
          <textarea maxLength={1000} name="reason" required rows={3} /></label>
        <button className="button button--primary" disabled={pending} type="submit">
          {pending ? "確認中…" : "追加設備狀態"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function ExternalHealthMeasurementMatchAction({ canManage, measurement, snapshot }: {
  canManage: boolean;
  measurement: ExternalHealthMeasurement;
  snapshot: ExternalHealthDeviceSnapshot;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState(measurement.matchStatus);
  if (!canManage || snapshot.demo) return null;
  return <details className={styles.actionDetails}>
    <summary>修正資料配對</summary>
    <form onChange={() => {
      if (uncertain.current) {
        operationKey.current = null; uncertain.current = false; setMessage(null);
      }
    }} onSubmit={async (event) => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      const key = operationKey.current ?? crypto.randomUUID();
      operationKey.current = key; setPending(true); setMessage(null);
      const body = { action: "correct_measurement_match",
        measurementId: measurement.measurementId,
        expectedCorrectionSequence: measurement.correctionSequence,
        matchStatus: status,
        clientId: status === "matched" ? data.get("clientId") : null,
        reason: data.get("reason") };
      try {
        await sendAction({ body, key, snapshot });
        operationKey.current = null; uncertain.current = false;
        setMessage("量測配對修正已追加保存；來源資料未被覆寫。");
        router.refresh();
      } catch (error) {
        uncertain.current = operationKey.current !== null;
        setMessage(error instanceof Error && error.message.startsWith("API:")
          ? error.message.slice(4) : failureMessage(error));
      } finally { setPending(false); }
    }}>
      <fieldset className={styles.actionGrid} disabled={pending}>
        <label><span>修正後狀態</span><select value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="matched">已配對個案</option>
          <option value="unmatched">未配對</option>
          <option value="excluded">排除</option>
        </select></label>
        <label><span>個案</span><select disabled={status !== "matched"}
          name="clientId" required={status === "matched"}
          defaultValue={measurement.clientId ?? ""}>
          <option value="">請選擇目前可存取個案</option>
          {snapshot.clientOptions.map((client) => <option key={client.clientId}
            value={client.clientId}>{client.clientCode} · {client.displayName}</option>)}
        </select></label>
        <label className={styles.wide}><span>修正理由</span>
          <textarea maxLength={1000} name="reason" required rows={3} /></label>
        <button className="button button--primary" disabled={pending} type="submit">
          {pending ? "確認中…" : "追加配對修正"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
