import { useState } from "react";
import { Link } from "react-router-dom";
import { api, savePin } from "../api.js";

const STYLES = [
  {
    id: "meetup",
    label: "Meetup",
    copy: "Put the code on the slide. People join from their phones. A check-in list can be imported too.",
  },
  {
    id: "booth",
    label: "Booth",
    copy: "The code stays off the projector. People scan a QR at the table.",
  },
  {
    id: "virtual",
    label: "Virtual",
    copy: "Paste the code in chat. Screen-share the stage.",
  },
];

export function Create() {
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

  if (room) {
    const joinUrl = `${location.origin}/j/${room.code}`;
    return (
      <main className="sheet">
        <p className="mark">Room open</p>
        <h1 className="code-sm">{room.code}</h1>
        <p className="lede">
          Share the code. Keep the pin on this computer. It unlocks Draw.
        </p>
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
      </main>
    );
  }

  return (
    <main className="sheet">
      <p className="mark">New room</p>
      <h1>Set the prize, then share a code.</h1>
      <form className="stack-form" onSubmit={submit}>
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
    </main>
  );
}
