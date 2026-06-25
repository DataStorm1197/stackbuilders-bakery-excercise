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

describe('Kitchen advance-time (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: KitchenSchedulerService;
  let mockTime: MockTimeProvider;
  let customerToken: string;

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
  });

  afterAll(async () => {
    await cleanDb();
    await app.close();
  });

  afterEach(async () => {
    await cleanDb();
    resetScheduler();
    mockTime.setNow(BASE_TIME);
  });

  async function cleanDb() {
    await prisma.kitchenJob.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.menuItem.deleteMany();
  }

  function resetScheduler() {
    for (const [, slots] of scheduler.ovens) {
      for (const [slot] of slots) {
        slots.set(slot, null);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scheduler as any).queue = [];
  }

  it('returns 400 when minutes < 1', async () => {
    await request(app.getHttpServer())
      .post('/kitchen/advance-time')
      .send({ minutes: 0 })
      .expect(400);
  });

  it('returns 400 when minutes is not an integer', async () => {
    await request(app.getHttpServer())
      .post('/kitchen/advance-time')
      .send({ minutes: 1.5 })
      .expect(400);
  });

  /**
   * Scenario:
   * 1. Fill 5 slots with long-baking items (20 min) so the kitchen is near capacity.
   * 2. Place a TIER3 order (Cookies, 5 min) → occupies the last (6th) slot.
   * 3. Place a TIER1 order (Bread, 20 min) → all slots taken, lands in queue; TIER1
   *    priority guarantees it is first in line (VIP gets next slot).
   * 4. Advance time by 6 minutes → cookie job's estimatedDoneAt (BASE+5min) ≤ now
   *    (BASE+6min) so completeBaking fires; drainQueue assigns bread to the freed slot.
   * 5. Assert: cookie job = DONE in DB, bread job = BAKING in DB, queue empty.
   */
  it('TIER3 cookie finishes after 6-min advance and queued TIER1 bread moves to baking', async () => {
    mockTime.setNow(BASE_TIME);

    // 5 distinct menu items for fillers (same menu item id would fail the de-dup guard in orders service)
    const fillers = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.menuItem.create({
          data: { name: `Filler Pastry ${i + 1}`, category: 'PASTRY', price: 1.0, bake_minutes: 20 },
        }),
      ),
    );
    const cookie = await prisma.menuItem.create({
      data: { name: 'Cookie', category: 'COOKIE', price: 1.5, bake_minutes: 5 },
    });
    const bread = await prisma.menuItem.create({
      data: { name: 'Bread', category: 'BREAD', price: 4.0, bake_minutes: 20 },
    });

    // Fill slots 1-5 with 20-min filler items (one order, 5 distinct items → 5 jobs)
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: fillers.map((f) => ({ menuItemId: f.id, quantity: 1 })),
        priorityLevel: 'TIER2',
      })
      .expect(201);

    // Step 1 – TIER3 Cookie (5 min) → slot 6 (last free slot)
    const cookieOrderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ menuItemId: cookie.id, quantity: 1 }], priorityLevel: 'TIER3' })
      .expect(201);

    const cookieOrderItem = await prisma.orderItem.findFirst({
      where: { orderId: cookieOrderRes.body.orderId },
    });
    expect(cookieOrderItem).not.toBeNull();

    // Step 2 – TIER1 Bread (20 min) → all slots full → queued with VIP priority
    const breadOrderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ menuItemId: bread.id, quantity: 1 }], priorityLevel: 'TIER1' })
      .expect(201);

    const breadOrderItem = await prisma.orderItem.findFirst({
      where: { orderId: breadOrderRes.body.orderId },
    });
    expect(breadOrderItem).not.toBeNull();

    // Confirm bread is at the front of the in-memory queue (TIER1 priority)
    const { queue } = scheduler.getKitchenState();
    expect(queue).toHaveLength(1);
    expect(queue[0].priorityLevel).toBe('TIER1');

    // Step 3 – Advance 6 minutes
    const advanceRes = await request(app.getHttpServer())
      .post('/kitchen/advance-time')
      .send({ minutes: 6 })
      .expect(200);

    // Cookie estimatedDoneAt = BASE+5min ≤ BASE+6min → 1 job completed
    expect(advanceRes.body.completedJobs).toBe(1);
    expect(advanceRes.body.advancedMs).toBe(6 * 60_000);

    // Step 4 – Cookie job is DONE in DB
    const cookieJob = await prisma.kitchenJob.findFirst({
      where: { orderItemId: cookieOrderItem!.id },
    });
    expect(cookieJob).not.toBeNull();
    expect(cookieJob!.status).toBe('DONE');

    // Bread job was moved from queue to a baking slot and persisted
    const breadJob = await prisma.kitchenJob.findFirst({
      where: { orderItemId: breadOrderItem!.id },
    });
    expect(breadJob).not.toBeNull();
    expect(breadJob!.status).toBe('BAKING');

    // Queue is now empty
    expect(scheduler.getKitchenState().queue).toHaveLength(0);
  });
});
