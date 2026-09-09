"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseCreateDocumentPrintJob,
  parseDocumentPrintJobApiEnvelope,
} from "@/lib/document-printing/parser";
import type { DocumentPrintingSnapshot } from "@/lib/document-printing/types";

import styles from "./document-printing.module.css";

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function errorMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) {
    return "連線逾時，結果未知；內容未修改時可保留相同操作鍵重試。";
  }
  return "文件工作尚未確認完成；請重新載入核對，內容未修改時可重試。";
}

export function DocumentPrintJobForm({
  canManage,
  hasRecentAal2,
  snapshot,
}: {
  canManage: boolean;
  hasRecentAal2: boolean;
  snapshot: DocumentPrintingSnapshot;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const failed = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!canManage || snapshot.demo) return null;
  if (!hasRecentAal2) return <section className={styles.reauth}>
    <h2>產生文件前需重新驗證</h2>
    <p>建立不可變文件、預覽及下載都需要最近 15 分鐘內的雙重驗證。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">
      前往雙重驗證
    </Link>
  </section>;
  if (snapshot.templates.length === 0) return <section className={styles.reauth}>
    <h2>尚無可使用的核准範本</h2>
    <p>須先完成範本版本、資料欄位、水印、私有中文字型與雜湊核准，才可產生正式文件。</p>
  </section>;
  if (snapshot.clients.length === 0) return <section className={styles.reauth}>
    <h2>目前沒有可選個案</h2>
    <p>只會列出目前工作範圍可查閱的個案，不會以姓名模糊擴張資料範圍。</p>
  </section>;

  return <details className={styles.composer}>
    <summary>建立不可變文件工作</summary>
    <form onChange={() => {
      if (failed.current) {
        operationKey.current = null;
        failed.current = false;
        setMessage(null);
      }
    }} onSubmit={async (event) => {
      event.preventDefault();
      setPending(true);
      setMessage(null);
      operationKey.current ??= crypto.randomUUID();
      try {
        const form = new FormData(event.currentTarget);
        const input = parseCreateDocumentPrintJob({
          action: "create_job",
          templateVersionId: String(form.get("templateVersionId") ?? ""),
          clientId: String(form.get("clientId") ?? ""),
          documentDate: String(form.get("documentDate") ?? ""),
        }, operationKey.current);
        const response = await fetchWithTimeout("/api/document-print-jobs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
            "x-document-print-operation": "create_job",
          },
          body: JSON.stringify({
            action: input.action,
            templateVersionId: input.templateVersionId,
            clientId: input.clientId,
            documentDate: input.documentDate,
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("DOCUMENT_PRINT_JOB_FAILED");
        const receipt = parseDocumentPrintJobApiEnvelope(
          payload,
          input,
          response.status,
        );
        operationKey.current = null;
        failed.current = false;
        setMessage(receipt.replayed
          ? "已核對原文件工作，未重複建立。"
          : "文件工作已建立；重新載入後可核對同一份不可變內容。");
        router.refresh();
      } catch (error) {
        failed.current = true;
        setMessage(errorMessage(error));
      } finally {
        setPending(false);
      }
    }}>
      <div className={styles.formGrid}>
        <label><span>核准範本版本</span><select name="templateVersionId" required
          defaultValue={snapshot.templates[0]?.versionId ?? ""}>
          {snapshot.templates.map((template) => <option
            key={template.versionId} value={template.versionId}>
            {template.title} · v{template.version}
          </option>)}
        </select></label>
        <label><span>個案</span><select name="clientId" required
          defaultValue={snapshot.clients[0]?.clientId ?? ""}>
          {snapshot.clients.map((client) => <option key={client.clientId}
            value={client.clientId}>
            {client.displayName}{client.clientCode ? ` · ${client.clientCode}` : ""}
          </option>)}
        </select></label>
        <label><span>文件日期</span><input name="documentDate" type="date"
          defaultValue={taipeiDate(snapshot.generatedAt)} required /></label>
      </div>
      <p className={styles.formNote}>送出後會凍結範本版本、個案資料、文件日期、水印與內容雜湊；已建立工作不可覆寫或刪除。</p>
      <button className="button button--primary" disabled={pending} type="submit">
        {pending ? "建立中…" : "建立文件工作"}
      </button>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
