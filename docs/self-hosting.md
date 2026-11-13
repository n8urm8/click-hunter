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

Sign-in runs on Clerk, so the backend needs no auth keypair. Set up Clerk
before the first push (see [Accounts](#accounts-clerk)).

## 2. Push your Convex functions

```bash
pnpm backend:push
```

This typechecks, regenerates `convex/_generated`, and pushes functions, indexes,
and schema to the self-hosted backend. The push fails until
`CLERK_JWT_ISSUER_DOMAIN` is set on the deployment, because `auth.config.ts`
reads it at push time.

## 3. Run the game against it

```bash
pnpm dev
```

`dev` is the self-hosted flow: it loads `docker/.env.selfhosted` for both
the Convex CLI (`--env-file`) and Vite (`VITE_CONVEX_URL`), then runs
`convex dev --start 'vite'` as usual. (`pnpm dev:selfhosted` is the same
command under its old name.) To use Convex Cloud instead: `pnpm dev:cloud`
(still reads `.env.local`).

## 4. Seed / migrate data

Fresh seed: open the app → Admin panel → run the reseed action (same as cloud).

For content added after the first seed, run `pnpm deploy:migrations`. It includes
`migrate:leathercrafting`, an insert-only backfill that adds the leathercrafting
skill, items, recipes, balance keys, and hide drops without touching existing
rows (see `docs/adr/0001-leathercrafting-backfill.md`).

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
- `convex` commands hitting cloud instead of local: make sure you used a
  self-hosted script (`pnpm dev`, `pnpm backend:push`) or
  `--env-file docker/.env.selfhosted` — bare `convex` without the env file
  targets cloud via `.env.local`. `pnpm dev:cloud` is the explicit
  cloud-dev alternative.

## Accounts (Clerk)

Every character belongs to a Clerk account. The first screen is sign-in or
sign-up, and there is no anonymous play. Clerk handles passwords, email
verification and password reset, so the app needs no mail settings.

One-time Clerk setup:

1. Create an application in the Clerk dashboard and enable email and password.
2. Create a JWT template named `convex` for the Convex integration. Clerk's
   Convex guide lists the exact steps and the audience to use.
3. Note the issuer domain (the Frontend API URL, such as
   `https://your-app.clerk.accounts.dev`) and the publishable key (`pk_...`).

Give the issuer domain to the deployment. The push and the sign-in check both
read it:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
```

The web build needs the publishable key. For `pnpm dev`, add it to
`docker/.env.selfhosted`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx
```

For Docker, pass it at build time: `--build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx`.
The app stops at a configuration error until the key is set.

Characters created before this switch belong to the old login system, so they
are not linked to Clerk accounts. Reseed or wipe local data after switching.

## Admin access

New characters are plain players. Grant or revoke admin from the CLI:

```bash
npx convex run --env-file docker/.env.selfhosted admin:setPlayerRole '{"name":"Ash","role":"admin"}'
```

On a wiped database, create your character first, grant it admin, then run
`seed:populateAll` with that character's `playerId`.
