/** Resets and reseeds a LOCAL development database only. Refuses production and non-local hosts. */
import { config } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';
config({ path: resolve(__dirname, '../../../.env') });

const url = process.env.DATABASE_URL ?? '';
let host = '';
try { host = new URL(url).hostname; } catch { /* handled below */ }
const LOCAL = ['localhost', '127.0.0.1', '::1', 'postgres'];

if (process.env.NODE_ENV === 'production') { console.error('db:reset refused: NODE_ENV=production.'); process.exit(1); }
if (!LOCAL.includes(host)) { console.error(`db:reset refused: database host "${host || 'unset'}" is not a local development host.`); process.exit(1); }

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit', cwd: resolve(__dirname, '..'), env: process.env });
run('npx prisma migrate reset --force --skip-seed');
run('npx ts-node prisma/seed.ts');
