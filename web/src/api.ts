/** Typed calls to the PAS API. Shapes mirror the server's JSON responses. */

export interface Client {
  id: string;
  name: string;
}

export interface RuleHit {
  ruleId: string;
  outcome: "decline" | "refer" | "warn";
  message: string;
  authority?: number;
}

export interface CoverageResult {
  code: string;
  name: string;
  premium: number;
}

export interface QuoteOption {
  productId: string;
  insurer: string;
  error?: string;
  rating?: {
    coverages: CoverageResult[];
    totalPremium: number;
    vat: number;
    commission: number;
    minimumPremiumAdjustment: number;
  };
  underwriting?: { outcome: "accept" | "refer" | "decline"; hits: RuleHit[] };
  referral?: { status: "pending" | "approved" | "declined"; requiredAuthority: number; note?: string };
}

export interface Quote {
  id: string;
  clientId: string;
  line: string;
  effectiveDate: string;
  expiresOn: string;
  createdAt: string;
  status: "open" | "bound";
  boundProductId?: string;
  risk: Record<string, unknown>;
  options: QuoteOption[];
}

export interface Policy {
  policyNumber: string;
  quoteId: string;
  insurer: string;
  line: string;
  status: string;
  terms: { number: number; start: string; end: string; versions: { number: number; rating: QuoteOption["rating"] }[] }[];
}

export interface Product {
  id: string;
  insurer: string;
  name: string;
  coverages: { code: string; name: string; mandatory: boolean }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const base = import.meta.env.VITE_API_BASE ?? "/api";

export function api(token: string) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
    return data as T;
  }

  const option = (quoteId: string, productId: string, action: string) =>
    `/quotes/${encodeURIComponent(quoteId)}/options/${encodeURIComponent(productId)}/${action}`;

  return {
    clients: () => call<Client[]>("GET", "/clients"),
    addClient: (name: string) => call<Client>("POST", "/clients", { name }),
    products: (line: string) => call<Product[]>("GET", `/products?line=${encodeURIComponent(line)}`),
    quotes: () => call<Quote[]>("GET", "/quotes"),
    quote: (id: string) => call<Quote>("GET", `/quotes/${encodeURIComponent(id)}`),
    createQuote: (body: { clientId: string; line: string; effectiveDate: string; risk: unknown; coverages: string[] }) =>
      call<Quote>("POST", "/quotes", body),
    refer: (quoteId: string, productId: string) => call<Quote>("POST", option(quoteId, productId, "refer")),
    bind: (quoteId: string, productId: string) => call<Policy>("POST", option(quoteId, productId, "bind")),
    policy: (n: string) => call<Policy>("GET", `/policies/${encodeURIComponent(n)}`),
    referrals: () => call<Quote[]>("GET", "/referrals"),
    decide: (quoteId: string, productId: string, decision: "approved" | "declined", note: string) =>
      call<Quote>("POST", option(quoteId, productId, "decision"), { decision, note }),
  };
}

export type Api = ReturnType<typeof api>;
