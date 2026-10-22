import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { StoreError, createStore } from "./store.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = createStore(path.join(root, "data", "raffle.db"));
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function send(res, fn) {
  try {
    return fn();
  } catch (err) {
    const status = err instanceof StoreError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({
      error: status === 500 ? "Something went wrong." : err.message,
    });
    return null;
  }
}

function pinFrom(req) {
  return req.get("x-host-pin") || req.body?.pin || "";
}

app.post("/api/rooms", (req, res) => {
  const room = send(res, () => store.createRoom(req.body || {}));
  if (room) res.status(201).json(room);
});

app.get("/api/rooms/:code", (req, res) => {
  const room = send(res, () => store.publicRoom(req.params.code));
  if (room) res.json(room);
});

app.get("/api/rooms/:code/host", (req, res) => {
  const room = send(res, () => store.hostRoom(req.params.code, pinFrom(req)));
  if (room) res.json(room);
});

app.post("/api/rooms/:code/join", (req, res) => {
  const entry = send(res, () => store.join(req.params.code, req.body || {}));
  if (entry) res.status(201).json(entry);
});

app.post("/api/rooms/:code/draw", (req, res) => {
  const draw = send(res, () => store.draw(req.params.code, pinFrom(req), req.body?.reveal));
  if (draw) res.json(draw);
});

app.post("/api/rooms/:code/redraw", (req, res) => {
  const draw = send(res, () => store.redraw(req.params.code, pinFrom(req), req.body?.reveal));
  if (draw) res.json(draw);
});

app.post("/api/rooms/:code/lock", (req, res) => {
  const room = send(res, () => store.lock(req.params.code, pinFrom(req), Boolean(req.body?.locked)));
  if (room) res.json(room);
});

app.post("/api/rooms/:code/prize", (req, res) => {
  const room = send(res, () => store.updatePrize(req.params.code, pinFrom(req), req.body?.prize));
  if (room) res.json(room);
});

app.post("/api/rooms/:code/reveal", (req, res) => {
  const room = send(res, () => store.updateReveal(req.params.code, pinFrom(req), req.body?.reveal));
  if (room) res.json(room);
});

app.post("/api/rooms/:code/import", (req, res) => {
  const room = send(res, () => store.importCsv(req.params.code, pinFrom(req), req.body?.csv || ""));
  if (room) res.json(room);
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Raffle API on http://localhost:${port}`);
});
