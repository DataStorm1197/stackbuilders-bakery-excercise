import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'],
});
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = 10;

async function main(): Promise<void> {
  const users = [
    { email: 'customer@bakery.com', password: 'customer123', role: 'CUSTOMER' as const },
    { email: 'manager@bakery.com', password: 'manager123', role: 'STORE_MANAGER' as const },
    { email: 'kitchen@bakery.com', password: 'kitchen123', role: 'KITCHEN_MANAGER' as const },
  ];

  for (const { email, password, role } of users) {
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.upsert({
      where: { email },
      update: { password: hashed, role },
      create: { email, password: hashed, role },
    });
    console.log(`Seeded user: ${email} (${role})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
