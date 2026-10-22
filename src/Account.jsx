import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api.js";

const HINT = "raffle_user";
const HINT_MAX_AGE = 60 * 60 * 24 * 30;

function encodeHint(user) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      sub: user.sub,
      email: user.email,
      name: user.name || user.email,
      picture: user.picture || "",
    }),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeHint(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readHint() {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${HINT}=`));
  if (!entry) return undefined;
  const value = decodeURIComponent(entry.slice(HINT.length + 1));
  if (!value || value === "0") return null;
  try {
    const user = JSON.parse(decodeHint(value));
    if (!user?.email) return null;
    return {
      sub: user.sub || "",
      email: user.email,
      name: user.name || user.email,
      picture: user.picture || "",
    };
  } catch {
    return null;
  }
}

function storeHint(user) {
  const value = user ? encodeHint(user) : "0";
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${HINT}=${value}; Path=/; Max-Age=${HINT_MAX_AGE}; SameSite=Lax${secure}`;
}

let current = readHint();
let generation = 0;
let pending = null;
const listeners = new Set();

function publish(user) {
  current = user;
  storeHint(user);
  for (const listener of listeners) listener(user);
}

function refreshSession() {
  const gen = generation;
  if (pending) return pending;
  pending = api
    .me()
    .then((user) => {
      if (gen !== generation) return;
      publish(user || null);
    })
    .catch(() => {
      if (gen !== generation) return;
      if (current === undefined) publish(null);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function forgetSession() {
  generation += 1;
  pending = null;
  publish(null);
}

export function useSession() {
  const [user, setUser] = useState(current);

  useEffect(() => {
    listeners.add(setUser);
    setUser(current);
    refreshSession();
    return () => listeners.delete(setUser);
  }, []);

  return user;
}

async function signOut() {
  forgetSession();
  try {
    await api.logout();
  } catch {
    // The cookie is already cleared. The next check confirms it.
  }
  location.href = "/";
}

export function AccountBar({ user, next, rooms = false, bar = false }) {
  if (bar && user) {
    return (
      <header className="topbar">
        <Link to="/rooms">Your rooms</Link>
        <span className="topbar-side">
          <span>{user.name || user.email}</span>
          <button className="text-btn" type="button" onClick={signOut}>
            Sign out
          </button>
        </span>
      </header>
    );
  }
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
        <button className="text-btn" type="button" onClick={signOut}>
          Sign out
        </button>
      </span>
    </div>
  );
}
