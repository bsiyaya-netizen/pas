/** Typed calls to the PAS API. Shapes mirror the server's JSON responses. */

export interface Address {
  line1: string;
  line2?: string;
  suburb?: string;
  city: string;
  postalCode: string;
}

export interface Client {
  id: string;
  name: string;
  idNumber?: string;
  email?: string;
  phone?: string;
  address?: Address;
}

export type ClientDetails = Omit<Client, "id">;

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

export interface PolicyVersion {
  number: number;
  effectiveFrom: string;
  risk: Record<string, unknown>;
  coverages: string[];
  rating: NonNullable<QuoteOption["rating"]>;
}

export interface PolicyTransaction {
  id: string;
  type: "new_business" | "endorsement" | "cancellation";
  effectiveDate: string;
  processedAt: string;
  premiumDelta: number;
  proRataAdjustment?: number;
  description?: string;
}

export type CancellationReason = "client_request" | "vehicle_sold" | "replaced_elsewhere" | "other";

export interface Policy {
  policyNumber: string;
  quoteId: string;
  productId: string;
  insurer: string;
  line: string;
  status: "in_force" | "cancelled";
  terms: { number: number; start: string; end: string; versions: PolicyVersion[] }[];
  transactions: PolicyTransaction[];
  cancellation?: { effectiveDate: string; reason: CancellationReason; note?: string };
}

export interface ChangeRequest {
  effectiveDate: string;
  risk: Record<string, unknown>;
  coverages: string[];
  description?: string;
}

export interface EndorsementPreview {
  effectiveDate: string;
  premiumBefore: number;
  premiumAfter: number;
  proRataAdjustment: number;
  warnings: RuleHit[];
}

export interface CancellationPreview {
  effectiveDate: string;
  lastDayOfCover: string;
  refund: number;
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

export type PolicyDocumentKind = "schedule" | "certificate";

export function api(token: string) {
  async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
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
    addClient: (details: ClientDetails) => call<Client>("POST", "/clients", details),
    updateClient: (id: string, details: ClientDetails) =>
      call<Client>("PUT", `/clients/${encodeURIComponent(id)}`, details),
    products: (line: string) => call<Product[]>("GET", `/products?line=${encodeURIComponent(line)}`),
    quotes: () => call<Quote[]>("GET", "/quotes"),
    quote: (id: string) => call<Quote>("GET", `/quotes/${encodeURIComponent(id)}`),
    createQuote: (body: { clientId: string; line: string; effectiveDate: string; risk: unknown; coverages: string[] }) =>
      call<Quote>("POST", "/quotes", body),
    refer: (quoteId: string, productId: string) => call<Quote>("POST", option(quoteId, productId, "refer")),
    bind: (quoteId: string, productId: string) => call<Policy>("POST", option(quoteId, productId, "bind")),
    policy: (n: string) => call<Policy>("GET", `/policies/${encodeURIComponent(n)}`),
    /** A policy document as a PDF; fetched with the token, since a plain link would not carry it. */
    policyDocument: async (n: string, kind: PolicyDocumentKind): Promise<Blob> => {
      const res = await fetch(`${base}/policies/${encodeURIComponent(n)}/documents/${kind}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
      }
      return res.blob();
    },
    previewChange: (n: string, change: ChangeRequest) =>
      call<EndorsementPreview>("POST", `/policies/${encodeURIComponent(n)}/endorsements/preview`, change),
    change: (n: string, change: ChangeRequest) =>
      call<Policy>("POST", `/policies/${encodeURIComponent(n)}/endorsements`, change),
    previewCancellation: (n: string, effectiveDate: string) =>
      call<CancellationPreview>("POST", `/policies/${encodeURIComponent(n)}/cancellation/preview`, { effectiveDate }),
    cancel: (n: string, body: { effectiveDate: string; reason: CancellationReason; note?: string }) =>
      call<Policy>("POST", `/policies/${encodeURIComponent(n)}/cancellation`, body),
    referrals: () => call<Quote[]>("GET", "/referrals"),
    decide: (quoteId: string, productId: string, decision: "approved" | "declined", note: string) =>
      call<Quote>("POST", option(quoteId, productId, "decision"), { decision, note }),
  };
}

export type Api = ReturnType<typeof api>;
