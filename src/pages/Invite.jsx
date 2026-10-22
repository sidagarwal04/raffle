import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useSession } from "../Account.jsx";

export function Invite() {
  const { token = "" } = useParams();
  const user = useSession();
  const [invite, setInvite] = useState(undefined);
  const [joined, setJoined] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    api
      .getInvite(token)
      .then((next) => {
        if (!stop) setInvite(next);
      })
      .catch((err) => {
        if (!stop) {
          setInvite(null);
          setError(err.message);
        }
      });
    return () => {
      stop = true;
    };
  }, [token]);

  async function join() {
    setBusy(true);
    setError("");
    try {
      setJoined(await api.acceptInvite(token));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    await api.logout();
    location.href = `/i/${token}`;
  }

  if (invite === undefined && !error) {
    return (
      <main className="sheet">
        <p className="lede">Checking the invite…</p>
      </main>
    );
  }

  if (!invite) {
    return (
      <main className="sheet">
        <p className="mark">Invite</p>
        <h1>That invite isn’t valid anymore.</h1>
        <p className="lede">If you were added already, the room is under Your rooms.</p>
        {error ? <p className="error">{error}</p> : null}
        <Link className="btn primary" to="/rooms">
          Your rooms
        </Link>
      </main>
    );
  }

  if (joined) {
    return (
      <main className="sheet">
        <p className="mark">You’re in</p>
        <h1>{joined.title}</h1>
        <p className="lede">This room is on your account. You can draw without the pin.</p>
        <div className="actions">
          <Link className="btn primary" to={`/s/${joined.code}`}>
            Open the big screen
          </Link>
          <Link className="btn ghost" to="/rooms">
            Your rooms
          </Link>
        </div>
      </main>
    );
  }

  const mismatch = user && user.email.toLowerCase() !== invite.email;
  const next = `/i/${token}`;

  return (
    <main className="sheet">
      <p className="mark">Invite</p>
      <h1>{invite.title}</h1>
      <p className="lede">
        Sign in as {invite.email} to run this room with the host. You can draw on another screen.
      </p>
      {user === undefined ? <p className="muted">Checking sign-in…</p> : null}
      {user && !mismatch ? (
        <button className="btn primary" type="button" onClick={join} disabled={busy}>
          {busy ? "Joining…" : "Join this room"}
        </button>
      ) : null}
      {user && mismatch ? (
        <>
          <p className="error">You’re signed in as {user.email}. This invite is for {invite.email}.</p>
          <button className="btn primary" type="button" onClick={switchAccount}>
            Sign out
          </button>
        </>
      ) : null}
      {user === null ? (
        <a className="btn primary" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
          Sign in with Google
        </a>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <Link className="btn ghost" to="/">
        Back home
      </Link>
    </main>
  );
}
