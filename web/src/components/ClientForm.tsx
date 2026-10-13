import { useState } from "react";
import type { Client, ClientDetails } from "../api";

const EMPTY = { name: "", idNumber: "", phone: "", email: "", line1: "", line2: "", suburb: "", city: "", postalCode: "" };
type Fields = typeof EMPTY;

function fieldsOf(client?: Client): Fields {
  if (!client) return EMPTY;
  const { address } = client;
  return {
    name: client.name,
    idNumber: client.idNumber ?? "",
    phone: client.phone ?? "",
    email: client.email ?? "",
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    suburb: address?.suburb ?? "",
    city: address?.city ?? "",
    postalCode: address?.postalCode ?? "",
  };
}

/** Blank fields are left out; the address is sent only when any part of it is filled in. */
export function detailsOf(f: Fields): ClientDetails {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const hasAddress = [f.line1, f.line2, f.suburb, f.city, f.postalCode].some((v) => v.trim());
  return {
    name: f.name.trim(),
    idNumber: opt(f.idNumber),
    phone: opt(f.phone),
    email: opt(f.email),
    address: hasAddress
      ? { line1: f.line1.trim(), line2: opt(f.line2), suburb: opt(f.suburb), city: f.city.trim(), postalCode: f.postalCode.trim() }
      : undefined,
  };
}

/**
 * Client capture and editing. It is not a <form> so it can sit inside the quote
 * form; Save submits it on its own.
 */
export function ClientForm({
  client,
  onSave,
  onCancel,
}: {
  client?: Client;
  onSave: (details: ClientDetails) => Promise<void>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<Fields>(() => fieldsOf(client));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = (key: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      {label}
      <input value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} />
    </label>
  );
  const addressStarted = [f.line1, f.line2, f.suburb, f.city, f.postalCode].some((v) => v.trim());

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await onSave(detailsOf(f));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="client-form">
      {error && <p className="error">{error}</p>}
      {input("name", "Full name", { required: true })}
      {input("idNumber", "South African ID number", { inputMode: "numeric", maxLength: 13, pattern: "\\d{13}" })}
      <div className="pair">
        {input("phone", "Mobile number", { type: "tel" })}
        {input("email", "Email", { type: "email" })}
      </div>
      {input("line1", "Street address", { required: addressStarted })}
      {input("line2", "Address line 2 (optional)")}
      <div className="pair">
        {input("suburb", "Suburb")}
        {input("city", "City or town", { required: addressStarted })}
      </div>
      {input("postalCode", "Postal code", { inputMode: "numeric", maxLength: 4, required: addressStarted })}
      <div className="inline">
        <button type="button" disabled={busy || !f.name.trim()} onClick={save}>
          {busy ? "Saving…" : "Save client"}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** What documents will leave out for this client, if anything. */
export function missingDetails(client: Client): string[] {
  return [!client.idNumber && "ID number", !client.address && "address"].filter((m): m is string => Boolean(m));
}
