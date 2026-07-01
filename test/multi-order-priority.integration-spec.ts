import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { MockTimeProvider } from '../src/common/time/mock-time.provider';
import { TimeProvider } from '../src/common/time/time-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { KitchenSchedulerService } from '../src/scheduler/kitchen-scheduler.service';

const BASE_TIME = new Date('2025-01-01T10:00:00.000Z').getTime();

/**
 * Exercises the priority queue with several concurrent orders across tiers.
 *
 * The kitchen has 2 ovens x 3 slots = 6 slots. Once full, new jobs wait in a
 * queue sorted by TIER1 < TIER2 < TIER3, then by enqueue time. This test proves
 * that a TIER1 order enqueued LAST is served BEFORE earlier TIER2/TIER3 orders
 * as soon as a slot frees up.
 */
describe('Multiple orders across tiers — priority scheduling (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: KitchenSchedulerService;
  let mockTime: MockTimeProvider;
  let customerToken: string;
  let kitchenToken: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TimeProvider)
      .useClass(MockTimeProvider)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = module.get(PrismaService);
    scheduler = module.get(KitchenSchedulerService);
    mockTime = module.get(TimeProvider) as MockTimeProvider;

    const jwt = module.get(JwtService);
    customerToken = await jwt.signAsync({ sub: 'cust-id', email: 'customer@test.com', role: 'CUSTOMER' });
    kitchenToken = await jwt.signAsync({ sub: 'kitchen-id', email: 'kitchen@test.com', role: 'KITCHEN_MANAGER' });
  });

  afterAll(async () => {
    await cleanDb();
    await app.close();
  });

  afterEach(async () => {
    await cleanDb();
    await scheduler.reset();
    mockTime.setNow(BASE_TIME);
  });

  async function cleanDb() {
    await prisma.paymentRecord.deleteMany();
    await prisma.kitchenJob.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.menuItem.deleteMany();
  }

  // Places a single-item order and returns its orderId.
  async function placeOrder(menuItemId: string, priorityLevel: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ menuItemId, quantity: 1 }], priorityLevel })
      .expect(201);
    return res.body.orderId;
  }

  async function advance(minutes: number): Promise<number> {
    const res = await request(app.getHttpServer())
      .post('/kitchen/advance-time')
      .send({ minutes })
      .expect(200);
    return res.body.completedJobs;
  }

  async function monitor() {
    const res = await request(app.getHttpServer())
      .get('/kitchen/monitor')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .expect(200);
    return res.body;
  }

  // Status of the (single) kitchen job belonging to an order. Note: QUEUED jobs
  // live only in memory (never persisted), so this returns undefined while queued
  // and only resolves to BAKING / DONE once the job is written to Postgres.
  async function jobStatusOf(orderId: string): Promise<string | undefined> {
    const item = await prisma.orderItem.findFirst({
      where: { orderId },
      include: { kitchenJob: true },
    });
    return item?.kitchenJob?.status;
  }

  // The (single) OrderItem id of an order — used to match against the in-memory queue.
  async function orderItemIdOf(orderId: string): Promise<string> {
    const item = await prisma.orderItem.findFirst({ where: { orderId } });
    return item!.id;
  }

  // orderItemIds currently waiting in the queue, in priority order (from the monitor).
  function queuedItemIds(state: { queue: Array<{ job: { orderItemId: string } }> }): string[] {
    return state.queue.map((q) => q.job.orderItemId);
  }

  async function orderStatusOf(orderId: string): Promise<string> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    return order!.status;
  }

  it('a TIER1 order enqueued last jumps ahead of earlier TIER2/TIER3 orders when a slot frees', async () => {
    mockTime.setNow(BASE_TIME);

    // --- Fillers to occupy all 6 slots -------------------------------------
    // 5 distinct long-baking (20 min) items in ONE order → slots 1..5.
    const longFillers = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.menuItem.create({
          data: { name: `Long Filler ${i + 1}`, category: 'PASTRY', price: 1, bake_minutes: 20 },
        }),
      ),
    );
    const longOrderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: longFillers.map((f) => ({ menuItemId: f.id, quantity: 1 })), priorityLevel: 'TIER2' })
      .expect(201);
    const longOrderId: string = longOrderRes.body.orderId;

    // 1 short (5 min) filler in its own order → slot 6. Frees first.
    const shortFiller = await prisma.menuItem.create({
      data: { name: 'Short Filler', category: 'COOKIE', price: 1, bake_minutes: 5 },
    });
    const shortOrderId = await placeOrder(shortFiller.id, 'TIER2');

    // --- Three contended orders, enqueued in REVERSE priority order --------
    const cookie = await prisma.menuItem.create({
      data: { name: 'Cookie', category: 'COOKIE', price: 1.5, bake_minutes: 5 },
    });
    const pastry = await prisma.menuItem.create({
      data: { name: 'Danish', category: 'PASTRY', price: 3, bake_minutes: 10 },
    });
    const bread = await prisma.menuItem.create({
      data: { name: 'Baguette', category: 'BREAD', price: 4, bake_minutes: 20 },
    });

    const cookieOrderId = await placeOrder(cookie.id, 'TIER3'); // enqueued 1st
    const pastryOrderId = await placeOrder(pastry.id, 'TIER2'); // enqueued 2nd
    const breadOrderId = await placeOrder(bread.id, 'TIER1'); // enqueued 3rd (highest priority)

    const cookieItemId = await orderItemIdOf(cookieOrderId);
    const pastryItemId = await orderItemIdOf(pastryOrderId);
    const breadItemId = await orderItemIdOf(breadOrderId);

    // --- Phase 1: kitchen full, three jobs waiting, reordered by priority ---
    let state = await monitor();
    expect(state.totalBaking).toBe(6);
    expect(state.totalQueued).toBe(3);
    // Despite enqueue order cookie(T3) → pastry(T2) → bread(T1), the queue is priority-sorted:
    // TIER1 bread first even though it arrived last.
    expect(queuedItemIds(state)).toEqual([breadItemId, pastryItemId, cookieItemId]);
    // Queued jobs are in-memory only, so none are persisted yet.
    expect(await jobStatusOf(breadOrderId)).toBeUndefined();

    // --- Phase 2: advance 5 min → short filler done, ONE slot frees --------
    const completed = await advance(5);
    expect(completed).toBe(1); // only the 5-min short filler

    // The freed slot goes to the highest-priority queued job: the TIER1 bread,
    // even though it was enqueued AFTER the TIER2 pastry and TIER3 cookie.
    expect(await jobStatusOf(breadOrderId)).toBe('BAKING');

    // Short filler's order auto-transitioned to READY.
    expect(await orderStatusOf(shortOrderId)).toBe('READY');

    // Queue now holds the remaining two (still in memory), still priority-ordered.
    state = await monitor();
    expect(state.totalQueued).toBe(2);
    expect(queuedItemIds(state)).toEqual([pastryItemId, cookieItemId]);

    // --- Phase 3: advance to BASE+20 → 5 long fillers done, freeing 5 slots -
    // pastry (T2) and cookie (T3) both get assigned; long filler order → READY.
    await advance(15); // total elapsed: 20 min
    expect(await orderStatusOf(longOrderId)).toBe('READY');
    expect(await jobStatusOf(pastryOrderId)).toBe('BAKING');
    expect(await jobStatusOf(cookieOrderId)).toBe('BAKING');

    // --- Phase 4: advance far enough for everything to finish --------------
    await advance(15); // total elapsed: 35 min — covers bread(done@25), pastry(@30), cookie(@25)
    for (const id of [breadOrderId, pastryOrderId, cookieOrderId]) {
      expect(await orderStatusOf(id)).toBe('READY');
    }
    state = await monitor();
    expect(state.totalBaking).toBe(0);
    expect(state.totalQueued).toBe(0);
  });
});
