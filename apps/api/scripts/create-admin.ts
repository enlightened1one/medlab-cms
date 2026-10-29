/** One-time production bootstrap for the first administrator. */
import { PrismaClient, Role, AuditOutcome } from '@prisma/client';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_PRODUCTION_ADMIN_CREATE !== 'true') {
    throw new Error('Set CONFIRM_PRODUCTION_ADMIN_CREATE=true to authorize first-admin creation.');
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email.');
  if (!password || password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('ADMIN_PASSWORD must be 12-128 characters and contain upper case, lower case, and a digit.');
  }
  if (!fullName || fullName.length > 120) throw new Error('ADMIN_FULL_NAME is required (max 120 characters).');

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    const admins = await tx.user.count({ where: { role: Role.ADMINISTRATOR } });
    if (admins > 0) throw new Error('An administrator already exists; refusing to create or elevate another account.');
    const user = await tx.user.create({ data: { email, fullName, passwordHash, role: Role.ADMINISTRATOR } });
    await tx.auditLog.create({ data: {
      actorId: user.id, action: 'AUTH_ADMIN_BOOTSTRAP', resourceType: 'User', resourceId: user.id,
      outcome: AuditOutcome.SUCCESS, metadata: { email },
    } });
  });
  console.log(`Administrator created: ${email}`);
  console.log('Store the supplied password in your password manager. It is not printed or stored in plaintext.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Admin creation failed.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
