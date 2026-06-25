import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Menu (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let managerToken: string;
  let customerToken: string;

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

    const jwt = module.get(JwtService);
    managerToken = await jwt.signAsync({
      sub: 'mgr-id',
      email: 'manager@test.com',
      role: 'STORE_MANAGER',
    });
    customerToken = await jwt.signAsync({
      sub: 'cust-id',
      email: 'customer@test.com',
      role: 'CUSTOMER',
    });
  });

  afterAll(async () => {
    await prisma.menuItem.deleteMany();
    await app.close();
  });

  afterEach(async () => {
    await prisma.menuItem.deleteMany();
  });

  // ──────────────────────────────────────────────
  // GET /menu
  // ──────────────────────────────────────────────

  describe('GET /menu', () => {
    it('returns empty object when no available items exist', async () => {
      const res = await request(app.getHttpServer()).get('/menu').expect(200);
      expect(res.body).toEqual({});
    });

    it('returns items grouped by category', async () => {
      await prisma.menuItem.createMany({
        data: [
          { name: 'Croissant', category: 'PASTRY', price: 3.5, bake_minutes: 20 },
          { name: 'Baguette', category: 'BREAD', price: 2.0, bake_minutes: 40 },
          { name: 'Chocolate Chip', category: 'COOKIE', price: 1.5, bake_minutes: 12 },
          { name: 'Sourdough', category: 'BREAD', price: 5.0, bake_minutes: 60 },
        ],
      });

      const res = await request(app.getHttpServer()).get('/menu').expect(200);

      expect(res.body).toHaveProperty('PASTRY');
      expect(res.body).toHaveProperty('BREAD');
      expect(res.body).toHaveProperty('COOKIE');

      expect(res.body.PASTRY).toHaveLength(1);
      expect(res.body.PASTRY[0].name).toBe('Croissant');

      expect(res.body.BREAD).toHaveLength(2);
      expect(res.body.COOKIE).toHaveLength(1);
    });

    it('excludes unavailable items', async () => {
      await prisma.menuItem.createMany({
        data: [
          { name: 'Available Cookie', category: 'COOKIE', price: 1.5, bake_minutes: 12, available: true },
          { name: 'Hidden Cookie', category: 'COOKIE', price: 2.0, bake_minutes: 12, available: false },
        ],
      });

      const res = await request(app.getHttpServer()).get('/menu').expect(200);

      expect(res.body.COOKIE).toHaveLength(1);
      expect(res.body.COOKIE[0].name).toBe('Available Cookie');
    });

    it('returns price as a number', async () => {
      await prisma.menuItem.create({
        data: { name: 'Test Bread', category: 'BREAD', price: 4.99, bake_minutes: 30 },
      });

      const res = await request(app.getHttpServer()).get('/menu').expect(200);

      expect(typeof res.body.BREAD[0].price).toBe('number');
      expect(res.body.BREAD[0].price).toBe(4.99);
    });

    it('does not require authentication', async () => {
      await request(app.getHttpServer()).get('/menu').expect(200);
    });
  });

  // ──────────────────────────────────────────────
  // POST /menu
  // ──────────────────────────────────────────────

  describe('POST /menu', () => {
    const validBody = {
      name: 'Cinnamon Roll',
      category: 'PASTRY',
      price: 3.75,
      bake_minutes: 25,
    };

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).post('/menu').send(validBody).expect(401);
    });

    it('returns 403 for a CUSTOMER token', async () => {
      await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(validBody)
        .expect(403);
    });

    it('creates an item and returns 201 for STORE_MANAGER', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(validBody)
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Cinnamon Roll',
        category: 'PASTRY',
        price: 3.75,
        bake_minutes: 25,
        available: true,
      });
      expect(res.body.id).toBeDefined();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Incomplete' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for an invalid category value', async () => {
      await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...validBody, category: 'INVALID' })
        .expect(400);
    });

    it('returns 400 for a negative price', async () => {
      await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...validBody, price: -1 })
        .expect(400);
    });

    it('returns 400 for bake_minutes less than 1', async () => {
      await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...validBody, bake_minutes: 0 })
        .expect(400);
    });

    it('returns 400 for extra unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/menu')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...validBody, unknown_field: 'oops' })
        .expect(400);
    });
  });

  // ──────────────────────────────────────────────
  // PATCH /menu/:id
  // ──────────────────────────────────────────────

  describe('PATCH /menu/:id', () => {
    let existingId: string;

    beforeEach(async () => {
      const item = await prisma.menuItem.create({
        data: { name: 'Original', category: 'BREAD', price: 2.0, bake_minutes: 30 },
      });
      existingId = item.id;
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/${existingId}`)
        .send({ name: 'Updated' })
        .expect(401);
    });

    it('returns 403 for a CUSTOMER token', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Updated' })
        .expect(403);
    });

    it('updates a single field and returns 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
      expect(res.body.category).toBe('BREAD');
      expect(res.body.price).toBe(2.0);
    });

    it('updates multiple fields', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ price: 3.5, bake_minutes: 45 })
        .expect(200);

      expect(res.body.price).toBe(3.5);
      expect(res.body.bake_minutes).toBe(45);
    });

    it('returns 404 for a nonexistent id', async () => {
      await request(app.getHttpServer())
        .patch('/menu/nonexistent-id-000')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Ghost' })
        .expect(404);
    });

    it('returns 400 for an invalid category value', async () => {
      await request(app.getHttpServer())
        .patch(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ category: 'PIZZA' })
        .expect(400);
    });
  });

  // ──────────────────────────────────────────────
  // DELETE /menu/:id
  // ──────────────────────────────────────────────

  describe('DELETE /menu/:id', () => {
    let existingId: string;

    beforeEach(async () => {
      const item = await prisma.menuItem.create({
        data: { name: 'To Delete', category: 'COOKIE', price: 1.0, bake_minutes: 10 },
      });
      existingId = item.id;
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).delete(`/menu/${existingId}`).expect(401);
    });

    it('returns 403 for a CUSTOMER token', async () => {
      await request(app.getHttpServer())
        .delete(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('soft-deletes the item (sets available=false) and returns 200', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body.available).toBe(false);
      expect(res.body.id).toBe(existingId);
    });

    it('soft-deleted item no longer appears in GET /menu', async () => {
      await request(app.getHttpServer())
        .delete(`/menu/${existingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer()).get('/menu').expect(200);
      const allItems = Object.values(res.body).flat() as { id: string }[];
      expect(allItems.find((i) => i.id === existingId)).toBeUndefined();
    });

    it('returns 404 for a nonexistent id', async () => {
      await request(app.getHttpServer())
        .delete('/menu/nonexistent-id-000')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });
});
