import { useState } from "react";
import { api } from "./api.js";

export function Collaborators({ code, collaborators = [], invites = [], canRemove = false, onUpdate }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.inviteCollaborator(code, email);
      setEmail("");
      setCopied("");
      onUpdate?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(address) {
    setError("");
    try {
      onUpdate?.(await api.removeCollaborator(code, address));
    } catch (err) {
      setError(err.message);
    }
  }

  async function copy(address, token) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/i/${token}`);
      setCopied(address);
    } catch {
      setCopied("");
    }
  }

  const people = [
    ...collaborators.map((person) => ({ ...person, waiting: false })),
    ...invites.map((invite) => ({ ...invite, waiting: true })),
  ];

  return (
    <section className="invite-line">
      <form className="inline" onSubmit={submit}>
        <label className="sr" htmlFor={`collab-${code}`}>
          Collaborator’s Google email
        </label>
        <input
          id={`collab-${code}`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Invite a collaborator"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          required
        />
        <button className="btn ghost" type="submit" disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>
      {people.length ? (
        <ul className="chips">
          {people.map((person) => (
            <li key={`${person.waiting ? "wait" : "in"}-${person.email}`}>
              <span>{person.name || person.email}</span>
              {person.waiting ? <em>{copied === person.email ? "Copied" : "Waiting"}</em> : <em>In</em>}
              {person.token ? (
                <button className="text-btn" type="button" onClick={() => copy(person.email, person.token)}>
                  Copy link
                </button>
              ) : null}
              {canRemove ? (
                <button className="text-btn" type="button" onClick={() => remove(person.email)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
