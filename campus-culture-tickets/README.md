# Campus Culture — Ticket Site

Sells Early Bird / Regular / VIP tickets for the 25 Sep event at Saju Gardens,
takes payment via M-Pesa STK Push through **PayHero**, and auto-closes Early
Bird sales at a cutoff you set.

Requires **Node.js 18+** (uses the built-in `fetch`) and a **Postgres**
database.

## 1. Get your PayHero details (5 min)

Log in at https://app.payhero.co.ke:
- **API username & password** — Settings/API section. These become
  `PAYHERO_USERNAME` / `PAYHERO_PASSWORD`.
- **Channel ID** — Payment Channels → My Payment Channels → the till/paybill
  you want the money to land in. This becomes `PAYHERO_CHANNEL_ID`.

## 2. Configure

```
cp .env.example .env
```
Fill in `PAYHERO_USERNAME`, `PAYHERO_PASSWORD`, `PAYHERO_CHANNEL_ID`,
`DATABASE_URL`, `EARLY_BIRD_CUTOFF` (tonight's midnight, e.g.
`2026-09-09T23:59:59+03:00`), and `ADMIN_KEY` (any password you choose, used
to view `/api/orders`).

`PUBLIC_URL` matters: PayHero sends the payment result to
`PUBLIC_URL/api/payhero/callback`, so it must be the real https address the
site is live at — not localhost. You only know this after step 3.

## 3. Fastest way to go live: Render.com (free tier, ~10 min)

1. Push this folder to a GitHub repo (or use Render's "deploy from folder"
   if you have Claude Code / a CLI handy).
2. On Render: **New → Web Service**, connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. **New → PostgreSQL** (free tier) → copy its Internal Connection String
   into `DATABASE_URL` on the web service's Environment tab.
4. Add all the other `.env` variables in the Environment tab.
5. Once deployed, copy the `https://your-app.onrender.com` URL Render gives
   you, set it as `PUBLIC_URL` in the environment variables, and redeploy
   (env var changes need a restart).

Railway.app and Fly.io work the same way if you prefer those.

### If you'd rather test locally first
```
npm install
npm start
```
Then use `ngrok http 3000` (or similar) to get a temporary public https URL,
set that as `PUBLIC_URL`, restart the server, and test a real STK push to
your own phone before pointing people at it.

## What the site does

- `GET /api/tickets` — tells the frontend which tiers are on sale. Early
  Bird disappears automatically once `EARLY_BIRD_CUTOFF` passes (checked
  server-side too, so it can't be bypassed by changing a phone's clock).
- `POST /api/checkout` — saves a `PENDING` order, fires the M-Pesa STK
  push to the buyer's phone.
- `POST /api/payhero/callback` — PayHero calls this automatically when the
  buyer enters their PIN (or cancels); marks the order `SUCCESS`/`FAILED`.
- `GET /api/order/:reference` — the page polls this every 3s to show the
  buyer a live "payment confirmed" state.
- `GET /api/orders?key=YOUR_ADMIN_KEY` — plain JSON list of every order, for
  a quick sales check from your phone/laptop during the event.

## Notes / things worth knowing before you rely on this for real money

- I built and reviewed this code carefully, using PayHero's published API
  reference, but I have no internet access in this environment and could
  not make a live test call — **do one real test purchase with your own
  phone before sharing the link publicly.**
- The transaction-status polling endpoint's exact query parameter wasn't
  fully documented publicly; this build relies on PayHero's **callback
  webhook** (the documented, recommended path) rather than polling
  PayHero directly, which is the more reliable approach anyway.
- Ticket prices and the Under-18 notice are pulled straight from your
  poster (Early Bird 300, Regular 400, VIP 1000).
