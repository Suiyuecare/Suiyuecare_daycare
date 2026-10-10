import { IntegrationError } from "@/lib/integrations/errors";

/** These candidate mutations are only called by the same-origin app. */
export function assertJuboReviewJsonRequest(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new IntegrationError("JUBO_REVIEW_ORIGIN_DENIED", "請從日照系統的覆核頁操作。", 403);
  }
  if (!/^application\/json(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) {
    throw new IntegrationError("JUBO_REVIEW_JSON_REQUIRED", "請從覆核頁送出表單。", 415);
  }
}
