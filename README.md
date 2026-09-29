# STALK

Social hub for [Stonkfun](https://www.stonkfun.xyz) — message boards, tracked callouts, holder chat, and $STALK voting.

## Stack

- **Express** (ESM) API + static hosting
- **Vite** vanilla JS frontend
- **Phantom** Browser SDK (`injected`; optional Portal `appId` for Google/Apple)
- **Postgres** on Heroku (`DATABASE_URL`), or local JSON file store when unset
- Stonkfun public API for token browse/market snapshots

## Features

| Feature | Gate |
|--------|------|
| Browse tokens + boards | Public browse; posts require signed-in wallet |
| Callouts + performance tracking | Must hold the token |
| Holder chat | Must hold the token |
| Token votes (`Good Tek`, `REAL`, `Dank Meme`, `Danger`, `LARP`) | 500,000 $STALK (configurable) |

## Local setup

```bash
cp .env.example .env
npm install
npm run build
npm run dev
```

Frontend hot-reload (proxy `/api` → Express):

```bash
# terminal 1
npm run dev
# terminal 2
npm run dev:client
```

Open http://localhost:5173 (Vite) or http://localhost:3000 (built assets).

### Env

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Signs session cookies |
| `SOLANA_RPC_URL` | RPC for SPL / Token-2022 balance checks |
| `STALK_MINT` | $STALK mint (required for voting) |
| `STALK_VOTE_THRESHOLD` | Default `500000` |
| `DATABASE_URL` | Heroku Postgres URL |
| `PHANTOM_APP_ID` / `VITE_PHANTOM_APP_ID` | Phantom Portal app id (needed for social login) |

## Heroku

```bash
heroku create your-stalk-app
heroku addons:create heroku-postgresql:essential-0
heroku config:set SESSION_SECRET="$(openssl rand -hex 32)"
heroku config:set SOLANA_RPC_URL="https://your-rpc.example"
heroku config:set STALK_MINT="..."
heroku config:set VITE_PHANTOM_APP_ID="..."   # baked in at build via heroku-postbuild
git push heroku main
```

Allowlist your Heroku URL in [Phantom Portal](https://phantom.com/portal) when using embedded/social providers.

## API sketch

- `GET /api/tokens` — proxy Stonkfun list
- `GET /api/tokens/:mint` — token + holdings + vote tallies
- `GET|POST /api/boards/:mint` — message board
- `GET|POST /api/callouts` — callouts (POST requires holder)
- `GET|POST /api/chat/:mint` — holder chat history / fallback POST
- Socket.IO `/socket.io` — live holder chat (`chat:join`, `chat:send`, `chat:message`)
- `GET|POST /api/votes/:mint` — $STALK-gated votes
- `GET /api/auth/nonce` → sign → `POST /api/auth/verify`

## Notes

- Token-2022 balances are checked (Stonkfun LaunchLab mints).
- Without `STALK_MINT`, voting returns `503` until you set it.
- Callout performance uses Stonkfun price/mcap at call time vs live reads.
- Holder chat is realtime via Socket.IO (session cookie auth + on-join balance check). Single Heroku dyno is enough; multi-dyno needs a Redis adapter later.
