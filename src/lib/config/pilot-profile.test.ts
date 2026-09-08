import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { appBranding, demoBranding } from "./branding";
import { pilotProfile, pilotReadinessRequirements } from "./pilot-profile";
import { pilotSources } from "./pilot-sources";

describe("public pilot configuration is not production authorization", () => {
  it("preserves the exact user-confirmed legal name and municipality", () => {
    expect(pilotProfile.legalName).toBe("樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構");
    expect(pilotProfile.municipality).toBe("臺北市");
    expect(pilotProfile.confirmation).toEqual({ source: "user_confirmation", confirmedOn: "2026-09-08" });
    expect(pilotProfile.plannedServiceType).toBe("community_day_care");
  });

  it("does not turn a name, directory row or synthetic data into a production binding", () => {
    expect(pilotProfile.provisioningStatus).toBe("not_provisioned");
    for (const key of [
      "organizationId", "branchId", "governmentInstitutionCode", "permitNumber",
      "contractNumber", "approvedCapacity", "publishedClaimFormatVersion",
      "publishedAccreditationVersion", "publishedRateVersion",
    ] as const) expect(pilotProfile[key]).toBeNull();
  });

  it("keeps every readiness gate unresolved and uniquely identified", () => {
    expect(pilotReadinessRequirements).toHaveLength(5);
    expect(new Set(pilotReadinessRequirements.map((item) => item.id)).size).toBe(5);
    for (const item of pilotReadinessRequirements) {
      expect(["awaiting_documents", "not_approved"]).toContain(item.status);
    }
  });

  it("shares product labels with the PWA while making demo identity explicit", () => {
    expect(manifest()).toMatchObject({
      name: appBranding.applicationName, short_name: appBranding.shortName,
      start_url: "/app/dashboard", lang: "zh-Hant",
    });
    expect(appBranding.brand).toBe("歲悅");
    expect(demoBranding.organizationName).toContain("合成示範");
    expect(demoBranding.branchName).toContain("示範");
    expect(demoBranding.otherBranchName).toContain("合成示範");
  });
});

describe("official references remain non-executable, unapproved candidates", () => {
  it("uses only HTTPS official sources with unique inventory keys", () => {
    expect(pilotSources).toHaveLength(8);
    expect(new Set(pilotSources.map((source) => source.id)).size).toBe(8);
    const allowedHosts = new Set(["dosw.gov.taipei", "www-ws.gov.taipei", "1966.gov.tw", "www.mohw.gov.tw"]);
    for (const source of pilotSources) {
      const urls = [source.sourceUrl, ...("documentUrl" in source ? [source.documentUrl] : [])];
      for (const value of urls) {
        const url = new URL(value);
        expect(url.protocol).toBe("https:");
        expect(allowedHosts.has(url.hostname)).toBe(true);
        expect(url.username + url.password + url.hash).toBe("");
      }
    }
  });

  it("never publishes rules, supplies an approver, or infers a legal effective date", () => {
    for (const source of pilotSources) {
      expect(source).toMatchObject({
        reviewStatus: "unapproved", enabled: false, approvedBy: null, approvedAt: null,
        legalEffectiveDate: null, institutionApplicability: "pending_document_verification",
        retrievedOn: "2026-09-08",
      });
    }
  });

  it("separates 115 day-care criteria from the future 116 proposal and home-care names", () => {
    const criteria = pilotSources.find((source) => source.id === "taipei-daycare-statutory-accreditation-115")!;
    const proposed = pilotSources.find((source) => source.id === "taipei-accreditation-proposed-116")!;
    expect(criteria.version).toContain("附件 2-4");
    expect(criteria.caution).toContain("43 個基本項目、另 2 加分題");
    expect(proposed.purpose).toBe("proposed_accreditation");
    expect(proposed.enabled).toBe(false);
    const procedure = pilotSources.find((source) => source.id === "taipei-statutory-accreditation-procedure-115")!;
    expect(procedure.dates).toContainEqual({ label: "實施期程（月精度）", value: "2026-01 至 2026-12" });
    expect(procedure.caution).toContain("名稱近似的居家機構不可匹配");
  });

  it("records public API evidence without reopening the expired verification intake", () => {
    const spec = pilotSources.find((source) => source.purpose === "api_reference")!;
    expect(spec.version).toBe("2.2.1／40 頁 PDF");
    expect(spec.dates).toContainEqual({ label: "文件修訂日", value: "2024-05-09" });
    expect(spec.dates).toContainEqual({ label: "附件上架日期標籤", value: "2025-06-25" });
    expect(spec.caution).toContain("尚未確認 115 年現行適用版本");
    const intake = pilotSources.find((source) => source.purpose === "verification_intake")!;
    expect(intake.title).toContain("已截止");
    expect(intake.dates).toContainEqual({ label: "該年度申請截止", value: "2025-07-25" });
  });

  it("does not treat a contract template, directory row or benefit report as a claims rule", () => {
    expect(pilotSources.find((source) => source.purpose === "contract_reference")!.caution)
      .toContain("不是本機構 115 年有效契約");
    expect(pilotSources.find((source) => source.purpose === "directory")!.caution)
      .toContain("列序不是機構代碼");
    expect(pilotSources.find((source) => source.purpose === "benefit_reporting")!.caution)
      .toContain("不得將效益表期限當作服務費申報送件期限");
  });
});
