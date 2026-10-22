import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AccountBar, useSession } from "../Account.jsx";
import { api, cleanCode } from "../api.js";
import { RoomList } from "../RoomList.jsx";

const AUTH_NOTE = {
  error: "Google sign-in didn’t complete. Try again.",
  config: "Google sign-in needs a client id and secret in the environment.",
};

export function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useSession();
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    if (!user) return undefined;
    let stop = false;
    api
      .rooms()
      .then((data) => {
        if (!stop) setRooms(data.rooms || []);
      })
      .catch(() => {
        if (!stop) setRooms([]);
      });
    return () => {
      stop = true;
    };
  }, [user]);

  function join(event) {
    event.preventDefault();
    const next = cleanCode(code);
    if (next.length < 4) return;
    navigate(`/j/${next}`);
  }

  return (
    <main className="sheet">
      <AccountBar user={user} next="/" />
      {AUTH_NOTE[params.get("auth")] ? <p className="error">{AUTH_NOTE[params.get("auth")]}</p> : null}
      <p className="mark brand">
        <img className="brand-mark" src="/icon.png" alt="" />
        Raffle
      </p>
      <h1>A room. A code. A winner.</h1>
      <p className="lede">
        For meetups, booths, and livestreams. People join with a name. You draw
        on the big screen. Sign in with Google and the code stays on your account.
      </p>
      <Link className="btn primary" to="/draw">
        Create a room
      </Link>
      <form className="join-row" onSubmit={join}>
        <label htmlFor="code">Have a code?</label>
        <div className="inline">
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="7KQM"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
            maxLength={8}
          />
          <button className="btn ghost" type="submit" disabled={cleanCode(code).length < 4}>
            Join
          </button>
        </div>
      </form>
      {user ? (
        <section className="saved-block">
          <h2>Your rooms</h2>
          <RoomList rooms={rooms} />
        </section>
      ) : null}
    </main>
  );
}
