import { IntegrationError } from "./errors";
import { assertSafeNotificationCopy } from "./notifications";

export interface SmsMessage {
  to: string;
  body: string;
  idempotencyKey: string;
}

export interface SmsReceipt {
  status: "sent" | "suppressed";
  providerMessageId: string | null;
  demo: boolean;
}

export interface SmsProvider {
  readonly providerKey: string;
  send(message: SmsMessage): Promise<SmsReceipt>;
}

export class MockSmsProvider implements SmsProvider {
  readonly providerKey = "mock";

  constructor(private readonly allowSimulatedDelivery = false) {}

  async send(message: SmsMessage): Promise<SmsReceipt> {
    assertSafeNotificationCopy("系統通知", message.body);
    if (!/^09\d{8}$/u.test(message.to)) {
      throw new IntegrationError(
        "INVALID_SMS_RECIPIENT",
        "簡訊收件門號格式錯誤。",
        400,
        "to",
      );
    }
    if (!message.idempotencyKey) {
      throw new IntegrationError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "簡訊發送需要冪等鍵。",
        400,
        "idempotency_key",
      );
    }
    return this.allowSimulatedDelivery
      ? {
          status: "sent",
          providerMessageId: `mock-${message.idempotencyKey}`,
          demo: true,
        }
      : { status: "suppressed", providerMessageId: null, demo: true };
  }
}

export async function getSmsProvider(): Promise<SmsProvider> {
  const { env, isDemoMode } = await import("@/lib/env");
  if (env.SMS_PROVIDER === "mock" && isDemoMode()) {
    return new MockSmsProvider(false);
  }
  throw new IntegrationError(
    "SMS_PROVIDER_NOT_CONFIGURED",
    "正式簡訊供應商尚未通過設定與驗收。",
    503,
  );
}
