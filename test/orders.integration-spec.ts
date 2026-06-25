import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { KitchenSchedulerService } from '../src/scheduler/kitchen-scheduler.service';

describe('Orders (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: KitchenSchedulerService;
  let customerToken: string;
  let otherCustomerToken: string;
  let managerToken: string;
  let kitchenManagerToken: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = module.get(PrismaService);
    scheduler = module.get(KitchenSchedulerService);

    const jwt = module.get(JwtService);
    customerToken = await jwt.signAsync({ sub: 'cust-id', email: 'customer@test.com', role: 'CUSTOMER' });
    otherCustomerToken = await jwt.signAsync({ sub: 'other-cust-id', email: 'other@test.com', role: 'CUSTOMER' });
    managerToken = await jwt.signAsync({ sub: 'mgr-id', email: 'manager@test.com', role: 'STORE_MANAGER' });
    kitchenManagerToken = await jwt.signAsync({ sub: 'km-id', email: 'kitchen@test.com', role: 'KITCHEN_MANAGER' });
  });

  afterAll(async () => {
    await cleanDb();
    await app.close();
  });

  afterEach(async () => {
    await cleanDb();
    resetScheduler();
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

  // ──────────────────────────────────────────────
  // POST /orders
  // ──────────────────────────────────────────────

  describe('POST /orders', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .send({ items: [], priorityLevel: 'TIER1' })
        .expect(401);
    });

    it('returns 403 for STORE_MANAGER (not a customer)', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ items: [{ menuItemId: 'any', quantity: 1 }], priorityLevel: 'TIER1' })
        .expect(403);
    });

    it('returns 403 for KITCHEN_MANAGER (not a customer)', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${kitchenManagerToken}`)
        .send({ items: [{ menuItemId: 'any', quantity: 1 }], priorityLevel: 'TIER1' })
        .expect(403);
    });

    it('creates an order and returns a ticket with ETA', async () => {
      const menuItem = await prisma.menuItem.create({
        data: { name: 'Croissant', category: 'PASTRY', price: 3.5, bake_minutes: 20 },
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: menuItem.id, quantity: 2 }], priorityLevel: 'TIER1' })
        .expect(201);

      expect(res.body).toMatchObject({
        orderId: expect.any(String),
        totalPrice: 7.0,
        priorityLevel: 'TIER1',
        estimatedReadyAt: expect.any(String),
        items: expect.arrayContaining([
          expect.objectContaining({
            menuItemId: menuItem.id,
            menuItemName: 'Croissant',
            quantity: 2,
            unitPrice: 3.5,
          }),
        ]),
      });

      expect(new Date(res.body.estimatedReadyAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('calculates totalPrice correctly for multiple items', async () => {
      const [cookie, bread] = await Promise.all([
        prisma.menuItem.create({
          data: { name: 'Cookie', category: 'COOKIE', price: 1.5, bake_minutes: 10 },
        }),
        prisma.menuItem.create({
          data: { name: 'Bread', category: 'BREAD', price: 4.0, bake_minutes: 40 },
        }),
      ]);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { menuItemId: cookie.id, quantity: 3 },
            { menuItemId: bread.id, quantity: 1 },
          ],
          priorityLevel: 'TIER2',
        })
        .expect(201);

      // 3 * 1.5 + 1 * 4.0 = 4.5 + 4.0 = 8.5
      expect(res.body.totalPrice).toBeCloseTo(8.5);
      expect(res.body.items).toHaveLength(2);
    });

    it('estimatedReadyAt reflects the bake time of the last-to-finish item', async () => {
      const fast = await prisma.menuItem.create({
        data: { name: 'Fast Cookie', category: 'COOKIE', price: 1.0, bake_minutes: 5 },
      });
      const slow = await prisma.menuItem.create({
        data: { name: 'Slow Bread', category: 'BREAD', price: 5.0, bake_minutes: 60 },
      });

      const before = Date.now();
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { menuItemId: fast.id, quantity: 1 },
            { menuItemId: slow.id, quantity: 1 },
          ],
          priorityLevel: 'TIER3',
        })
        .expect(201);

      const etaMs = new Date(res.body.estimatedReadyAt).getTime();
      // ETA must be at least 60 minutes from now (the slowest item)
      expect(etaMs).toBeGreaterThanOrEqual(before + 60 * 60_000);
    });

    it('returns 400 for a non-existent menuItemId', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: 'non-existent-id', quantity: 1 }], priorityLevel: 'TIER1' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for an unavailable menu item', async () => {
      const item = await prisma.menuItem.create({
        data: { name: 'Sold Out', category: 'COOKIE', price: 2.0, bake_minutes: 10, available: false },
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: item.id, quantity: 1 }], priorityLevel: 'TIER1' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for an invalid priorityLevel', async () => {
      const item = await prisma.menuItem.create({
        data: { name: 'Muffin', category: 'PASTRY', price: 2.0, bake_minutes: 15 },
      });

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: item.id, quantity: 1 }], priorityLevel: 'URGENT' })
        .expect(400);
    });

    it('returns 400 when items array is empty', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [], priorityLevel: 'TIER1' })
        .expect(400);
    });

    it('returns 400 when quantity is less than 1', async () => {
      const item = await prisma.menuItem.create({
        data: { name: 'Muffin', category: 'PASTRY', price: 2.0, bake_minutes: 15 },
      });

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: item.id, quantity: 0 }], priorityLevel: 'TIER1' })
        .expect(400);
    });

    it('returns 400 when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: 'abc' }] })
        .expect(400);
    });

    it('persists the order in the database', async () => {
      const menuItem = await prisma.menuItem.create({
        data: { name: 'Baguette', category: 'BREAD', price: 2.5, bake_minutes: 30 },
      });

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: menuItem.id, quantity: 1 }], priorityLevel: 'TIER2' })
        .expect(201);

      const savedOrder = await prisma.order.findUnique({
        where: { id: res.body.orderId },
        include: { items: true },
      });

      expect(savedOrder).not.toBeNull();
      expect(savedOrder!.priorityLevel).toBe('TIER2');
      expect(Number(savedOrder!.totalPrice)).toBeCloseTo(2.5);
      expect(savedOrder!.items).toHaveLength(1);
      expect(savedOrder!.estimatedReadyAt).toBeInstanceOf(Date);
    });
  });

  // ──────────────────────────────────────────────
  // GET /orders/:id
  // ──────────────────────────────────────────────

  describe('GET /orders/:id', () => {
    let orderId: string;

    beforeEach(async () => {
      const menuItem = await prisma.menuItem.create({
        data: { name: 'Scone', category: 'PASTRY', price: 2.0, bake_minutes: 15 },
      });
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: menuItem.id, quantity: 1 }], priorityLevel: 'TIER3' })
        .expect(201);
      orderId = res.body.orderId;
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(401);
    });

    it('returns 403 for KITCHEN_MANAGER', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${kitchenManagerToken}`)
        .expect(403);
    });

    it('returns order for the owning CUSTOMER', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        orderId,
        status: 'PENDING',
        priorityLevel: 'TIER3',
        totalPrice: expect.any(Number),
        estimatedReadyAt: expect.any(String),
        items: expect.any(Array),
      });
    });

    it('returns order for STORE_MANAGER (any order)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body.orderId).toBe(orderId);
    });

    it('returns 403 when a different CUSTOMER tries to view the order', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(403);
    });

    it('returns 404 for a nonexistent order id', async () => {
      await request(app.getHttpServer())
        .get('/orders/nonexistent-order-id-000')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });

  // ──────────────────────────────────────────────
  // PATCH /orders/:id/status
  // ──────────────────────────────────────────────

  describe('PATCH /orders/:id/status', () => {
    let orderId: string;

    beforeEach(async () => {
      const menuItem = await prisma.menuItem.create({
        data: { name: 'Pretzel', category: 'BREAD', price: 1.5, bake_minutes: 10 },
      });
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ menuItemId: menuItem.id, quantity: 1 }], priorityLevel: 'TIER1' })
        .expect(201);
      orderId = res.body.orderId;
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).expect(401);
    });

    it('returns 403 for CUSTOMER', async () => {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('returns 403 for STORE_MANAGER', async () => {
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });

    it('marks the order as READY for KITCHEN_MANAGER', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${kitchenManagerToken}`)
        .expect(200);

      expect(res.body.status).toBe('READY');
      expect(res.body.id).toBe(orderId);
    });

    it('returns 404 for a nonexistent order id', async () => {
      await request(app.getHttpServer())
        .patch('/orders/nonexistent-order-id-000/status')
        .set('Authorization', `Bearer ${kitchenManagerToken}`)
        .expect(404);
    });
  });
});
