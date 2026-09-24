import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
vi.mock("server-only", () => ({}));
import { validateIntakePdf } from "./pdf-validation";
function escapedActionPdf() {
  const header = "%PDF-1.4\n";
  const objects = ["<< /Type /Catalog /Pages 2 0 R /Open#41ction << /S /Java#53cript /J#53 () >> >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources <<>> >>"];
  let body = header; const offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
describe("parsed static PDF policy", () => {
  it("accepts a valid static one-page document", async () => { const pdf = await PDFDocument.create(); pdf.addPage([200, 200]); await expect(validateIntakePdf(await pdf.save())).resolves.toBeUndefined(); });
  it("rejects correctly offset PDF with escaped names missed by raw regex", async () => {
    const bytes = escapedActionPdf(); expect(/\/(?:JavaScript|JS|OpenAction)\b/i.test(bytes.toString("latin1"))).toBe(false);
    await expect(validateIntakePdf(bytes)).rejects.toMatchObject({ code: "PDF_INSPECTION_REJECTED" });
  });
  it("inspects compressed object-stream actions", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([200, 200]);
    const action = pdf.context.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of("") });
    pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.register(action));
    const bytes = await pdf.save({ useObjectStreams: true });
    expect(Buffer.from(bytes).toString("latin1")).toContain("/ObjStm");
    await expect(validateIntakePdf(bytes)).rejects.toMatchObject({ code: "PDF_INSPECTION_REJECTED" });
  });
  it("rejects malformed or encrypted PDFs instead of assuming scan-clean is enough", async () => {
    await expect(validateIntakePdf(Buffer.from("%PDF-1.7\nbroken\n%%EOF"))).rejects.toMatchObject({ code: "PDF_INSPECTION_REJECTED" });
    const bytes = escapedActionPdf().toString("latin1").replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 2 0 R");
    await expect(validateIntakePdf(Buffer.from(bytes))).rejects.toMatchObject({ code: "PDF_INSPECTION_REJECTED" });
  });
});
