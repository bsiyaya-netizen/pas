import type { Api } from "../api";
import { formatRand } from "../format";
import { href } from "../router";
import { useLoad } from "../useLoad";

export function PolicyView({ api, policyNumber }: { api: Api; policyNumber: string }) {
  const policy = useLoad(() => api.policy(policyNumber), [api, policyNumber]);
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
          {term.start} to {term.end}
        </dd>
        <dt>Monthly premium</dt>
        <dd>{version.rating ? `${formatRand(version.rating.totalPremium)} incl. VAT` : "–"}</dd>
      </dl>
      <p>
        <a href={href("quotes", p.quoteId)}>View the quote</a>
      </p>
    </>
  );
}
