import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../.env.test') });

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing test DB operation: NODE_ENV must be "test".');
}

for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const value = process.env[name];
  if (!value) throw new Error(`Refusing test DB operation: ${name} is required.`);
  const database = decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''));
  if (!/test/i.test(database)) {
    throw new Error(`Refusing test DB operation: ${name} database name must contain "test".`);
  }
}

console.log('Test database safety check passed.');
