import type { Api } from "../api";
import { ClientForm, missingDetails } from "../components/ClientForm";
import { go, href } from "../router";
import { useLoad } from "../useLoad";

/** The broker's clients; `editing` is a client id, "new", or undefined for the list. */
export function Clients({ api, editing }: { api: Api; editing?: string }) {
  const clients = useLoad(() => api.clients(), [api]);
  if (clients.error) return <p className="error">{clients.error}</p>;
  if (!clients.data) return <p>Loading…</p>;

  if (editing) {
    const client = clients.data.find((c) => c.id === editing);
    if (editing !== "new" && !client) return <p className="error">Client not found.</p>;
    return (
      <>
        <h1>{client ? `Edit ${client.name}` : "New client"}</h1>
        <div className="form">
          <fieldset>
            <ClientForm
              client={client}
              onSave={async (details) => {
                if (client) await api.updateClient(client.id, details);
                else await api.addClient(details);
                clients.reload();
                go("clients");
              }}
              onCancel={() => go("clients")}
            />
          </fieldset>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Clients</h1>
      <p>
        <a href={href("clients", "new")}>Add a client</a>
      </p>
      {clients.data.length === 0 ? (
        <p>No clients yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>ID number</th>
              <th>Contact</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.data.map((c) => {
              const missing = missingDetails(c);
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.idNumber ?? "–"}</td>
                  <td>{[c.phone, c.email].filter(Boolean).join(", ") || "–"}</td>
                  <td>
                    <a href={href("clients", c.id)}>{missing.length ? `Add ${missing.join(" and ")}` : "Edit"}</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
