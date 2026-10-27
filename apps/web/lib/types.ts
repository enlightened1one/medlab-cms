import { hasPermission, type Permission, type Role as SharedRole } from '@medlab/shared-types';

export type Role = 'ADMINISTRATOR' | 'LABORATORY_SCIENTIST' | 'CLINICIAN';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';

export type User = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive?: boolean;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type Patient = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: string | null;
  phone?: string | null;
  archivedAt?: string | null;
  createdAt: string;
};

export type TestItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  specimenType: string;
  unit: string | null;
  resultType: 'NUMERIC' | 'TEXT';
  decimalPlaces: number;
  isActive: boolean;
};

export type LabResult = {
  id: string;
  requestItemId: string;
  numericValue: number | string | null;
  textValue: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'AMENDED';
  flag: string | null;
  version: number;
  unit?: string | null;
  refLow?: number | string | null;
  refHigh?: number | string | null;
  refText?: string | null;
  comment?: string | null;
};

export type RequestItem = {
  id: string;
  test: TestItem;
  result: LabResult | null;
};

export type Specimen = {
  id: string;
  specimenNumber: string;
  specimenType: string;
  status: 'REGISTERED' | 'COLLECTED' | 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'REJECTED' | 'CANCELLED';
  version: number;
};

export type LabRequest = {
  id: string;
  requestNumber: string;
  requestDate: string;
  status: 'PENDING' | 'SPECIMEN_COLLECTED' | 'IN_PROGRESS' | 'AWAITING_VALIDATION' | 'COMPLETED' | 'CANCELLED';
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  version: number;
  clinicalNotes?: string | null;
  patient: Pick<Patient, 'id' | 'patientNumber' | 'firstName' | 'lastName' | 'gender' | 'dateOfBirth'>;
  requestedBy?: { id: string; fullName: string; role: Role };
  items: RequestItem[];
  specimens: Specimen[];
  report?: { id: string; reportNumber: string; status: string; version: number } | null;
};

export type DashboardStats = {
  filters: { from: string | null; to: string | null };
  patients: number;
  tests: number;
  requests: Record<string, number>;
  specimens: Record<string, number>;
  results: Record<string, number>;
};

export type Report = {
  id: string;
  reportNumber: string;
  status: string;
  issuedAt: string;
  version: number;
  request: {
    id: string;
    requestNumber: string;
    patient: Pick<Patient, 'patientNumber' | 'firstName' | 'lastName'>;
  };
};

export type AuditEntry = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  createdAt: string;
  actor?: { fullName: string } | null;
};

export type Prediction = {
  id: string;
  modelVersion: string;
  predictedClass: string;
  createdAt: string;
  probabilities?: Record<string, number>;
  syntheticDataOnly?: boolean;
  clinicalUse?: boolean;
  patientId: string;
};

export const can = (user: User, permission: Permission) => hasPermission(user.role as SharedRole, permission);
