import Dexie, { Table } from 'dexie';
import { UserProfile, Requisition } from '../types';

export interface AuditLogEntry {
  id?: string;
  user: string;
  username: string;
  action: string;
  module: string;
  target: string;
  details: string;
  timestamp: string | number;
}

export class MineazyLocalDb extends Dexie {
  users!: Table<UserProfile>;
  requisitions!: Table<Requisition>;
  auditLogs!: Table<AuditLogEntry>;

  constructor() {
    super('MineazyLocalDb');
    this.version(1).stores({
      users: 'uid, username, role, department, status, isVerified',
      requisitions: 'id, userId, status, department, createdAt, writtenTo, quotationBook',
      auditLogs: '++id, username, action, timestamp'
    });
  }

  /** Clear all local data (useful on logout) */
  async clearAll() {
    await Promise.all([
      this.users.clear(),
      this.requisitions.clear(),
      this.auditLogs.clear()
    ]);
  }
}

export const localDb = new MineazyLocalDb();
