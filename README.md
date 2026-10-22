# Raffle

Spin Fiesta is a live raffle for meetups, booths, and livestreams. Guests join a room with a short code. The host draws a winner on the big screen.

## What it does

- Open a room with a title, prize, and a meetup, booth, or virtual style.
- Share a join code, a link, or a QR code. Booth rooms keep the code off the projector.
- Guests enter a name from their phone. Hosts can also import a check-in list from CSV.
- Lock entries, draw, redraw, and reveal the winner on the stage view.
- A host pin stays on the computer that created the room and is required to draw.

Rooms are stored in a local SQLite database under `data/`. That folder is not part of the repo.

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
