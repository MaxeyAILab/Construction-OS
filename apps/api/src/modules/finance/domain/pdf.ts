import PDFDocument from "pdfkit";

export interface PaymentApplicationPdfLine {
  costCodeCode: string;
  costCodeName: string;
  scheduledValue: string;
  previousCompleted: string;
  thisPeriod: string;
  materialsStored: string;
  completedToDate: string;
  retainagePct: string;
  retainageAmount: string;
}

export interface PaymentApplicationPdfData {
  projectName: string;
  projectCode: string;
  periodNumber: number;
  periodEndDate: string;
  lines: PaymentApplicationPdfLine[];
  totalScheduledValue: string;
  totalCompletedAndStored: string;
  totalRetainage: string;
  currentPaymentDue: string;
}

// spec.md §17.14/database.md §11 (FR-FIN-4): "AIA-style" progress billing
// — a simplified G702/G703 layout (summary + per-cost-code schedule of
// values), not a reproduction of the copyrighted AIA G702/G703 forms
// themselves.
export function renderPaymentApplicationPdf(data: PaymentApplicationPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "letter" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("Application and Certificate for Payment", { align: "center" });
    doc.fontSize(10).text("(AIA-style — not the AIA G702/G703 form)", { align: "center" });
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Project: ${data.projectName} (${data.projectCode})`);
    doc.text(`Application No.: ${data.periodNumber}`);
    doc.text(`Period Ending: ${data.periodEndDate}`);
    doc.moveDown();

    const columns = [
      { label: "Cost Code", width: 90 },
      { label: "Scheduled Value", width: 70 },
      { label: "Previous", width: 60 },
      { label: "This Period", width: 60 },
      { label: "Stored", width: 55 },
      { label: "Completed to Date", width: 70 },
      { label: "Retainage", width: 60 },
    ];
    const startX = doc.x;
    let y = doc.y;

    doc.fontSize(9).font("Helvetica-Bold");
    let x = startX;
    for (const col of columns) {
      doc.text(col.label, x, y, { width: col.width });
      x += col.width;
    }
    y += 16;
    doc.font("Helvetica");

    for (const line of data.lines) {
      x = startX;
      const cells = [
        `${line.costCodeCode} ${line.costCodeName}`,
        line.scheduledValue,
        line.previousCompleted,
        line.thisPeriod,
        line.materialsStored,
        line.completedToDate,
        `${line.retainagePct}% (${line.retainageAmount})`,
      ];
      for (let i = 0; i < columns.length; i++) {
        doc.text(cells[i]!, x, y, { width: columns[i]!.width });
        x += columns[i]!.width;
      }
      y += 16;
    }

    y += 8;
    doc.font("Helvetica-Bold");
    doc.text(`Total Scheduled Value: ${data.totalScheduledValue}`, startX, y);
    y += 16;
    doc.text(`Total Completed and Stored to Date: ${data.totalCompletedAndStored}`, startX, y);
    y += 16;
    doc.text(`Total Retainage: ${data.totalRetainage}`, startX, y);
    y += 16;
    doc.text(`Current Payment Due: ${data.currentPaymentDue}`, startX, y);

    doc.end();
  });
}
