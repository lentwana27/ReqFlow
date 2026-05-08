/**
 * API Service for REQFLOW PRO
 * Uses local storage (Dexie) and mock authentication
 */

import { UserProfile, UserRole, Department, Requisition } from '../types';
import { localDb } from './localDb';

// --- MOCK CONSTANTS ---

const MOCK_PASSWORD = 'password123';

const INITIAL_USERS: UserProfile[] = [
  {
    uid: 'admin-001',
    username: 'admin',
    name: 'System Admin',
    role: UserRole.ADMIN,
    department: Department.GENERAL,
    status: 'approved',
    isVerified: true,
    createdAt: new Date().toISOString()
  },
  {
    uid: 'director-001',
    username: 'director',
    name: 'Managing Director',
    role: UserRole.DIRECTOR,
    department: Department.GENERAL,
    status: 'approved',
    isVerified: true,
    createdAt: new Date().toISOString()
  },
  {
    uid: 'finance-001',
    username: 'finance',
    name: 'Finance HOD',
    role: UserRole.FINANCE_HOD,
    department: Department.ACCOUNTING,
    status: 'approved',
    isVerified: true,
    createdAt: new Date().toISOString()
  },
  {
    uid: 'ops-001',
    username: 'ops',
    name: 'Operations Manager',
    role: UserRole.OPERATIONS_MANAGER,
    department: Department.OPERATIONS,
    status: 'approved',
    isVerified: true,
    createdAt: new Date().toISOString()
  },
  {
    uid: 'worker-001',
    username: 'requester',
    name: 'Site Requester',
    role: UserRole.REQUESTER,
    department: Department.OPERATIONS,
    status: 'approved',
    isVerified: true,
    createdAt: new Date().toISOString()
  }
];

// --- INITIALIZATION ---

async function initializeDb() {
  const count = await localDb.users.count();
  if (count === 0) {
    await localDb.users.bulkAdd(INITIAL_USERS);
  }
}

initializeDb();

// --- CACHE LAYER ---
let cachedProfile: UserProfile | null = null;

// --- AUTH ---

export const authService = {
  login: async (username: string, password: string) => {
    const lowerUsername = username.trim().toLowerCase();
    
    // 1. Find user first
    const user = await localDb.users.where('username').equals(lowerUsername).first();
    
    if (!user) {
      throw new Error(`User "${username}" not found. Try "admin", "director", or "requester".`);
    }

    // 2. Mock password check
    const isMockAdmin = lowerUsername === 'admin';
    
    // For demo purposes, we allow 'password123' for everyone, 
    // plus 'admin123' for the admin.
    // If they type anything else, we still let them in if it's the admin account to prevent lockouts.
    const isCorrectPassword = password === MOCK_PASSWORD || (isMockAdmin && password === 'admin123');

    if (!isCorrectPassword && !isMockAdmin) {
      throw new Error('Invalid password. Use "password123" for testing.');
    }
    
    if (user.status !== 'approved') {
      throw new Error('Your account is pending approval by an administrator.');
    }

    cachedProfile = user;
    window.localStorage.setItem('auth_user_id', user.uid);
    return { user };
  },

  register: async (payload: any) => {
    const { username, name, role, department } = payload;
    
    const existing = await localDb.users.where('username').equals(username.toLowerCase()).first();
    if (existing) {
      throw new Error('Username already taken.');
    }

    const newUser: UserProfile = {
      uid: crypto.randomUUID(),
      username: username.toLowerCase(),
      name,
      role,
      department,
      status: 'pending',
      isVerified: false,
      createdAt: new Date().toISOString()
    };

    await localDb.users.add(newUser);
    return { user: newUser };
  },

  logout: async () => {
    cachedProfile = null;
    window.localStorage.removeItem('auth_user_id');
  },

  getCurrentUser: async () => {
    if (cachedProfile) return cachedProfile;

    const uid = window.localStorage.getItem('auth_user_id');
    if (!uid) return null;

    const user = await localDb.users.get(uid);
    if (user) {
      cachedProfile = user;
    }
    return user || null;
  },

  changePassword: async (_newPassword: string) => {
    // Mock - always succeeds
    return true;
  },

  requestPasswordReset: async (_username: string) => {
    // Mock - always succeeds
    return true;
  },

  updateProfile: async (updates: Partial<UserProfile>) => {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('Not authenticated');

    const updated = { ...user, ...updates };
    await localDb.users.put(updated);
    cachedProfile = updated;
    return updated;
  }
};

// --- USERS ---

export const userService = {
  list: async () => {
    return localDb.users.toArray();
  },
  update: async (uid: string, updates: Partial<UserProfile>) => {
    const existing = await localDb.users.get(uid);
    if (!existing) throw new Error('User not found');
    
    const updated = { ...existing, ...updates };
    await localDb.users.put(updated);
    return updated;
  },
  delete: async (uid: string) => {
    await localDb.users.delete(uid);
  }
};

// --- REQUISITIONS ---

export const requisitionService = {
  list: async (userProfile?: UserProfile | null) => {
    const list = await localDb.requisitions.orderBy('createdAt').reverse().toArray();
    
    if (!userProfile) return list;

    // Filter based on roles and ownership
    const isAdminOrDirector = userProfile.username === 'admin' || userProfile.role === UserRole.ADMIN || userProfile.role === UserRole.DIRECTOR;
    if (isAdminOrDirector) return list;

    return list.filter(req => {
      // 1. Creators always see their own requisitions
      if (req.creatorId === userProfile.uid) return true;
      
      // 2. Approvers see requisitions where their role is included in the approval chain
      // The requirement states: "REQUESTS that do not include them as approvers they dont see it"
      const isApproverInChain = req.approvals.some(approval => approval.role === userProfile.role);
      
      if (isApproverInChain) return true;
      
      return false;
    });
  },
  create: async (payload: Requisition) => {
    await localDb.requisitions.add(payload);
    return payload;
  },
  update: async (id: string, updates: Partial<Requisition>) => {
    const existing = await localDb.requisitions.get(id);
    if (!existing) throw new Error('Requisition not found');
    
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await localDb.requisitions.put(updated as Requisition);
    return updated as Requisition;
  },
  delete: async (id: string) => {
    await localDb.requisitions.delete(id);
  }
};

// --- AUDIT ---

export const auditService = {
  list: async () => {
    const logs = await localDb.auditLogs.orderBy('timestamp').reverse().toArray();
    return logs.map(l => ({
      id: l.id?.toString(),
      timestamp: l.timestamp,
      user: l.user,
      username: l.username,
      action: l.action,
      details: l.details
    }));
  },
  log: async (log: any) => {
    const entry = {
      ...log,
      timestamp: new Date().toISOString()
    };
    await localDb.auditLogs.add(entry);
    return entry;
  }
};
