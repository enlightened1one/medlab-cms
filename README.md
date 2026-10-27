# MedLab - Cloud-Based Medical Laboratory System (Random Forest decision support)

> **STATUS: WORK IN PROGRESS.** Phases 1-6 are implemented. Phase 4 workflow and selected integration tests,
> plus Phase 5/6 verification, are recorded below. Phase 7-8 remain incomplete.

## Architecture
Browser -> Next.js (apps/web) -> NestJS REST `/api/v1` (apps/api) -> PostgreSQL (Prisma) and protected FastAPI ML service (apps/ml-service).
Single schema owner: `apps/api/prisma/schema.prisma`. Shared RBAC matrix: `packages/shared-types/src/permissions.ts`.

## Implementation status
| Phase | Scope | State |
|---|---|---|
| 1-2 | Workspace, env template, Docker Postgres, Prisma schema, idempotent seed, guarded reset | Implemented; install, schema, migration, and seed verified |
| 3 | Env validation, Argon2id, login/refresh rotation+reuse detection, lockout, password reset, deny-by-default RBAC, CSRF origin guard, admin user provisioning, audit service, exception filter, health/readiness | Implemented; build and API smoke flows verified |
| 4 | Patients, test catalogue, requests, specimens, results/amendments, reports+PDF, dashboard, audit read API | Implemented; compilation and API startup verified; database workflows unverified |
| 5 | ML dataset, Random Forest training/eval, FastAPI service, NestJS integration | Implemented as a synthetic educational prototype; tests/metrics below |
| 6 | Next.js pages | Implemented; production build and API client tests verified |
| 7-8 | Test suites, e2e, full docs | **Not started** |

## Verification status (actually executed)
- PASS: `pnpm install`; dependency lockfile was up to date. pnpm reported an existing webpack peer-dependency warning.
- PASS: Prisma Client generation and `prisma validate` (Prisma 5.22.0).
- PASS: `pnpm db:migrate` against the configured database; one migration was found and no migration was pending.
- PASS: demo seed run twice; both runs reported `users=6 patients=6 tests=12 requests=7 specimens=7 results=8 reports=1 audit=26`.
- PASS: after the HTTP checks added expected audit events, two more seed runs each reported the stable total `audit=38`.
- PASS: API TypeScript typecheck and NestJS build.
- PASS: shared RBAC tests (7 cases).
- PASS: API HTTP smoke checks: all five active demo accounts logged in; inactive account was rejected; `/auth/me`, admin and wrong-role access, missing-Origin rejection, refresh rotation/reuse revocation, logout, and password reset were exercised. The reset test used a directly inserted one-time test token. Demo credentials were restored by re-running the seed.
- PASS: `GET /api/v1/health` returned `200 {"status":"ok"}`; `/health/ready` returned HTTP 200 with database `ok` and optional ML service `down`.
- PASS: workspace `pnpm build` and `pnpm typecheck`, including the new Supertest suite, pass.
- PASS: Phase 4 API modules loaded at startup; `GET /api/v1/health` returned `{"status":"ok"}` and `/health/ready` returned `{"app":"ok","database":"ok","mlService":"down"}`.
- PASS: shared RBAC tests pass all 7 cases, including dashboard and prediction permissions.
- PASS: `pnpm ml:train` generated the 5,000-row synthetic dataset and versioned Random Forest pipeline; held-out 20% metrics were accuracy 1.000, macro precision 1.000, macro recall 1.000, and macro F1 1.000. Five-fold stratified training-partition CV accuracy and macro F1 were both 1.000 (standard deviation 0.000).
- PASS: `pnpm ml:test` (6 tests covering deterministic labels, health, metadata, authentication, strict schema, and body-size limits), plus live HTTP checks for health, model-info, rejected unauthenticated prediction, and a bearer-authenticated prediction.
- PASS: `pnpm typecheck` and `pnpm build` after adding the NestJS predictions module.
- PASS: `pnpm --filter @medlab/web typecheck`, `pnpm --filter @medlab/web build`, and `pnpm --filter @medlab/web test` (3 API client tests).
- NOT RUN: Phase 4 patient/request/specimen/result/report workflows and clinician IDOR cases are implemented as database-backed Jest/Supertest tests but require a separate `.env.test` database. They have not been run; do not point them at the application or production database.
- NOT RUN: live browser login/workflow against an authenticated API, Phase 4/5 database-backed integration, real email delivery/reset-link retrieval, expired/malformed JWT cases, rate-limit verification, complete security/e2e suites, `pnpm audit`, and frontend e2e/accessibility verification.

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

### Phase 4 workflow scope

The API now provides patient archive/search/history, test catalogue and reference-range reads, idempotent laboratory
request creation, specimen status history, version-checked result entry/validation/amendment, final report generation
and amendment (PDF plus print HTML), date-filtered dashboard counts, and a paginated read-only administrator audit API.
Report generation requires a final result for every request item; changing a validated result records a revision.
No Prisma schema changes were needed for this phase, so it adds no migration.

Clinicians can search the minimal active-patient directory (demographics only, no phone number) so they can place their
first laboratory request. Their request, patient-history, specimen, result, and report access is restricted to requests
they created. This directory visibility is broader than ownership-based visibility and is not yet validated by the
database-backed integration suite.

### Phase 5 ML prototype

The ML service is an educational CBC-pattern classifier trained only on a reproducible synthetic dataset generated
by `apps/ml-service/generate_synthetic_dataset.py`. Labels come from explicit, deterministic threshold rules for
synthetic anemia, red-cell-index, leukocyte, platelet, and within-reference patterns; there are no real patient
records and no random labels. Those rules and resulting metrics do **not** establish clinical validity. The model
must not be used for diagnosis, screening, triage, treatment, or clinical decisions.
The trained classes are `synthetic_anemia_pattern`, `synthetic_red_cell_index_pattern`,
`synthetic_leukocyte_pattern`, `synthetic_platelet_pattern`, and `within_synthetic_reference`.
Their synthetic rules are hemoglobin below the sex-specific generated cutoff (13.0/12.0/12.5 g/dL), otherwise
MCV below 80 or above 100 fL, otherwise WBC below 4 or above 11, otherwise platelets below 150 or above 450;
the first matching rule wins. These are dataset-labeling rules only, not clinical reference ranges.

After Python 3.11+ is available, install and run it from the repository root:

```powershell
python -m pip install -r apps/ml-service/requirements-dev.txt
pnpm ml:train
pnpm ml:test
pnpm ml:serve
```

Configure `.env`'s `ML_SERVICE_TOKEN` to a unique random secret of at least 32 characters. The same value must be
available to the API and ML service. Start the API separately with `pnpm dev`; the ML service listens only on
`127.0.0.1:8000` by default. `GET /health` and `GET /model-info` are informational; `POST /predict` requires the
service bearer token, uses a strict bounded feature schema, and rejects request bodies larger than 64 KiB.
Predictions are persisted with input-feature snapshots and model version, and are auditable. The API only accepts
the configured service URL; callers cannot supply a URL.
`POST /api/v1/predictions` accepts a patient ID, optional request ID, and the six model features (`age_years`,
`sex`, `hemoglobin_g_dl`, `mcv_fl`, `wbc_10e9_l`, and `platelets_10e9_l`). Clinicians must link a prediction to
one of their own requests; clinicians and lab scientists have prediction access, administrators do not.

Training writes the versioned pipeline to `apps/ml-service/artifacts/medlab-synthetic-cbc-v1.joblib`, metrics and
feature metadata to the adjacent JSON, and the labelled synthetic CSV to `apps/ml-service/data/`. The held-out
metrics are from a stratified 20% test partition; 5-fold stratified cross-validation runs on the training partition
with preprocessing inside the pipeline. Persisted artifacts are required before the service starts.

### Phase 6 frontend

The Next.js App Router frontend is in `apps/web`. It includes login, password recovery/reset, a responsive role-filtered
workspace, dashboard date filters, patient directory and history, request creation/review, specimen transitions,
result entry/submission/validation/amendment, final reports and PDF/print, catalogue/reference-range management,
educational predictions, administrator user management, and read-only audit logs.

The browser uses `HttpOnly` cookies with `credentials: include`; access and refresh tokens are never put in browser
storage. Session refresh is attempted once after an authenticated API request returns 401. Unsafe request calls rely
on the API's configured `CORS_ORIGINS` Origin allow-list. The shared RBAC permission matrix controls navigation and
visible actions; server-side authorization remains authoritative. Clinician history and request details stay
ownership-scoped. The prediction interface prominently labels the prototype as synthetic and non-clinical.

For local development, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1` in the root `.env`, ensure that
`CORS_ORIGINS` contains `http://localhost:3000`, start the API with `pnpm dev`, then in another terminal run:

```powershell
pnpm --filter @medlab/web dev
```

The web app is served at `http://localhost:3000`. To build and test it:

```powershell
pnpm --filter @medlab/web typecheck
pnpm --filter @medlab/web test
pnpm --filter @medlab/web build
```

The frontend has not been validated against authenticated server data or a production deployment. Do not claim
browser-level workflow, accessibility, or end-to-end verification until those suites have been run.

### Vercel multi-service deployment

The root `vercel.json` defines three services: the public Next.js web app (`/`), the public NestJS API (`/api/*`),
and an internal FastAPI ML service. The API declares a service binding to `ml-service`; Vercel injects its URL as
`ML_SERVICE_URL` at runtime. Do not manually define `ML_SERVICE_URL` in Vercel. The browser uses the same-origin
`/api/v1` path in production, which routes through the API rewrite; do not set `NEXT_PUBLIC_API_BASE_URL` to an
internal service binding URL. The API and web services each use a frozen, filtered pnpm workspace install so
their runtime and shared workspace dependencies are present in their deployment bundles. The API's Vercel build
explicitly generates Prisma Client from `prisma/schema.prisma` before compiling Nest; its `prebuild` script does
the same for package builds. The Nest production build includes only runtime source under `src/`, excluding CLI
seed, database scripts, and tests.

Configure these Vercel environment variables for the API and ML service as applicable: `DATABASE_URL`,
`DIRECT_URL`, `JWT_ACCESS_SECRET`, `ML_SERVICE_TOKEN`, `FRONTEND_URL`, and `CORS_ORIGINS`. `DATABASE_URL`,
`DIRECT_URL`, `JWT_ACCESS_SECRET`, `FRONTEND_URL`, and `CORS_ORIGINS` are required by the API; `ML_SERVICE_TOKEN`
is required by both the API and ML service and must have the same strong, unique value in both. `ML_SERVICE_URL`
is injected into the API by the binding and must not be manually configured. Set `FRONTEND_URL` to the canonical
web origin and include that origin in `CORS_ORIGINS`. In Vercel preview deployments, the API additionally allows
only the matching `VERCEL_URL` hostname when `VERCEL_ENV=preview` and that hostname ends in `.vercel.app`; arbitrary
origins and non-Vercel preview hosts are not allowed automatically. Configure SMTP values if password-reset email
delivery is required. Never use demo credentials or placeholder secrets in deployment.
Do not set `NODE_ENV=development` in Vercel; let Vercel select `production` for production deployments and its
appropriate value for previews.

Apply committed migrations from a trusted deployment environment with `pnpm db:migrate`; deployments do not
automatically migrate the database or seed demo data. The ML model artifact and metadata must be present in the
repository when building the ML service. Vercel service routing/bindings and these deployment steps have not yet
been verified with a Vercel deployment. Confirm the service names, public routes, and API-to-ML binding before
creating the Vercel project.

## Demo credentials (PUBLICLY KNOWN - never deploy with these)
| Role | Email | Password |
|---|---|---|
| Administrator | admin@medlab.local | MedLabAdmin!2026 |
| Laboratory Scientist | scientist@medlab.local | MedLabLab!2026 |
| Laboratory Scientist | scientist2@medlab.local | MedLabLab2!2026 |
| Clinician | clinician@medlab.local | MedLabDoctor!2026 |
| Clinician | clinician2@medlab.local | MedLabDoctor2!2026 |
| Clinician (deactivated, must fail login) | inactive@medlab.local | MedLabInactive!2026 |

The seed refuses to run when `NODE_ENV=production`. All seeded rows have `isDemo=true`. No predictions are seeded;
the model is an educational prototype and generates results only on explicit requests.

## Security decisions made so far
Argon2id; HttpOnly SameSite=Strict cookies (no localStorage tokens); hashed, rotating refresh tokens with family revocation on reuse;
identical login errors for all failure causes plus dummy-hash timing equalisation; 5-failure lockout; rate limits on auth routes;
role re-read from DB each request; whitelist-only DTOs; passwordHash never selected for responses; append-only audit service;
last-admin and self-demotion protections; administrators lack result entry/validation/amendment permissions.

## Known gaps / blockers
- Phase 5 metrics only measure recovery of deterministic synthetic rules; they provide no clinical evidence.
- Phase 4 workflow correctness and authorization still require execution against the isolated `.env.test` database.
- Phase 6 screens need authenticated API/browser workflow and accessibility verification.
- Nigerian data-protection (NDPA 2023) and clinical governance review is still required before any real deployment.
