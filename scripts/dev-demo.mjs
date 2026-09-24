import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const DEMO_HOST = "127.0.0.1";
export const DEFAULT_DEMO_PORT = 3000;

// Empty values are intentional: Next's env loader does not replace variables
// that already exist in the child environment, so inherited secrets and
// .env.local cannot silently activate an external adapter in demo mode.
export const BLANKED_EXTERNAL_ENV_KEYS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_ID",
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_HOST",
  "POSTGRES_DATABASE",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "DOCUMENT_DOWNLOAD_SIGNING_SECRET",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_ROLE_SESSION_NAME",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_SDK_LOAD_CONFIG",
  "HTML_ARCHIVE_BUCKET",
  "AWS_KMS_KEY_ID",
  "CLIENT_DOCUMENTS_SCANNER_APPROVED",
  "CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE",
  "CLIENT_DOCUMENTS_CLAMAV_HOST",
  "CLIENT_DOCUMENTS_CLAMAV_PORT",
  "CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM",
  "CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM",
  "CLIENT_DOCUMENTS_CLAMAV_CA_PEM",
  "LINE_CHANNEL_ID",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "SMS_API_KEY",
  "SMS_API_SECRET",
  "SMS_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "FINANCE_STORE_SUMMARY_URL",
  "FINANCE_STORE_SUMMARY_TOKEN",
  "FINANCE_STORE_ORGANIZATION_ID",
  "FINANCE_STORE_BRANCH_ID",
  "FINANCE_STORE_ENTITY_ID",
]);

export class DemoArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "DemoArgumentError";
  }
}

function parsePort(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3,4}$/u.test(value)) {
    throw new DemoArgumentError("連接埠必須是 1024 至 65535 的十進位整數。");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new DemoArgumentError("連接埠必須是 1024 至 65535 的十進位整數。");
  }
  return port;
}

export function parseDemoArguments(rawArguments) {
  if (!Array.isArray(rawArguments) || rawArguments.some((value) => typeof value !== "string")) {
    throw new DemoArgumentError("啟動參數格式不正確。");
  }
  const argumentsToParse = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
  let port = DEFAULT_DEMO_PORT;
  let portWasSet = false;
  let help = false;

  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    if (argument === "--help" || argument === "-h") {
      if (argumentsToParse.length !== 1) {
        throw new DemoArgumentError("說明參數不可與其他啟動參數併用。");
      }
      help = true;
      continue;
    }

    let portValue = null;
    if (argument === "--port" || argument === "-p") {
      portValue = argumentsToParse[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--port=")) {
      portValue = argument.slice("--port=".length);
    } else if (argument.startsWith("-p=")) {
      portValue = argument.slice("-p=".length);
    } else {
      throw new DemoArgumentError(
        "只接受 --port <1024-65535>；主機固定為 127.0.0.1。",
      );
    }

    if (portWasSet) {
      throw new DemoArgumentError("連接埠只能指定一次。");
    }
    port = parsePort(portValue);
    portWasSet = true;
  }

  return Object.freeze({ port, help });
}

export function buildDemoEnvironment(inheritedEnvironment, port) {
  if (
    inheritedEnvironment === null ||
    typeof inheritedEnvironment !== "object" ||
    Array.isArray(inheritedEnvironment)
  ) {
    throw new TypeError("inheritedEnvironment must be an environment object");
  }
  const validatedPort = parsePort(String(port));
  const environment = { ...inheritedEnvironment };
  for (const key of BLANKED_EXTERNAL_ENV_KEYS) environment[key] = "";

  environment.NODE_ENV = "development";
  environment.DEMO_MODE = "true";
  environment.SMS_PROVIDER = "mock";
  environment.AWS_EC2_METADATA_DISABLED = "true";
  environment.NEXT_PUBLIC_APP_ORIGIN = `http://${DEMO_HOST}:${validatedPort}`;
  return environment;
}

export function createDemoLaunch(
  rawArguments,
  inheritedEnvironment = process.env,
  projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
) {
  const options = parseDemoArguments(rawArguments);
  if (options.help) return Object.freeze({ help: true, port: options.port });

  const nextCliPath = require.resolve("next/dist/bin/next");
  return Object.freeze({
    help: false,
    port: options.port,
    command: process.execPath,
    arguments: Object.freeze([
      nextCliPath,
      "dev",
      "--hostname",
      DEMO_HOST,
      "--port",
      String(options.port),
    ]),
    options: Object.freeze({
      cwd: resolve(projectRoot),
      env: buildDemoEnvironment(inheritedEnvironment, options.port),
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    }),
  });
}

function helpText() {
  return [
    "安全本機展示：pnpm dev:demo [--port 3000]",
    `主機固定為 ${DEMO_HOST}，只接受 1024 至 65535 的本機連接埠。`,
  ].join("\n");
}

export function startDemoServer(
  rawArguments = process.argv.slice(2),
  inheritedEnvironment = process.env,
  spawnProcess = spawn,
) {
  const launch = createDemoLaunch(rawArguments, inheritedEnvironment);
  if (launch.help) {
    process.stdout.write(`${helpText()}\n`);
    return null;
  }

  process.stdout.write(
    `安全展示模式：http://${DEMO_HOST}:${launch.port}（外部整合已停用）\n`,
  );
  const child = spawnProcess(launch.command, launch.arguments, launch.options);
  const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map();
  let finished = false;

  const cleanup = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
  for (const signal of forwardedSignals) {
    const handler = () => {
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  child.once("error", () => {
    if (finished) return;
    finished = true;
    cleanup();
    process.stderr.write("安全展示伺服器無法啟動。\n");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (finished) return;
    finished = true;
    cleanup();
    const signalExitCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
    process.exitCode = code ?? signalExitCodes[signal] ?? 1;
  });
  return child;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    startDemoServer();
  } catch (error) {
    if (error instanceof DemoArgumentError) {
      process.stderr.write(`${error.message}\n${helpText()}\n`);
    } else {
      process.stderr.write("安全展示啟動器發生未預期錯誤。\n");
    }
    process.exitCode = 1;
  }
}
