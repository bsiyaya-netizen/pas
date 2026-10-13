import { useState } from "react";
import type { Api, PolicyDocumentKind } from "../api";
import { formatDate, formatRand } from "../format";
import { href } from "../router";
import { useLoad } from "../useLoad";

export function PolicyView({ api, policyNumber }: { api: Api; policyNumber: string }) {
  const policy = useLoad(() => api.policy(policyNumber), [api, policyNumber]);
  const [busy, setBusy] = useState<PolicyDocumentKind>();
  const [error, setError] = useState<string>();

  async function download(kind: PolicyDocumentKind) {
    setBusy(kind);
    setError(undefined);
    try {
      const url = URL.createObjectURL(await api.policyDocument(policyNumber, kind));
      const link = Object.assign(document.createElement("a"), { href: url, download: `${policyNumber}-${kind}.pdf` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  if (policy.error) return <p className="error">{policy.error}</p>;
  const p = policy.data;
  if (!p) return <p>Loading…</p>;
  const term = p.terms.at(-1)!;
  const version = term.versions.at(-1)!;

  return (
    <>
      <h1>Policy {p.policyNumber}</h1>
      <dl className="facts">
        <dt>Insurer</dt>
        <dd>{p.insurer}</dd>
        <dt>Status</dt>
        <dd>{p.status === "in_force" ? "In force" : p.status}</dd>
        <dt>Period</dt>
        <dd>
          {formatDate(term.start)} to {formatDate(term.end, -1)}, both days included
        </dd>
        <dt>Monthly premium</dt>
        <dd>{version.rating ? `${formatRand(version.rating.totalPremium)} incl. VAT` : "–"}</dd>
      </dl>
      <h2>Documents</h2>
      {error && <p className="error">{error}</p>}
      <div className="inline">
        <button disabled={busy !== undefined} onClick={() => download("schedule")}>
          {busy === "schedule" ? "Preparing…" : "Policy schedule (PDF)"}
        </button>
        <button className="secondary" disabled={busy !== undefined} onClick={() => download("certificate")}>
          {busy === "certificate" ? "Preparing…" : "Certificate of insurance (PDF)"}
        </button>
      </div>
      <p>
        <a href={href("quotes", p.quoteId)}>View the quote</a>
      </p>
    </>
  );
}
