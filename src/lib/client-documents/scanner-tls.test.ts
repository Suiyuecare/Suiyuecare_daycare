import { EventEmitter } from "node:events";
import { rootCertificates } from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const tls = vi.hoisted(() => ({ connect: vi.fn(), context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:tls", async () => ({ ...await vi.importActual<typeof import("node:tls")>("node:tls"), connect: tls.connect, createSecureContext: tls.context }));
import { configuredDocumentScanner } from "./pipeline";

class Socket extends EventEmitter {
  destroy = vi.fn(); write = vi.fn(); setTimeout = vi.fn();
}
let socket: Socket;
beforeEach(() => {
  vi.resetAllMocks(); socket = new Socket(); tls.connect.mockReturnValue(socket);
  vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_APPROVED", "true");
  vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_HOST", "scanner.example.invalid");
  vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_PORT", "3310");
  vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE", "mtls");
  vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM", "synthetic-client-certificate");
  vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM", "synthetic-client-private-key");
  vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CA_PEM", rootCertificates[0]!);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("scanner transport requires explicitly approved application access control", () => {
  it("passes paired mTLS credentials only to a hostname-verified TLS connection", async () => {
    const scanner = configuredDocumentScanner()!;
    const result = scanner.scan(new Uint8Array([1, 2, 3]));
    expect(tls.context).toHaveBeenCalledWith(expect.objectContaining({ minVersion: "TLSv1.2", rejectUnauthorized: true }));
    expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ host: "scanner.example.invalid", servername: "scanner.example.invalid",
      cert: "synthetic-client-certificate", key: "synthetic-client-private-key", ca: rootCertificates[0], rejectUnauthorized: true }));
    expect(socket.write).not.toHaveBeenCalled();
    socket.emit("secureConnect"); socket.emit("data", Buffer.from("stream: OK\0"));
    expect(await result).toBe("clean"); expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it.each(["", "public", "disabled"])('rejects absent or unsupported access mode "%s"', mode => {
    vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE", mode);
    expect(configuredDocumentScanner()).toBeNull(); expect(tls.connect).not.toHaveBeenCalled();
  });
  it.each(["CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM", "CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM"])('rejects missing pair member %s', field => {
    vi.stubEnv(field, ""); expect(configuredDocumentScanner()).toBeNull();
  });
  it("rejects malformed or mismatched crypto material without logging it", () => {
    tls.context.mockImplementation(() => { throw new Error("synthetic private crypto detail"); });
    expect(configuredDocumentScanner()).toBeNull(); expect(tls.connect).not.toHaveBeenCalled();
  });
  it("bounds private key material before the TLS parser", () => {
    vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM", "x".repeat(32769));
    expect(configuredDocumentScanner()).toBeNull(); expect(tls.context).not.toHaveBeenCalled();
  });
  it.each(["invalid CA text", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
    `${rootCertificates[0]}\ntrailing material`, `${rootCertificates[0]}\n-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----`])("rejects every malformed CA bundle before TLS context creation (%#)", ca => {
    vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CA_PEM", ca);
    expect(configuredDocumentScanner()).toBeNull(); expect(tls.context).not.toHaveBeenCalled(); expect(tls.connect).not.toHaveBeenCalled();
  });
  it("accepts a structurally valid multiple-certificate CA bundle", () => {
    vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CA_PEM", `${rootCertificates[0]}\n${rootCertificates[1]}`);
    expect(configuredDocumentScanner()).not.toBeNull(); expect(tls.context).toHaveBeenCalledOnce();
  });
  it("does not silently ignore credentials in private-network mode", () => {
    vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE", "private_network");
    expect(configuredDocumentScanner()).toBeNull();
  });
  it("allows separately approved private transport without a client certificate", () => {
    vi.stubEnv("CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE", "private_network");
    vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM", ""); vi.stubEnv("CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM", "");
    expect(configuredDocumentScanner()).not.toBeNull();
  });
  it.each(["error", "timeout", "end", "close"])("never reports a clean file after TLS %s", async event => {
    const result = configuredDocumentScanner()!.scan(new Uint8Array([1]));
    socket.emit(event, new Error("synthetic TLS failure"));
    expect(await result).toBe("failed"); expect(socket.write).not.toHaveBeenCalled();
  });
  it("keeps infection distinct from transport failure", async () => {
    const result = configuredDocumentScanner()!.scan(new Uint8Array([1]));
    socket.emit("secureConnect"); socket.emit("data", Buffer.from("stream: Eicar-Signature FOUND\0"));
    expect(await result).toBe("infected");
  });
  it("fails after 12 seconds despite a slow-drip response and ignores late success", async () => {
    vi.useFakeTimers(); const result = configuredDocumentScanner()!.scan(new Uint8Array([1]));
    socket.emit("secureConnect");
    await vi.advanceTimersByTimeAsync(5000); socket.emit("data", Buffer.from("str"));
    await vi.advanceTimersByTimeAsync(5000); socket.emit("data", Buffer.from("eam:"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe("failed"); expect(socket.destroy).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    socket.emit("data", Buffer.from(" OK\0")); expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it("ends a stalled handshake without transmitting bytes and clears a successful deadline", async () => {
    vi.useFakeTimers(); const stalled = configuredDocumentScanner()!.scan(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(12000); expect(await stalled).toBe("failed");
    socket.emit("secureConnect"); expect(socket.write).not.toHaveBeenCalled();
    socket = new Socket(); tls.connect.mockReturnValue(socket);
    const clean = configuredDocumentScanner()!.scan(new Uint8Array([1])); socket.emit("secureConnect"); socket.emit("data", Buffer.from("stream: OK\0"));
    expect(await clean).toBe("clean"); expect(vi.getTimerCount()).toBe(0);
  });
});
