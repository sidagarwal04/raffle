import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api.js";

export function useSession() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let stop = false;
    api
      .me()
      .then((next) => {
        if (!stop) setUser(next);
      })
      .catch(() => {
        if (!stop) setUser(null);
      });
    return () => {
      stop = true;
    };
  }, []);

  return user;
}

export function AccountBar({ user, next, rooms = false }) {
  if (user === undefined) return <p className="muted">Checking sign-in…</p>;
  if (!user) {
    return (
      <a className="btn ghost" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
        Sign in with Google
      </a>
    );
  }
  return (
    <div className="account">
      {rooms ? <Link to="/rooms">Your rooms</Link> : <span>{user.name || user.email}</span>}
      <span className="account-side">
        {rooms ? <span>{user.name || user.email}</span> : null}
        <button
          className="text-btn"
          type="button"
          onClick={async () => {
            await api.logout();
            location.href = "/";
          }}
        >
          Sign out
        </button>
      </span>
    </div>
  );
}
