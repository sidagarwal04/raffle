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
    <section className="collab">
      <h2>Collaborators</h2>
      <p className="muted">Invite someone to run this room with you. They can draw on another screen.</p>
      <form className="stack-form" onSubmit={submit}>
        <label htmlFor={`collab-${code}`}>
          Google email
          <input
            id={`collab-${code}`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alex@company.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            required
          />
        </label>
        <button className="btn ghost" type="submit" disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>
      {people.length ? (
        <ul className="people">
          {people.map((person) => (
            <li key={`${person.waiting ? "wait" : "in"}-${person.email}`}>
              <span>
                <strong>{person.name || person.email}</strong>
                {person.name ? <em>{person.email}</em> : null}
                <em>{person.waiting ? "Waiting on the link" : "On the room"}</em>
              </span>
              <span className="inline">
                {person.token ? (
                  <button className="btn ghost" type="button" onClick={() => copy(person.email, person.token)}>
                    {copied === person.email ? "Copied" : "Copy link"}
                  </button>
                ) : null}
                {canRemove ? (
                  <button className="text-btn" type="button" onClick={() => remove(person.email)}>
                    Remove
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
