/**
 * API Service for REQFLOW PRO
 * Uses Supabase for Backend and Dexie for local caching
 */

import { createClient } from '@supabase/supabase-js';
import { UserProfile, UserRole, Department, Requisition, ActivityLog } from '../types';
import { localDb } from './localDb';

// --- INITIALIZATION ---

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are missing. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// --- HELPERS ---

function mapUsernameToEmail(username: string) {
  return username.includes('@') ? username : `${username.toLowerCase()}@reqflow-mail.com`;
}

// --- AUTH SERVICE ---

let cachedProfile: UserProfile | null = null;

export const authService = {
  login: async (username: string, password: string) => {
    try {
      const input = username.trim();
      let email = input;

      // If it doesn't look like an email, try to resolve from profile
      if (!input.includes('@')) {
        const { data: profile, error: profileFetchError } = await supabase
          .from('profiles')
          .select('email, status')
          .eq('username', input.toLowerCase())
          .single();
        
        if (profileFetchError && profileFetchError.code === 'PGRST116') {
          throw new Error('Username not found. If the system was recently reset, please Register your account again.');
        }

        if (profile?.email) {
          email = profile.email;
        } else {
          email = mapUsernameToEmail(input);
        }
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      if (!data.user) throw new Error('Login failed: No user data returned');

      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', data.user.id)
        .single();

      if (profileError || !profile) {
        // Recovery for admin
        if (username.toLowerCase() === 'admin') {
          const recoveryProfile: UserProfile = {
            uid: data.user.id,
            username: 'admin',
            email: data.user.email || 'admin@reqflow-mail.com',
            name: 'System Administrator',
            role: UserRole.ADMIN,
            department: Department.GENERAL,
            status: 'approved',
            isVerified: true,
            createdAt: new Date().toISOString()
          };
          await supabase.from('profiles').insert(recoveryProfile);
          cachedProfile = recoveryProfile;
          await localDb.users.put(recoveryProfile);
          return { user: recoveryProfile };
        }
        throw new Error('User profile not found. If you have an account but see this, please try registering again or contact the administrator.');
      }

      const userProfile = profile as UserProfile;

      // Backfill email if missing
      if (!userProfile.email && data.user.email) {
        userProfile.email = data.user.email;
        await supabase.from('profiles').update({ email: data.user.email }).eq('uid', userProfile.uid);
      }

      cachedProfile = userProfile;
      
      // Update local cache
      await localDb.users.put(cachedProfile);
      
      return { user: cachedProfile };
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.message?.includes('invalid_credentials') || error.message?.includes('Invalid login credentials')) {
        throw new Error('Invalid email or password. Note: If the backend was recently switched, you must Register your account again.');
      }
      throw error;
    }
  },

  register: async (payload: any) => {
    try {
      const { username, email: providedEmail, password, name, role, department } = payload;
      const email = providedEmail || mapUsernameToEmail(username.trim());

      // 1. Create Auth User
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name, username: username.toLowerCase() }
        }
      });

      if (error) throw error;
      if (!data.user) throw new Error('Registration failed: No user data returned');

      // 2. Create Profile
      const profile: UserProfile = {
        uid: data.user.id,
        username: username.toLowerCase(),
        email: email,
        name,
        role,
        department,
        status: username.toLowerCase() === 'admin' ? 'approved' : 'pending',
        isVerified: username.toLowerCase() === 'admin',
        createdAt: new Date().toISOString()
      };

      const { error: insertError } = await supabase.from('profiles').insert(profile);
      if (insertError) throw insertError;
      
      cachedProfile = profile;
      await localDb.users.put(profile);
      
      return { user: profile };
    } catch (error: any) {
      console.error('Registration error:', error);
      if (error.message?.includes('User already registered')) {
        throw new Error('This user/email is already registered. Please try logging in instead.');
      }
      throw error;
    }
  },

  logout: async () => {
    try {
      await supabase.auth.signOut();
      cachedProfile = null;
      await localDb.clearAll();
      window.localStorage.clear();
    } catch (error) {
      console.warn('Logout cleanup failed:', error);
    }
  },

  getCurrentUser: async () => {
    if (cachedProfile) return cachedProfile;

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', session.user.id)
        .single();
      
      if (profile) {
        cachedProfile = profile as UserProfile;
        return cachedProfile;
      }
    }
    return null;
  },

  changePassword: async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  requestPasswordReset: async (username: string) => {
    const input = username.trim();
    let email = input;

    if (!input.includes('@')) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('username', input.toLowerCase())
        .single();
      
      if (profile?.email) {
        email = profile.email;
      } else {
        email = mapUsernameToEmail(input);
      }
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },

  updateProfile: async (updates: Partial<UserProfile>) => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Not authenticated');
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('uid', user.id)
        .select()
        .single();
        
      if (error) throw error;
      
      const updated = data as UserProfile;
      cachedProfile = updated;
      await localDb.users.put(updated);
      return updated;
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  }
};

// --- USER SERVICE ---

export const userService = {
  list: async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('username');
        
      if (error) throw error;
      const users = data as UserProfile[];
      
      // Update local cache
      await localDb.users.clear();
      await localDb.users.bulkPut(users);
      
      return users;
    } catch (error) {
      console.error('List users error:', error);
      throw error;
    }
  },
  update: async (uid: string, updates: Partial<UserProfile>) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('uid', uid)
        .select()
        .single();
        
      if (error) throw error;
      const updated = data as UserProfile;
      await localDb.users.put(updated);
      return updated;
    } catch (error) {
      console.error('Update user error:', error);
      throw error;
    }
  },
  delete: async (uid: string) => {
    try {
      const { error } = await supabase.from('profiles').delete().eq('uid', uid);
      if (error) throw error;
      await localDb.users.delete(uid);
    } catch (error) {
      console.error('Delete user error:', error);
      throw error;
    }
  },
  resetPassword: async (uid: string, newPassword: string) => {
    const response = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, newPassword })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to reset password');
    }
    
    return response.json();
  }
};

// --- REQUISITION SERVICE ---

export const requisitionService = {
  list: async (userProfile?: UserProfile | null) => {
    try {
      const { data, error } = await supabase
        .from('requisitions')
        .select('*')
        .order('createdAt', { ascending: false });
        
      if (error) throw error;
      const allReqs = data as Requisition[];

      if (!userProfile) return allReqs;

      const isAdminOrDirector = userProfile.username === 'admin' || userProfile.role === UserRole.ADMIN || userProfile.role === UserRole.DIRECTOR;
      if (isAdminOrDirector) return allReqs;

      // Special case for Treasurer: Only specific approved types
      if (userProfile.role === UserRole.TREASURER) {
        return allReqs.filter(req => {
          const isApproved = req.status === 'approved' || req.status === 'processed';
          const allowedTypes = [
            'Admin', 
            'Purchasing', 
            'Fuel', 
            'Workshop'
          ];
          return isApproved && allowedTypes.includes(req.type as any);
        });
      }

      return allReqs.filter(req => {
        if (req.creatorId === userProfile.uid) return true;
        const isApproverInChain = req.approvals.some(approval => approval.role === userProfile.role);
        return isApproverInChain;
      });
    } catch (error) {
      console.error('List requisitions error:', error);
      throw error;
    }
  },
  getById: async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('requisitions')
        .select('*')
        .eq('id', id)
        .single();
        
      if (error) throw error;
      return data as Requisition;
    } catch (error) {
      console.error('Get requisition error:', error);
      throw error;
    }
  },
  create: async (payload: Requisition) => {
    try {
      const { data, error } = await supabase
        .from('requisitions')
        .insert({
          ...payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .select()
        .single();
        
      if (error) throw error;
      const requisition = data as Requisition;
      
      // Notify next approver (Stage 0)
      notificationService.notifyNextApprover(requisition).catch(console.error);
      
      return requisition;
    } catch (error) {
      console.error('Create requisition error:', error);
      throw error;
    }
  },
  update: async (id: string, updates: Partial<Requisition>) => {
    try {
      const { data, error } = await supabase
        .from('requisitions')
        .update({
          ...updates,
          updatedAt: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
        
      if (error) throw error;
      const requisition = data as Requisition;

      // If progress happened or status changed to pending, notify next
      if (updates.currentStage !== undefined || updates.status === 'pending') {
        notificationService.notifyNextApprover(requisition).catch(console.error);
      }

      return requisition;
    } catch (error) {
      console.error('Update requisition error:', error);
      throw error;
    }
  },
  delete: async (id: string) => {
    try {
      const { error } = await supabase.from('requisitions').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      console.error('Delete requisition error:', error);
      throw error;
    }
  }
};

// --- NOTIFICATION SERVICE ---

export const notificationService = {
  notifyNextApprover: async (requisition: Requisition) => {
    try {
      const currentStage = requisition.currentStage;
      const approvals = requisition.approvals;
      
      if (currentStage >= approvals.length && requisition.status !== 'approved') return; // No more stages unless just finishing
      
      // If requisition is fully approved, maybe notify creator?
      if (requisition.status === 'approved') {
        console.log('Requisition fully approved. Notification for final status could be sent here.');
        return;
      }

      const nextRole = approvals[currentStage]?.role;
      if (!nextRole) return;
      
      console.log(`[Notification] Preparing notification for stage ${currentStage + 1} (${nextRole})...`);
      
      // Get users for this role. For HOD role, we filter by the creator's department.
      let query = supabase.from('profiles').select('email, name, status, role, department');
      
      if (nextRole === UserRole.HOD) {
        if (requisition.department === Department.IT) {
          query = query.or(`role.eq.${UserRole.HOD},role.eq.${UserRole.IT_HOD}`).eq('department', Department.IT);
        } else if (requisition.department === Department.WAREHOUSE) {
          query = query.or(`role.eq.${UserRole.HOD},role.eq.${UserRole.WAREHOUSE_HOD}`).eq('department', Department.WAREHOUSE);
        } else {
          query = query.eq('role', UserRole.HOD).eq('department', requisition.department);
        }
      } else if (nextRole === UserRole.IT_HOD) {
        query = query.or(`role.eq.${UserRole.HOD},role.eq.${UserRole.IT_HOD}`).eq('department', Department.IT);
      } else if (nextRole === UserRole.WAREHOUSE_HOD) {
        query = query.or(`role.eq.${UserRole.HOD},role.eq.${UserRole.WAREHOUSE_HOD}`).eq('department', Department.WAREHOUSE);
      } else {
        query = query.eq('role', nextRole);
      }

      const { data: approvers, error } = await query;
        
      if (error) throw error;
      
      // Filters for approved users only
      const activeApprovers = approvers?.filter(a => a.status === 'approved') || [];
      const pendingApprovers = approvers?.filter(a => a.status === 'pending') || [];

      if (activeApprovers.length === 0) {
        const failureReason = pendingApprovers.length > 0 
          ? `All users with role ${nextRole}${nextRole === UserRole.HOD ? ` in ${requisition.department}` : ''} are PENDING verification.`
          : `No users found with role ${nextRole}${nextRole === UserRole.HOD ? ` in ${requisition.department}` : ''}.`;
        
        console.warn(`[Notification] Failure: ${failureReason}`);
        
        await auditService.log({
          action: 'NOTIFY_FAILURE',
          module: 'NOTIFICATION',
          target: requisition.requisitionNumber,
          details: `FAILED to notify: ${failureReason} Approvals cannot proceed until an administrator approves/assigns a user to this role.`,
          user: 'SYSTEM',
          username: 'system'
        });
        return;
      }

      const appUrl = window.location.origin.replace(/\/$/, '');
      const requisitionLink = `${appUrl}?requisitionId=${requisition.id}`;

      // Get requester email for CC?
      const { data: creatorProfile } = await supabase.from('profiles').select('email').eq('uid', requisition.creatorId).single();
      const creatorEmail = creatorProfile?.email;

      for (const approver of activeApprovers) {
        if (!approver.email) continue;
        
        console.log(`[Notification] Sending request to ${approver.email} for Requisition ${requisition.requisitionNumber}...`);
        
        try {
          const response = await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: approver.email,
              cc: creatorEmail,
              subject: `Action Required: Requisition ${requisition.requisitionNumber}`,
              body: `
Hello ${approver.name},

A new requisition requires your approval.

DETAILS:
- Requisition #: ${requisition.requisitionNumber}
- Requested By: ${requisition.creatorName}
- Department: ${requisition.department}
- Type: ${requisition.type}
- Amount: $${requisition.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}

You can view and approve the requisition by clicking the link below:
${requisitionLink}

Thank you,
REQFLOW PRO System
              `.trim()
            })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error(`[Notification] Server error ${response.status}:`, errorData);
            
            // Log specifically if it's an API Key issue
            if (response.status === 401) {
              await auditService.log({
                action: 'NOTIFY_FAILURE',
                module: 'NOTIFICATION',
                target: requisition.requisitionNumber,
                details: `CRITICAL: Notification failed due to Invalid Resend API Key. Please check your settings.`,
                user: 'SYSTEM',
                username: 'system'
              });
            }
          } else {
            const result = await response.json();
            const isSimulated = result.simulated;
            
            console.log(`[Notification] ${isSimulated ? 'Simulated' : 'Actual'} success for ${approver.email}:`, result);
            
            // Audit the notification
            await auditService.log({
              action: isSimulated ? 'NOTIFY_SIMULATED' : 'NOTIFY',
              module: 'NOTIFICATION',
              target: requisition.requisitionNumber,
              details: isSimulated 
                ? `Simulated notification to ${approver.email}. (Resend domain verification required for actual delivery)` 
                : `Sent actual notification to ${approver.email} (${nextRole})`,
              requisitionId: requisition.id
            });
          }
        } catch (fetchError) {
          console.error(`[Notification] Fetch failed for ${approver.email}:`, fetchError);
        }
      }
    } catch (error) {
      console.error('[Notification] Error sending notifications:', error);
    }
  }
};

// --- AUDIT SERVICE ---

export const auditService = {
  list: async () => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('timestamp', { ascending: false });
        
      if (error) throw error;
      return data as ActivityLog[];
    } catch (error) {
      console.error('List logs error:', error);
      throw error;
    }
  },
  log: async (log: any) => {
    try {
      const entry = {
        user: 'System',
        username: 'system',
        module: 'SYSTEM',
        action: 'Log',
        ...log,
        timestamp: new Date().toISOString()
      };
      const { data, error } = await supabase.from('activity_logs').insert(entry).select().single();
      if (error) throw error;
      return data as ActivityLog;
    } catch (error) {
      console.warn('Audit log write failed:', error);
      return log;
    }
  }
};
