import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite/pgtap";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");
const testDirectory = join(projectRoot, "supabase", "tests");
const seedFile = join(projectRoot, "supabase", "seed.sql");
const compileOnly = process.argv.includes("--compile-only");
const requestedTests = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith("--"));

// Frozen pre-executive multi-role regression suites. Only these known local
// suites replace the new admission predicate, never its tenant/role/AAL guards.
// Every new suite (including executive_google_access.test.sql) runs all real
// migrations with default-deny admission. No environment bypass or hosted
// configuration switch exists. Shared Vitest bootstrap remains unmodified.
const legacyMultiRoleTests = new Set([
  "abcd_assessments_page21.test.sql",
  "abnormal_event_workflow_page27.test.sql",
  "activity_management_page30.test.sql",
  "adaptation_assessment_page32.test.sql",
  "atomic_claim_workflows.test.sql",
  "attendance_event_workflow_test.sql",
  "authorized_care_plan_view_page55.test.sql",
  "authorized_care_plan_write_boundary.test.sql",
  "behavior_emotion_events_page20.test.sql",
  "billing_management_page64.test.sql",
  "blood_glucose_measurements_test.sql",
  "body_assessments_page19.test.sql",
  "care_communications_page43.test.sql",
  "care_diary_draft_boundary.test.sql",
  "case_conferences_page38.test.sql",
  "case_service_records_page50.test.sql",
  "chewing_assessment_page35.test.sql",
  "client_directory_hardening.test.sql",
  "client_inspection_reports_page22.test.sql",
  "client_lifecycle.test.sql",
  "client_master_read_snapshot.test.sql",
  "client_master_write_boundary.test.sql",
  "client_service_plan_workflow_page52.test.sql",
  "client_tocc_workflow.test.sql",
  "client_vaccinations_page23.test.sql",
  "complete_service_event.test.sql",
  "consultant_messages_page76.test.sql",
  "core_care_plans.test.sql",
  "daily_service_summary_page54.test.sql",
  "data_inventory_page83.test.sql",
  "document_printing_page62.test.sql",
  "external_health_devices_page65.test.sql",
  "fall_event_workflow_page24.test.sql",
  "fall_risk_assessment_page13.test.sql",
  "family_consent_workflow.test.sql",
  "family_portal_read_hardening.test.sql",
  "feedback_complaints_page56.test.sql",
  "form_governance_snapshot.test.sql",
  "form_publication_approval.test.sql",
  "foundation_schema.test.sql",
  "gds_assessment_page12.test.sql",
  "hand_hygiene_page66.test.sql",
  "import_approval_context.test.sql",
  "individual_service_plan_workflow.test.sql",
  "infection_event_workflow_page25.test.sql",
  "initialization_rls_hardening.test.sql",
  "insulin_administrations_page5.test.sql",
  "integrations_audit_page83.test.sql",
  "interprofessional_consultations_page37.test.sql",
  "inventory_management_page77.test.sql",
  "meal_management_page57.test.sql",
  "medication_administration_workflow_test.sql",
  "medication_plan_workflow.test.sql",
  "meeting_append_only_privilege_hardening.test.sql",
  "meeting_management_workflow.test.sql",
  "mna_assessment_page36.test.sql",
  "notification_acknowledgement.test.sql",
  "notification_center_snapshot.test.sql",
  "notification_enqueue_boundary.test.sql",
  "nsi_nutrition_screening_page14.test.sql",
  "nursing_assessments_page51.test.sql",
  "occupational_therapy_assessment_page33.test.sql",
  "occupational_therapy_services_page41.test.sql",
  "organization_profile_page58.test.sql",
  "physical_therapy_assessment_page34.test.sql",
  "physical_therapy_services_page40.test.sql",
  "pre_mfa_challenge_eligibility.test.sql",
  "professional_service_summary_page42.test.sql",
  "psychosocial_assessment_page28.test.sql",
  "push_notification_management.test.sql",
  "reassurance_calendar_page44.test.sql",
  "reauth_evidence_selection.test.sql",
  "referral_management_page39.test.sql",
  "rls_access.test.sql",
  "role_governance_approval.test.sql",
  "role_governance_snapshot.test.sql",
  "role_profile_kind_boundary.test.sql",
  "social_resources_page31.test.sql",
  "social_work_service_records_page29.test.sql",
  "spmsq_assessment_page11.test.sql",
  "staff_announcement_workflow.test.sql",
  "staff_certificates_page72.test.sql",
  "staff_lab_reports_page78.test.sql",
  "staff_management_page59.test.sql",
  "staff_scheduling_page63.test.sql",
  "staff_tocc_page74.test.sql",
  "staff_training_page71.test.sql",
  "staff_vaccinations_page73.test.sql",
  "staff_vital_signs_page69.test.sql",
  "transport_execution_page48.test.sql",
  "transport_trip_plans_page47.test.sql",
  "vital_measurement_sets.test.sql",
  "weight_management_page26.test.sql",
]);

async function applyLegacyAdmissionFixture(database, testFile) {
  if (!legacyMultiRoleTests.has(testFile)) return false;
  if (!(database instanceof PGlite)) throw new Error("Legacy admission fixture requires local PGlite");
  const { rows } = await database.query(
    "select private.is_executive_login_allowed() as allowed, (select count(*)::integer from private.executive_access_policy) as policies",
  );
  if (rows[0]?.allowed !== false || rows[0]?.policies !== 0) {
    throw new Error("Unmodified migration must default-deny without executive provisioning");
  }
  await database.exec(
    "create or replace function private.is_executive_login_allowed() returns boolean language sql volatile security definer set search_path = '' as $$ select true $$;",
  );
  return true;
}


async function sqlFiles(directory) {
  return (await readdir(directory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
}

function databaseErrorSummary(error) {
  if (!(error instanceof Error)) return String(error);
  const fields = [error.message];
  if ("code" in error && typeof error.code === "string") {
    fields.push(`SQLSTATE ${error.code}`);
  }
  if ("constraint" in error && typeof error.constraint === "string") {
    fields.push(`constraint ${error.constraint}`);
  }
  if ("position" in error && typeof error.position === "string") {
    fields.push(`position ${error.position}`);
  }
  if ("detail" in error && typeof error.detail === "string") {
    fields.push(`detail ${error.detail}`);
  }
  if ("hint" in error && typeof error.hint === "string") {
    fields.push(`hint ${error.hint}`);
  }
  if ("where" in error && typeof error.where === "string") {
    fields.push(error.where);
  }
  return fields.join("\n");
}

async function createDatabase(migrationFiles) {
  const database = new PGlite({ extensions: { pgtap } });
  await database.exec(bootstrapSql);
  for (const migrationFile of migrationFiles) {
    try {
      await database.exec(
        await readFile(join(migrationDirectory, migrationFile), "utf8"),
      );
    } catch (error) {
      throw new Error(
        `Migration failed: ${migrationFile}\n${databaseErrorSummary(error)}`,
      );
    }
  }
  return database;
}

function resultStrings(result) {
  return result.flatMap((statement) =>
    statement.rows.flatMap((row) =>
      Object.values(row).filter((value) => typeof value === "string"),
    ),
  );
}

function plannedAssertions(sql) {
  const match = sql.match(/\bselect\s+plan\(\s*(\d+)\s*\)\s*;/iu);
  return match ? Number(match[1]) : null;
}

async function runTest(migrationFiles, testFile) {
  const database = await createDatabase(migrationFiles);
  try {
    await applyLegacyAdmissionFixture(database, testFile);
    await database.exec(await readFile(seedFile, "utf8"));
    await database.exec("create extension if not exists pgtap;");
    const sql = await readFile(join(testDirectory, testFile), "utf8");
    let result;
    try {
      result = await database.exec(sql);
    } catch (error) {
      throw new Error(
        `${testFile} failed to execute\n${databaseErrorSummary(error)}`,
      );
    }
    const strings = resultStrings(result);
    const assertions = strings.filter((value) => /^ok \d+\b/u.test(value));
    const failures = strings.filter((value) => /^not ok \d+\b/u.test(value));
    const finishFailures = strings.filter((value) =>
      value.startsWith("# Looks like you failed"),
    );
    const expected = plannedAssertions(sql);
    if (
      failures.length > 0 ||
      finishFailures.length > 0 ||
      expected === null ||
      assertions.length !== expected
    ) {
      const details = [...failures, ...finishFailures].join("\n") ||
        `planned ${expected ?? "unknown"}, observed ${assertions.length}`;
      throw new Error(`${testFile} failed\n${details}`);
    }
    return assertions.length;
  } finally {
    await database.close();
  }
}

const migrationFiles = await sqlFiles(migrationDirectory);
const compileDatabase = await createDatabase(migrationFiles);
await compileDatabase.close();
console.log(`Database compile: ${migrationFiles.length} migrations passed.`);

if (!compileOnly) {
  const availableTests = await sqlFiles(testDirectory);
  const testFiles = requestedTests.length
    ? requestedTests.map((test) => basename(test))
    : availableTests;
  const unknownTests = testFiles.filter((test) => !availableTests.includes(test));
  if (unknownTests.length) {
    throw new Error(`Unknown database tests: ${unknownTests.join(", ")}`);
  }

  let assertionCount = 0;
  for (const testFile of testFiles) {
    const passed = await runTest(migrationFiles, testFile);
    assertionCount += passed;
    console.log(`${testFile}: ${passed}/${passed} passed.`);
  }
  console.log(
    `Database tests: ${testFiles.length} files, ${assertionCount} assertions passed.`,
  );
  console.log(
    `Admission modes: ${testFiles.filter((file) => legacyMultiRoleTests.has(file)).length} legacy PGlite-only fixture suites; ${testFiles.filter((file) => !legacyMultiRoleTests.has(file)).length} enforced executive suites.`,
  );
  console.log(
    "PGlite is a local compatibility check; formal Supabase PostgreSQL, lint, and concurrent-session gates remain separate.",
  );
}
