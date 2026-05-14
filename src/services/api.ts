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
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, status')
          .eq('username', input.toLowerCase())
          .single();
        
        if (profile?.email) {
          email = profile.email;
        } else {
          // Fallback to default format if not in profiles
          // This allows users to recover if they exist in auth but not profiles
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
        // Recovery logic: Profile is missing but login was successful
        // This can happen after database resets or table deletions
        const metadata = data.user.user_metadata;
        const isAdmin = username.toLowerCase() === 'admin' || metadata?.username === 'admin';
        
        console.warn(`[Auth] Profile missing for user ${data.user.id}. Attempting recovery...`);

        const recoveryProfile: UserProfile = {
          uid: data.user.id,
          username: metadata?.username || username.toLowerCase(),
          email: data.user.email || email,
          name: metadata?.name || username,
          role: isAdmin ? UserRole.ADMIN : (metadata?.role as UserRole || UserRole.REQUESTER),
          department: isAdmin ? Department.GENERAL : (metadata?.department as Department || Department.GENERAL),
          status: isAdmin ? 'approved' : 'pending',
          isVerified: isAdmin,
          createdAt: new Date().toISOString()
        };

        const { error: recoveryError } = await supabase.from('profiles').insert(recoveryProfile);
        
        if (recoveryError) {
          console.error('[Auth] Recovery failed:', recoveryError);
          throw new Error('User profile not found and auto-recovery failed. Please contact the administrator.');
        }

        cachedProfile = recoveryProfile;
        await localDb.users.put(recoveryProfile);
        return { user: recoveryProfile };
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
      const normalizedUsername = username.trim().toLowerCase();

      // 1. Check if username is already taken in Profiles
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('uid, username')
        .eq('username', normalizedUsername)
        .single();
      
      if (existingProfile) {
        throw new Error(`The username "@${normalizedUsername}" is already taken. Please choose another.`);
      }

      // 2. Create Auth User
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name, username: normalizedUsername, role, department }
        }
      });

      if (error) {
        if (error.message.includes('User already registered')) {
          console.log('[Register] User already exists in Auth. Attempting transparent login/recovery...');
          try {
            // Self-correction: if they are already registered, try to log in with these credentials
            // This handles cases where the database was wiped but Auth persisted
            const loginResult = await authService.login(username, password);
            return loginResult;
          } catch (loginError: any) {
            console.error('[Register] Transparent login failed:', loginError);
            throw new Error('This email is already registered. If you forgot your password, please use the reset option or contact an admin. If the system was reset, your account might be in a recovery state—try Logging In instead.');
          }
        }
        throw error;
      }
      if (!data.user) throw new Error('Registration failed: No user data returned');

      // 3. Create Profile
      const profile: UserProfile = {
        uid: data.user.id,
        username: normalizedUsername,
        email: email,
        name,
        role,
        department,
        status: normalizedUsername === 'admin' ? 'approved' : 'pending',
        isVerified: normalizedUsername === 'admin',
        createdAt: new Date().toISOString()
      };

      const { error: insertError } = await supabase.from('profiles').insert(profile);
      
      if (insertError) {
        // If insert fails (maybe concurrent register), try to log them in anyway if they just created the account
        if (insertError.code === '23505') { // Unique violation
           console.log('[Register] Profile already exists, returning login result');
        } else {
           throw insertError;
        }
      }
      
      cachedProfile = profile;
      await localDb.users.put(profile);
      
      return { user: profile };
    } catch (error: any) {
      console.error('Registration error:', error);
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
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', session.user.id)
        .single();
      
      if (profile) {
        cachedProfile = profile as UserProfile;
        return cachedProfile;
      }

      // If profile is missing but user is logged in, recover it
      const metadata = session.user.user_metadata;
      const isAdmin = metadata?.username === 'admin' || session.user.email?.startsWith('admin@');
      
      console.warn(`[Auth] Session exists but profile missing for ${session.user.id}. Recovering...`);
      const recoveryProfile: UserProfile = {
        uid: session.user.id,
        username: metadata?.username || session.user.email?.split('@')[0] || 'user',
        email: session.user.email || '',
        name: metadata?.name || 'User',
        role: isAdmin ? UserRole.ADMIN : (metadata?.role as UserRole || UserRole.REQUESTER),
        department: isAdmin ? Department.GENERAL : (metadata?.department as Department || Department.GENERAL),
        status: isAdmin ? 'approved' : 'pending',
        isVerified: isAdmin,
        createdAt: new Date().toISOString()
      };
      await supabase.from('profiles').insert(recoveryProfile);
      cachedProfile = recoveryProfile;
      return cachedProfile;
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

    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to send reset email');
    return result;
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

      // Expand list logic:
      // 1. You created it
      // 2. You are in the approval chain
      // 3. You are a "Processor" (Finance HOD / Treasurer) and it is approved/processed
      return allReqs.filter(req => {
        if (req.creatorId === userProfile.uid) return true;
        
        const isApproverInChain = req.approvals.some(approval => approval.role === userProfile.role);
        if (isApproverInChain) return true;

        const isFinanceOrTreasurer = userProfile.role === UserRole.FINANCE_HOD || userProfile.role === UserRole.TREASURER;
        const isApprovedOrProcessed = req.status === 'approved' || req.status === 'processed';
        
        if (isFinanceOrTreasurer && isApprovedOrProcessed) {
          // If Treasurer, further restrict by allowed types
          if (userProfile.role === UserRole.TREASURER) {
            const allowedTypes = ['Admin', 'Purchasing', 'Fuel', 'Workshop'];
            return allowedTypes.includes(req.type as any);
          }
          return true;
        }

        return false;
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
      console.log('[Requisition] Creating...', payload);
      
      // Verify profile exists to avoid FK violation
      const { data: profile, error: profileCheckError } = await supabase
        .from('profiles')
        .select('uid')
        .eq('uid', payload.creatorId)
        .single();
      
      if (profileCheckError || !profile) {
        console.error('[Requisition] Creator profile check failed:', profileCheckError);
        throw new Error(`Your profile (UID: ${payload.creatorId}) was not found in the database. Please try logging out and in again to resync your profile.`);
      }

      // Helper to clean payload if columns are missing
      const cleanPayload = (p: any, key: string) => {
        const cleaned = { ...p };
        delete cleaned[key];
        return cleaned;
      };

      let insertPayload = {
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let currentResult = await supabase
        .from('requisitions')
        .insert(insertPayload)
        .select()
        .single();
      
      // Recursive safety loop for schema mismatches
      let attempts = 0;
      while (currentResult.error && currentResult.error.message.includes('Could not find') && currentResult.error.message.includes('column') && attempts < 5) {
        attempts++;
        const match = currentResult.error.message.match(/column ['"]([^'"]+)['"]/) || currentResult.error.message.match(/['"]([^'"]+)['"] column/);
        const missingColumn = match ? match[1] : null;
        
        if (missingColumn) {
          console.warn(`[Requisition] Column "${missingColumn}" missing in DB. Removing from payload and retrying...`);
          insertPayload = cleanPayload(insertPayload, missingColumn);
          currentResult = await supabase
            .from('requisitions')
            .insert(insertPayload)
            .select()
            .single();
        } else {
          break;
        }
      }

      if (currentResult.error) {
        console.error('[Requisition] Insert error after fallback attempts:', currentResult.error);
        throw currentResult.error;
      }
      
      const requisition = currentResult.data as Requisition;
      
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
      let updatePayload: any = {
        ...updates,
        updatedAt: new Date().toISOString()
      };

      let currentResult = await supabase
        .from('requisitions')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      
      // Recursive safety loop for schema mismatches
      let attempts = 0;
      while (currentResult.error && currentResult.error.message.includes('Could not find') && currentResult.error.message.includes('column') && attempts < 5) {
        attempts++;
        const match = currentResult.error.message.match(/column ['"]([^'"]+)['"]/) || currentResult.error.message.match(/['"]([^'"]+)['"] column/);
        const missingColumn = match ? match[1] : null;
        
        if (missingColumn) {
          console.warn(`[Requisition Update] Column "${missingColumn}" missing in DB. Removing from payload and retrying...`);
          const cleaned = { ...updatePayload };
          delete cleaned[missingColumn];
          updatePayload = cleaned;
          
          currentResult = await supabase
            .from('requisitions')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();
        } else {
          break;
        }
      }

      if (currentResult.error) throw currentResult.error;
      
      // Merge updates back into the returned data to ensure ephemeral fields (like rejectionReason) 
      // are available for notifications even if they weren't saved to the DB due to schema mismatches
      const requisition = { ...currentResult.data, ...updates } as Requisition;

      // If progress happened or status changed to pending, notify next
      // Also notify if status is rejected
      if (updates.currentStage !== undefined || updates.status === 'pending' || updates.status === 'rejected') {
        notificationService.notifyNextApprover(requisition).catch(console.error);
      }

      return requisition;
    } catch (error) {
      console.error('Update requisition error:', error);
      throw error;
    }
  },
  delete: async (id: string, userProfile?: UserProfile | null) => {
    try {
      console.log(`[Requisition] Deleting ${id}...`);
      const { error } = await supabase.from('requisitions').delete().eq('id', id);
      
      if (error) {
        console.error('[Requisition] Delete failed:', error);
        throw error;
      }

      // Cleanup local cache
      await localDb.requisitions.delete(id).catch(e => console.warn('Local cleanup failed:', e));
      
      // Attempt to log if profile provided
      if (userProfile) {
        await auditService.log({
          user: userProfile.name,
          username: userProfile.username || userProfile.email,
          action: 'FORCE_DELETE',
          module: 'REQUISITION',
          target: id,
          details: `Requisition permanently deleted from system by ${userProfile.name}`
        }).catch(e => console.warn('Audit log failed after delete:', e));
      }
    } catch (error: any) {
      console.error('Delete requisition error:', error);
      throw error;
    }
  }
};

// --- NOTIFICATION SERVICE ---

export const notificationService = {
  async processApprovedRequisition(requisition: Requisition) {
    try {
      console.log(`[Notification] Requisition ${requisition.requisitionNumber} APPROVED. Notifying processors...`);
      
      const appUrl = window.location.origin.replace(/\/$/, '');
      const requisitionLink = `${appUrl}?requisitionId=${requisition.id}`;

      // Notify Finance HOD and Treasurer
      const { data: processors, error } = await supabase
        .from('profiles')
        .select('email, name, role')
        .or(`role.eq.${UserRole.FINANCE_HOD},role.eq.${UserRole.TREASURER}`)
        .eq('status', 'approved');

      if (error) throw error;
      if (!processors || processors.length === 0) return;

      for (const proc of processors) {
        if (!proc.email) continue;
        
        // Treasurer only handles specific types
        if (proc.role === UserRole.TREASURER) {
          const allowedTypes = ['Admin', 'Purchasing', 'Fuel', 'Workshop'];
          if (!allowedTypes.includes(requisition.type as any)) continue;
        }

        console.log(`[Notification] Notifying processor ${proc.email} (${proc.role})...`);
        
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: proc.email,
            subject: `Ready for Disbursement: Requisition ${requisition.requisitionNumber}`,
            body: `
Hello ${proc.name},

Requisition ${requisition.requisitionNumber} has been FULLY APPROVED and is now ready for disbursement processing.

DETAILS:
- Requisition #: ${requisition.requisitionNumber}
- Requested By: ${requisition.creatorName}
- Type: ${requisition.type}
- Amount: $${requisition.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}

You can process this requisition here:
${requisitionLink}

Thank you,
REQFLOW PRO System
            `.trim()
          })
        }).catch(console.error);
      }
    } catch (err) {
      console.error('[Notification] Error processing approved requisition:', err);
    }
  },

  async notifyNextApprover(requisition: Requisition) {
    try {
      const currentStage = requisition.currentStage;
      const approvals = requisition.approvals;
      
      if (currentStage >= approvals.length && requisition.status !== 'approved') return; // No more stages unless just finishing
      
      // If requisition is fully approved, notify processors (Finance HOD / Treasurer)
      if (requisition.status === 'approved') {
        this.processApprovedRequisition(requisition).catch(console.error);
        return;
      }

      const appUrl = window.location.origin.replace(/\/$/, '');
      const requisitionLink = `${appUrl}?requisitionId=${requisition.id}`;

      // Handle Rejection Notification
      if (requisition.status === 'rejected') {
        const { data: creatorProfile } = await supabase.from('profiles').select('email, name').eq('uid', requisition.creatorId).single();
        if (creatorProfile?.email) {
          console.log(`[Notification] Sending rejection notice to ${creatorProfile.email}...`);
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: creatorProfile.email,
              subject: `Update: Requisition ${requisition.requisitionNumber} REJECTED`,
              body: `
Hello ${creatorProfile.name},

Your requisition ${requisition.requisitionNumber} has been REJECTED.

REASON FOR REJECTION:
${requisition.rejectionReason || 'No specific reason provided.'}

You can view the details here:
${requisitionLink}

If you need to make corrections, please create a new requisition or contact the approver.

Thank you,
REQFLOW PRO System
              `.trim()
            })
          }).catch(console.error);
        }
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
      let entry: any = {
        user: cachedProfile?.name || 'System',
        username: cachedProfile?.username || 'system',
        module: 'SYSTEM',
        action: 'Log',
        userId: cachedProfile?.uid,
        ...log,
        timestamp: new Date().toISOString()
      };

      let currentResult = await supabase.from('activity_logs').insert(entry).select().single();

      // Recursive safety loop for schema mismatches
      let attempts = 0;
      while (currentResult.error && currentResult.error.message.includes('Could not find') && currentResult.error.message.includes('column') && attempts < 5) {
        attempts++;
        const match = currentResult.error.message.match(/column ['"]([^'"]+)['"]/) || currentResult.error.message.match(/['"]([^'"]+)['"] column/);
        const missingColumn = match ? match[1] : null;
        
        if (missingColumn) {
          console.warn(`[Audit Log] Column "${missingColumn}" missing in DB. Removing from entry and retrying...`);
          const cleaned = { ...entry };
          delete cleaned[missingColumn];
          entry = cleaned;
          
          currentResult = await supabase.from('activity_logs').insert(entry).select().single();
        } else {
          break;
        }
      }

      if (currentResult.error) throw currentResult.error;
      return currentResult.data as ActivityLog;
    } catch (error) {
      console.warn('Audit log write failed:', error);
      return log;
    }
  }
};

export const customAuthService = {
  completePasswordReset: async (data: any) => {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to reset password');
    return result;
  }
};
