# MedLab - Cloud-Based Medical Laboratory System (Random Forest decision support)

> **STATUS: WORK IN PROGRESS.** Phases 1-3 are implemented; initial Prisma, build, seed, and API smoke
> verification has now been run. Phases 4-8 remain incomplete. See "Verification status" for exact results.

## Architecture
Browser -> Next.js (apps/web) -> NestJS REST `/api/v1` (apps/api) -> PostgreSQL (Prisma) and protected FastAPI ML service (apps/ml-service).
Single schema owner: `apps/api/prisma/schema.prisma`. Shared RBAC matrix: `packages/shared-types/src/permissions.ts`.

## Implementation status
| Phase | Scope | State |
|---|---|---|
| 1-2 | Workspace, env template, Docker Postgres, Prisma schema, idempotent seed, guarded reset | Implemented; install, schema, migration, and seed verified |
| 3 | Env validation, Argon2id, login/refresh rotation+reuse detection, lockout, password reset, deny-by-default RBAC, CSRF origin guard, admin user provisioning, audit service, exception filter, health/readiness | Implemented; build and API smoke flows verified |
| 4 | Patients, test catalogue, requests, specimens, results/amendments, reports+PDF, dashboard, audit read API | **Not started** |
| 5 | ML dataset, Random Forest training/eval, FastAPI service, NestJS integration | **Not started** |
| 6 | Next.js pages | **Not started** |
| 7-8 | Test suites, e2e, full docs | **Not started** |

## Verification status (actually executed)
- PASS: `pnpm install`; dependency lockfile was up to date. pnpm reported an existing webpack peer-dependency warning.
- PASS: Prisma Client generation and `prisma validate` (Prisma 5.22.0).
- PASS: `pnpm db:migrate` against the configured database; one migration was found and no migration was pending.
- PASS: demo seed run twice; both runs reported `users=6 patients=6 tests=12 requests=7 specimens=7 results=8 reports=1 audit=26`.
- PASS: after the HTTP checks added expected audit events, two more seed runs each reported the stable total `audit=38`.
- PASS: API TypeScript typecheck and NestJS build.
- PASS: 5 shared RBAC tests.
- PASS: API HTTP smoke checks: all five active demo accounts logged in; inactive account was rejected; `/auth/me`, admin and wrong-role access, missing-Origin rejection, refresh rotation/reuse revocation, logout, and password reset were exercised. The reset test used a directly inserted one-time test token. Demo credentials were restored by re-running the seed.
- PASS: `GET /api/v1/health` returned `200 {"status":"ok"}`; `/health/ready` returned HTTP 200 with database `ok` and optional ML service `down`.
- PASS: workspace `pnpm build` and `pnpm typecheck`, including the new Supertest suite, pass.
- NOT RUN: database-backed Jest/Supertest suite is implemented but requires a separate `.env.test` database. It has not been run; do not point it at the application or production database.
- NOT RUN: real email delivery/reset-link retrieval, expired/malformed JWT cases, rate-limit verification, complete security/e2e suites, `pnpm audit`, ML training, and frontend verification.

## Setup
```bash
cp .env.example .env            # replace every placeholder secret (min 32 chars)
docker compose up -d postgres   # or point DATABASE_URL/DIRECT_URL at Neon
pnpm install
pnpm db:generate
pnpm db:migrate:init             # FIRST RUN ONLY: creates the initial migration
pnpm db:migrate                  # subsequent deploys use committed migrations
pnpm db:seed
pnpm db:reset                   # local dev DB only; refuses production and non-local hosts
pnpm dev                         # API on :4000, Swagger at /api/docs (non-production)
```
Use a dedicated non-production database for migrations and demo seeding. `pnpm db:migrate:init` is only for a database
without an initial migration; do not use it to reset an existing or production database.

### Database-backed API tests

The test runner refuses to proceed unless `NODE_ENV=test` and both database URLs name a database containing `test`.
On Windows PowerShell, create the isolated local test database and env file with:

```powershell
Copy-Item .env.test.example .env.test
docker compose up -d postgres-test
pnpm test:db:prepare
pnpm test
```

The Compose test database is isolated on `127.0.0.1:5433` with its own persistent volume. Never replace
`.env.test` URLs with production or application database URLs.

## Demo credentials (PUBLICLY KNOWN - never deploy with these)
| Role | Email | Password |
|---|---|---|
| Administrator | admin@medlab.local | MedLabAdmin!2026 |
| Laboratory Scientist | scientist@medlab.local | MedLabLab!2026 |
| Laboratory Scientist | scientist2@medlab.local | MedLabLab2!2026 |
| Clinician | clinician@medlab.local | MedLabDoctor!2026 |
| Clinician | clinician2@medlab.local | MedLabDoctor2!2026 |
| Clinician (deactivated, must fail login) | inactive@medlab.local | MedLabInactive!2026 |

The seed refuses to run when `NODE_ENV=production`. All seeded rows have `isDemo=true`. No predictions are seeded (no model exists yet).

## Security decisions made so far
Argon2id; HttpOnly SameSite=Strict cookies (no localStorage tokens); hashed, rotating refresh tokens with family revocation on reuse;
identical login errors for all failure causes plus dummy-hash timing equalisation; 5-failure lockout; rate limits on auth routes;
role re-read from DB each request; whitelist-only DTOs; passwordHash never selected for responses; append-only audit service;
last-admin and self-demotion protections; administrators lack result entry/validation/amendment permissions.

## Known gaps / blockers
- No migration SQL yet (needs a live PostgreSQL to generate).
- No lockfile (needs network).
- Dataset for the ML phase must be supplied or downloaded; otherwise a clearly labelled synthetic set will be used.
- Nigerian data-protection (NDPA 2023) and clinical governance review is still required before any real deployment.


<!-- pnpm --filter @medlab/api prisma:migrate:dev --name init -->