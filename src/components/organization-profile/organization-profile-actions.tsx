"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseOrganizationProfileDecisionApiEnvelope,
  parseOrganizationProfileDecisionInput,
  parseOrganizationProfileProposalApiEnvelope,
  parseOrganizationProfileProposalInput,
} from "@/lib/organization-profile/parser";
import type {
  OrganizationProfileSnapshot,
  OrganizationProfileVersion,
} from "@/lib/organization-profile/types";

import styles from "./organization-profile.module.css";

function messageFor(error: unknown) {
  if (isClientFetchTimeoutError(error) ||
    (error instanceof Error && error.message.includes("fetch"))) {
    return "連線中斷或逾時，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return "操作尚未確認完成；請核對資料，內容未修改時可使用原操作鍵重試。";
}

function useOperationKeys() {
  const operationKey = useRef<string | null>(null);
  const entityKeys = useRef(new Map<string, string>());
  const failed = useRef(false);
  return {
    operation() { operationKey.current ??= crypto.randomUUID(); return operationKey.current; },
    entity(name: string, existing?: string) {
      if (existing) return existing;
      const value = entityKeys.current.get(name) ?? crypto.randomUUID();
      entityKeys.current.set(name, value); return value;
    },
    markFailed() { failed.current = true; },
    markSucceeded() { operationKey.current = null; entityKeys.current.clear(); failed.current = false; },
    handleChange(clear: () => void) {
      if (failed.current) {
        operationKey.current = null; entityKeys.current.clear(); failed.current = false;
        clear();
      }
    },
  };
}

function optional(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fieldValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

async function sendProposal(
  input: ReturnType<typeof parseOrganizationProfileProposalInput>,
  snapshot: OrganizationProfileSnapshot,
) {
  const response = await fetchWithTimeout("/api/organization-profile", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({ action: "propose",
      proposal_action: input.proposalAction, proposal_key: input.proposalKey,
      profile_key: input.profileKey, base_version_id: input.baseVersionId,
      expected_base_version: input.expectedBaseVersion,
      effective_from: input.content.effectiveFrom,
      effective_to: input.content.effectiveTo,
      permit_number: input.content.permitNumber,
      permit_issuing_authority: input.content.permitIssuingAuthority,
      permit_issued_on: input.content.permitIssuedOn,
      permit_valid_through: input.content.permitValidThrough,
      permit_status_text: input.content.permitStatusText,
      organization_type_text: input.content.organizationTypeText,
      service_items: input.content.serviceItems.map((item) => ({
        service_key: item.serviceKey, name: item.name,
        description: item.description, taxonomy_status: item.taxonomyStatus,
      })),
      rate_items: input.content.rateItems.map((item) => ({
        rate_key: item.rateKey, label: item.label,
        amount_decimal_text: item.amountDecimalText,
        currency_code: item.currencyCode,
        effective_from: item.effectiveFrom, effective_to: item.effectiveTo,
        taxonomy_status: item.taxonomyStatus,
      })),
      approved_capacity: input.content.approvedCapacity,
      capacity_unit_text: input.content.capacityUnitText,
      capacity_basis_text: input.content.capacityBasisText,
      contact_name: input.content.contactName,
      contact_phone: input.content.contactPhone,
      contact_email: input.content.contactEmail,
      contact_address: input.content.contactAddress,
      change_reason: input.content.changeReason,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("organization profile proposal failed");
  return parseOrganizationProfileProposalApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

async function sendDecision(
  input: ReturnType<typeof parseOrganizationProfileDecisionInput>,
  snapshot: OrganizationProfileSnapshot,
) {
  const response = await fetchWithTimeout("/api/organization-profile", {
    method: "PATCH", headers: { "content-type": "application/json",
      "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({ action: "decide", proposal_id: input.proposalId,
      expected_proposal_number: input.expectedProposalNumber,
      expected_base_version: input.expectedBaseVersion,
      expected_profile_key: input.expectedProfileKey,
      expected_content_hash: input.expectedContentHash,
      expected_effective_from: input.expectedEffectiveFrom,
      expected_effective_to: input.expectedEffectiveTo,
      decision: input.decision, decision_reason: input.decisionReason,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("organization profile decision failed");
  return parseOrganizationProfileDecisionApiEnvelope(
    payload, input, snapshot.organizationId, snapshot.branchId, response.status,
  );
}

function ProfileFields({
  base, serviceCount, setServiceCount, rateCount, setRateCount,
}: {
  base?: OrganizationProfileVersion;
  serviceCount: number;
  setServiceCount: (value: number) => void;
  rateCount: number;
  setRateCount: (value: number) => void;
}) {
  return <>
    <fieldset className={styles.sectionFields}>
      <legend>生效與許可資料</legend>
      <label><span>生效起日</span><input name="effectiveFrom" type="date"
        defaultValue={base?.effectiveFrom ?? ""} required /></label>
      <label><span>生效迄日（選填）</span><input name="effectiveTo" type="date"
        defaultValue={base?.effectiveTo ?? ""} /></label>
      <label><span>許可字號</span><input name="permitNumber" maxLength={160}
        defaultValue={base?.permitNumber ?? ""} required /></label>
      <label><span>發證單位</span><input name="permitAuthority" maxLength={200}
        defaultValue={base?.permitIssuingAuthority ?? ""} required /></label>
      <label><span>許可發出日</span><input name="permitIssuedOn" type="date"
        defaultValue={base?.permitIssuedOn ?? ""} required /></label>
      <label><span>許可有效迄日（選填）</span><input name="permitValidThrough"
        type="date" defaultValue={base?.permitValidThrough ?? ""} /></label>
      <label><span>許可狀態（人工文字）</span><input name="permitStatus"
        maxLength={160} defaultValue={base?.permitStatusText ?? ""} required /></label>
      <label><span>機構類型（人工文字）</span><input name="organizationType"
        maxLength={160} defaultValue={base?.organizationTypeText ?? ""} required /></label>
    </fieldset>

    <fieldset className={styles.sectionFields}>
      <legend>服務項目（人工未標準化）</legend>
      {Array.from({ length: serviceCount }, (_, index) => {
        const item = base?.serviceItems[index];
        return <div className={styles.repeatRow} key={`service-${index}`}>
          <label><span>服務 {index + 1} 名稱</span><input name="serviceName"
            aria-label={`服務 ${index + 1} 名稱`} maxLength={160}
            defaultValue={item?.name ?? ""} /></label>
          <label><span>說明（選填）</span><input name="serviceDescription"
            aria-label={`服務 ${index + 1} 說明`} maxLength={1_000}
            defaultValue={item?.description ?? ""} /></label>
        </div>;
      })}
      <div className={styles.inlineActions}>
        <button type="button" className="button button--ghost"
          onClick={() => setServiceCount(Math.min(50, serviceCount + 1))}>新增服務列</button>
        {serviceCount > 1 ? <button type="button" className="button button--ghost"
          onClick={() => setServiceCount(serviceCount - 1)}>移除末列</button> : null}
      </div>
    </fieldset>

    <fieldset className={styles.sectionFields}>
      <legend>費率（精確文字與生效期）</legend>
      {Array.from({ length: rateCount }, (_, index) => {
        const item = base?.rateItems[index];
        return <div className={styles.rateRow} key={`rate-${index}`}>
          <label><span>費目 {index + 1}</span><input name="rateLabel"
            aria-label={`費目 ${index + 1}`} maxLength={160}
            defaultValue={item?.label ?? ""} /></label>
          <label><span>精確金額文字</span><input name="rateAmount" inputMode="decimal"
            aria-label={`費目 ${index + 1} 精確金額文字`} maxLength={25}
            placeholder="例如 001200.00" defaultValue={item?.amountDecimalText ?? ""} /></label>
          <label><span>幣別（三碼）</span><input name="rateCurrency"
            aria-label={`費目 ${index + 1} 幣別`} maxLength={3}
            placeholder="請人工填寫" defaultValue={item?.currencyCode ?? ""} /></label>
          <label><span>費率起日</span><input name="rateFrom" type="date"
            aria-label={`費目 ${index + 1} 生效起日`}
            defaultValue={item?.effectiveFrom ?? ""} /></label>
          <label><span>費率迄日（選填）</span><input name="rateTo" type="date"
            aria-label={`費目 ${index + 1} 生效迄日`}
            defaultValue={item?.effectiveTo ?? ""} /></label>
        </div>;
      })}
      <div className={styles.inlineActions}>
        <button type="button" className="button button--ghost"
          onClick={() => setRateCount(Math.min(100, rateCount + 1))}>新增費率列</button>
        {rateCount > 1 ? <button type="button" className="button button--ghost"
          onClick={() => setRateCount(rateCount - 1)}>移除末列</button> : null}
      </div>
    </fieldset>

    <fieldset className={styles.sectionFields}>
      <legend>核定容量與聯絡資訊</legend>
      <label><span>核定容量</span><input name="capacity" type="number" min={1}
        max={1_000_000} defaultValue={base?.approvedCapacity ?? ""} required /></label>
      <label><span>容量單位（人工文字）</span><input name="capacityUnit"
        maxLength={40} defaultValue={base?.capacityUnitText ?? ""} required /></label>
      <label className={styles.wide}><span>容量核定依據</span><textarea
        name="capacityBasis" rows={2} maxLength={500}
        defaultValue={base?.capacityBasisText ?? ""} required /></label>
      <label><span>聯絡窗口</span><input name="contactName" maxLength={160}
        defaultValue={base?.contactName ?? ""} required /></label>
      <label><span>聯絡電話</span><input name="contactPhone" maxLength={80}
        defaultValue={base?.contactPhone ?? ""} required /></label>
      <label><span>聯絡信箱（選填）</span><input name="contactEmail" type="email"
        maxLength={254} defaultValue={base?.contactEmail ?? ""} /></label>
      <label className={styles.wide}><span>聯絡地址</span><textarea
        name="contactAddress" rows={2} maxLength={500}
        defaultValue={base?.contactAddress ?? ""} required /></label>
      <label className={styles.wide}><span>異動理由</span><textarea
        name="changeReason" rows={3} maxLength={1_000} required /></label>
    </fieldset>
    <p className={styles.inlineNote}>本頁不接受附件路徑、匯出或主管機關同步要求；正式代碼表未發布前，許可、類型、服務與費率均只保存為「人工未標準化」。</p>
  </>;
}

export function OrganizationProfileProposalForm({
  canManage, hasRecentAal2, snapshot,
}: {
  canManage: boolean;
  hasRecentAal2: boolean;
  snapshot: OrganizationProfileSnapshot;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "correct">("create");
  const [baseId, setBaseId] = useState(snapshot.versions[0]?.versionId ?? "");
  const selectedBase = mode === "correct"
    ? snapshot.versions.find((item) => item.versionId === baseId) : undefined;
  const [serviceCount, setServiceCount] = useState(1);
  const [rateCount, setRateCount] = useState(1);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (!canManage) return null;
  if (!hasRecentAal2) return <section className={styles.reauth}>
    <h2>建立異動前需重新驗證</h2>
    <p>提案會凍結完整許可、費率、容量與聯絡版本，請先完成最近 15 分鐘內的雙重驗證。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff">前往雙重驗證</Link>
  </section>;
  return <details className={styles.composer}>
    <summary>建立機構資料異動提案</summary>
    <div className={styles.modeControls}>
      <label><span>提案方式</span><select value={mode} onChange={(event) => {
        const next = event.target.value as "create" | "correct";
        setMode(next); setMessage(null); keys.handleChange(() => undefined);
        const base = snapshot.versions[0];
        setServiceCount(next === "correct" ? Math.max(1, base?.serviceItems.length ?? 1) : 1);
        setRateCount(next === "correct" ? Math.max(1, base?.rateItems.length ?? 1) : 1);
      }}><option value="create">建立新的生效期間</option>
        <option value="correct" disabled={snapshot.versions.length === 0}>更正既有終端版本</option>
      </select></label>
      {mode === "correct" ? <label><span>更正基準版本</span><select
        value={baseId} onChange={(event) => {
          setBaseId(event.target.value); setMessage(null);
          keys.handleChange(() => undefined);
          const base = snapshot.versions.find((item) => item.versionId === event.target.value);
          setServiceCount(Math.max(1, base?.serviceItems.length ?? 1));
          setRateCount(Math.max(1, base?.rateItems.length ?? 1));
        }}>{snapshot.versions.map((version) => <option key={version.versionId}
          value={version.versionId}>許可 {version.permitNumber} · v{version.version}</option>)}</select></label> : null}
    </div>
    <form key={`${mode}:${selectedBase?.versionId ?? "new"}`}
      onChange={() => keys.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget; const data = new FormData(form);
        try {
          const serviceNames = data.getAll("serviceName");
          const serviceDescriptions = data.getAll("serviceDescription");
          const services = serviceNames.map((value, index) => ({
            name: fieldValue(value).trim(), description: optional(serviceDescriptions[index] ?? null),
            index,
          })).filter((item) => item.name).map((item) => ({
            service_key: keys.entity(`service-${item.index}`,
              selectedBase?.serviceItems[item.index]?.serviceKey),
            name: item.name, description: item.description,
            taxonomy_status: "manual_unstandardized" as const,
          }));
          const labels = data.getAll("rateLabel"); const amounts = data.getAll("rateAmount");
          const currencies = data.getAll("rateCurrency"); const from = data.getAll("rateFrom");
          const to = data.getAll("rateTo");
          const rates = labels.map((value, index) => ({
            label: fieldValue(value).trim(), amount: fieldValue(amounts[index] ?? null).trim(),
            currency: fieldValue(currencies[index] ?? null).trim().toUpperCase(),
            from: fieldValue(from[index] ?? null), to: optional(to[index] ?? null), index,
          })).filter((item) => item.label || item.amount || item.currency || item.from || item.to)
            .map((item) => ({ rate_key: keys.entity(`rate-${item.index}`,
              selectedBase?.rateItems[item.index]?.rateKey), label: item.label,
              amount_decimal_text: item.amount, currency_code: item.currency,
              effective_from: item.from, effective_to: item.to,
              taxonomy_status: "manual_unstandardized" as const }));
          const input = parseOrganizationProfileProposalInput({
            action: "propose", proposal_action: mode,
            proposal_key: keys.entity("proposal"),
            profile_key: selectedBase?.profileKey ?? keys.entity("profile"),
            base_version_id: selectedBase?.versionId ?? null,
            expected_base_version: selectedBase?.version ?? 0,
            effective_from: data.get("effectiveFrom"),
            effective_to: optional(data.get("effectiveTo")),
            permit_number: data.get("permitNumber"),
            permit_issuing_authority: data.get("permitAuthority"),
            permit_issued_on: data.get("permitIssuedOn"),
            permit_valid_through: optional(data.get("permitValidThrough")),
            permit_status_text: data.get("permitStatus"),
            organization_type_text: data.get("organizationType"),
            service_items: services, rate_items: rates,
            approved_capacity: Number(data.get("capacity")),
            capacity_unit_text: data.get("capacityUnit"),
            capacity_basis_text: data.get("capacityBasis"),
            contact_name: data.get("contactName"), contact_phone: data.get("contactPhone"),
            contact_email: optional(data.get("contactEmail")),
            contact_address: data.get("contactAddress"),
            change_reason: data.get("changeReason"),
          }, keys.operation());
          await sendProposal(input, snapshot); keys.markSucceeded();
          setMessage("異動提案已凍結送審；內容尚未生效，必須由另一位授權人員核准。");
          if (mode === "create") form.reset(); router.refresh();
        } catch (error) { keys.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset disabled={pending} className={styles.formShell}>
        <ProfileFields base={selectedBase} serviceCount={serviceCount}
          setServiceCount={(value) => {
            keys.handleChange(() => setMessage(null)); setServiceCount(value);
          }} rateCount={rateCount}
          setRateCount={(value) => {
            keys.handleChange(() => setMessage(null)); setRateCount(value);
          }} />
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? "送審中…" : "凍結完整提案並送審"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}

export function OrganizationProfileDecisionForm({
  canApprove, currentUserId, hasRecentAal2, snapshot,
}: {
  canApprove: boolean;
  currentUserId: string;
  hasRecentAal2: boolean;
  snapshot: OrganizationProfileSnapshot;
}) {
  const router = useRouter();
  const reviewable = snapshot.proposals.filter((proposal) =>
    proposal.status === "pending" && proposal.proposedBy !== currentUserId);
  const [selectedId, setSelectedId] = useState(reviewable[0]?.proposalId ?? "");
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useOperationKeys();
  if (!canApprove || reviewable.length === 0) return null;
  if (!hasRecentAal2) return <section className={styles.reauth}>
    <h2>審核前需重新驗證</h2><p>核准或駁回必須由不同人員，並使用最近 15 分鐘內的雙重驗證。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff">前往雙重驗證</Link>
  </section>;
  const proposal = reviewable.find((item) => item.proposalId === selectedId) ?? reviewable[0]!;
  return <details className={styles.composer}>
    <summary>獨立核准或駁回待審提案</summary>
    <form onChange={() => keys.handleChange(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        try {
          const input = parseOrganizationProfileDecisionInput({
            action: "decide", proposal_id: proposal.proposalId,
            expected_proposal_number: proposal.proposalNumber,
            expected_base_version: proposal.expectedBaseVersion,
            expected_profile_key: proposal.profileKey,
            expected_content_hash: proposal.contentHash,
            expected_effective_from: proposal.effectiveFrom,
            expected_effective_to: proposal.effectiveTo,
            decision, decision_reason: data.get("decisionReason"),
          }, keys.operation());
          await sendDecision(input, snapshot); keys.markSucceeded();
          setMessage(decision === "approve"
            ? "已由獨立人員核准並追加新的不可變生效版本。"
            : "提案已駁回；駁回紀錄與原提案均完整保留。");
          router.refresh();
        } catch (error) { keys.markFailed(); setMessage(messageFor(error)); }
        finally { setPending(false); }
      }}>
      <fieldset disabled={pending} className={styles.decisionGrid}>
        <label><span>待審提案</span><select value={proposal.proposalId}
          onChange={(event) => { setSelectedId(event.target.value); setMessage(null); }}>
          {reviewable.map((item) => <option key={item.proposalId} value={item.proposalId}>
            #{item.proposalNumber} · {item.permitNumber} · {item.proposedByDisplayName}
          </option>)}</select></label>
        <label><span>決定</span><select value={decision}
          onChange={(event) => setDecision(event.target.value as "approve" | "reject")}>
          <option value="approve">核准並產生生效版本</option>
          <option value="reject">駁回並保留紀錄</option>
        </select></label>
        <label className={styles.wide}><span>審核理由</span><textarea
          name="decisionReason" rows={3} maxLength={1_000} required /></label>
        <p className={styles.inlineNote}>核准前會再次核對提案 #{proposal.proposalNumber}、基準 v{proposal.expectedBaseVersion}、內容雜湊與生效期間；生效期間重疊時整筆拒絕。</p>
        <button className={decision === "approve"
          ? "button button--primary" : "button button--secondary"}
          type="submit" disabled={pending}>{pending ? "處理中…" :
            decision === "approve" ? "獨立核准" : "駁回提案"}</button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
