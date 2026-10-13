import { useRef, useState, type FormEvent } from "react";
import type { Api, ChangeRequest, EndorsementPreview } from "../api";
import { MotorFields, readMotor } from "../components/MotorFields";
import { formatDate, formatRand } from "../format";
import { go, href } from "../router";
import { useLoad } from "../useLoad";

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const latest = (...dates: string[]) => dates.sort().at(-1)!;

/** A mid-term change: edit the cover, preview the new premium, then confirm. */
export function PolicyChange({ api, policyNumber }: { api: Api; policyNumber: string }) {
  const policy = useLoad(() => api.policy(policyNumber), [api, policyNumber]);
  const products = useLoad(() => api.products("motor"), [api]);
  const form = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<{ request: ChangeRequest; result: EndorsementPreview }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const p = policy.data;
  if (policy.error) return <p className="error">{policy.error}</p>;
  if (!p || !products.data) return <p>Loading…</p>;
  if (p.status !== "in_force") return <p>This policy is cancelled and cannot be changed.</p>;
  const term = p.terms.at(-1)!;
  const version = term.versions.at(-1)!;
  const product = products.data.find((x) => x.id === p.productId);
  const optional = (product?.coverages ?? []).filter((c) => !c.mandatory).map((c) => [c.code, c.name] as const);
  const earliest = latest(today(), term.start, version.effectiveFrom);

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

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const request: ChangeRequest = {
      effectiveDate: String(f.get("effectiveDate")),
      description: String(f.get("description") ?? "").trim() || undefined,
      ...readMotor(f),
    };
    const result = await run(() => api.previewChange(policyNumber, request));
    if (result) setPreview({ request, result });
  }

  async function onConfirm() {
    if (!preview) return;
    const done = await run(() => api.change(policyNumber, preview.request));
    if (done) go("policies", policyNumber);
  }

  const difference = preview && preview.result.premiumAfter - preview.result.premiumBefore;

  return (
    <>
      <h1>Change cover on {p.policyNumber}</h1>
      <p className="muted">
        {p.insurer}. The change is priced on the rates this policy was written on. Currently{" "}
        {formatRand(version.rating.totalPremium)} a month.
      </p>
      {error && <p className="error">{error}</p>}
      <form ref={form} onSubmit={onPreview} onChange={() => setPreview(undefined)} className="form">
        <fieldset>
          <legend>The change</legend>
          <label>
            Change applies from
            <input type="date" name="effectiveDate" required min={earliest} max={dayBefore(term.end)} defaultValue={earliest} />
          </label>
          <label>
            What is changing (optional)
            <input name="description" maxLength={500} placeholder="e.g. Client bought a new car" />
          </label>
        </fieldset>
        <MotorFields optionalCovers={optional} risk={version.risk} coverages={version.coverages} />

        {preview && difference !== undefined ? (
          <section className="option">
            <h2>New premium from {formatDate(preview.result.effectiveDate)}</h2>
            <table className="compact">
              <tbody>
                <tr>
                  <td>Monthly premium now</td>
                  <td className="num">{formatRand(preview.result.premiumBefore)}</td>
                </tr>
                <tr>
                  <td>Monthly premium after the change</td>
                  <td className="num">
                    <strong>{formatRand(preview.result.premiumAfter)}</strong>
                  </td>
                </tr>
                <tr className="muted">
                  <td>
                    {preview.result.proRataAdjustment >= 0 ? "Extra to collect" : "To refund"} for the rest of this month
                  </td>
                  <td className="num">{formatRand(Math.abs(preview.result.proRataAdjustment))}</td>
                </tr>
              </tbody>
            </table>
            {preview.result.warnings.length > 0 && (
              <ul className="hits">
                {preview.result.warnings.map((h) => (
                  <li key={h.ruleId} className={h.outcome}>
                    {h.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="inline">
              <button type="button" disabled={busy} onClick={onConfirm}>
                {busy ? "Saving…" : "Confirm change"}
              </button>
              <span className="muted">Edit any field to price again.</span>
            </div>
          </section>
        ) : (
          <button type="submit" disabled={busy}>
            {busy ? "Pricing…" : "Price the change"}
          </button>
        )}
      </form>
      <p>
        <a href={href("policies", policyNumber)}>Back to the policy</a>
      </p>
    </>
  );
}
