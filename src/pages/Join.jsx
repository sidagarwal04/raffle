import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, browserToken, cleanCode, saveEntry, saveName, savedName } from "../api.js";

export function Join() {
  const params = useParams();
  const [search] = useSearchParams();
  const code = cleanCode(params.code);
  const fromBooth = search.get("src") === "booth";
  const [room, setRoom] = useState(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState(() => savedName(code));
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(() => !savedName(code));

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const next = await api.getRoom(code);
        if (stop) return;
        setRoom(next);
        setMissing(false);
      } catch (err) {
        if (stop) return;
        if (err.status === 404) setMissing(true);
        else setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [code]);

  useEffect(() => {
    const stored = savedName(code);
    if (!stored) return;
    let stop = false;
    api
      .join(code, {
        name: stored,
        token: browserToken(),
        source: fromBooth ? "booth" : undefined,
      })
      .then((result) => {
        if (stop) return;
        saveEntry(code, result.entryId);
        setEntry(result);
      })
      .catch((err) => {
        if (!stop && err.status !== 403) setError(err.message);
      })
      .finally(() => {
        if (!stop) setChecked(true);
      });
    return () => {
      stop = true;
    };
  }, [code, fromBooth]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.join(code, {
        name,
        token: browserToken(),
        source: fromBooth ? "booth" : undefined,
      });
      saveName(code, result.name);
      saveEntry(code, result.entryId);
      setEntry(result);
      const next = await api.getRoom(code);
      setRoom(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <main className="sheet">
        <p className="mark">Spin Fiesta</p>
        <h1>That code doesn’t match a room.</h1>
        <Link className="btn ghost" to="/">
          Try another
        </Link>
      </main>
    );
  }

  const won = room?.latestDraw && entry && room.latestDraw.entryId === entry.entryId;
  const earlierWin = room?.earlier?.find((draw) => draw.entryId === entry?.entryId);

  if (won || earlierWin) {
    const prize = won ? room.latestDraw.prize : earlierWin.prize;
    return (
      <main className="sheet won">
        <p className="mark">{room?.title || "Spin Fiesta"}</p>
        <h1>You won</h1>
        <p className="prize-lg">{prize}</p>
        <p className="muted">{entry.name}</p>
      </main>
    );
  }

  if (!checked) {
    return (
      <main className="sheet">
        <p className="mark">{code}</p>
        <h1>Joining…</h1>
      </main>
    );
  }

  if (entry) {
    return (
      <main className="sheet">
        <p className="mark">{room?.title || code}</p>
        <h1>You’re in.</h1>
        <p className="lede">
          {entry.name}. {room ? `${room.count} in the draw.` : "Watch the big screen."}
        </p>
        <p className="muted">This page flips if this phone wins.</p>
      </main>
    );
  }

  return (
    <main className="sheet">
      <p className="mark">{room?.title || "Spin Fiesta"}</p>
      <h1>{room?.prize ? `Win a ${room.prize}` : "Join the draw"}</h1>
      <p className="lede">Code {code}. Your name is the whole sign-up.</p>
      {room?.locked ? (
        <p className="error">This room is closed.</p>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          <label htmlFor="name">
            Your name
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
              maxLength={40}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn primary" type="submit" disabled={busy || !room}>
            {busy ? "Joining…" : "I’m in"}
          </button>
        </form>
      )}
    </main>
  );
}
