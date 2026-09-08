import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  documentAccessTokenConfigured,
  issueDocumentAccessToken,
  verifyDocumentAccessToken,
} from "./download-token";

const jobId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-02T08:00:00.000Z");
const previous = process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET;

describe("short-lived document access token", () => {
  beforeEach(() => {
    process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET = "test-only-secret-that-is-at-least-32-characters";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET;
    else process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET = previous;
  });

  it("binds one job, current user, access mode, and five-minute window", () => {
    const token = issueDocumentAccessToken({ jobId, userId, mode: "preview", now });
    expect(verifyDocumentAccessToken({
      token,
      expectedJobId: jobId,
      expectedUserId: userId,
      expectedMode: "preview",
      now: new Date(now.getTime() + 299_000),
    })).toMatchObject({ jobId, userId, mode: "preview" });
    expect(() => verifyDocumentAccessToken({
      token,
      expectedJobId: jobId,
      expectedUserId: userId,
      expectedMode: "download",
      now,
    })).toThrow("DOCUMENT_ACCESS_TOKEN_INVALID");
    expect(() => verifyDocumentAccessToken({
      token,
      expectedJobId: jobId,
      expectedUserId: userId,
      expectedMode: "preview",
      now: new Date(now.getTime() + 300_000),
    })).toThrow("DOCUMENT_ACCESS_TOKEN_INVALID");
  });

  it("rejects tampering and a token replayed by another user or job", () => {
    const token = issueDocumentAccessToken({ jobId, userId, mode: "download", now });
    expect(() => verifyDocumentAccessToken({
      token: `${token.slice(0, -1)}x`,
      expectedJobId: jobId,
      expectedUserId: userId,
      expectedMode: "download",
      now,
    })).toThrow("DOCUMENT_ACCESS_TOKEN_INVALID");
    expect(() => verifyDocumentAccessToken({
      token,
      expectedJobId: jobId,
      expectedUserId: "33333333-3333-4333-8333-333333333333",
      expectedMode: "download",
      now,
    })).toThrow("DOCUMENT_ACCESS_TOKEN_INVALID");
  });

  it("fails closed when the secret is missing or too short", () => {
    delete process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET;
    expect(documentAccessTokenConfigured()).toBe(false);
    expect(() => issueDocumentAccessToken({ jobId, userId, mode: "preview", now }))
      .toThrow("DOCUMENT_DOWNLOAD_SIGNING_NOT_CONFIGURED");
    process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET = "too-short";
    expect(documentAccessTokenConfigured()).toBe(false);
  });
});
