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
 * Demonstrates the AUTOMATIC order lifecycle:
 * a CUSTOMER places an order → it starts PENDING → after the pastry's bake time
 * elapses (driven by POST /kitchen/advance-time under NODE_ENV=test), the last
 * DONE job flips the order to READY on its own — no manual PATCH /orders/:id/status.
 */
describe('Order auto-transitions to READY when baking finishes (integration)', () => {
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

  it('order is BAKING right after creation, then READY once the 20-min bake completes', async () => {
    mockTime.setNow(BASE_TIME);

    const pastry = await prisma.menuItem.create({
      data: { name: 'Croissant', category: 'PASTRY', price: 4.5, bake_minutes: 20 },
    });

    // 1. CUSTOMER places the order → one KitchenJob, immediately assigned to a free slot (BAKING).
    const orderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ menuItemId: pastry.id, quantity: 1 }], priorityLevel: 'TIER2' })
      .expect(201);
    const orderId: string = orderRes.body.orderId;

    // 2. The empty kitchen assigns the job to a free slot immediately, so the
    //    order is already BAKING (PENDING only lasts while a job waits in the queue).
    const before = await prisma.order.findUnique({ where: { id: orderId } });
    expect(before!.status).toBe('BAKING');

    // 3. Advance the kitchen clock by 19 minutes → still baking, not done yet.
    await request(app.getHttpServer())
      .post('/kitchen/advance-time')
      .send({ minutes: 19 })
      .expect(200);
    const midway = await prisma.order.findUnique({ where: { id: orderId } });
    expect(midway!.status).toBe('BAKING');

    // 4. Advance 1 more minute (total 20) → bake completes and the order flips to READY automatically.
    const advRes = await request(app.getHttpServer())
      .post('/kitchen/advance-time')
      .send({ minutes: 1 })
      .expect(200);
    expect(advRes.body.completedJobs).toBe(1);

    const after = await prisma.order.findUnique({ where: { id: orderId } });
    expect(after!.status).toBe('READY');

    // The underlying job is DONE too.
    const items = await prisma.orderItem.findMany({
      where: { orderId },
      include: { kitchenJob: true },
    });
    expect(items[0].kitchenJob!.status).toBe('DONE');
  });
});
