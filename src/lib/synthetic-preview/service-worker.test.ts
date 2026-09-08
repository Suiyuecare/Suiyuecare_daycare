import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("synthetic preview does not install an offline worker", () => {
  it("leaves service workers untouched in a production preview build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "true");
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    expect(ServiceWorkerRegistration()).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
});
