"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseInventoryItemApiEnvelope,
  parseInventoryItemInput,
  parseInventoryMovementApiEnvelope,
  parseInventoryMovementInput,
} from "@/lib/inventory/parser";
import type {
  InventoryItemOption,
  InventoryManagementSnapshot,
  InventoryMovementType,
} from "@/lib/inventory/types";

import styles from "./inventory.module.css";

function localDateTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function toIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}
function failureMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) {
    return "連線逾時，操作結果未知；請保留內容，未修改時可使用原操作鍵重試。";
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，操作結果未知；請保留內容，未修改時可使用原操作鍵重試。";
  }
  return "操作結果未知；請先重新載入，未修改內容時可使用原操作鍵重試。";
}

function useOperationKey() {
  const key = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    getOrCreate() {
      key.current ??= crypto.randomUUID();
      return key.current;
    },
    markFailed() { failed.current = true; },
    markSucceeded() { key.current = null; failed.current = false; },
    handleChange(clear: () => void) {
      if (failed.current) {
        failed.current = false; key.current = null; clear();
      }
    },
  };
}

export function InventoryItemCreateForm({ canManage, snapshot }: {
  canManage: boolean;
  snapshot: InventoryManagementSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  return <details className={styles.composer}>
    <summary>建立庫存品項</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const operationKey = operation.getOrCreate();
        try {
          const input = parseInventoryItemInput({
            action: "create", item_code: data.get("itemCode"),
            item_name: data.get("itemName"), unit: data.get("unit"),
          }, operationKey);
          if (input.action !== "create") throw new Error("invalid item action");
          const response = await fetchWithTimeout("/api/inventory/items", {
            method: "POST", headers: { "content-type": "application/json",
              "idempotency-key": input.idempotencyKey },
            body: JSON.stringify({ action: "create", item_code: input.itemCode,
              item_name: input.itemName, unit: input.unit }),
          });
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error("save failed");
          parseInventoryItemApiEnvelope(payload, input,
            snapshot.organizationId, snapshot.branchId);
          operation.markSucceeded();
          form.reset(); setMessage("品項已建立；初始狀態為啟用。"); router.refresh();
        } catch (error) {
          operation.markFailed(); setMessage(failureMessage(error));
        } finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>品項代碼</span><input name="itemCode" maxLength={80} required /></label>
        <label><span>品項名稱</span><input name="itemName" maxLength={160} required /></label>
        <label><span>固定單位</span><input name="unit" maxLength={40} required /></label>
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "建立中…" : "建立品項"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function InventoryItemStatusForm({ canManage, item, snapshot }: {
  canManage: boolean;
  item: InventoryItemOption;
  snapshot: InventoryManagementSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  const next = item.status === "active" ? "inactive" : "active";
  return <form className={styles.statusForm}
    onChange={() => operation.handleChange(() => setMessage(null))}
    onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      const data = new FormData(event.currentTarget);
      const operationKey = operation.getOrCreate();
      try {
        const input = parseInventoryItemInput({
          action: "set_status", item_id: item.itemId, status: next,
          reason: data.get("reason"),
          expected_status_ledger_version: item.statusLedgerVersion,
        }, operationKey);
        if (input.action !== "set_status") throw new Error("invalid item action");
        const response = await fetchWithTimeout("/api/inventory/items", {
          method: "POST", headers: { "content-type": "application/json",
            "idempotency-key": input.idempotencyKey },
          body: JSON.stringify({ action: "set_status", item_id: input.itemId,
            status: input.status, reason: input.reason,
            expected_status_ledger_version: input.expectedStatusLedgerVersion }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("save failed");
        parseInventoryItemApiEnvelope(payload, input,
          snapshot.organizationId, snapshot.branchId);
        operation.markSucceeded();
        setMessage(next === "inactive" ? "已追加停用狀態。" : "已追加啟用狀態。");
        router.refresh();
      } catch (error) {
        operation.markFailed(); setMessage(failureMessage(error));
      } finally { setPending(false); }
    }}>
    <fieldset disabled={pending} className={styles.inlineFieldset}>
      <label><span>{next === "inactive" ? "停用理由" : "重新啟用理由"}</span>
        <input name="reason" maxLength={1000} required /></label>
      <button className="button button--secondary" type="submit" disabled={pending}>
        {pending ? "保存中…" : next === "inactive" ? "停用品項" : "重新啟用"}
      </button>
    </fieldset>
    {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
  </form>;
}

export function InventoryMovementForm({
  canAdjust, canManage, hasRecentAal2, snapshot,
}: {
  canAdjust: boolean;
  canManage: boolean;
  hasRecentAal2: boolean;
  snapshot: InventoryManagementSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [movementType, setMovementType] = useState<InventoryMovementType>("receipt");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedBatch, setSelectedBatch] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canManage) return null;
  const highRisk = movementType === "adjustment" || movementType === "stocktake";
  return <details className={styles.composer} open>
    <summary>新增庫存異動</summary>
    <form onChange={() => operation.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const operationKey = operation.getOrCreate();
        try {
          const submittedBatch = String(data.get("batch") ?? "");
          const submittedItem = String(data.get("item") ?? "");
          const selectedReturn = snapshot.returnableIssueOptions.find((item) =>
            item.originalMovementId === String(data.get("originalMovement") ?? ""));
          const itemId = movementType === "return" ? selectedReturn?.itemId : submittedItem;
          const batchId = movementType === "return" ? selectedReturn?.batchId :
            submittedBatch === "new" ? null : submittedBatch;
          const batch = snapshot.batches.find((item) => item.batchId === batchId);
          const input = parseInventoryMovementInput({
            item_id: itemId, batch_id: batchId,
            new_batch_number: submittedBatch === "new" ? data.get("newBatch") : null,
            new_expiry_date: submittedBatch === "new" ? data.get("expiryDate") : null,
            new_unit: submittedBatch === "new"
              ? snapshot.itemOptions.find((item) => item.itemId === submittedItem)?.unit ?? null
              : null,
            movement_type: movementType,
            quantity: ["receipt", "issue", "return", "client_issue"].includes(movementType)
              ? data.get("quantity") : null,
            adjustment_delta: movementType === "adjustment" ? data.get("adjustmentDelta") : null,
            counted_quantity: movementType === "stocktake" ? data.get("countedQuantity") : null,
            original_movement_id: movementType === "return" ? selectedReturn?.originalMovementId : null,
            client_id: movementType === "client_issue" ? data.get("client") : null,
            instruction_reference: movementType === "client_issue" ? data.get("instruction") : null,
            issued_to_user_id: movementType === "client_issue" ? data.get("issuedTo") : null,
            purpose: movementType === "issue" ? data.get("purpose") : null,
            destination_unit: movementType === "issue" ? data.get("destination") : null,
            reason: ["return", "adjustment", "stocktake"].includes(movementType)
              ? data.get("reason") : null,
            occurred_at: toIso(String(data.get("occurredAt"))),
            expected_ledger_version: movementType === "return"
              ? snapshot.batches.find((item) => item.batchId === selectedReturn?.batchId)?.ledgerVersion
              : batch?.ledgerVersion ?? 0,
          }, operationKey);
          const response = await fetchWithTimeout("/api/inventory/movements", {
            method: "POST", headers: { "content-type": "application/json",
              "idempotency-key": input.idempotencyKey },
            body: JSON.stringify({
              item_id: input.itemId, batch_id: input.batchId,
              new_batch_number: input.newBatchNumber, new_expiry_date: input.newExpiryDate,
              new_unit: input.newUnit, movement_type: input.movementType,
              quantity: input.quantity, adjustment_delta: input.adjustmentDelta,
              counted_quantity: input.countedQuantity,
              original_movement_id: input.originalMovementId, client_id: input.clientId,
              instruction_reference: input.instructionReference,
              issued_to_user_id: input.issuedToUserId, purpose: input.purpose,
              destination_unit: input.destinationUnit, reason: input.reason,
              occurred_at: input.occurredAt,
              expected_ledger_version: input.expectedLedgerVersion,
            }),
          });
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error("save failed");
          parseInventoryMovementApiEnvelope(payload, input,
            snapshot.organizationId, snapshot.branchId);
          operation.markSucceeded();
          setMessage("異動已追加保存；批次與歷史紀錄未被覆寫。");
          router.refresh();
        } catch (error) {
          operation.markFailed(); setMessage(failureMessage(error));
        } finally { setPending(false); }
      }}>
      <fieldset className={styles.formGrid} disabled={pending}>
        <label><span>異動類型</span><select name="movementType" value={movementType}
          onChange={(event) => {
            setMovementType(event.target.value as InventoryMovementType);
            setSelectedBatch("");
          }}>
          <option value="receipt">入庫</option><option value="issue">一般出庫</option>
          <option value="return">退回</option><option value="client_issue">個案領用</option>
          <option value="adjustment">庫存調整</option><option value="stocktake">盤點</option>
        </select></label>
        {movementType === "return" ? <label className={styles.wide}><span>原始出庫／個案領用</span>
          <select name="originalMovement" required defaultValue=""><option value="">請選擇</option>
            {snapshot.returnableIssueOptions.map((item) => <option key={item.originalMovementId}
              value={item.originalMovementId}>{item.itemName} · {item.batchNumber} · 可退 {item.outstandingQuantity} {item.unit}</option>)}</select>
        </label> : <>
          <label><span>品項</span><select name="item" required value={selectedItem}
            onChange={(event) => { setSelectedItem(event.target.value); setSelectedBatch(""); }}><option value="">請選擇</option>
            {snapshot.itemOptions.filter((item) => item.status === "active").map((item) =>
              <option key={item.itemId} value={item.itemId}>{item.itemCode} · {item.itemName}（{item.unit}）</option>)}</select></label>
          <label><span>批次</span><select name="batch" required value={selectedBatch}
            onChange={(event) => setSelectedBatch(event.target.value)}><option value="">請選擇</option>
            {movementType === "receipt" ? <option value="new">建立新批次</option> : null}
            {snapshot.batches.filter((batch) => batch.itemId === selectedItem)
              .map((batch) => <option key={batch.batchId} value={batch.batchId}>
              {batch.itemName} · {batch.batchNumber} · 餘 {batch.balance} {batch.unit}</option>)}</select></label>
        </>}
        {movementType === "receipt" ? <><label><span>新批號（選新批次時填）</span><input name="newBatch" maxLength={120} required={selectedBatch === "new"} /></label>
          <label><span>新批次效期</span><input name="expiryDate" type="date"
            min={snapshot.snapshotDate} required={selectedBatch === "new"} /></label></> : null}
        {["receipt", "issue", "return", "client_issue"].includes(movementType) ?
          <label><span>數量（最多四位小數）</span><input name="quantity" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?" required /></label> : null}
        {movementType === "adjustment" ? <label><span>調整差額（可為負）</span><input name="adjustmentDelta" inputMode="decimal" pattern="-?[0-9]+([.][0-9]{1,4})?" required /></label> : null}
        {movementType === "stocktake" ? <label><span>實際盤點數</span><input name="countedQuantity" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?" required /></label> : null}
        {movementType === "issue" ? <><label><span>用途</span><input name="purpose" maxLength={500} required /></label>
          <label><span>領用單位／去向</span><input name="destination" maxLength={160} required /></label></> : null}
        {movementType === "client_issue" ? <><label><span>個案</span><select name="client" required defaultValue=""><option value="">請選擇</option>{snapshot.clientOptions.map((client) =>
          <option key={client.clientId} value={client.clientId}>{client.clientCode} · {client.displayName}</option>)}</select></label>
          <label><span>領用／執行人</span><select name="issuedTo" required defaultValue=""><option value="">請選擇</option>{snapshot.staffOptions.map((staff) =>
            <option key={staff.userId} value={staff.userId}>{staff.displayName}</option>)}</select></label>
          <label className={styles.wide}><span>照顧指示或穩定內部參照</span><textarea name="instruction" maxLength={500} required /></label></> : null}
        {["return", "adjustment", "stocktake"].includes(movementType) ?
          <label className={styles.wide}><span>理由</span><textarea name="reason" maxLength={1000} required /></label> : null}
        <label><span>發生時間（台北）</span><input name="occurredAt" type="datetime-local"
          defaultValue={localDateTime(snapshot.generatedAt)}
          max={localDateTime(snapshot.generatedAt)} required /></label>
        {highRisk && !canAdjust ? <p className={styles.warning} role="alert">目前角色沒有調整或盤點權限。</p> : null}
        {highRisk && canAdjust && !hasRecentAal2 ? <p className={styles.warning} role="alert">調整與盤點前，請先在 15 分鐘內重新完成雙因素驗證。</p> : null}
        <button className="button button--primary" type="submit"
          disabled={pending || (highRisk && (!canAdjust || !hasRecentAal2))}>
          {pending ? "保存中…" : "追加異動"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
