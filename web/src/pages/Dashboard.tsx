import { useState } from "react";
import type { Api } from "../api";
import { MonthlyBars, monthLabel } from "../components/MonthlyBars";
import { saveFile } from "../download";
import { formatDate, formatRand } from "../format";
import { href } from "../router";
import { useLoad } from "../useLoad";

const TYPE_LABEL = {
  new_business: "New policy",
  endorsement: "Change",
  cancellation: "Cancellation",
};

/** "R12k" style axis ticks for cents. */
const randTick = (cents: number) => {
  const rand = cents / 100;
  return rand >= 1000 ? `R${Number((rand / 1000).toFixed(1))}k` : `R${rand}`;
};

export function Dashboard({ api }: { api: Api }) {
  const dashboard = useLoad(() => api.dashboard(), [api]);
  const d = dashboard.data;
  if (dashboard.error) return <p className="error">{dashboard.error}</p>;
  if (!d) return <p>Loading…</p>;

  const conversion =
    d.quotes.conversionRate === null
      ? "–"
      : `${Math.round(d.quotes.conversionRate * 100)}%`;
  const totalPremium = d.inForce.premium || 1;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">
        Your book on {formatDate(d.asOf)}. Premiums are monthly and include VAT.
      </p>

      <div className="tiles">
        <Tile label="Policies in force" value={String(d.inForce.policies)}>
          {d.startingSoon > 0 && `${d.startingSoon} more starting soon`}
        </Tile>
        <Tile
          label="Monthly premium in force"
          value={formatRand(d.inForce.premium)}
        />
        <Tile
          label="Monthly commission"
          value={formatRand(d.inForce.commission)}
        >
          excl. VAT
        </Tile>
        <Tile label="Quotes bound, last 30 days" value={conversion}>
          {d.quotes.boundLast30Days} of {d.quotes.last30Days} quotes
        </Tile>
      </div>

      {(d.quotes.expiringSoon.length > 0 ||
        d.quotes.awaitingUnderwriter > 0 ||
        d.renewalsDue.length > 0) && (
        <section className="panel">
          <h2>Needs attention</h2>
          <ul className="attention">
            {d.quotes.awaitingUnderwriter > 0 && (
              <li>
                {d.quotes.awaitingUnderwriter}{" "}
                {d.quotes.awaitingUnderwriter === 1 ? "quote is" : "quotes are"}{" "}
                waiting for an underwriter.{" "}
                <a href={href("quotes")}>See quotes</a>
              </li>
            )}
            {d.quotes.expiringSoon.map((q) => (
              <li key={q.id}>
                Quote for {q.clientName} expires on {formatDate(q.expiresOn)}.{" "}
                <a href={href("quotes", q.id)}>Open</a>
              </li>
            ))}
            {d.renewalsDue.map((r) => (
              <li key={r.policyNumber}>
                {r.policyNumber} for {r.clientName} ({r.insurer}) ends on{" "}
                {formatDate(r.endsOn)}.{" "}
                <a href={href("policies", r.policyNumber)}>Open</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>New business premium per month</h2>
        <MonthlyBars
          label="Monthly premium of new policies written in each of the last 12 months"
          data={d.months.map((m) => ({
            month: m.month,
            value: m.newPremium,
            detail: `${m.newPolicies} new ${m.newPolicies === 1 ? "policy" : "policies"}, ${formatRand(m.newPremium)} a month`,
          }))}
          format={formatRand}
          formatTick={randTick}
        />
        <details>
          <summary>Show as a table</summary>
          <div className="table-scroll">
            <table className="compact">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">New policies</th>
                  <th className="num">New premium</th>
                  <th className="num">Changes</th>
                  <th className="num">Cancellations</th>
                  <th className="num">Net premium change</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month, true)}</td>
                    <td className="num">{m.newPolicies}</td>
                    <td className="num">{formatRand(m.newPremium)}</td>
                    <td className="num">{m.endorsements}</td>
                    <td className="num">{m.cancellations}</td>
                    <td className="num">{formatRand(m.premiumChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div className="columns">
        <section className="panel">
          <h2>In force by insurer</h2>
          {d.byInsurer.length === 0 ? (
            <p className="muted">No policies in force yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="compact">
                <thead>
                  <tr>
                    <th>Insurer</th>
                    <th className="num">Policies</th>
                    <th className="num">Premium</th>
                    <th className="num">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byInsurer.map((r) => (
                    <tr key={r.insurer}>
                      <td>
                        {r.insurer}
                        <span className="share" aria-hidden="true">
                          <span
                            style={{
                              width: `${(r.premium / totalPremium) * 100}%`,
                            }}
                          />
                        </span>
                      </td>
                      <td className="num">{r.policies}</td>
                      <td className="num">{formatRand(r.premium)}</td>
                      <td className="num">{formatRand(r.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Recent activity</h2>
          {d.recent.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul className="activity">
              {d.recent.map((t) => (
                <li key={t.id}>
                  <a href={href("policies", t.policyNumber)}>
                    {t.policyNumber}
                  </a>{" "}
                  {t.clientName}: {TYPE_LABEL[t.type]}
                  <span className="muted">
                    {" "}
                    on {formatDate(t.processedAt.slice(0, 10))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Reports api={api} asOf={d.asOf} />
    </>
  );
}

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      {children && <span className="muted tile-note">{children}</span>}
    </div>
  );
}

function Reports({ api, asOf }: { api: Api; asOf: string }) {
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const [registerDate, setRegisterDate] = useState(asOf);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(asOf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Reports</h2>
      <p className="muted">
        Spreadsheets (CSV) that open in Excel or Google Sheets.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="report-row">
        <div>
          <strong>Policy register</strong>
          <span className="muted">
            Every policy with its status, premium, commission and vehicle on the
            date.
          </span>
        </div>
        <label>
          As at
          <input
            type="date"
            value={registerDate}
            onChange={(e) => setRegisterDate(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !registerDate}
          onClick={() =>
            run(async () =>
              saveFile(
                await api.policyRegister(registerDate),
                `policy-register-${registerDate}.csv`,
              ),
            )
          }
        >
          Download
        </button>
      </div>
      <div className="report-row">
        <div>
          <strong>Transactions</strong>
          <span className="muted">
            New policies, changes and cancellations processed between the dates.
          </span>
        </div>
        <div className="inline">
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <button
          disabled={busy || !from || !to || from > to}
          onClick={() =>
            run(async () =>
              saveFile(
                await api.transactionReport(from, to),
                `transactions-${from}-to-${to}.csv`,
              ),
            )
          }
        >
          Download
        </button>
      </div>
    </section>
  );
}
