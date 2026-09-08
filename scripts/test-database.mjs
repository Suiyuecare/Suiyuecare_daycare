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
    "PGlite is a local compatibility check; formal Supabase PostgreSQL, lint, and concurrent-session gates remain separate.",
  );
}
