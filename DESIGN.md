# Design Notes — Bakery Kitchen API

## In-Memory Scheduler vs. Database Queue

The kitchen scheduler keeps its oven grid and job queue **entirely in memory** (`KitchenSchedulerService`). All baking state lives in two `Map` structures: one for the six oven slots and one for the ordered wait queue.

**Why in-memory?**
- The spec defines a single bakery with two physical ovens and six fixed slots. The cardinality is tiny and bounded, so a database query per scheduling decision would only add latency.
- The priority queue must be re-sorted on every TIER1 insertion to recalculate all downstream ETAs — an operation that is trivially fast in memory but would require a transactional read-modify-write cycle in a database.
- Persistence still happens: every BAKING and DONE transition is written to Postgres via Prisma, giving a durable audit log and making the in-memory state reconstructable after a restart (not yet implemented, but the data is there).

**Trade-off:** if the process crashes, the in-memory queue is lost. Jobs that were QUEUED (not yet assigned to a slot) have no Prisma record and would be silently dropped. For the exercise scope this is acceptable; a production system would persist QUEUED jobs too.

## Mutex Strategy

Every public method that mutates scheduler state (`enqueue`, `completeBaking`, `assignPendingJobs`) runs inside `async-mutex`'s `runExclusive`. The mutex serialises all concurrent callers, preventing:

- Two `enqueue` calls racing to claim the same free slot.
- A `completeBaking` draining the queue while a concurrent `enqueue` is inserting.

Private helpers (`findFreeSlot`, `assignJobToSlot`, `drainQueue`, etc.) never acquire the lock themselves — they are always invoked from within an already-locked context, which avoids deadlocks.

## TimeProvider Pattern

`TimeProvider` is an abstract class with a single method `now(): number`. The real implementation (`RealTimeProvider`) delegates to `Date.now()`. `MockTimeProvider` exposes `setNow(ms)`, allowing tests to pin and advance the clock deterministically.

This pattern keeps the scheduler and service logic free of `Date.now()` calls. Any test that needs time control swaps in `MockTimeProvider` via NestJS's DI — no monkey-patching required. The `POST /kitchen/advance-time` endpoint uses the same mechanism to simulate time passage in integration tests.

## What Would Need to Change for Horizontal Scaling

Running multiple API instances breaks the in-memory model in three ways:

1. **Queue state is not shared.** Each instance has its own `Map`s; a job enqueued on instance A is invisible to instance B.
2. **Mutex only guards a single process.** Cross-instance concurrent writes need a distributed lock (Redis `SETNX`, Postgres advisory locks, or a dedicated queue broker).
3. **`MockTimeProvider` is per-process.** The advance-time endpoint would only affect the instance it lands on.

To scale horizontally, replace the in-memory queue with a **persistent, ordered queue** (e.g., a `KitchenJob` table with status + priority + enqueued_at columns and a Postgres advisory lock for the drain loop, or a broker like BullMQ backed by Redis). The oven grid becomes a database table too, and each slot-assignment is a compare-and-swap update. The `TimeProvider` abstraction remains valid — only `MockTimeProvider` becomes irrelevant outside single-process tests.
