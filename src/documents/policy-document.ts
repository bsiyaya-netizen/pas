import type { Policy, PolicyTerm, PolicyVersion } from "../policy/policy.js";
import type { Product } from "../product/schema.js";
import type { Address, Broker, Client } from "../parties.js";
import { addDays } from "../dates.js";
import { readPath } from "../rating/engine.js";

/**
 * Everything printed on a policy schedule or certificate, gathered from the
 * policy, its parties and the product version it was rated on. Building this is
 * pure, so the wording is tested here and the PDF renderer only lays it out.
 */
export interface PolicyDocument {
  policyNumber: string;
  issuedOn: string;
  lineName: string;
  productName: string;
  insured: { name: string; idNumber?: string; address?: string; contact?: string };
  broker: { name: string; fspNumber: string };
  insurer: { name: string; registeredName?: string; fspNumber?: string };
  term: { number: number; from: string; to: string };
  version: { number: number; effectiveFrom: string };
  /** Monthly amounts in cents. */
  premium: { total: number; vat: number; excludingVat: number; vatRate: number };
  sections: { code: string; name: string; premium: number }[];
  minimumPremiumAdjustment: number;
  commission: { rate: number; monthly: number; excludedSections: string[] };
  /** Grouped risk details, e.g. "Vehicle" -> [["Value", "R300 000"], ...]. */
  risk: { heading: string; rows: [string, string][] }[];
  /** The main amount insured in cents, where the line has one (motor: vehicle value). */
  sumInsured?: number;
}

export interface DocumentParties {
  broker: Broker;
  client: Client;
  product: Product;
  /** ISO date the document is produced. */
  issuedOn: string;
}

const LINE_NAMES: Record<Policy["line"], string> = {
  motor: "Motor",
  home: "Home",
  commercial_property: "Commercial property",
};

/** The latest version of the latest term: what the policy looks like now. */
export function currentCover(policy: Policy): { term: PolicyTerm; version: PolicyVersion } {
  const term = policy.terms.at(-1);
  const version = term?.versions.at(-1);
  if (!term || !version) throw new Error(`Policy ${policy.policyNumber} has no cover`);
  return { term, version };
}

export function policyDocument(policy: Policy, parties: DocumentParties): PolicyDocument {
  const { broker, client, product, issuedOn } = parties;
  const { term, version } = currentCover(policy);
  const rating = version.rating;
  const excluded = new Set(product.commission.excludedCoverages);

  return {
    policyNumber: policy.policyNumber,
    issuedOn,
    lineName: LINE_NAMES[policy.line],
    productName: product.name,
    insured: {
      name: client.name,
      ...(client.idNumber && { idNumber: client.idNumber }),
      ...(client.address && { address: formatAddress(client.address) }),
      ...((client.phone || client.email) && { contact: [client.phone, client.email].filter(Boolean).join(", ") }),
    },
    broker: { name: broker.name, fspNumber: broker.fspNumber },
    insurer: { name: policy.insurer, ...product.insurerDetails },
    term: { number: term.number, from: term.start, to: addDays(term.end, -1) },
    version: { number: version.number, effectiveFrom: version.effectiveFrom },
    premium: {
      total: rating.totalPremium,
      vat: rating.vat,
      excludingVat: rating.totalExcludingVat,
      vatRate: product.tax.vatRate,
    },
    sections: rating.coverages.map((c) => ({ code: c.code, name: c.name, premium: c.premium })),
    minimumPremiumAdjustment: rating.minimumPremiumAdjustment,
    commission: {
      rate: rating.commissionRate,
      monthly: rating.commission,
      excludedSections: rating.coverages.filter((c) => excluded.has(c.code)).map((c) => c.name),
    },
    ...riskDetails(policy.line, version.risk),
  };
}

function riskDetails(line: Policy["line"], risk: Record<string, unknown>): Pick<PolicyDocument, "risk" | "sumInsured"> {
  if (line === "motor") return motorDetails(risk);
  // Home and commercial property get their own layouts with their capture forms.
  return { risk: [{ heading: "Risk details", rows: flatten(risk) }] };
}

const TERRITORIES: Record<string, string> = {
  gauteng: "Gauteng",
  western_cape: "Western Cape",
  kwazulu_natal: "KwaZulu-Natal",
  other: "Other province",
};

function motorDetails(risk: Record<string, unknown>): Pick<PolicyDocument, "risk" | "sumInsured"> {
  const read = (path: string) => readPath(risk, path);
  const value = read("vehicle.value");
  const sumInsured = typeof value === "number" ? Math.round(value * 100) : undefined;
  const rows = (pairs: [string, string | undefined][]) =>
    pairs.filter((p): p is [string, string] => p[1] !== undefined);

  return {
    sumInsured,
    risk: [
      {
        heading: "Vehicle",
        rows: rows([
          ["Vehicle", vehicleName(read("vehicle.year"), read("vehicle.make"), read("vehicle.model"))],
          ["Registration", text(read("vehicle.registration"))],
          ["Sum insured", sumInsured === undefined ? undefined : formatRand(sumInsured, { cents: false })],
          ["Use", read("vehicle.use") === "business" ? "Business" : read("vehicle.use") === "private" ? "Private" : text(read("vehicle.use"))],
          ["Kept overnight in", TERRITORIES[String(read("territory"))] ?? text(read("territory"))],
        ]),
      },
      {
        heading: "Regular driver",
        rows: rows([
          ["Age", text(read("driver.age"))],
          ["Claims in the last 3 years", text(read("driver.claimsLast3Years"))],
          ["Licence issued", typeof read("driver.licenceDate") === "string" ? formatDate(read("driver.licenceDate") as string) : undefined],
        ]),
      },
      {
        heading: "Excess",
        rows: rows([
          ["Basic excess per claim", typeof read("excessOption") === "number" ? formatRand((read("excessOption") as number) * 100, { cents: false }) : undefined],
        ]),
      },
    ].filter((group) => group.rows.length > 0),
  };
}

function vehicleName(...parts: unknown[]): string | undefined {
  const name = parts.filter((p) => p !== undefined && p !== null && p !== "").join(" ");
  return name || undefined;
}

export function formatAddress(address: Address): string {
  return [address.line1, address.line2, address.suburb, address.city, address.postalCode].filter(Boolean).join(", ");
}

function text(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function flatten(data: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(data).flatMap(([key, value]): [string, string][] => {
    const label = `${prefix}${humanise(key)}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return flatten(value as Record<string, unknown>, `${label}: `);
    }
    return [[label, Array.isArray(value) ? value.join(", ") : String(value)]];
  });
}

function humanise(key: string): string {
  const words = key.replace(/_/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "R1 012.50", or "R300 000" without cents; thousands are grouped with a space. */
export function formatRand(cents: number, { cents: showCents = true } = {}): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rand = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return showCents ? `${sign}R${rand}.${String(abs % 100).padStart(2, "0")}` : `${sign}R${rand}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "14 October 2026" from an ISO date. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

export function formatPercent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}
