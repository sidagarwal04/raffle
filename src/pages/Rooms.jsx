import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AccountBar, useSession } from "../Account.jsx";
import { api } from "../api.js";
import { RoomList } from "../RoomList.jsx";

export function Rooms() {
  const user = useSession();
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return undefined;
    let stop = false;
    api
      .rooms()
      .then((data) => {
        if (!stop) setRooms(data.rooms || []);
      })
      .catch((err) => {
        if (!stop) setError(err.message);
      });
    return () => {
      stop = true;
    };
  }, [user]);

  if (user === undefined) {
    return (
      <main className="sheet">
        <p className="lede">Checking sign-in…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="sheet">
        <p className="mark">Your rooms</p>
        <h1>Sign in to see your rooms.</h1>
        <p className="lede">Google sign-in keeps the rooms you open, and the ones you’re invited to run.</p>
        <a className="btn primary" href="/api/auth/google?next=/rooms">
          Sign in with Google
        </a>
        <Link className="btn ghost" to="/">
          Back home
        </Link>
      </main>
    );
  }

  return (
    <main className="sheet top">
      <AccountBar user={user} next="/rooms" />
      <p className="mark">Raffle</p>
      <h1>Your rooms</h1>
      <p className="lede">Rooms you open, and rooms other people invite you to run.</p>
      <Link className="btn primary" to="/draw">
        Create a room
      </Link>
      {error ? <p className="error">{error}</p> : null}
      <RoomList rooms={rooms} />
    </main>
  );
}
