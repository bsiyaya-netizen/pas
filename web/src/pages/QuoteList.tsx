import type { Api } from "../api";
import { formatRand, optionStatus } from "../format";
import { href } from "../router";
import { useLoad } from "../useLoad";

const LINE_NAMES: Record<string, string> = {
  motor: "Motor",
  home: "Home",
  commercial_property: "Commercial property",
};

export function QuoteList({ api }: { api: Api }) {
  const quotes = useLoad(() => api.quotes(), [api]);
  const clients = useLoad(() => api.clients(), [api]);
  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "…";

  return (
    <>
      <div className="title">
        <h1>Quotes</h1>
        <a className="button" href={href("quotes", "new")}>
          New quote
        </a>
      </div>
      {quotes.error && <p className="error">{quotes.error}</p>}
      {quotes.data?.length === 0 && <p>No quotes yet.</p>}
      {quotes.data && quotes.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Line</th>
              <th>Cover from</th>
              <th>Cheapest</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {quotes.data.map((q) => {
              const cheapest = q.options.find((o) => o.rating)?.rating?.totalPremium;
              const statuses = q.options.map(optionStatus);
              const ready = statuses.filter((s) => s === "bindable").length;
              const referred = statuses.filter((s) => s === "referred").length;
              const summary =
                q.status === "bound"
                  ? "Bound"
                  : [
                      ready > 0 && `${ready} ready to bind`,
                      referred > 0 && `${referred} with underwriter`,
                      ready + referred === 0 && "Needs action",
                    ]
                      .filter(Boolean)
                      .join(", ") + ` · expires ${q.expiresOn}`;
              return (
                <tr key={q.id}>
                  <td>
                    <a href={href("quotes", q.id)}>{clientName(q.clientId)}</a>
                  </td>
                  <td>{LINE_NAMES[q.line] ?? q.line}</td>
                  <td>{q.effectiveDate}</td>
                  <td>{cheapest === undefined ? "–" : `${formatRand(cheapest)} pm`}</td>
                  <td>{summary}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
