import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDate, formatPercent, formatRand, type PolicyDocument } from "./policy-document.js";

/**
 * Lays out policy documents as A4 PDFs with the built-in Helvetica fonts, so
 * nothing needs to be installed or stored: documents are produced on request
 * from the policy record and always match it.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);

class Layout {
  private page!: PDFPage;
  private y = 0;
  readonly width = A4[0] - 2 * MARGIN;

  private constructor(
    readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly footer: string,
  ) {
    this.newPage();
  }

  static async create(title: string, footer: string): Promise<Layout> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    pdf.setCreator("PAS");
    pdf.setProducer("PAS");
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return new Layout(pdf, regular, bold, footer);
  }

  private newPage() {
    this.page = this.pdf.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  /** Starts a new page unless the next `height` points fit on this one. */
  private room(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  /** Drops characters the standard PDF fonts cannot draw, rather than failing. */
  private clean(text: string, font: PDFFont): string {
    const supported = new Set(font.getCharacterSet());
    return [...text.normalize("NFC")].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  }

  private draw(text: string, x: number, size: number, font: PDFFont, color = INK) {
    this.page.drawText(this.clean(text, font), { x, y: this.y, size, font, color });
  }

  private wrap(text: string, size: number, font: PDFFont, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of this.clean(text, font).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  title(text: string, subtitle?: string) {
    this.draw(text, MARGIN, 20, this.bold);
    this.y -= 18;
    if (subtitle) {
      this.draw(subtitle, MARGIN, 10, this.regular, MUTED);
      this.y -= 14;
    }
    this.y -= 10;
  }

  heading(text: string) {
    this.room(40);
    this.y -= 8;
    this.draw(text, MARGIN, 12, this.bold);
    this.y -= 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + this.width, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 14;
  }

  /** Label on the left, value beside it; long values wrap. */
  field(label: string, value: string, labelWidth = 170) {
    const lines = this.wrap(value, 10, this.regular, this.width - labelWidth);
    this.room(lines.length * 13 + 2);
    this.draw(label, MARGIN, 10, this.regular, MUTED);
    lines.forEach((line, i) => {
      if (i > 0) this.y -= 13;
      this.draw(line, MARGIN + labelWidth, 10, this.regular);
    });
    this.y -= 15;
  }

  /** A row with text on the left and an amount right-aligned. */
  amount(label: string, value: string, { bold = false, muted = false } = {}) {
    this.room(15);
    const font = bold ? this.bold : this.regular;
    const color = muted ? MUTED : INK;
    this.draw(label, MARGIN, 10, font, color);
    const clean = this.clean(value, font);
    this.page.drawText(clean, {
      x: MARGIN + this.width - font.widthOfTextAtSize(clean, 10),
      y: this.y,
      size: 10,
      font,
      color,
    });
    this.y -= 15;
  }

  paragraph(text: string, { size = 9.5, color = INK } = {}) {
    const lines = this.wrap(text, size, this.regular, this.width);
    for (const line of lines) {
      this.room(size + 4);
      this.draw(line, MARGIN, size, this.regular, color);
      this.y -= size + 3.5;
    }
    this.y -= 5;
  }

  async save(): Promise<Uint8Array> {
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      const text = this.clean(`${this.footer}   |   Page ${i + 1} of ${pages.length}`, this.regular);
      page.drawText(text, { x: MARGIN, y: MARGIN - 20, size: 8, font: this.regular, color: MUTED });
    });
    return this.pdf.save();
  }
}

function insurerLine(doc: PolicyDocument): string {
  const { name, registeredName, fspNumber } = doc.insurer;
  const legal = registeredName && registeredName !== name ? `${registeredName}` : name;
  return fspNumber ? `${legal}, FSP ${fspNumber}` : legal;
}

/** The policy schedule: who and what is insured, the cover, the premium and the disclosures. */
export async function renderSchedule(doc: PolicyDocument): Promise<Uint8Array> {
  const layout = await Layout.create(
    `Policy schedule ${doc.policyNumber}`,
    `Policy schedule ${doc.policyNumber}, issued ${formatDate(doc.issuedOn)}`,
  );
  layout.title("Policy schedule", `${doc.lineName} insurance | ${doc.productName}`);

  layout.heading("Policy");
  layout.field("Policy number", doc.policyNumber);
  layout.field("Policyholder", doc.insured.name);
  layout.field("Period of insurance", `${formatDate(doc.term.from)} to ${formatDate(doc.term.to)}, both days included`);
  layout.field("Schedule effective from", `${formatDate(doc.version.effectiveFrom)} (version ${doc.version.number})`);
  layout.field("Date issued", formatDate(doc.issuedOn));
  layout.field("Insurer", insurerLine(doc));
  layout.field("Broker", `${doc.broker.name}, FSP ${doc.broker.fspNumber}`);

  for (const group of doc.risk) {
    layout.heading(group.heading);
    for (const [label, value] of group.rows) layout.field(label, value);
  }

  layout.heading("Cover and monthly premium");
  for (const section of doc.sections) layout.amount(section.name, formatRand(section.premium));
  if (doc.minimumPremiumAdjustment > 0) {
    layout.amount("Minimum premium adjustment", formatRand(doc.minimumPremiumAdjustment));
  }
  layout.amount("Total monthly premium", formatRand(doc.premium.total), { bold: true });
  layout.amount(`Includes VAT at ${formatPercent(doc.premium.vatRate)}`, formatRand(doc.premium.vat), { muted: true });

  layout.heading("Important information");
  const excluded = doc.commission.excludedSections;
  layout.paragraph(
    `Broker commission: ${doc.broker.name} is paid commission of ${formatRand(doc.commission.monthly)} a month by the insurer. ` +
      `This is ${formatPercent(doc.commission.rate)} of the premium excluding VAT` +
      (excluded.length ? `, not counting ${excluded.join(" and ")}, which carries no commission.` : "."),
  );
  if (doc.sections.some((s) => s.code === "sasria")) {
    layout.paragraph(
      "SASRIA cover for riot, strike, civil commotion and terrorism is underwritten by SASRIA SOC Ltd and collected by the insurer on its behalf.",
    );
  }
  layout.paragraph(
    "Read this schedule together with the policy wording, which sets out the cover, conditions and exclusions. " +
      "Check every detail and tell your broker straight away if anything is wrong or changes, because incorrect information can affect claims.",
  );
  layout.paragraph(
    "Complaints: please contact your broker or the insurer first. If your complaint is not resolved, you can contact " +
      "the Ombudsman for Short-term Insurance (www.osti.org.za) about the insurer, or the FAIS Ombud (www.faisombud.co.za) " +
      "about the advice or service you received from your broker.",
  );
  return layout.save();
}

/** A one-page confirmation that cover is in force, for finance houses, landlords and others. */
export async function renderCertificate(doc: PolicyDocument): Promise<Uint8Array> {
  const layout = await Layout.create(
    `Certificate of insurance ${doc.policyNumber}`,
    `Certificate of insurance ${doc.policyNumber}, issued ${formatDate(doc.issuedOn)}`,
  );
  layout.title("Certificate of insurance", `${doc.lineName} insurance`);
  const status =
    doc.issuedOn < doc.term.from
      ? `has been issued and starts on ${formatDate(doc.term.from)}`
      : `is in force on ${formatDate(doc.issuedOn)}`;
  layout.paragraph(
    `This certifies that the insurance described below ${status}, ` +
      "subject to the terms, conditions and exclusions of the policy.",
  );

  layout.heading("Cover");
  layout.field("Policy number", doc.policyNumber);
  layout.field("Policyholder", doc.insured.name);
  layout.field("Insurer", insurerLine(doc));
  layout.field("Period of insurance", `${formatDate(doc.term.from)} to ${formatDate(doc.term.to)}, both days included`);
  layout.field("Cover", doc.sections.map((s) => s.name).join(", "));
  if (doc.sumInsured !== undefined) layout.field("Sum insured", formatRand(doc.sumInsured, { cents: false }));

  const insured = doc.risk.find((g) => g.heading === "Vehicle");
  if (insured) {
    layout.heading(insured.heading);
    for (const [label, value] of insured.rows) if (label !== "Sum insured") layout.field(label, value);
  }

  layout.heading("Issued by");
  layout.field("Broker", `${doc.broker.name}, FSP ${doc.broker.fspNumber}`);
  layout.field("Date issued", formatDate(doc.issuedOn));
  layout.paragraph(
    "This certificate confirms cover only as at the date of issue. It is not the policy, does not change the cover, " +
      "and gives the holder no rights under the policy. Cover can end early, for example if premiums are not paid.",
    { color: MUTED, size: 9 },
  );
  return layout.save();
}
