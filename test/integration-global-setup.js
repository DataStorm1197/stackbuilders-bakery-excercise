const { execSync } = require('child_process');

const TEST_DATABASE_URL =
  'postgresql://snack:snack@localhost:5433/snack_builders?schema=test';

module.exports = async function () {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
};
