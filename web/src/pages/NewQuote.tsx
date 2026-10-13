import { useState, type FormEvent } from "react";
import type { Api } from "../api";
import { ClientForm, missingDetails } from "../components/ClientForm";
import { MotorFields, readMotor } from "../components/MotorFields";
import { go, href } from "../router";
import { useLoad } from "../useLoad";

/** Motor quote capture. Home and commercial property forms follow once their products are loaded. */

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
    setBusy(true);
    setError(undefined);
    try {
      const quote = await api.createQuote({
        clientId,
        line: "motor",
        effectiveDate: String(f.get("effectiveDate")),
        ...readMotor(f),
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
          <legend>Start date</legend>
          <label>
            Cover starts
            <input type="date" name="effectiveDate" required defaultValue={tomorrow()} />
          </label>
        </fieldset>

        <MotorFields optionalCovers={optional} />

        <button type="submit" disabled={busy}>
          {busy ? "Quoting…" : "Get quotes"}
        </button>
      </form>
    </>
  );
}
