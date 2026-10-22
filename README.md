# Raffle

Spin Fiesta is a live raffle for meetups, booths, and livestreams. Guests join a room with a short code. The host draws a winner on the big screen.

## What it does

- Open a room with a title, prize, and a meetup, booth, or virtual style.
- Share a join code, a link, or a QR code. Booth rooms keep the code off the projector.
- Guests enter a name from their phone. Hosts can also import a check-in list from CSV.
- Lock entries, draw, redraw, and reveal the winner on the stage view.
- Sign in with Google to save rooms and draws. Guests still join with the code and do not need an account.
- A host pin unlocks Draw on a screen that isn’t signed in.

On Netlify, rooms live in a Netlify Blobs store named `raffle-rooms`, keyed by the Google account the same way [Meridian](https://github.com/sidagarwal04/meridian-app) stores trips. Locally, without Netlify Blobs credentials, they live in a SQLite file under `data/`. That folder is not part of the repo.

## Requirements

- Node.js 22 or newer

## Run locally

```bash
npm install
npm run dev
```

The web app is at [http://localhost:5173](http://localhost:5173). The API listens on port 8787 and Vite proxies `/api` to it.

Production serves the built app from the same process:

```bash
npm run build
npm start
```

Tests:

```bash
npm test
```

## Google sign-in

Create an OAuth client in Google Cloud Console (Web application). Add these authorized redirect URIs:

- `http://localhost:5173/api/auth/callback`
- `https://YOUR-SITE.netlify.app/api/auth/callback`

Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. On Netlify, set the same two variables for Functions, then redeploy.

## Netlify

The site build publishes `dist`. `/api/*` runs as a Function. Signed-in rooms are stored with `@netlify/blobs`. Netlify injects the Blobs context in production, so no database setup is required.

To point local dev at the live store, set `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` in `.env`. Leave them empty to keep using the local SQLite file.
