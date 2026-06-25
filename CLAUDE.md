# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev          # watch mode (pino-pretty log output)
npm run build              # compile via nest build

# Testing
npm test                   # unit tests (src/**/*.spec.ts)
npm run test:watch         # unit tests in watch mode
npm run test:cov           # unit tests with coverage
npm run test:e2e           # e2e suite (test/*.e2e-spec.ts)
npm run test:integration   # integration suite against real Postgres (test/*.integration-spec.ts)

# Run a single unit test file
npx jest src/scheduler/kitchen-scheduler.service.spec.ts

# Database
npx prisma migrate dev     # apply migrations in development
npx prisma migrate deploy  # apply migrations in CI / production
npx prisma db seed         # seed initial data
npx prisma studio          # GUI

# Docker (includes Postgres on port 5433 + Adminer on 8080)
docker compose up -d
```

### Integration test requirements

Integration tests expect Postgres running at `postgresql://snack:snack@localhost:5433/snack_builders?schema=test`. The global setup (`test/integration-global-setup.js`) runs `prisma migrate deploy` against that schema automatically. Start the database with `docker compose up -d postgres` before running the integration suite.

## Architecture

NestJS monolith backed by PostgreSQL (Prisma 7, adapter-based `PrismaPg` connection — not the default direct URL mode). All routes are JWT-protected globally via `APP_GUARD`; mark public endpoints with `@Public()`.

### Modules

| Module | Responsibility |
|---|---|
| `AuthModule` | JWT login, `JwtAuthGuard` (global), `RolesGuard`, `@Roles()` / `@Public()` decorators |
| `MenuModule` | CRUD for `MenuItem` (STORE_MANAGER) |
| `OrdersModule` | Create & retrieve orders; enqueues one `KitchenJob` per `OrderItem` via `KitchenSchedulerService` |
| `PaymentsModule` | Record and confirm payment for a READY order |
| `KitchenModule` | `GET /kitchen/monitor` (live oven state), `POST /kitchen/advance-time` (test helper) |
| `SchedulerModule` | `KitchenSchedulerService` — the in-memory oven grid and priority queue |
| `MetricsModule` | Prometheus metrics at `/metrics` via `@willsoto/nestjs-prometheus`; exported as `@Optional()` injectables |
| `PrismaModule` | Global `PrismaService`; uses `PrismaPg` adapter |
| `TimeProviderModule` | Global `TimeProvider` DI token; `RealTimeProvider` in production, `MockTimeProvider` in tests |

### Kitchen Scheduler (`KitchenSchedulerService`)

Two ovens × three slots = six total slots. All state lives in two `Map` structures:

- `ovens: Map<ovenNumber, Map<slotNumber, KitchenJob | null>>`
- `queue: KitchenJob[]` — sorted by TIER1 < TIER2 < TIER3, then by `enqueuedAt`

Every mutating public method (`enqueue`, `completeBaking`, `assignPendingJobs`) runs inside `async-mutex`'s `runExclusive`. Private helpers never acquire the lock — they are always called from within an already-locked context.

ETA model: queued jobs form a serial chain starting from the earliest slot-free timestamp. A TIER1 insertion re-sorts the queue and recalculates every downstream job's ETA (`affectedJobs` in the response).

Persistence: only BAKING and DONE transitions are written to Postgres. QUEUED jobs exist only in memory — they are lost on restart.

### TimeProvider pattern

`TimeProvider` is an abstract class. Inject it in any service that needs the current time instead of calling `Date.now()` directly. `MockTimeProvider.setNow(ms)` pins the clock in unit tests; `POST /kitchen/advance-time` drives it in integration tests.

### Swagger

Available at `/api-docs` when the server is running. All routes use `@ApiTags`, `@ApiOperation`, and `@ApiResponse` decorators. Bearer auth is configured via `DocumentBuilder.addBearerAuth()`.

### Roles

`CUSTOMER`, `STORE_MANAGER`, `KITCHEN_MANAGER` (Prisma enum `Role`). Use `@Roles(Role.X)` + `@UseGuards(RolesGuard)` on controllers that need role checks on top of JWT authentication.
