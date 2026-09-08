import { describe, expect, it } from "vitest";

import {
  BLANKED_EXTERNAL_ENV_KEYS,
  createDemoLaunch,
  DemoArgumentError,
  parseDemoArguments,
} from "./dev-demo.mjs";

describe("safe local demo launcher", () => {
  it("builds a loopback-only Next CLI launch and sanitizes inherited integrations", () => {
    const inherited = {
      PATH: "/synthetic/bin",
      KEEP_ME: "unrelated-value",
      NODE_ENV: "production",
      DEMO_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
      SUPABASE_SECRET_KEY: "synthetic-secret",
      DATABASE_URL: "postgres://synthetic.invalid/database",
      AWS_ACCESS_KEY_ID: "synthetic-access-key",
      AWS_SECRET_ACCESS_KEY: "synthetic-secret-key",
      HTML_ARCHIVE_BUCKET: "synthetic-bucket",
      LINE_CHANNEL_ACCESS_TOKEN: "synthetic-line-token",
      SMS_PROVIDER: "real-provider",
      TWILIO_AUTH_TOKEN: "synthetic-sms-token",
      NEXT_PUBLIC_APP_ORIGIN: "https://external.invalid",
    };

    const launch = createDemoLaunch([], inherited, "/tmp/synthetic-daycare-project");

    expect(launch.help).toBe(false);
    expect(launch.arguments.slice(1)).toEqual([
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
    expect(launch.options).toMatchObject({
      cwd: "/tmp/synthetic-daycare-project",
      shell: false,
      stdio: "inherit",
    });
    expect(launch.options.env).toMatchObject({
      KEEP_ME: "unrelated-value",
      PATH: "/synthetic/bin",
      NODE_ENV: "development",
      DEMO_MODE: "true",
      SMS_PROVIDER: "mock",
      AWS_EC2_METADATA_DISABLED: "true",
      NEXT_PUBLIC_APP_ORIGIN: "http://127.0.0.1:3000",
    });
    for (const key of BLANKED_EXTERNAL_ENV_KEYS) {
      expect(launch.options.env[key], key).toBe("");
    }
    expect(inherited.SUPABASE_SECRET_KEY).toBe("synthetic-secret");
    expect(inherited.NODE_ENV).toBe("production");
  });

  it("covers every integration key consumed by the current application schema", () => {
    expect(BLANKED_EXTERNAL_ENV_KEYS).toEqual(expect.arrayContaining([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "DOCUMENT_DOWNLOAD_SIGNING_SECRET",
      "AWS_REGION",
      "HTML_ARCHIVE_BUCKET",
      "AWS_KMS_KEY_ID",
      "LINE_CHANNEL_SECRET",
      "LINE_CHANNEL_ACCESS_TOKEN",
    ]));
  });

  it.each([
    [["--port", "3100"], 3100],
    [["--port=4200"], 4200],
    [["-p", "5300"], 5300],
    [["-p=6400"], 6400],
    [["--", "--port", "7500"], 7500],
  ])("accepts a validated local port without exposing hostname control", (args, port) => {
    const launch = createDemoLaunch(args, {}, "/tmp/project");
    expect(launch.port).toBe(port);
    expect(launch.arguments).toEqual(expect.arrayContaining([
      "--hostname", "127.0.0.1", "--port", String(port),
    ]));
    expect(launch.options.env.NEXT_PUBLIC_APP_ORIGIN)
      .toBe(`http://127.0.0.1:${port}`);
  });

  it.each([
    ["0"],
    ["80"],
    ["1023"],
    ["65536"],
    ["03000"],
    ["3e3"],
    ["3000x"],
    [""],
  ])("rejects invalid port %j before any process can be launched", (port) => {
    expect(() => parseDemoArguments(["--port", port]))
      .toThrow(DemoArgumentError);
  });

  it.each([
    ["--hostname", "0.0.0.0"],
    ["--host=example.invalid"],
    ["--production"],
    ["next", "dev"],
    ["--port", "3000", "--port", "3001"],
    ["--help", "--port", "3000"],
  ])("rejects unsupported or ambiguous arguments %j", (...args) => {
    expect(() => parseDemoArguments(args)).toThrow(DemoArgumentError);
  });

  it("supports a side-effect-free help mode", () => {
    expect(createDemoLaunch(["--help"], { SUPABASE_SECRET_KEY: "synthetic" }))
      .toEqual({ help: true, port: 3000 });
  });
});
