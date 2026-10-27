export type Role = 'ADMINISTRATOR' | 'LABORATORY_SCIENTIST' | 'CLINICIAN';

export const PERMISSIONS = [
  'users:manage', 'audit:read', 'stats:system', 'stats:read',
  'patients:read', 'patients:write',
  'tests:read', 'tests:manage',
  'requests:read', 'requests:create', 'requests:cancel',
  'specimens:read', 'specimens:write',
  'results:read', 'results:enter', 'results:validate', 'results:amend',
  'reports:read', 'reports:generate',
  'predictions:read', 'predictions:create',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Deny by default: anything not listed here is forbidden. Enforced server-side by a guard. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMINISTRATOR: [
    'users:manage', 'audit:read', 'stats:system', 'stats:read', 'patients:read', 'tests:read', 'tests:manage',
    'requests:read', 'specimens:read', 'results:read', 'reports:read',
  ], // no results:enter/validate/amend: admin cannot alter clinical results
  LABORATORY_SCIENTIST: [
    'patients:read', 'patients:write', 'tests:read', 'requests:read', 'requests:create', 'requests:cancel', 'stats:read',
    'specimens:read', 'specimens:write', 'results:read', 'results:enter', 'results:validate', 'results:amend',
    'reports:read', 'reports:generate', 'predictions:read', 'predictions:create',
  ],
  CLINICIAN: [
    'patients:read', 'tests:read', 'requests:read', 'requests:create', 'results:read', 'stats:read',
    'reports:read', 'predictions:read', 'predictions:create',
  ],
};

export const hasPermission = (role: Role, p: Permission): boolean =>
  ROLE_PERMISSIONS[role]?.includes(p) ?? false;
