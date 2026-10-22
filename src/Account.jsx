import { useEffect, useState } from "react";
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

export function AccountBar({ user, next }) {
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
      <span>{user.name || user.email}</span>
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
    </div>
  );
}
