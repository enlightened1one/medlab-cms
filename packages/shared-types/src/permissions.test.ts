import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, PERMISSIONS, hasPermission, type Role } from './permissions';

test('every listed permission is a known permission', () => {
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS))
    for (const p of perms) assert.ok(PERMISSIONS.includes(p), `${role} has unknown permission ${p}`);
});
test('administrator cannot enter, validate or amend clinical results', () => {
  for (const p of ['results:enter', 'results:validate', 'results:amend'] as const)
    assert.equal(hasPermission('ADMINISTRATOR', p), false);
});
test('only administrators manage users and read audit logs', () => {
  for (const r of ['LABORATORY_SCIENTIST', 'CLINICIAN'] as Role[]) {
    assert.equal(hasPermission(r, 'users:manage'), false);
    assert.equal(hasPermission(r, 'audit:read'), false);
  }
  assert.equal(hasPermission('ADMINISTRATOR', 'users:manage'), true);
});
test('all authenticated roles can use role-scoped dashboard statistics', () => {
  for (const role of ['ADMINISTRATOR', 'LABORATORY_SCIENTIST', 'CLINICIAN'] as Role[])
    assert.equal(hasPermission(role, 'stats:read'), true);
});
test('clinicians cannot touch specimens or validate results', () => {
  assert.equal(hasPermission('CLINICIAN', 'specimens:write'), false);
  assert.equal(hasPermission('CLINICIAN', 'results:validate'), false);
});
test('unknown or tampered role is denied by default', () => {
  assert.equal(hasPermission('SUPERUSER' as Role, 'patients:read'), false);
});
