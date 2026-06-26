# Snack Builders Bakery API

REST API for a bakery's order management system — handles menu, orders, kitchen scheduling, and payments. Built as a code exercise for Stack Builders.

## Architecture

The application is a **NestJS monolith** backed by PostgreSQL (via Prisma 7). All routes are JWT-protected globally through `APP_GUARD`; public endpoints are opt-in with `@Public()`. Each feature follows a **controller → service → repository → Prisma** layering.

```mermaid
flowchart TB
    Client([Client]) -->|HTTP + Bearer JWT| JwtG[["JwtAuthGuard (APP_GUARD)"]]

    subgraph Features["Feature modules"]
        direction LR
        Auth[AuthModule] --> Users[UsersModule]
        Menu[MenuModule]
        Orders[OrdersModule]
        Payments[PaymentsModule]
        Kitchen[KitchenModule]
        Scheduler["SchedulerModule<br/>in-memory ovens + queue"]
    end

    JwtG --> Auth & Menu & Orders & Payments & Kitchen
    Orders -->|enqueue jobs| Scheduler
    Kitchen -->|monitor / advance-time| Scheduler

    Features --> Prisma[("PrismaService<br/>PrismaPg adapter")]
    Scheduler -.-> Time["TimeProvider"]
    Orders & Scheduler -.-> Metrics["Prometheus /metrics"]
```

> 📐 Full module-dependency and order-lifecycle diagrams: **[docs/architecture.md](docs/architecture.md)**

### Modules

| Module | Routes | Responsibility |
|---|---|---|
| `AuthModule` | `POST /auth/login` | JWT login, `JwtAuthGuard` (global), `RolesGuard`, `@Roles()` / `@Public()` decorators |
| `MenuModule` | `GET /menu` · `POST /menu` · `PATCH /menu/:id` · `DELETE /menu/:id` | CRUD for `MenuItem`; listing is public, mutations require `STORE_MANAGER` |
| `OrdersModule` | `POST /orders` · `GET /orders/:id` · `PATCH /orders/:id/status` | Create & retrieve orders; enqueues one `KitchenJob` per `OrderItem` via `KitchenSchedulerService` |
| `PaymentsModule` | `POST /payments` · `GET /payments/:orderId` | Record and confirm payment for a `READY` order |
| `KitchenModule` | `GET /kitchen/monitor` · `POST /kitchen/advance-time` | Live oven state (KITCHEN_MANAGER) and test clock helper |
| `SchedulerModule` | — (internal) | `KitchenSchedulerService` — in-memory oven grid and priority queue |
| `MetricsModule` | `GET /metrics` | Prometheus scrape endpoint via `@willsoto/nestjs-prometheus` |
| `PrismaModule` | — (global) | `PrismaService` using the `PrismaPg` adapter |
| `TimeProviderModule` | — (global) | `TimeProvider` DI token; `RealTimeProvider` in production, `MockTimeProvider` in tests |

### Roles

| Role | Access |
|---|---|
| `CUSTOMER` | Place orders, view own orders, process payments |
| `STORE_MANAGER` | Manage menu items, view any order, view payment records |
| `KITCHEN_MANAGER` | View live kitchen monitor, mark orders as READY |

### Kitchen Scheduler

Two ovens × three slots = **six total slots**. All state lives in two in-memory `Map` structures:

- `ovens: Map<ovenNumber, Map<slotNumber, KitchenJob | null>>`
- `queue: KitchenJob[]` — sorted by `TIER1 < TIER2 < TIER3`, then by `enqueuedAt`

Every mutating method (`enqueue`, `completeBaking`, `assignPendingJobs`) runs inside `async-mutex`'s `runExclusive` to prevent race conditions on concurrent requests.

**ETA model:** queued jobs form a serial chain starting from the earliest slot-free timestamp. A `TIER1` insertion re-sorts the queue and recalculates every downstream job's ETA (`affectedJobs` in the response).

**Persistence:** only `BAKING` and `DONE` transitions are written to Postgres. `QUEUED` jobs exist only in memory — they are lost on restart.

---

## Database — Entity Relationship Diagram

```mermaid
erDiagram
    MenuItem ||--o{ OrderItem : "ordered as"
    Order ||--o{ OrderItem : "contains"
    Order ||--o| PaymentRecord : "paid by"
    OrderItem ||--o| KitchenJob : "baked as"
```

> 🗃️ Full attributed ER diagram (field types, keys, and the standalone `User` entity): **[docs/database.md](docs/database.md)**

### Models

| Model | Description |
|---|---|
| `User` | Authentication credentials and role |
| `MenuItem` | Bakery catalogue — name, category, price, bake time |
| `Order` | Customer order with priority level and lifecycle status |
| `OrderItem` | Line item linking an `Order` to a `MenuItem` with quantity |
| `KitchenJob` | One-to-one with `OrderItem`; tracks oven assignment and bake timestamps |
| `PaymentRecord` | One-to-one with `Order`; records payment method, amount, and completion |

### Enumerations

| Enum | Values |
|---|---|
| `Role` | `CUSTOMER` · `STORE_MANAGER` · `KITCHEN_MANAGER` |
| `Category` | `COOKIE` · `PASTRY` · `BREAD` |
| `PriorityLevel` | `TIER1` · `TIER2` · `TIER3` |
| `OrderStatus` | `PENDING` → `BAKING` → `READY` → `PAID` |
| `PaymentMethod` | `CASH` · `CARD` |
| `PaymentStatus` | `PENDING` · `COMPLETED` |
| `KitchenJobStatus` | `QUEUED` · `BAKING` · `DONE` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 · TypeScript 5 |
| ORM | Prisma 7 (adapter-based `PrismaPg`, not direct URL mode) |
| Database | PostgreSQL 16 |
| Auth | `@nestjs/jwt` · `passport-jwt` · bcrypt |
| Validation | `class-validator` · `class-transformer` |
| Logging | `nestjs-pino` · `pino-pretty` (dev) |
| Metrics | `@willsoto/nestjs-prometheus` · `prom-client` |
| API docs | `@nestjs/swagger` · Swagger UI |
| Concurrency | `async-mutex` |
| Containerisation | Docker · Docker Compose |

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- Docker & Docker Compose

### 1 — Environment variables

Create a `.env` file at the project root:

```env
DATABASE_URL=postgresql://snack:snack@localhost:5433/snack_builders?schema=public
JWT_SECRET=change-me-in-production
PORT=3000
```

### 2 — Start the database

```bash
docker compose up -d postgres
```

This starts PostgreSQL on **port 5433** and Adminer (database GUI) on **port 8080**.

### 3 — Apply migrations and seed

```bash
npx prisma migrate dev   # apply schema migrations
npx prisma db seed       # seed initial data (menu items, users)
```

### 4 — Start the API

```bash
npm run start:dev        # watch mode with pino-pretty logs
```

The API is available at `http://localhost:3000`.

### Run the full stack with Docker

```bash
docker compose up -d
```

This starts the API container, Postgres, and Adminer together. The API container runs `prisma migrate deploy` automatically on startup.

---

## API Reference

Full interactive documentation is available at [`/api-docs`](http://localhost:3000/api-docs) (Swagger UI).

### Authentication

```http
POST /auth/login
Content-Type: application/json

{ "email": "customer@example.com", "password": "secret" }
```

Returns `{ "access_token": "<JWT>" }`. Include it as `Authorization: Bearer <token>` on subsequent requests.

### Menu

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/menu` | Public | List all available items grouped by category |
| `POST` | `/menu` | STORE_MANAGER | Create a menu item |
| `PATCH` | `/menu/:id` | STORE_MANAGER | Update a menu item |
| `DELETE` | `/menu/:id` | STORE_MANAGER | Remove a menu item |

### Orders

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/orders` | CUSTOMER | Place a new order; returns ETA |
| `GET` | `/orders/:id` | CUSTOMER · STORE_MANAGER | Get order details |
| `PATCH` | `/orders/:id/status` | KITCHEN_MANAGER | Mark order as READY |

### Payments

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/payments` | CUSTOMER | Pay for a READY order |
| `GET` | `/payments/:orderId` | STORE_MANAGER | Get payment record |

### Kitchen

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/kitchen/monitor` | KITCHEN_MANAGER | Live oven slots and queue snapshot |
| `POST` | `/kitchen/advance-time` | Public | Advance clock N minutes (test environments only) |

### Observability

| Method | Path | Description |
|---|---|---|
| `GET` | `/metrics` | Prometheus scrape endpoint |
| `GET` | `/` | Health check — returns `"Snack Builders API"` |

**Prometheus metrics exposed:**

| Metric | Type | Labels | Description |
|---|---|---|---|
| `orders_placed_total` | Counter | `priority_level` | Total orders placed |
| `kitchen_queue_length` | Gauge | — | Jobs waiting in queue |
| `oven_utilization` | Gauge | — | Fraction of oven slots occupied (0–1) |

---

## Development Commands

```bash
# Development
npm run start:dev          # watch mode (pino-pretty log output)
npm run build              # compile via nest build
npm run start:prod         # run compiled output

# Linting & formatting
npm run lint               # ESLint with auto-fix
npm run format             # Prettier

# Database
npx prisma migrate dev     # apply migrations in development
npx prisma migrate deploy  # apply migrations in CI / production
npx prisma db seed         # seed initial data
npx prisma studio          # GUI at localhost:5555
```

---

## Testing

```bash
# Unit tests
npm test                   # run all unit tests
npm run test:watch         # watch mode
npm run test:cov           # with coverage report

# Run a single spec file
npx jest src/scheduler/kitchen-scheduler.service.spec.ts

# Integration tests (require Postgres running)
docker compose up -d postgres
npm run test:integration

# E2E tests
npm run test:e2e
```

### Integration test requirements

Integration tests target `postgresql://snack:snack@localhost:5433/snack_builders?schema=test`. The global setup (`test/integration-global-setup.js`) runs `prisma migrate deploy` against that schema automatically before the suite starts.

### TimeProvider pattern

`TimeProvider` is an abstract class injected into any service that needs the current time — never call `Date.now()` directly. `MockTimeProvider.setNow(ms)` pins the clock in unit tests. The `POST /kitchen/advance-time` endpoint drives it in integration tests, completing baking jobs and draining the queue deterministically.

---

## Design Notes

### Why in-memory scheduling?

The bakery has two physical ovens with six fixed slots — the cardinality is tiny and bounded. A database round-trip per scheduling decision would only add latency, while the in-memory priority queue re-sorts and recalculates all ETAs on every `TIER1` insertion in microseconds. Every `BAKING` and `DONE` transition is still persisted to Postgres as an audit log.

**Trade-off:** if the process crashes, `QUEUED` jobs (not yet assigned to a slot) are lost — they have no Prisma record. Acceptable for the exercise scope; a production system would persist QUEUED jobs too.

### Mutex strategy

Every public state-mutating method runs inside `async-mutex`'s `runExclusive`. This serialises concurrent callers and prevents two requests from racing to claim the same free oven slot or from a `completeBaking` drain conflicting with a concurrent `enqueue`. Private helpers never acquire the lock — they are always called from within an already-locked context, avoiding deadlocks.

### Horizontal scaling considerations

Running multiple API instances breaks the in-memory model:

1. **Queue state is not shared** — each instance has its own `Map`s.
2. **Mutex only guards a single process** — cross-instance writes need a distributed lock (Redis `SETNX`, Postgres advisory locks, or a broker like BullMQ).
3. **`MockTimeProvider` is per-process** — the advance-time endpoint only affects the instance it lands on.

To scale horizontally, replace the in-memory queue with a persistent ordered queue and make the oven grid a database table with compare-and-swap slot assignment.
