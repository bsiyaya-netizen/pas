import { useState } from "react";
import type { Api, Quote, QuoteOption } from "../api";
import { formatRand } from "../format";
import { useLoad } from "../useLoad";

type Decide = (q: Quote, o: QuoteOption, d: "approved" | "declined", note: string) => Promise<void>;

/** The underwriter's queue: options from their insurer waiting on a decision. */
export function Referrals({ api }: { api: Api }) {
  const queue = useLoad(() => api.referrals(), [api]);
  const [error, setError] = useState<string>();

  const decide: Decide = async (quote, option, decision, note) => {
    setError(undefined);
    try {
      await api.decide(quote.id, option.productId, decision, note);
      queue.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const items = (queue.data ?? []).flatMap((q) =>
    q.options.filter((o) => o.referral?.status === "pending").map((o) => ({ q, o })),
  );

  return (
    <>
      <h1>Referrals</h1>
      {(error ?? queue.error) && <p className="error">{error ?? queue.error}</p>}
      {queue.data && items.length === 0 && <p>No referrals waiting.</p>}
      {items.map(({ q, o }) => (
        <Referral key={`${q.id}/${o.productId}`} quote={q} option={o} onDecide={decide} />
      ))}
    </>
  );
}

function Referral({ quote, option, onDecide }: { quote: Quote; option: QuoteOption; onDecide: Decide }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (decision: "approved" | "declined") => {
    setBusy(true);
    await onDecide(quote, option, decision, note);
    setBusy(false);
  };

  return (
    <section className="option">
      <header>
        <h2>
          {option.insurer}: {quote.line} cover from {quote.effectiveDate}
        </h2>
        <span className="badge referred">Needs authority {option.referral?.requiredAuthority}</span>
      </header>
      {option.rating && <p className="premium">{formatRand(option.rating.totalPremium)} per month</p>}
      <ul className="hits">
        {option.underwriting?.hits.map((h) => (
          <li key={h.ruleId} className={h.outcome}>
            {h.message}
          </li>
        ))}
      </ul>
      <details>
        <summary>Risk details</summary>
        <pre>{JSON.stringify(quote.risk, null, 2)}</pre>
      </details>
      <textarea placeholder="Decision note (required)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="inline">
        <button disabled={busy || !note.trim()} onClick={() => run("approved")}>
          Approve
        </button>
        <button className="secondary" disabled={busy || !note.trim()} onClick={() => run("declined")}>
          Decline
        </button>
      </div>
    </section>
  );
}
