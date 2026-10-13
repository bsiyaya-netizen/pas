import { useState } from "react";
import type { Api, PolicyDocumentKind } from "../api";
import { saveFile } from "../download";
import { formatDate, formatRand } from "../format";
import { href } from "../router";
import { useLoad } from "../useLoad";

const TRANSACTION_LABEL = { new_business: "Policy issued", endorsement: "Cover changed", cancellation: "Cancelled" };
const today = () => new Date().toISOString().slice(0, 10);
const signed = (cents: number) => `${cents > 0 ? "+" : ""}${formatRand(cents)}`;

export function PolicyView({ api, policyNumber }: { api: Api; policyNumber: string }) {
  const policy = useLoad(() => api.policy(policyNumber), [api, policyNumber]);
  const [busy, setBusy] = useState<PolicyDocumentKind>();
  const [error, setError] = useState<string>();

  async function download(kind: PolicyDocumentKind) {
    setBusy(kind);
    setError(undefined);
    try {
      saveFile(await api.policyDocument(policyNumber, kind), `${policyNumber}-${kind}.pdf`);
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
        <dd>
          {p.cancellation
            ? `Cancelled. Cover ends on ${formatDate(p.cancellation.effectiveDate, -1)}`
            : "In force"}
        </dd>
        <dt>Period</dt>
        <dd>
          {formatDate(term.start)} to{" "}
          {p.cancellation && p.cancellation.effectiveDate < term.end
            ? formatDate(p.cancellation.effectiveDate, -1)
            : formatDate(term.end, -1)}
          , both days included
        </dd>
        <dt>Monthly premium</dt>
        <dd>
          {formatRand(version.rating.totalPremium)} incl. VAT
          {version.number > 1 && ` from ${formatDate(version.effectiveFrom)}`}
        </dd>
      </dl>
      {p.status === "in_force" && (
        <div className="inline actions">
          <a className="button" href={href("policies", p.policyNumber, "change")}>
            Change cover
          </a>
          <a className="button secondary" href={href("policies", p.policyNumber, "cancel")}>
            Cancel policy
          </a>
        </div>
      )}
      <h2>History</h2>
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>Change</th>
            <th className="num">Monthly premium change</th>
            <th className="num">Once-off for that month</th>
          </tr>
        </thead>
        <tbody>
          {p.transactions.map((t) => (
            <tr key={t.id}>
              <td>{formatDate(t.effectiveDate)}</td>
              <td>{t.description ?? TRANSACTION_LABEL[t.type]}</td>
              <td className="num">{signed(t.premiumDelta)}</td>
              <td className="num">{t.proRataAdjustment ? signed(t.proRataAdjustment) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Documents</h2>
      {error && <p className="error">{error}</p>}
      <div className="inline">
        <button disabled={busy !== undefined} onClick={() => download("schedule")}>
          {busy === "schedule" ? "Preparing…" : "Policy schedule (PDF)"}
        </button>
        <button
          className="secondary"
          disabled={busy !== undefined || (p.cancellation && p.cancellation.effectiveDate <= today())}
          onClick={() => download("certificate")}
        >
          {busy === "certificate" ? "Preparing…" : "Certificate of insurance (PDF)"}
        </button>
      </div>
      <p>
        <a href={href("quotes", p.quoteId)}>View the quote</a>
      </p>
    </>
  );
}
