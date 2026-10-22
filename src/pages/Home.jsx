import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cleanCode } from "../api.js";

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function join(event) {
    event.preventDefault();
    const next = cleanCode(code);
    if (next.length < 4) return;
    navigate(`/j/${next}`);
  }

  return (
    <main className="sheet">
      <p className="mark">Spin Fiesta</p>
      <h1>A room. A code. A winner.</h1>
      <p className="lede">
        For meetups, booths, and livestreams. People join with a name. You draw
        on the big screen.
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
    </main>
  );
}
