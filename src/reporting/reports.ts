import { addDays } from "../dates.js";
import type { Client } from "../parties.js";
import { versionOn, type Policy, type TransactionType } from "../policy/policy.js";
import { readPath } from "../rating/engine.js";
import { nameLookup } from "./dashboard.js";

/**
 * Spreadsheet reports for a broker's own records and for insurer bordereaux.
 * Each returns a header row and data rows; `toCsv` writes them out.
 */

export type Cell = string | number | null;
export interface Report {
  header: string[];
  rows: Cell[][];
}

const LINE_NAMES: Record<Policy["line"], string> = { motor: "Motor", home: "Home", commercial_property: "Commercial property" };
const TYPE_NAMES: Record<TransactionType, string> = {
  new_business: "New business",
  endorsement: "Change",
  cancellation: "Cancellation",
};

/** Every policy with the cover in force on `asOf` (or, if none, its latest version). */
export function policyRegister(policies: Policy[], clients: Client[], asOf: string): Report {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const rows = [...policies]
    .sort((a, b) => a.policyNumber.localeCompare(b.policyNumber))
    .map((p): Cell[] => {
      const term = p.terms.at(-1)!;
      const version = versionOn(p, asOf) ?? term.versions.at(-1)!;
      const client = byId.get(p.clientId);
      const end = p.cancellation && p.cancellation.effectiveDate < term.end ? p.cancellation.effectiveDate : term.end;
      const vehicle = [readPath(version.risk, "vehicle.year"), readPath(version.risk, "vehicle.make"), readPath(version.risk, "vehicle.model")]
        .filter((v) => v !== undefined && v !== "")
        .join(" ");
      const value = readPath(version.risk, "vehicle.value");
      return [
        p.policyNumber,
        client?.name ?? "Unknown client",
        client?.idNumber ?? null,
        p.insurer,
        LINE_NAMES[p.line],
        status(p, asOf),
        term.start,
        addDays(end, -1),
        rand(version.rating.totalPremium),
        rand(version.rating.vat),
        rand(version.rating.commission),
        vehicle || null,
        (readPath(version.risk, "vehicle.registration") as string | undefined) ?? null,
        typeof value === "number" ? value.toFixed(2) : null,
      ];
    });
  return {
    header: [
      "Policy number",
      "Client",
      "ID number",
      "Insurer",
      "Line",
      "Status",
      "Start date",
      "Last day of cover",
      "Monthly premium (R)",
      "VAT included (R)",
      "Monthly commission (R)",
      "Vehicle",
      "Registration",
      "Sum insured (R)",
    ],
    rows,
  };
}

/** Transactions processed between two dates, both included, oldest first. */
export function transactionReport(policies: Policy[], clients: Client[], from: string, to: string): Report {
  const clientName = nameLookup(clients);
  const rows = policies
    .flatMap((p) => p.transactions.map((t) => ({ p, t })))
    .filter(({ t }) => t.processedAt.slice(0, 10) >= from && t.processedAt.slice(0, 10) <= to)
    .sort((a, b) => a.t.processedAt.localeCompare(b.t.processedAt))
    .map(({ p, t }): Cell[] => [
      t.processedAt.slice(0, 10),
      t.effectiveDate,
      p.policyNumber,
      clientName(p.clientId),
      p.insurer,
      TYPE_NAMES[t.type],
      t.description ?? null,
      rand(t.premiumDelta),
      rand(t.proRataAdjustment ?? 0),
    ]);
  return {
    header: [
      "Processed",
      "Effective",
      "Policy number",
      "Client",
      "Insurer",
      "Type",
      "Description",
      "Monthly premium change (R)",
      "Once-off amount (R)",
    ],
    rows,
  };
}

function status(p: Policy, asOf: string): string {
  if (p.cancellation) return p.cancellation.effectiveDate <= asOf ? "Cancelled" : "Cancellation pending";
  const term = p.terms.at(-1)!;
  if (asOf < term.start) return "Not started";
  if (asOf >= term.end) return "Expired";
  return "In force";
}

/** Cents as rand with two decimals and no grouping, so spreadsheets read it as a number. */
function rand(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * RFC 4180 CSV with a byte-order mark so Excel opens it as UTF-8. Text cells
 * that start with a formula character are prefixed with ' so a client name
 * cannot run as a spreadsheet formula.
 */
export function toCsv(report: Report): string {
  const cell = (value: Cell): string => {
    if (value === null) return "";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[report.header, ...report.rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
