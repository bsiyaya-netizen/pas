import { useState, type FormEvent } from "react";
import type { Api } from "../api";
import { ClientForm, missingDetails } from "../components/ClientForm";
import { go, href } from "../router";
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
  const [adding, setAdding] = useState(false);
  const [clientId, setClientId] = useState("");
  const selected = clients.data?.find((c) => c.id === clientId);
  const missing = selected ? missingDetails(selected) : [];

  const optional = [
    ...new Map(
      (products.data ?? []).flatMap((p) => p.coverages.filter((c) => !c.mandatory).map((c) => [c.code, c.name] as const)),
    ),
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const num = (name: string) => Number(f.get(name));
    const text = (name: string) => String(f.get(name) ?? "").trim();
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
          vehicle: {
            value: num("vehicleValue"),
            use: f.get("use"),
            make: text("make"),
            model: text("model"),
            year: num("year"),
            ...(text("registration") && { registration: text("registration").toUpperCase() }),
          },
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
          {missing.length > 0 && !adding && (
            <p className="note">
              Documents for this client will leave out their {missing.join(" and ")}.{" "}
              <a href={href("clients", clientId)}>Add them</a>
            </p>
          )}
          {adding ? (
            <ClientForm
              onSave={async (details) => {
                const client = await api.addClient(details);
                clients.setData([...(clients.data ?? []), client]);
                setClientId(client.id);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="secondary" onClick={() => setAdding(true)}>
              Add a new client
            </button>
          )}
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
          <div className="pair">
            <label>
              Make
              <input name="make" required placeholder="e.g. Toyota" />
            </label>
            <label>
              Model
              <input name="model" required placeholder="e.g. Corolla Cross 1.8 XS" />
            </label>
          </div>
          <div className="pair">
            <label>
              Year
              <input type="number" name="year" min="1950" max={new Date().getFullYear() + 1} required />
            </label>
            <label>
              Registration number
              <input name="registration" placeholder="Leave blank if not yet registered" />
            </label>
          </div>
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
