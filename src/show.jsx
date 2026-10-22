import { useEffect, useMemo, useRef, useState } from "react";

const ROW = 72;
const CENTER = 2;

function buildStrip(names, winner) {
  const pool = [...new Set([...(names || []), winner].filter(Boolean))];
  const seq = [];
  const spins = Math.max(20, pool.length * 3);
  for (let i = 0; i < spins; i++) seq.push(pool[i % pool.length]);
  if (pool.length > 1 && seq[seq.length - 1] === winner) {
    seq[seq.length - 1] = pool.find((name) => name !== winner) || winner;
  }
  seq.push(winner);
  return seq;
}

export function Reel({ names, winner, onDone }) {
  const strip = useMemo(() => buildStrip(names, winner), [names, winner]);
  const [step, setStep] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const target = strip.length - 1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setStep(target);
      const hold = setTimeout(() => onDoneRef.current(), 250);
      return () => clearTimeout(hold);
    }
    const start = performance.now();
    const duration = 3800;
    let frame = 0;
    let hold = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setStep(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else hold = setTimeout(() => onDoneRef.current(), 520);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hold);
    };
  }, [strip]);

  const y = (CENTER - step) * ROW;
  return (
    <div className="reel" aria-hidden="true">
      <div className="reel-window">
        <div className="reel-strip" style={{ transform: `translateY(${y}px)` }}>
          {strip.map((name, index) => {
            const distance = Math.abs(index - step);
            const opacity = distance < 0.55 ? 1 : distance < 1.5 ? 0.42 : 0.16;
            return (
              <div key={`${index}-${name}`} className="reel-row" style={{ opacity }}>
                {name}
              </div>
            );
          })}
        </div>
        <div className="reel-highlight" />
      </div>
    </div>
  );
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function Odometer({ name, onDone }) {
  const [tick, setTick] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = name.length * 4;
    if (reduce) {
      setTick(total);
      const hold = setTimeout(() => onDoneRef.current(), 250);
      return () => clearTimeout(hold);
    }
    let step = 0;
    let finish = 0;
    const id = setInterval(() => {
      step += 1;
      setTick(step);
      if (step >= total) {
        clearInterval(id);
        finish = setTimeout(() => onDoneRef.current(), 420);
      }
    }, 58);
    return () => {
      clearInterval(id);
      clearTimeout(finish);
    };
  }, [name]);

  const locked = Math.floor(tick / 4);
  const shown = name
    .split("")
    .map((char, index) => {
      if (char === " ") return " ";
      if (index < locked) return char;
      return GLYPHS[(tick * 3 + index * 11) % GLYPHS.length];
    })
    .join("");

  return <h1 className="winner-name">{shown}</h1>;
}

export function Confetti({ drawId }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const colors = ["#e6ff4d", "#f5f5f0", "#ffffff", "#d6f25a", "#ffe08a"];
    let pieces = [];
    let frame = 0;
    let last = 0;

    function size() {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    size();
    window.addEventListener("resize", size);

    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = 0; i < 140; i++) {
      pieces.push({
        x: Math.random() * width,
        y: -20 - Math.random() * height * 0.5,
        vx: -2 + Math.random() * 4,
        vy: 2 + Math.random() * 4,
        r: 4 + Math.random() * 6,
        c: colors[i % colors.length],
        rot: Math.random() * Math.PI,
        vr: -0.2 + Math.random() * 0.4,
      });
    }

    function paint(now) {
      const step = last ? Math.min(2.5, (now - last) / 16.667) : 1;
      last = now;
      ctx.clearRect(0, 0, width, height);
      let alive = false;
      for (const piece of pieces) {
        piece.x += piece.vx * step;
        piece.y += piece.vy * step;
        piece.vy += 0.08 * step;
        piece.rot += piece.vr * step;
        if (piece.y > height + 30) continue;
        alive = true;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rot);
        ctx.fillStyle = piece.c;
        ctx.fillRect(-piece.r / 2, -piece.r / 2, piece.r, piece.r * 1.5);
        ctx.restore();
      }
      if (alive) frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", size);
      pieces = [];
    };
  }, [drawId]);

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
}

export function WinnerCard({ name, prize, count }) {
  const people = count === 1 ? "person" : "people";
  return (
    <div className="winner" role="status">
      <p className="eyebrow">Winner</p>
      <h1 className="winner-name">{name}</h1>
      <p className="prize-lg">{prize}</p>
      <p className="muted">
        {count} {people} in this draw
      </p>
    </div>
  );
}
