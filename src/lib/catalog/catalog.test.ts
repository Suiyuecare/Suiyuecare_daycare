import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  addedPages,
  canAccessCatalogPage,
  catalogModules,
  catalogSummary,
  familyNavigationGroups,
  familyPages,
  filterNavigationByAccess,
  getModule,
  getNavigationGroups,
  getPageBySlug,
  pageCatalog,
  parityPages,
  staffNavigationGroups,
  staffPages,
} from "./index";

describe("page catalog contract", () => {
  it("locks the approved module and page counts", () => {
    expect(catalogModules).toHaveLength(11);
    expect(pageCatalog).toHaveLength(89);
    expect(staffPages).toHaveLength(83);
    expect(familyPages).toHaveLength(6);
    expect(parityPages).toHaveLength(79);
    expect(addedPages).toHaveLength(10);
    expect(catalogSummary).toEqual({
      moduleCount: 11,
      pageCount: 89,
      staffPageCount: 83,
      familyPageCount: 6,
      parityPageCount: 79,
      addedPageCount: 10,
    });
  });

  it("keeps page numbers and slugs unique and stable", () => {
    expect(new Set(pageCatalog.map((page) => page.number)).size).toBe(89);
    expect(new Set(pageCatalog.map((page) => page.slug)).size).toBe(89);
    expect(pageCatalog.map((page) => page.number)).toEqual(
      Array.from({ length: 89 }, (_, index) => index + 1),
    );
    expect(pageCatalog.every((page) => !page.slug.startsWith("/"))).toBe(true);
  });

  it("locks the complete 89-page golden manifest", () => {
    const manifest = pageCatalog.map((page) => ({
      number: page.number,
      moduleId: page.moduleId,
      slug: page.slug,
      title: page.title,
      surface: page.surface,
      origin: page.origin,
    }));
    const manifestHash = createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex");

    expect(manifestHash).toBe(
      "6f0e8b8d8971d755f4c57b30a9b7991ebcddaec89958303df296431911458951",
    );
  });

  it("keeps module surfaces and approved release batches aligned", () => {
    const moduleSurface = new Map(
      catalogModules.map((module) => [module.id, module.surface]),
    );
    expect(
      pageCatalog.every(
        (page) => moduleSurface.get(page.moduleId) === page.surface,
      ),
    ).toBe(true);

    const batches = {
      R1: pageCatalog.filter((page) => page.number >= 80 && page.number <= 83),
      R2: pageCatalog.filter(
        (page) =>
          (page.number >= 1 && page.number <= 27) ||
          (page.number >= 46 && page.number <= 57),
      ),
      R3: pageCatalog.filter(
        (page) =>
          (page.number >= 28 && page.number <= 45) ||
          (page.number >= 58 && page.number <= 79),
      ),
      R4: pageCatalog.filter((page) => page.number >= 84 && page.number <= 89),
    };
    expect(Object.fromEntries(
      Object.entries(batches).map(([batch, pages]) => [batch, pages.length]),
    )).toEqual({ R1: 4, R2: 39, R3: 40, R4: 6 });
    expect(new Set(Object.values(batches).flat().map((page) => page.number)).size).toBe(89);
  });

  it("distinguishes the 79 parity pages from the 10 new pages", () => {
    expect(parityPages.map((page) => page.number)).toEqual(
      Array.from({ length: 79 }, (_, index) => index + 1),
    );
    expect(addedPages.filter((page) => page.origin === "governance")).toHaveLength(4);
    expect(addedPages.filter((page) => page.origin === "family")).toHaveLength(6);
    expect(addedPages.map((page) => page.number)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 80),
    );
  });

  it("requires complete product and acceptance metadata for every page", () => {
    for (const page of pageCatalog) {
      expect(page.title.trim(), `${page.slug}: title`).not.toBe("");
      expect(page.description.trim(), `${page.slug}: description`).not.toBe("");
      expect(page.primaryActions.length, `${page.slug}: actions`).toBeGreaterThan(0);
      expect(page.filters.length, `${page.slug}: filters`).toBeGreaterThan(0);
      expect(page.metrics.length, `${page.slug}: metrics`).toBeGreaterThan(0);
      expect(page.columns.length, `${page.slug}: columns`).toBeGreaterThan(0);
      expect(page.acceptance.length, `${page.slug}: acceptance`).toBeGreaterThan(0);
      expect(Array.isArray(page.requiredPermissions)).toBe(true);
      expect(page.offline.note.trim(), `${page.slug}: offline note`).not.toBe("");
    }
  });

  it("builds navigation groups in approved order without empty modules", () => {
    expect(staffNavigationGroups).toHaveLength(10);
    expect(familyNavigationGroups).toHaveLength(1);
    expect(getNavigationGroups()).toHaveLength(11);
    expect(getNavigationGroups().flatMap((group) => group.pages)).toHaveLength(89);
    expect(getNavigationGroups().every((group) => group.pages.length > 0)).toBe(true);
    expect(getNavigationGroups().map((group) => group.order)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1),
    );
    expect(getNavigationGroups().map((group) => group.pages.length)).toEqual([
      2, 8, 13, 4, 5, 10, 3, 12, 22, 4, 6,
    ]);
  });

  it("looks up pages and modules through stable helpers", () => {
    expect(getPageBySlug("staff/daily-care/vital-signs")?.number).toBe(3);
    expect(getPageBySlug("/family/home/")?.number).toBe(84);
    expect(getPageBySlug("does/not/exist")).toBeUndefined();
    expect(getModule("governance").title).toBe("系統治理與中央匯入");
  });

  it("keeps offline capabilities within the approved boundaries", () => {
    expect(getPageBySlug("staff/daily-care/vital-signs")?.offline.mode).toBe(
      "draft-sync-24h",
    );
    expect(getPageBySlug("staff/daily-care/medication-records")?.offline.mode).toBe(
      "online-only",
    );
    expect(getPageBySlug("staff/service-management/claims")?.offline.mode).toBe(
      "online-only",
    );
    expect(getPageBySlug("family/billing-documents")?.offline.mode).toBe(
      "online-only",
    );
  });

  it("gates high-risk staff pages with explicit production permissions", () => {
    const expectedPermissions = new Map([
      ["staff/workspace/case-center", ["clients.read"]],
      ["staff/daily-care/vital-signs", ["clients.read", "health.read"]],
      ["staff/daily-care/blood-glucose", ["clients.read", "health.read"]],
      ["staff/daily-care/insulin", [
        "clients.read", "medications.read", "insulin_administrations.read",
      ]],
      ["staff/daily-care/client-tocc", ["clients.read", "health.read"]],
      ["staff/daily-care/care-diary", ["clients.read", "care_records.read"]],
      ["staff/daily-care/medication-records", ["clients.read", "medications.read"]],
      ["staff/daily-care/medication-plans", ["clients.read", "medications.read"]],
      ["staff/daily-care/individual-service-plan", ["clients.read", "care_plans.read"]],
      ["staff/assessments/spmsq", ["clients.read", "questionnaire_cognition.read"]],
      ["staff/assessments/gds", ["clients.read", "questionnaire_emotion.read"]],
      ["staff/assessments/fall-risk", ["clients.read", "questionnaire_fall.read"]],
      ["staff/assessments/nsi", ["clients.read", "questionnaire_nutrition.read"]],
      ["staff/assessments/barthel-adl", ["clients.read", "questionnaire_adl.read"]],
      ["staff/assessments/iadl", ["clients.read", "questionnaire_adl.read"]],
      ["staff/assessments/swallowing", ["clients.read", "questionnaire_swallowing.read"]],
      ["staff/assessments/bsrs", ["clients.read", "questionnaire_emotion.read"]],
      ["staff/assessments/inspection-reports", [
        "clients.read", "health.read", "client_reports.read",
      ]],
      ["staff/assessments/vaccinations", [
        "clients.read", "client_vaccinations.read",
      ]],
      ["staff/quality/falls", ["clients.read", "quality_events.read"]],
      ["staff/quality/infections", ["clients.read", "quality_events.read"]],
      ["staff/quality/incidents", ["clients.read", "quality_events.read"]],
      ["staff/quality/weight-management", ["clients.read", "quality_events.read"]],
      ["staff/social-work/psychosocial-assessment", ["clients.read", "social_work_records.read"]],
      ["staff/social-work/activities", ["clients.read", "activity.read"]],
      ["staff/social-work/resources", ["social_resources.read"]],
      ["staff/social-work/adaptation-assessment", ["clients.read", "social_work_records.read"]],
      ["staff/professional-care/occupational-assessment", [
        "clients.read", "occupational_therapy_assessments.read",
      ]],
      ["staff/professional-care/physical-assessment", [
        "clients.read", "physical_therapy_assessments.read",
      ]],
      ["staff/professional-care/chewing", [
        "clients.read", "chewing_assessments.read",
      ]],
      ["staff/professional-care/mna", [
        "clients.read", "questionnaire_nutrition.read",
      ]],
      ["staff/professional-care/consultations", [
        "clients.read", "interprofessional_consultations.read",
      ]],
      ["staff/professional-care/case-conferences", [
        "clients.read", "case_conferences.read",
      ]],
      ["staff/professional-care/referrals", [
        "clients.read", "referral_management.read",
      ]],
      ["staff/professional-care/physical-services", [
        "clients.read", "physical_therapy_services.read",
      ]],
      ["staff/professional-care/occupational-services", [
        "clients.read", "occupational_therapy_services.read",
      ]],
      ["staff/professional-care/service-summary", [
        "clients.read", "professional_service_summary.read",
      ]],
      ["staff/communication/push-notifications", ["notifications.manage"]],
      ["staff/service-management/attendance", ["clients.read", "attendance.read"]],
      [
        "staff/service-management/daily-summary",
        ["clients.read", "daily_service_summary.read"],
      ],
      ["staff/service-management/claims", ["claims.read"]],
      ["staff/service-management/case-service-records", ["clients.read", "case_service_records.read"]],
      ["staff/service-management/client-service-plans", ["clients.read", "care_plans.read"]],
      ["staff/service-management/service-usage", ["clients.read", "services.read"]],
      ["staff/service-management/approved-care-plans", ["clients.read", "care_plans.read"]],
      ["staff/operations/organization", ["organization_profile.read"]],
      ["staff/operations/billing", ["billing.read"]],
      ["staff/operations/clients", ["clients.read"]],
      ["staff/operations/client-transitions", ["clients.read"]],
      ["staff/operations/hand-hygiene", ["hand_hygiene.read"]],
      ["staff/operations/notifications", ["notifications.read"]],
      ["staff/operations/announcements", ["announcements.read"]],
      ["staff/operations/staff-vital-signs", ["staff_health.read"]],
      ["staff/operations/training", ["staff_training.read"]],
      ["staff/operations/staff-certificates", ["staff_certificates.read"]],
      ["staff/operations/staff-vaccinations", ["staff_health.read"]],
      ["staff/operations/staff-tocc", ["staff_tocc.read"]],
      ["staff/operations/staff-lab-reports", ["staff_health.read"]],
      ["staff/operations/meetings", ["meetings.read"]],
      ["staff/operations/inventory", ["inventory.read"]],
      ["staff/governance/central-html-import", ["imports.manage"]],
      ["staff/governance/roles-data-scopes", ["roles.manage"]],
      ["staff/governance/form-rule-versions", ["forms.manage"]],
      ["staff/governance/integrations-audit", ["audit.view"]],
    ]);

    for (const [slug, permissions] of expectedPermissions) {
      const page = getPageBySlug(slug)!;
      expect(page.requiredPermissions).toEqual(permissions);
      expect(
        canAccessCatalogPage({ demo: false, scopes: [] }, page),
      ).toBe(false);
      expect(
        canAccessCatalogPage({ demo: false, scopes: permissions }, page),
      ).toBe(true);
    }
  });

  it("keeps page 54 dedicated snapshot, source-scope and offline boundaries explicit", () => {
    const page = getPageBySlug("staff/service-management/daily-summary")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "daily_service_summary.read",
    ]);
    expect(page.offline.mode).toBe("online-only");
    expect(acceptance).toMatch(/單一.*資料庫.*快照/u);
    expect(acceptance).toMatch(/未授權.*unknown/u);
    expect(acceptance).toMatch(/assigned-client/u);
    expect(acceptance).toMatch(/同工作階段 AAL2/u);
    expect(acceptance).toMatch(/24 小時離線/u);
  });

  it("keeps page 23 immutable, exact-batch and fail-closed boundaries explicit", () => {
    const page = getPageBySlug("staff/assessments/vaccinations")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "client_vaccinations.read",
    ]);
    expect(page.offline.mode).toBe("online-only");
    expect(acceptance).toMatch(/缺證明與不適用分開/u);
    expect(acceptance).toMatch(/不得自動合併/u);
    expect(acceptance).toMatch(/不可變單一終端版本鏈/u);
    expect(acceptance).toMatch(/外層操作鍵精確重播/u);
    expect(acceptance).toMatch(/assigned-client/u);
    expect(acceptance).toMatch(/not_configured/u);
  });

  it("keeps page 32 manual-only, exact-client and online-only boundaries explicit", () => {
    const page = getPageBySlug("staff/social-work/adaptation-assessment")!;
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toContain("從個案列快速新增");
    expect(page.acceptance.join(" ")).toMatch(/精確個案識別碼/u);
    expect(page.acceptance.join(" ")).toMatch(/非標準化/u);
    expect(page.acceptance.join(" ")).toMatch(/不得宣稱官方量表/u);
    expect(page.acceptance.join(" ")).toMatch(/最近 15 分鐘 AAL2/u);
  });

  it("keeps page 11 fillable, versioned and access-scoped", () => {
    const page = getPageBySlug("staff/assessments/spmsq")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "選擇個案並填寫", "保存草稿", "建立新版",
    ]);
    expect(page.columns).not.toContain("分數");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "questionnaire_cognition.read",
    ]);
    expect(acceptance).toMatch(/10 題/u);
    expect(acceptance).toMatch(/教育程度/u);
    expect(acceptance).toMatch(/不自動簽署/u);
  });

  it("keeps page 12 GDS fillable with strict complete scoring", () => {
    const page = getPageBySlug("staff/assessments/gds")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "選擇個案並填寫", "保存草稿", "建立新版",
    ]);
    expect(page.columns).not.toContain("正式風險");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "questionnaire_emotion.read",
    ]);
    expect(acceptance).toMatch(/十五題/u);
    expect(acceptance).toMatch(/缺答均不產生總分/u);
    expect(acceptance).toMatch(/不自動診斷/u);
  });

  it("keeps page 13 Taipei B12 fillable and access-scoped", () => {
    const page = getPageBySlug("staff/assessments/fall-risk")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "選擇個案並填寫", "保存草稿", "建立新版",
    ]);
    expect(page.columns).not.toContain("正式風險分級");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "questionnaire_fall.read",
    ]);
    expect(acceptance).toMatch(/B12/u);
    expect(acceptance).toMatch(/3 項以上/u);
    expect(acceptance).toMatch(/不自動建待辦/u);
  });

  it("keeps page 14 NSI DETERMINE fillable with weighted preview", () => {
    const page = getPageBySlug("staff/assessments/nsi")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "選擇個案並填寫", "保存草稿", "建立新版",
    ]);
    expect(page.columns).not.toContain("總分");
    expect(page.columns).not.toContain("風險");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "questionnaire_nutrition.read",
    ]);
    expect(acceptance).toMatch(/十項依固定版本加權/u);
    expect(acceptance).toMatch(/不是營養診斷/u);
    expect(acceptance).toMatch(/不自動簽署/u);
  });

  it("keeps page 5 governed, two-person and online-only", () => {
    const page = getPageBySlug("staff/daily-care/insulin")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "medications.read", "insulin_administrations.read",
    ]);
    expect(acceptance).toMatch(/Page 8/u);
    expect(acceptance).toMatch(/Page 72/u);
    expect(acceptance).toMatch(/not_configured/u);
    expect(acceptance).toMatch(/兩位不同/u);
    expect(acceptance).toMatch(/解析敏感 body 前/u);
  });

  it("keeps page 28 manual-only, immutable and online-only boundaries explicit", () => {
    const page = getPageBySlug("staff/social-work/psychosocial-assessment")!;
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toContain("快速新增草稿");
    expect(page.acceptance.join(" ")).toMatch(/人工非標準化/u);
    expect(page.acceptance.join(" ")).toMatch(/未知及不適用/u);
    expect(page.acceptance.join(" ")).toMatch(/不建立分數/u);
    expect(page.acceptance.join(" ")).toMatch(/最近 15 分鐘 AAL2/u);
    expect(page.acceptance.join(" ")).toMatch(/not_configured/u);
  });

  it("keeps page 33 manual, professional-scoped and online-only", () => {
    const page = getPageBySlug("staff/professional-care/occupational-assessment")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "開始新評估草稿", "建立草稿新版", "簽署評估", "建立更正版",
    ]);
    expect(page.columns).not.toContain("分數");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "occupational_therapy_assessments.read",
    ]);
    expect(acceptance).toMatch(/manual_unstandardized/u);
    expect(acceptance).toMatch(/不得加總成臨床分數/u);
    expect(acceptance).toMatch(/professional/u);
    expect(acceptance).toMatch(/最近 15 分鐘 AAL2/u);
    expect(acceptance).toMatch(/未配置/u);
  });

  it("keeps page 34 independent, manual, professional-scoped and online-only", () => {
    const page = getPageBySlug("staff/professional-care/physical-assessment")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "開始新評估草稿", "建立草稿新版", "簽署評估", "建立更正版",
    ]);
    expect(page.columns).not.toContain("分數");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "physical_therapy_assessments.read",
    ]);
    expect(acceptance).toMatch(/獨立物理治療資料領域/u);
    expect(acceptance).toMatch(/manual_unstandardized/u);
    expect(acceptance).toMatch(/數值文字、觀察文字、缺值及不適用/u);
    expect(acceptance).toMatch(/不得宣稱官方量表/u);
    expect(acceptance).toMatch(/全部使用最近 15 分鐘 AAL2/u);
    expect(acceptance).toMatch(/not_configured/u);
  });

  it("keeps page 35 manual-only, professional-scoped and fail-closed", () => {
    const page = getPageBySlug("staff/professional-care/chewing")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.primaryActions).toEqual([
      "開始人工觀察草稿", "建立不可變新版",
      "正式簽署／更正（規則未發布時封鎖）",
    ]);
    expect(page.columns).not.toContain("分數");
    expect(page.columns).not.toContain("能力分級");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "chewing_assessments.read",
    ]);
    expect(acceptance).toMatch(/manual_unstandardized_chewing_observations/u);
    expect(acceptance).toMatch(/缺值與不適用不得當作 0/u);
    expect(acceptance).toMatch(/professional/u);
    expect(acceptance).toMatch(/正式簽署、更正生效/u);
    expect(acceptance).toMatch(/不得自動建立或通知轉介/u);
    expect(acceptance).toMatch(/非法篩選不得放寬/u);
  });

  it("keeps page 36 MNA-SF fillable and nutrition-scoped", () => {
    const page = getPageBySlug("staff/professional-care/mna")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "questionnaire_nutrition.read",
    ]);
    expect(page.primaryActions).toEqual([
      "選擇個案並填寫", "保存草稿", "建立新版",
    ]);
    expect(acceptance).toMatch(/MNA-SF 2009 修訂版六題/u);
    expect(acceptance).toMatch(/BMI／小腿圍替代/u);
    expect(acceptance).toMatch(/不替代營養師診斷/u);
  });

  it("keeps page 40 independent from assessment, immutable and fail-closed", () => {
    const page = getPageBySlug("staff/professional-care/physical-services")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "physical_therapy_services.read",
    ]);
    expect(page.primaryActions).toEqual([
      "新增服務草稿", "建立草稿新版", "簽署紀錄", "建立有理由更正",
    ]);
    expect(acceptance).toMatch(/獨立服務紀錄領域/u);
    expect(acceptance).toMatch(/第 34 頁.*唯讀參照/u);
    expect(acceptance).toMatch(/缺值及不適用/u);
    expect(acceptance).toMatch(/最近 15 分鐘同 session AAL2/u);
    expect(acceptance).toMatch(/not_configured/u);
  });

  it("keeps page 41 independent from assessment, immutable and fail-closed", () => {
    const page = getPageBySlug("staff/professional-care/occupational-services")!;
    const acceptance = page.acceptance.join(" ");
    expect(page.offline.mode).toBe("online-only");
    expect(page.requiredPermissions).toEqual([
      "clients.read", "occupational_therapy_services.read",
    ]);
    expect(page.primaryActions).toEqual([
      "新增服務草稿", "建立草稿新版", "簽署紀錄", "建立有理由更正",
    ]);
    expect(acceptance).toMatch(/獨立服務紀錄領域/u);
    expect(acceptance).toMatch(/第 33 頁.*唯讀參照/u);
    expect(acceptance).toMatch(/append-only 線性版本/u);
    expect(acceptance).toMatch(/occupational_therapy_services\.read/u);
    expect(acceptance).toMatch(/not_configured/u);
  });

  it("filters unauthorized navigation while leaving demo mode intact", () => {
    const restricted = filterNavigationByAccess(staffNavigationGroups, {
      demo: false,
      scopes: ["clients.read"],
    });
    expect(restricted.length).toBeGreaterThan(0);
    const restrictedPages = restricted.flatMap((group) => group.pages);
    expect(
      restrictedPages.every((page) =>
        (page.requiredPermissions ?? []).every(
          (permission) => permission === "clients.read",
        ),
      ),
    ).toBe(true);
    expect(new Set(restrictedPages.map((page) => page.slug)).size).toBe(
      restrictedPages.length,
    );
    expect(
      restricted.flatMap((group) => group.pages)
        .some((page) => page.slug === "staff/operations/announcements"),
    ).toBe(false);
    expect(
      restricted.flatMap((group) => group.pages)
        .some((page) => page.slug === "staff/operations/meetings"),
    ).toBe(false);
    expect(
      restricted.flatMap((group) => group.pages)
        .some((page) => page.slug === "staff/quality/falls"),
    ).toBe(false);
    expect(
      restricted.flatMap((group) => group.pages)
        .some((page) => page.slug === "staff/quality/infections"),
    ).toBe(false);
    expect(
      restricted.flatMap((group) => group.pages)
        .some((page) => page.slug === "staff/quality/incidents"),
    ).toBe(false);
    expect(
      restricted
        .flatMap((group) => group.pages)
        .some((page) => page.moduleId === "governance"),
    ).toBe(false);

    const demo = filterNavigationByAccess(staffNavigationGroups, {
      demo: true,
      scopes: [],
    });
    expect(demo).toHaveLength(10);
    expect(demo.flatMap((group) => group.pages)).toHaveLength(83);
  });
});
