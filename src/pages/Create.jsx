import { useState } from "react";
import { Link } from "react-router-dom";
import { AccountBar, useSession } from "../Account.jsx";
import { api, savePin } from "../api.js";
import { Collaborators } from "../Collaborators.jsx";

const STYLES = [
  {
    id: "meetup",
    label: "Meetup",
    copy: "Code on the slide. A check-in list can come in too.",
  },
  {
    id: "booth",
    label: "Booth",
    copy: "QR at the table. The code stays off the screen.",
  },
  {
    id: "virtual",
    label: "Virtual",
    copy: "Paste the code in chat and share the stage.",
  },
];

export function Create() {
  const user = useSession();
  const [title, setTitle] = useState("");
  const [prize, setPrize] = useState("");
  const [style, setStyle] = useState("meetup");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState(null);
  const [copied, setCopied] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const created = await api.createRoom({ title, prize, style });
      savePin(created.code, created.pin);
      setRoom(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied("");
    }
  }

  if (!room && user === undefined) {
    return (
      <main className="sheet">
        <p className="lede">Checking sign-in…</p>
      </main>
    );
  }

  if (!room && !user) {
    return (
      <main className="sheet">
        <p className="mark">New room</p>
        <h1>Sign in to save the room.</h1>
        <p className="lede">Google sign-in keeps the code and the draws on your account.</p>
        <a className="btn primary" href="/api/auth/google?next=/draw">
          Sign in with Google
        </a>
        <Link className="btn ghost" to="/">
          Back home
        </Link>
      </main>
    );
  }

  function applyPeople(result) {
    setRoom((current) =>
      current
        ? {
            ...current,
            collaborators: result.collaborators || [],
            invites: result.invites || [],
          }
        : current,
    );
  }

  const joinUrl = room ? `${location.origin}/j/${room.code}` : "";

  return (
    <div className="studio">
      <AccountBar user={user} next="/draw" rooms bar />
      <main className="board">
        {room ? (
          <div className="open">
            <p className="mark">Room open</p>
            <h1 className="code-sm">{room.code}</h1>
            <p className="muted">Share the code. The pin unlocks a screen that isn’t signed in.</p>
            <div className="secret">
              <span>Host pin</span>
              <strong>{room.pin}</strong>
              <button className="btn ghost" type="button" onClick={() => copy(room.pin, "pin")}>
                {copied === "pin" ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="actions">
              <Link className="btn primary" to={`/s/${room.code}`}>
                Open the big screen
              </Link>
              <button className="btn ghost" type="button" onClick={() => copy(joinUrl, "link")}>
                {copied === "link" ? "Link copied" : "Copy join link"}
              </button>
            </div>
            <Collaborators
              code={room.code}
              collaborators={room.collaborators}
              invites={room.invites}
              canRemove
              onUpdate={applyPeople}
            />
          </div>
        ) : (
          <div className="open">
            <p className="mark">New room</p>
            <h1 className="board-title">Set the prize, then share a code.</h1>
            <form className="stack-form" onSubmit={submit}>
              <div className="pair">
                <label htmlFor="title">
                  Room
                  <input
                    id="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Friday meetup"
                    maxLength={80}
                    required
                  />
                </label>
                <label htmlFor="prize">
                  Prize
                  <input
                    id="prize"
                    value={prize}
                    onChange={(event) => setPrize(event.target.value)}
                    placeholder="T-shirt"
                    maxLength={60}
                    required
                  />
                </label>
              </div>
              <fieldset>
                <legend>How will people get in?</legend>
                <div className="choices">
                  {STYLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={style === item.id}
                      className={style === item.id ? "choice on" : "choice"}
                      onClick={() => setStyle(item.id)}
                    >
                      <span className="choice-title">{item.label}</span>
                      <span className="choice-copy">{item.copy}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {error ? <p className="error">{error}</p> : null}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Opening…" : "Create room"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
