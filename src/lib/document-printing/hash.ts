import "server-only";

import { payloadHash } from "@/lib/integrations/security";

import { parseDocumentRenderModel } from "./parser";

export function documentRenderModelHash(value: unknown) {
  return payloadHash(parseDocumentRenderModel(value));
}
