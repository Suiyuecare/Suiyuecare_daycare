import { describe, expect, it } from "vitest";
import { CareWriteAttempt } from "./write-attempt";
describe("uncertain care writes", () => {
  it("freezes exact body and key even if the original object is later changed", () => {
    const attempt = new CareWriteAttempt(); const body = { values: { pulse: 75 } };
    attempt.prepare(body, "original-key"); body.values.pulse = 90; attempt.failed();
    expect(attempt.prepare({ values: { pulse: 99 } }, "new-key")).toEqual({ body: { values: { pulse: 75 } }, serialized: '{"values":{"pulse":75}}', key: "original-key" });
  });
  it.each([400, 422])("may unlock a first definitive %s rejection", (status) => {
    const attempt = new CareWriteAttempt(); attempt.prepare({ value: 1 }, "key"); expect(attempt.failed(status)).toBeNull();
  });
  it.each([400, 422, 401, 403, 409, 500])("never unlocks after an unknown result even on later %s", (status) => {
    const attempt = new CareWriteAttempt(); attempt.prepare({ value: 1 }, "key"); attempt.failed(); expect(attempt.failed(status)?.key).toBe("key");
  });
  it("only a verified success clears an uncertain attempt", () => {
    const attempt = new CareWriteAttempt(); attempt.prepare({ value: 1 }, "key"); attempt.failed(); attempt.confirmed(); expect(attempt.current()).toBeNull();
  });
});
