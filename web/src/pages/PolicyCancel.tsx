import { useState } from "react";
import type { Api, CancellationPreview, CancellationReason } from "../api";
import { formatDate, formatRand } from "../format";
import { go, href } from "../router";
import { useLoad } from "../useLoad";

const REASONS: [CancellationReason, string][] = [
  ["client_request", "The client asked to cancel"],
  ["vehicle_sold", "The vehicle was sold"],
  ["replaced_elsewhere", "Replaced by another policy"],
  ["other", "Other"],
];

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/** Cancels a policy from a date, showing the pro-rata refund before confirming. */
export function PolicyCancel({ api, policyNumber }: { api: Api; policyNumber: string }) {
  const policy = useLoad(() => api.policy(policyNumber), [api, policyNumber]);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState<CancellationReason>("client_request");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<CancellationPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const p = policy.data;
  if (policy.error) return <p className="error">{policy.error}</p>;
  if (!p) return <p>Loading…</p>;
  if (p.status !== "in_force") return <p>This policy is already cancelled.</p>;
  const term = p.terms.at(-1)!;
  const earliest = [today(), term.start].sort().at(-1)!;
  const date = effectiveDate || earliest;

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(undefined);
    try {
      return await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!window.confirm(`Cancel ${p!.policyNumber}? Cover ends on ${formatDate(preview!.lastDayOfCover)}. This cannot be undone.`)) {
      return;
    }
    const done = await run(() =>
      api.cancel(policyNumber, { effectiveDate: date, reason, note: note.trim() || undefined }),
    );
    if (done) go("policies", policyNumber);
  }

  return (
    <>
      <h1>Cancel {p.policyNumber}</h1>
      <p className="muted">{p.insurer}</p>
      {error && <p className="error">{error}</p>}
      <div className="form">
        <fieldset>
          <label>
            No cover from
            <input
              type="date"
              required
              min={earliest}
              max={dayBefore(term.end)}
              value={date}
              onChange={(e) => {
                setEffectiveDate(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value as CancellationReason)}>
              {REASONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note (optional)
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
        </fieldset>
        {preview ? (
          <section className="option">
            <p>
              Cover ends on <strong>{formatDate(preview.lastDayOfCover)}</strong>. If this month's premium has been paid,{" "}
              <strong>{formatRand(preview.refund)}</strong> is due back to the client for the unused days.
            </p>
            <div className="inline">
              <button className="danger" disabled={busy} onClick={confirm}>
                {busy ? "Cancelling…" : "Cancel the policy"}
              </button>
              <button className="secondary" onClick={() => go("policies", policyNumber)}>
                Keep the policy
              </button>
            </div>
          </section>
        ) : (
          <button
            disabled={busy}
            onClick={async () => setPreview(await run(() => api.previewCancellation(policyNumber, date)))}
          >
            {busy ? "Working out the refund…" : "Work out the refund"}
          </button>
        )}
      </div>
      <p>
        <a href={href("policies", policyNumber)}>Back to the policy</a>
      </p>
    </>
  );
}
