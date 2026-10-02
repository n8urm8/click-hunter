# Self-hosting Convex with Docker

Runs the open-source Convex backend (`ghcr.io/get-convex/convex-backend`) locally
or on your own server, instead of Convex Cloud. Your `.env.local` cloud config is
untouched — self-hosted commands use `docker/.env.selfhosted` via `convex --env-file`.

| Service   | URL                         | Notes                                    |
| --------- | --------------------------- | ---------------------------------------- |
| backend   | `http://127.0.0.1:3210`     | Convex API (client + CLI target)         |
| site      | `http://127.0.0.1:3211`     | HTTP actions / auth JWKS origin          |
| dashboard | `http://localhost:6791`     | Self-hosted Convex dashboard             |
| web       | `http://localhost:8080`     | Production build (nginx, `web` service)  |

## 1. Start the stack

```bash
cp docker/.env.selfhosted.example docker/.env.selfhosted
docker compose up -d
docker compose exec backend ./generate_admin_key.sh
```

Paste the printed key into `docker/.env.selfhosted` as `CONVEX_SELF_HOSTED_ADMIN_KEY`.
(`docker/.env.selfhosted` is gitignored — never commit the key.)

Convex Auth needs an RS256 keypair on self-hosted backends (cloud provisions
this automatically). Generate it once and store it on the deployment:

```bash
node docker/generate-auth-keys.mjs   # writes docker/.auth-keys.env (gitignored)
set -a; . ./docker/.env.selfhosted; set +a
set -a; . ./docker/.auth-keys.env; set +a
printenv JWT_PRIVATE_KEY | npx convex env set JWT_PRIVATE_KEY
npx convex env set JWKS "$JWKS"
```

Keep `docker/.auth-keys.env`: re-apply it with the same two `env set` commands
after wiping the backend volume or when provisioning another backend.

## 2. Push your Convex functions

```bash
pnpm backend:push
```

This typechecks, regenerates `convex/_generated`, and pushes functions, indexes,
and schema to the self-hosted backend. `auth.config.ts` picks up
`CONVEX_SITE_URL` (port 3211) from the env file at push time. Sign-in
(including Anonymous) requires the auth keypair from step 1; if you add OAuth
providers later, follow the manual Convex Auth setup.

## 3. Run the game against it

```bash
pnpm dev:selfhosted
```

This loads `docker/.env.selfhosted` for both the Convex CLI (`--env-file`) and
Vite (`VITE_CONVEX_URL`), then runs `convex dev --start 'vite'` as usual.
To go back to Convex Cloud at any time: `pnpm dev` (still reads `.env.local`).

## 4. Seed / migrate data

Fresh seed: open the app → Admin panel → run the reseed action (same as cloud).

Copy data from Convex Cloud (run while you still have cloud access):

```bash
npx convex export --path ./backups/cloud-$(date +%F).zip   # uses .env.local (cloud); add --prod for the prod deployment
set -a; . ./docker/.env.selfhosted; set +a
npx convex import --path ./backups/cloud-*.zip              # resolves self-hosted backend from process env
```

Push functions (step 2) before importing so indexes exist.

## 5. Serve the production build (optional)

```bash
docker compose up -d --build web   # http://localhost:8080
```

## Remote server notes

- Set `PUBLIC_CONVEX_URL` (and `PUBLIC_CONVEX_SITE_URL`) to the public backend
  origin before `docker compose up`, e.g.
  `PUBLIC_CONVEX_URL=https://convex.example.com docker compose up -d --build`.
  The dashboard (`NEXT_PUBLIC_DEPLOYMENT_URL`) and the `web` build args follow it.
- The Convex client uses HTTP + WebSocket on the backend origin: your reverse
  proxy must forward `Upgrade` headers to port 3210 (and plain HTTP to 3211).
- Data lives in the `convex-data` Docker volume (SQLite by default). Back it up
  (`docker run --rm -v click-hunter_convex-data:/data -v "$PWD/backups:/backup" alpine tar czf /backup/convex-data.tgz /data`)
  or point the backend at Postgres/MySQL (`POSTGRES_URL`/`MYSQL_URL`/`DATABASE_URL`
  in a `docker-compose.override.yml`) and S3 storage per the
  [self-hosted guide](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md).
- Pin versions in production: `CONVEX_BACKEND_VERSION=x.y.z` matching your
  `convex` npm package; keep the backend image and the npm package in sync on upgrades.
- Rotate a leaked admin key by generating a new one (`generate_admin_key.sh`
  prints a fresh key each run) and updating `docker/.env.selfhosted`.

## Troubleshooting

- `Missing docker/.env.selfhosted` — copy the `.example` file (step 1).
- Wipe local backend data and start over: `docker compose down -v` (deletes the volume).
- `convex` commands hitting cloud instead of local: make sure you used the
  `:selfhosted` script or `--env-file docker/.env.selfhosted` — bare `pnpm dev`
  intentionally still targets cloud via `.env.local`.
