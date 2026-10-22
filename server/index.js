import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { dispatch } from "./api.js";
import { loadEnv } from "./env.js";

loadEnv();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  dispatch({
    method: req.method,
    path: req.path,
    query: req.query,
    headers: req.headers,
    body: req.body,
    origin: `${req.protocol}://${req.get("host")}`,
  })
    .then((result) => {
      res.setHeader("cache-control", "no-store");
      for (const cookie of result.cookies || []) res.append("Set-Cookie", cookie);
      if (result.location) {
        res.redirect(result.status, result.location);
        return;
      }
      res.status(result.status).json(result.json ?? {});
    })
    .catch(next);
});

app.use((err, req, res, next) => {
  if (!req.path.startsWith("/api")) return next(err);
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "That request could not be read." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

if (process.env.NODE_ENV === "production" && !process.env.NETLIFY) {
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
