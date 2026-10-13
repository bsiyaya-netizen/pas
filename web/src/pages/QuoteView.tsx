import { useState } from "react";
import type { Api, QuoteOption } from "../api";
import { formatRand, optionStatus, STATUS_LABEL } from "../format";
import { go, href } from "../router";
import { useLoad } from "../useLoad";

export function QuoteView({ api, quoteId }: { api: Api; quoteId: string }) {
  const quote = useLoad(() => api.quote(quoteId), [api, quoteId]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function act(option: QuoteOption, action: "refer" | "bind") {
    if (action === "bind" && !window.confirm(`Bind cover with ${option.insurer}? This issues the policy.`)) return;
    setBusy(true);
    setError(undefined);
    try {
      if (action === "refer") quote.setData(await api.refer(quoteId, option.productId));
      else go("policies", (await api.bind(quoteId, option.productId)).policyNumber);
    } catch (e) {
      setError((e as Error).message);
      quote.reload();
    } finally {
      setBusy(false);
    }
  }

  if (quote.error) return <p className="error">{quote.error}</p>;
  const q = quote.data;
  if (!q) return <p>Loading…</p>;

  return (
    <>
      <h1>Motor quote</h1>
      <p className="muted">
        Cover from {q.effectiveDate}. {q.status === "bound" ? "Bound." : `Valid until ${q.expiresOn}.`}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="options">
        {q.options.map((o) => {
          const status = optionStatus(o);
          return (
            <section key={o.productId} className="option">
              <header>
                <h2>{o.insurer}</h2>
                <span className={`badge ${status}`}>
                  {q.boundProductId === o.productId ? "Bound" : STATUS_LABEL[status]}
                </span>
              </header>
              {o.rating ? (
                <>
                  <p className="premium">
                    {formatRand(o.rating.totalPremium)} <small>per month incl. VAT</small>
                  </p>
                  <table className="compact">
                    <tbody>
                      {o.rating.coverages.map((c) => (
                        <tr key={c.code}>
                          <td>{c.name}</td>
                          <td className="num">{formatRand(c.premium)}</td>
                        </tr>
                      ))}
                      {o.rating.minimumPremiumAdjustment > 0 && (
                        <tr>
                          <td>Minimum premium top-up</td>
                          <td className="num">{formatRand(o.rating.minimumPremiumAdjustment)}</td>
                        </tr>
                      )}
                      <tr className="muted">
                        <td>VAT included</td>
                        <td className="num">{formatRand(o.rating.vat)}</td>
                      </tr>
                      <tr className="muted">
                        <td>Your commission</td>
                        <td className="num">{formatRand(o.rating.commission)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="muted">{o.error}</p>
              )}
              {o.underwriting && o.underwriting.hits.length > 0 && (
                <ul className="hits">
                  {o.underwriting.hits.map((h) => (
                    <li key={h.ruleId} className={h.outcome}>
                      {h.message}
                    </li>
                  ))}
                </ul>
              )}
              {o.referral?.note && <p className="note">Underwriter: {o.referral.note}</p>}
              {q.status === "open" && status === "needs_referral" && (
                <button disabled={busy} onClick={() => act(o, "refer")}>
                  Refer to {o.insurer}
                </button>
              )}
              {q.status === "open" && status === "bindable" && (
                <button disabled={busy} onClick={() => act(o, "bind")}>
                  Bind
                </button>
              )}
            </section>
          );
        })}
      </div>
      <p>
        <a href={href("quotes")}>Back to quotes</a>
      </p>
    </>
  );
}
