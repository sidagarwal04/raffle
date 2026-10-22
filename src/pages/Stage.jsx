import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api, cleanCode, clearPin, roomPin, savePin } from "../api.js";
import { Confetti, Odometer, Reel, WinnerCard } from "../show.jsx";

const REVEALS = [
  { id: "wheel", label: "Wheel" },
  { id: "odometer", label: "Odometer" },
  { id: "instant", label: "Instant" },
];

const SOURCE = { join: "Joined", csv: "Check-in", booth: "Booth" };

function playedKey(code) {
  return `raffle-played:${code}`;
}

function loadPlayed(code) {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(playedKey(code)) || "[]"));
  } catch {
    return new Set();
  }
}

export function Stage() {
  const params = useParams();
  const code = cleanCode(params.code);
  const [pin, setPin] = useState(() => roomPin(code));
  const [room, setRoom] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [askPin, setAskPin] = useState(false);
  const [tryHost, setTryHost] = useState(true);
  const [pinDraft, setPinDraft] = useState("");
  const [phase, setPhase] = useState("lobby");
  const [activeDraw, setActiveDraw] = useState(null);
  const [reveal, setReveal] = useState("wheel");
  const [prize, setPrize] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [qr, setQr] = useState("");
  const [presenting, setPresenting] = useState(false);
  const [freshIds, setFreshIds] = useState([]);
  const played = useRef(loadPlayed(code));
  const firstLoad = useRef(true);
  const knownIds = useRef(new Set());
  const openedFullscreen = useRef(false);

  function remember(draw, animate) {
    if (!draw || played.current.has(draw.id)) return;
    played.current.add(draw.id);
    sessionStorage.setItem(playedKey(code), JSON.stringify([...played.current]));
    setActiveDraw(draw);
    setPhase(animate ? "spinning" : "winner");
  }

  useEffect(() => {
    const joinUrl = `${location.origin}/j/${code}${room?.style === "booth" ? "?src=booth" : ""}`;
    QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 360,
      color: { dark: "#14160a", light: "#f4f4ee" },
    }).then(setQr);
  }, [code, room?.style]);

  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const next = pin || tryHost ? await api.getHost(code, pin) : await api.getRoom(code);
        if (stop) return;
        setRoom(next);
        setMissing(false);
        setError("");
        const draw = next.latestDraw;
        if (draw) {
          const stale = firstLoad.current && Date.now() - draw.at > 15000;
          remember(draw, !stale && draw.reveal !== "instant");
        }
        firstLoad.current = false;
      } catch (err) {
        if (stop) return;
        if (err.status === 404) setMissing(true);
        else if (err.status === 403) {
          if (pin) {
            clearPin(code);
            setPin("");
            setError("That pin didn’t match. Enter it again.");
            setAskPin(true);
          }
          setTryHost(false);
          try {
            const pub = await api.getRoom(code);
            if (stop) return;
            setRoom(pub);
            setMissing(false);
          } catch (inner) {
            if (inner.status === 404) setMissing(true);
            else setError(inner.message);
          }
        } else setError(err.message);
      }
    }
    tick();
    const id = setInterval(tick, 800);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [code, pin, tryHost]);

  useEffect(() => {
    if (room?.reveal) setReveal(room.reveal);
    if (room?.prize) setPrize(room.prize);
  }, [room?.reveal, room?.prize]);

  useEffect(() => {
    document.title = room?.title ? `${room.title} · Spin Fiesta` : "Spin Fiesta";
  }, [room?.title]);

  const entryKey = (room?.entries || []).map((entry) => entry.id).join("|");

  useEffect(() => {
    if (!presenting) {
      knownIds.current = new Set();
      return;
    }
    const ids = entryKey ? entryKey.split("|") : [];
    const arrived = ids.filter((id) => !knownIds.current.has(id));
    if (!arrived.length) return;
    const firstPaint = knownIds.current.size === 0;
    arrived.forEach((id) => knownIds.current.add(id));
    setFreshIds(firstPaint ? ids : arrived);
  }, [presenting, entryKey]);

  useEffect(() => {
    if (!presenting) return undefined;
    function onKey(event) {
      if (event.key === "Escape" && !document.fullscreenElement) setPresenting(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  function startPresent() {
    setPresenting(true);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        openedFullscreen.current = true;
      }).catch(() => {});
    }
  }

  function stopPresent() {
    setPresenting(false);
    if (openedFullscreen.current) {
      openedFullscreen.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }

  async function unlock(event) {
    event.preventDefault();
    setError("");
    try {
      const next = await api.getHost(code, pinDraft.trim());
      savePin(code, pinDraft.trim().toUpperCase());
      setTryHost(true);
      setPin(pinDraft.trim().toUpperCase());
      setRoom(next);
      setAskPin(false);
      setPinDraft("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function onDraw() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const draw = await api.draw(code, pin, reveal);
      remember(draw, draw.reveal !== "instant");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onRedraw() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const draw = await api.redraw(code, pin, reveal);
      remember(draw, draw.reveal !== "instant");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseReveal(next) {
    setReveal(next);
    try {
      setRoom(await api.setReveal(code, pin, next));
    } catch (err) {
      setError(err.message);
    }
  }

  async function savePrize(event) {
    event.preventDefault();
    try {
      const next = await api.setPrize(code, pin, prize);
      setRoom(next);
      setNotice("Prize updated.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleLock() {
    try {
      const next = await api.setLocked(code, pin, !room.locked);
      setRoom(next);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const csv = await file.text();
    setNotice("");
    setError("");
    try {
      const next = await api.importCsv(code, pin, csv);
      setRoom(next);
      setNotice(`Added ${next.added}. Left out ${next.unchecked} who were not checked in. Skipped ${next.duplicates} already here.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  if (missing) {
    return (
      <main className="sheet">
        <p className="mark">Spin Fiesta</p>
        <h1>That code doesn’t match a room.</h1>
        <Link className="btn ghost" to="/">
          Back home
        </Link>
      </main>
    );
  }

  const showCode = room && room.style !== "booth";
  const joinUrl = `${location.origin}/j/${code}`;
  const localHint = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const hosting = Boolean(room?.entries) && !presenting;
  const people = [...(room?.entries || [])].sort((a, b) => b.joinedAt - a.joinedAt);

  return (
    <div className={hosting ? "stage-shell hosting" : "stage-shell"}>
      <section className={presenting ? "stage presenting" : "stage"}>
        <header className="stage-top">
          <p className="mark">{room?.title || "Spin Fiesta"}</p>
          <p className="live">
            <span className="pip" />
            {room ? `${room.count} in the draw` : "Connecting"}
          </p>
          {presenting ? (
            <button className="text-btn" type="button" onClick={stopPresent}>
              Exit
            </button>
          ) : (
            <span className="stage-tools">
              {room?.entries ? (
                <button className="text-btn" type="button" onClick={startPresent}>
                  Present
                </button>
              ) : null}
              <button className="text-btn" type="button" onClick={fullscreen}>
                Fullscreen
              </button>
            </span>
          )}
        </header>

        <div className="stage-body">
          {phase === "spinning" && activeDraw?.reveal === "wheel" ? (
            <Reel
              names={activeDraw.reel}
              winner={activeDraw.name}
              onDone={() => setPhase("winner")}
            />
          ) : null}
          {phase === "spinning" && activeDraw?.reveal === "odometer" ? (
            <Odometer name={activeDraw.name} onDone={() => setPhase("winner")} />
          ) : null}
          {phase === "winner" && activeDraw ? (
            <>
              <Confetti drawId={activeDraw.id} />
              <WinnerCard
                name={activeDraw.name}
                prize={activeDraw.prize}
                count={activeDraw.eligibleCount}
              />
            </>
          ) : null}
          {phase === "lobby" && presenting ? (
            <div className="present-lobby">
              <div className="present-join">
                {showCode ? (
                  <>
                    <p className="eyebrow">Join with this code</p>
                    <h1 className="code present-code">{code}</h1>
                  </>
                ) : (
                  <>
                    <p className="eyebrow">Booth</p>
                    <h1 className="booth-line present-booth">Scan the card at the table</h1>
                  </>
                )}
                <p className="prize-lg">{room?.prize}</p>
                {showCode && qr ? <img className="present-qr" src={qr} alt={`QR code to join ${code}`} /> : null}
              </div>
              <div className="name-wall" aria-live="polite">
                {people.length ? (
                  people.map((entry, index) => (
                    <span
                      key={entry.id}
                      className={
                        freshIds.includes(entry.id)
                          ? entry.eligible
                            ? "name-chip fresh"
                            : "name-chip fresh out"
                          : entry.eligible
                            ? "name-chip"
                            : "name-chip out"
                      }
                      style={
                        freshIds.includes(entry.id) && freshIds.length > 1
                          ? { animationDelay: `${Math.min(index, 18) * 45}ms` }
                          : undefined
                      }
                    >
                      {entry.name}
                    </span>
                  ))
                ) : (
                  <p className="lede">Names land here as people join.</p>
                )}
              </div>
            </div>
          ) : null}
          {phase === "lobby" && !presenting ? (
            <div className="lobby">
              {showCode ? (
                <>
                  <p className="eyebrow">{room?.style === "virtual" ? "Paste this in chat" : "Join with this code"}</p>
                  <h1 className="code">{code}</h1>
                </>
              ) : (
                <>
                  <p className="eyebrow">Booth</p>
                  <h1 className="booth-line">Scan the card at the table</h1>
                </>
              )}
              <p className="prize-lg">{room?.prize}</p>
            </div>
          ) : null}
        </div>

        {room?.earlier?.length ? (
          <p className="earlier">
            Already drawn: {room.earlier.map((draw) => draw.name).join(", ")}
          </p>
        ) : (
          <span />
        )}

        <footer className="stage-foot">
          {showCode && qr && !presenting ? (
            <div className="qr-block">
              <img src={qr} alt={`QR code to join ${code}`} />
              <span>{joinUrl.replace(/^https?:\/\//, "")}</span>
            </div>
          ) : (
            <span />
          )}
          {room?.entries || presenting ? null : (
            <button className="text-btn" type="button" onClick={() => setAskPin(true)}>
              Host
            </button>
          )}
        </footer>

        {askPin && !room?.entries ? (
          <form className="pin-card" onSubmit={unlock}>
            <label htmlFor="pin">Host pin</label>
            <div className="inline">
              <input
                id="pin"
                value={pinDraft}
                onChange={(event) => setPinDraft(event.target.value.toUpperCase())}
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
              />
              <button className="btn primary" type="submit">
                Unlock
              </button>
            </div>
            <button className="text-btn" type="button" onClick={() => setAskPin(false)}>
              Cancel
            </button>
          </form>
        ) : null}
        {error && !room?.entries ? <p className="stage-error">{error}</p> : null}
      </section>

      {hosting && room ? (
        <aside className="dock">
          <div className="dock-controls">
            <p className="mark">Host</p>
            <button className="btn primary" type="button" onClick={startPresent}>
              Present
            </button>
            <p className="muted">The big screen, without these controls. Names show up as people join.</p>
            <div className="reveal-picks" role="radiogroup" aria-label="How the name lands">
              {REVEALS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={reveal === item.id}
                  className={reveal === item.id ? "pick on" : "pick"}
                  onClick={() => chooseReveal(item.id)}
                  disabled={phase === "spinning"}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="actions">
              <button className="btn primary" type="button" onClick={onDraw} disabled={busy || phase === "spinning" || room.count === 0}>
                Draw
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={onRedraw}
                disabled={busy || phase !== "winner" || room.count < 2}
              >
                Exclude and draw again
              </button>
            </div>
            <form className="prize-edit" onSubmit={savePrize}>
              <label htmlFor="prize-edit">Prize</label>
              <div className="inline">
                <input id="prize-edit" value={prize} onChange={(event) => setPrize(event.target.value)} maxLength={60} />
                <button className="btn ghost" type="submit">
                  Save
                </button>
              </div>
            </form>
            <div className="actions">
              <button className="btn ghost" type="button" onClick={toggleLock}>
                {room.locked ? "Reopen the room" : "Close the room"}
              </button>
              <label className="btn ghost file">
                Import check-ins
                <input type="file" accept=".csv,text/csv" onChange={onImport} />
              </label>
            </div>
            {room.style === "booth" && qr ? (
              <div className="qr-block dock-qr">
                <img src={qr} alt={`QR code for the ${room.title} booth`} />
                <span>Put this on the table. Code {code}</span>
              </div>
            ) : null}
            {localHint ? (
              <p className="muted">
                Open this page from this computer’s network address so phones can reach the QR.
              </p>
            ) : null}
            {notice ? <p className="notice">{notice}</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </div>
          <div className="dock-list">
            <h2>In the draw</h2>
            <ul>
              {room.entries?.filter((entry) => entry.eligible).map((entry) => (
                <li key={entry.id} className={entry.id === room.latestDraw?.entryId ? "current" : undefined}>
                  <span>{entry.name}</span>
                  <em>{SOURCE[entry.source] || entry.source}</em>
                </li>
              ))}
              {room.count === 0 ? <li className="empty">Nobody’s in yet.</li> : null}
            </ul>
            {room.earlier?.length ? (
              <>
                <h2>Already drawn</h2>
                <ul>
                  {room.earlier.map((draw) => (
                    <li key={draw.id}>
                      <span>{draw.name}</span>
                      <em>{draw.prize}</em>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
