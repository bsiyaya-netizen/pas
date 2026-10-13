import { useState, type FormEvent } from "react";
import type { Api } from "../api";
import { go } from "../router";
import { useLoad } from "../useLoad";

/** Motor quote capture. Home and commercial property forms follow once their products are loaded. */

const TERRITORIES = [
  ["gauteng", "Gauteng"],
  ["western_cape", "Western Cape"],
  ["kwazulu_natal", "KwaZulu-Natal"],
  ["other", "Other province"],
] as const;

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

export function NewQuote({ api }: { api: Api }) {
  const clients = useLoad(() => api.clients(), [api]);
  const products = useLoad(() => api.products("motor"), [api]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [clientId, setClientId] = useState("");

  const optional = [
    ...new Map(
      (products.data ?? []).flatMap((p) => p.coverages.filter((c) => !c.mandatory).map((c) => [c.code, c.name] as const)),
    ),
  ];

  async function addClient() {
    if (!newClient.trim()) return;
    try {
      const client = await api.addClient(newClient.trim());
      clients.setData([...(clients.data ?? []), client]);
      setClientId(client.id);
      setNewClient("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const num = (name: string) => Number(f.get(name));
    setBusy(true);
    setError(undefined);
    try {
      const quote = await api.createQuote({
        clientId,
        line: "motor",
        effectiveDate: String(f.get("effectiveDate")),
        coverages: f.getAll("coverages").map(String),
        risk: {
          territory: f.get("territory"),
          excessOption: num("excessOption"),
          vehicle: { value: num("vehicleValue"), use: f.get("use") },
          driver: {
            age: num("age"),
            claimsLast3Years: num("claims"),
            ...(f.get("licenceDate") && { licenceDate: f.get("licenceDate") }),
          },
        },
      });
      go("quotes", quote.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1>New motor quote</h1>
      {error && <p className="error">{error}</p>}
      <form onSubmit={submit} className="form">
        <fieldset>
          <legend>Client</legend>
          <label>
            Client
            <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="" disabled>
                Choose a client
              </option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="inline">
            <input placeholder="New client name" value={newClient} onChange={(e) => setNewClient(e.target.value)} />
            <button type="button" className="secondary" onClick={addClient}>
              Add client
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Cover</legend>
          <label>
            Cover starts
            <input type="date" name="effectiveDate" required defaultValue={tomorrow()} />
          </label>
          <label>
            Basic excess
            <select name="excessOption" defaultValue="5000">
              <option value="3500">R3 500</option>
              <option value="5000">R5 000</option>
              <option value="7500">R7 500</option>
            </select>
          </label>
          {optional.map(([code, name]) => (
            <label key={code} className="check">
              <input type="checkbox" name="coverages" value={code} /> {name}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Vehicle</legend>
          <label>
            Value (R)
            <input type="number" name="vehicleValue" min="1000" step="1000" required />
          </label>
          <label>
            Use
            <select name="use" defaultValue="private">
              <option value="private">Private</option>
              <option value="business">Business</option>
            </select>
          </label>
          <label>
            Kept overnight in
            <select name="territory" defaultValue="gauteng">
              {TERRITORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Regular driver</legend>
          <label>
            Age
            <input type="number" name="age" min="16" max="100" required />
          </label>
          <label>
            Claims in the last 3 years
            <input type="number" name="claims" min="0" max="20" defaultValue="0" required />
          </label>
          <label>
            Licence issue date
            <input type="date" name="licenceDate" />
          </label>
        </fieldset>

        <button type="submit" disabled={busy}>
          {busy ? "Quoting…" : "Get quotes"}
        </button>
      </form>
    </>
  );
}
