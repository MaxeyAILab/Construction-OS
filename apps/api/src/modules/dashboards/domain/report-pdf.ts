import PDFDocument from "pdfkit";

export interface ReportPdfRow {
  label: string;
  value: string;
}

export interface ReportPdfData {
  title: string;
  generatedAt: string;
  rows: ReportPdfRow[];
}

// database.md §21: "Runs: generated artifacts (object_key of PDF/XLSX...)."
// A flat label/value layout — api.md doesn't specify a report layout
// beyond "artifact", so this renders exactly the same fields
// DashboardsService.getCompany/getProject already expose on screen,
// same "simplified, not a reproduction of a specific form" precedent as
// Payment Applications' renderPaymentApplicationPdf. XLSX is flagged, not
// built this pass (see dashboards.ts schema's report_runs comment).
export function renderReportPdf(data: ReportPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "letter" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(data.title, { align: "center" });
    doc.fontSize(10).text(`Generated ${data.generatedAt}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(11);
    for (const row of data.rows) {
      doc.text(`${row.label}: ${row.value}`);
    }

    doc.end();
  });
}
