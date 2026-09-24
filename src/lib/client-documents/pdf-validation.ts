import "server-only";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, PDFStream } from "pdf-lib";
import { IntegrationError } from "@/lib/integrations/errors";

const blockedKeys = new Set(["OpenAction", "AA", "A", "JavaScript", "JS", "EmbeddedFiles", "EF", "XFA", "AcroForm", "RichMedia", "Collection"]);
const blockedNames = new Set(["JavaScript", "Launch", "GoToR", "GoToE", "SubmitForm", "ImportData", "URI", "Movie", "Sound", "RichMedia", "EmbeddedFile", "Filespec", "PS"]);
/** Structural policy check, not a sanitizer or a replacement for antivirus.
 * pdf-lib parses compressed object streams and PDFName.decodeText resolves #xx
 * names before policy checks. Files that cannot be inspected are rejected. */
export async function validateIntakePdf(bytes: Uint8Array): Promise<void> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 200) throw new Error("unsupported page count");
    const visited = new Set<PDFObject>(); let objects = 0;
    function inspect(object: PDFObject, depth: number) {
      if (depth > 80 || ++objects > 100000) throw new Error("inspection limit");
      if (visited.has(object)) return; visited.add(object);
      if (object instanceof PDFRef) { const target = pdf.context.lookup(object); if (!target) throw new Error("unresolved reference"); inspect(target, depth + 1); }
      else if (object instanceof PDFName) { if (blockedNames.has(object.decodeText())) throw new Error("active name"); }
      else if (object instanceof PDFDict) {
        for (const [key, value] of object.entries()) { if (blockedKeys.has(key.decodeText())) throw new Error("active dictionary key"); inspect(value, depth + 1); }
      } else if (object instanceof PDFArray) { for (let i = 0; i < object.size(); i++) inspect(object.get(i), depth + 1); }
      else if (object instanceof PDFStream) inspect(object.dict, depth + 1);
    }
    for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object, 0);
    inspect(pdf.catalog, 0);
  } catch {
    throw new IntegrationError("PDF_INSPECTION_REJECTED", "PDF 無法通過結構檢查，或含互動、主動內容、內嵌檔案或加密；請列印／轉存為一般靜態 PDF 後重試。", 400);
  }
}
