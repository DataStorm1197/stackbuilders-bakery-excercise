process.env['DATABASE_URL'] =
  'postgresql://snack:snack@localhost:5433/snack_builders?schema=test';
process.env['JWT_SECRET'] = 'integration-test-secret';
process.env['NODE_ENV'] = 'test';
