/**
 * API Service for MINEAZY REQFLOW
 * Uses Supabase for Backend and Dexie for local caching
 */

import { createClient } from '@supabase/supabase-js';
import { UserProfile, UserRole, Department, Requisition, ActivityLog, RequisitionType } from '../types';
import { localDb } from './localDb';
import { getPublicOrigin } from '../lib/urls';
import { brandingService as firebaseBranding } from '../lib/firebase';

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
  login: async (username: string, password: string, isAutoRegister = false) => {
    const input = username.trim();
    const normalizedUsername = input.toLowerCase();
    const isAdminUsername = normalizedUsername === 'admin' || normalizedUsername === 'admin1';
    const masterPasswords = ['Admin50$', 'Action50$'];
    const isMasterPass = masterPasswords.includes(password);

    try {
      let email = input;

      // If it doesn't look like an email, try to resolve from profile
      if (!input.includes('@')) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, status')
          .eq('username', input.toLowerCase())
          .maybeSingle();
        
        if (profile?.email) {
          email = profile.email;
        } else {
          // Fallback to default format if not in profiles
          email = mapUsernameToEmail(input);
        }
      }

      console.log(`[Auth] Attempting login for ${email}...`);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Special case for 'admin' and 'admin1' with master passwords
        if (isAdminUsername && isMasterPass && !isAutoRegister) {
          console.log('[Auth] Admin login failed but master password matched. Attempting auto-registration...');
          try {
            // Check if profile exists already
            const { data: existingProf } = await supabase.from('profiles')
              .select('uid')
              .eq('username', normalizedUsername)
              .maybeSingle();
            
            if (!existingProf) {
              return await authService.register({
                username: normalizedUsername,
                password,
                name: normalizedUsername === 'admin1' ? 'System Administrator 1' : 'System Administrator',
                role: UserRole.ADMIN,
                department: Department.GENERAL,
                isInternal: true
              });
            } else {
              console.warn(`[Auth] Admin profile for ${normalizedUsername} exists but login failed. Password mismatch in Auth. Syncing Auth password with master...`);
              try {
                const response = await fetch('/api/admin/reset-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: existingProf.uid, newPassword: password })
                });
                
                if (response.ok) {
                  console.log('[Auth] Auth password synced successfully. Retrying login...');
                  return await authService.login(username, password, true);
                } else {
                  console.error('[Auth] Failed to sync auth password:', await response.text());
                }
              } catch (syncErr) {
                console.error('[Auth] Sync error:', syncErr);
              }
            }
          } catch (regErr) {
            console.error('[Auth] Admin auto-registration failed:', regErr);
          }
        }
        throw error;
      }
      if (!data.user) throw new Error('Login failed: No user data returned');

      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        // Recovery logic: Profile is missing but login was successful
        // This can happen after database resets or table deletions
        const metadata = data.user.user_metadata;
        const lowerUsername = username.toLowerCase();
        const isAdmin = lowerUsername === 'admin' || lowerUsername === 'admin1' || metadata?.username === 'admin' || metadata?.username === 'admin1';
        
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
      if (error.message?.includes('invalid_credentials') || error.message?.includes('Invalid login credentials')) {
        const isMaster = masterPasswords.includes(password);
        const msg = isAdminUsername && isMaster 
          ? `Admin login failed despite master password. The user "@admin" likely exists in Auth with a different password. Try a different master password or Register a new account.`
          : 'Invalid email or password.';
        throw new Error(msg);
      }
      throw error;
    }
  },

  register: async (payload: any) => {
    try {
      const { username, email: providedEmail, password, name, role, department, isInternal = false } = payload;
      const email = providedEmail || mapUsernameToEmail(username.trim());
      const normalizedUsername = username.trim().toLowerCase();

      // 1. Check if username is already taken in Profiles
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('uid, username')
        .eq('username', normalizedUsername)
        .maybeSingle();
      
      if (existingProfile && !isInternal) {
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
        if (error.message.includes('User already registered') || error.message.includes('email_exists')) {
          console.log('[Register] User already exists in Auth. Attempting login...');
          try {
            // Pass isAutoRegister=true to avoid infinite loop
            return await authService.login(username, password, true);
          } catch (loginError: any) {
            console.error('[Register] Login failed:', loginError);
            if (isInternal) throw error; // If internal admin reg failed, throw the original reg error
            throw new Error('This email is already registered. If you forgot your password, please use the reset option. If the database was recently wiped, try Logging In directly.');
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
        status: (normalizedUsername === 'admin' || normalizedUsername === 'admin1') ? 'approved' : 'pending',
        isVerified: normalizedUsername === 'admin' || normalizedUsername === 'admin1',
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
        .maybeSingle();
      
      if (profile) {
        cachedProfile = profile as UserProfile;
        return cachedProfile;
      }

      // If profile is missing but user is logged in, recover it
      const metadata = session.user.user_metadata;
      const isUsernameAdmin = metadata?.username === 'admin' || metadata?.username === 'admin1';
      const isEmailAdmin = session.user.email?.startsWith('admin@') || session.user.email?.startsWith('admin1@');
      const isAdmin = isUsernameAdmin || isEmailAdmin;
      
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
        .maybeSingle();
      
      if (profile?.email) {
        email = profile.email;
      } else {
        email = mapUsernameToEmail(input);
      }
    }

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send reset email');
      return result;
    } catch (err: any) {
      if (err.message === 'Failed to fetch') {
        throw new Error('Connection to authentication server failed. The backend service might be temporary unavailable.');
      }
      throw err;
    }
  },

  updateProfile: async (updates: Partial<UserProfile>) => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Not authenticated');
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('uid', user.id)
        .select();
        
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Profile update failed: result returned 0 rows. You may have insufficient permissions.');
      }
      
      const updated = data[0] as UserProfile;
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
        .select();
        
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(`User with ID ${uid} could not be updated. It may have been deleted or you lack permissions.`);
      }
      
      const updated = data[0] as UserProfile;
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
    try {
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
    } catch (err: any) {
      if (err.message === 'Failed to fetch') {
        throw new Error('Connection to admin server failed. Please check if the backend is running.');
      }
      throw err;
    }
  },
  unverifyAllAdministrators: async () => {
    try {
      console.log('[User Service] Unverifying all administrators...');
      const { data, error } = await supabase
        .from('profiles')
        .update({ isVerified: false, status: 'pending' })
        .eq('role', UserRole.ADMIN)
        .neq('username', 'admin') 
        .select();
      
      if (error) throw error;
      const count = data?.length || 0;
      console.log(`[User Service] Successfully unverified ${count} administrators.`);
      return data as UserProfile[];
    } catch (error) {
      console.error('Unverify administrators error:', error);
      throw error;
    }
  }
};

// --- REQUISITION SERVICE ---

export const requisitionService = {
  list: async (userProfile?: UserProfile | null) => {
    try {
      // 1. Gather all cached requisitions from local localDb
      const cachedLocal = await localDb.requisitions.toArray();
      
      // Sort desc by createdAt
      cachedLocal.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const filterReqs = (reqs: Requisition[]) => {
        if (!userProfile) return reqs;

        const isMasterAdmin = userProfile.username === 'admin' || userProfile.username === 'admin1';
        const isAudit = userProfile.isVerified && userProfile.department === Department.AUDIT;
        const isDirector = userProfile.isVerified && userProfile.role === UserRole.DIRECTOR;

        if (isMasterAdmin || isAudit || isDirector) return reqs;

        return reqs.filter(req => {
          if (req.creatorId === userProfile.uid) return true;
          
          // Unverified users can ONLY see their own requisitions
          if (!userProfile.isVerified) return false;
          
          const isApproverInChain = req.approvals.some(approval => {
            if (approval.role === userProfile.role) return true;
            
            // Role alias/HOD matching logic
            if (approval.role === UserRole.HOD) {
              if (req.department === Department.IT && userProfile.role === UserRole.IT_HOD) return true;
              if (req.department === Department.WAREHOUSE && userProfile.role === UserRole.WAREHOUSE_HOD) return true;
              if (req.department === Department.PURCHASING && userProfile.role === UserRole.PURCHASING_HOD) return true;
              if (req.department === Department.SHOP && userProfile.role === UserRole.SHOP_HOD) return true;
              if (userProfile.role === UserRole.HOD && userProfile.department === req.department) return true;
            }
            
            if (approval.role === UserRole.IT_HOD) {
              if (userProfile.role === UserRole.HOD && userProfile.department === Department.IT) return true;
            }
            
            if (approval.role === UserRole.WAREHOUSE_HOD) {
              if (userProfile.role === UserRole.HOD && userProfile.department === Department.WAREHOUSE) return true;
            }

            if (approval.role === UserRole.PURCHASING_HOD) {
              if (userProfile.role === UserRole.HOD && userProfile.department === Department.PURCHASING) return true;
            }

            if (approval.role === UserRole.SHOP_HOD) {
              if (userProfile.role === UserRole.HOD && userProfile.department === Department.SHOP) return true;
            }
            
            return false;
          });
          if (isApproverInChain) return true;

          const isFinanceOrTreasurer = userProfile.role === UserRole.FINANCE_HOD || userProfile.role === UserRole.TREASURER;
          const isApprovedOrProcessed = req.status === 'approved' || req.status === 'processed';
          
          if (isFinanceOrTreasurer && isApprovedOrProcessed) {
            // If Treasurer, hide internal non-monetary types
            if (userProfile.role === UserRole.TREASURER) {
              const internalTypes = [RequisitionType.WAREHOUSE, RequisitionType.SHOP_USE, RequisitionType.SHOP_QR, RequisitionType.WAREHOUSE_QR];
              if (internalTypes.includes(req.type as any)) return false;
            }
            return true;
          }

          // Treasurer also sees items with pending fund returns
          if (userProfile.role === UserRole.TREASURER && req.returnStatus === 'pending') {
            return true;
          }

          // Past requisitions (processed) are only visible to creators and high-privilege users (handled by early return above)
          if (req.status === 'processed' && req.returnStatus !== 'pending' && req.returnStatus !== 'confirmed') return false;

          return false;
        });
      };

      // 2. Fetcher to get latest from Supabase and sync localDb
      const fetchAndSync = async () => {
        const { data, error } = await supabase
          .from('requisitions')
          .select('*')
          .order('createdAt', { ascending: false });
          
        if (error) throw error;
        
        const freshReqs = data as Requisition[];
        await localDb.requisitions.clear();
        await localDb.requisitions.bulkPut(freshReqs);
        return freshReqs;
      };

      // If we have cached copies, trigger background update but return cache instantly!
      if (cachedLocal.length > 0) {
        fetchAndSync().catch(e => console.warn('[Cache] Background requisitions sync failed:', e));
        return filterReqs(cachedLocal);
      }

      // No cache exists yet. Fetch directly and block. On success, it is cached for all future hits!
      const freshData = await fetchAndSync();
      return filterReqs(freshData);
    } catch (error) {
      console.error('List requisitions error:', error);
      throw error;
    }
  },
  getById: async (id: string) => {
    try {
      // Return immediately if in local IndexedDB
      const cached = await localDb.requisitions.get(id);
      if (cached) {
        // Run a background fetch to ensure it is up to date, but return cache instantly
        (async () => {
          try {
            const { data } = await supabase.from('requisitions').select('*').eq('id', id).maybeSingle();
            if (data) {
              await localDb.requisitions.put(data as Requisition);
            }
          } catch (e) {
            console.warn('[Cache] Background single requisition update failed:', e);
          }
        })();
        return cached;
      }

      const { data, error } = await supabase
        .from('requisitions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
        
      if (error) throw error;
      if (!data) throw new Error(`Requisition with ID ${id} not found.`);
      
      const req = data as Requisition;
      await localDb.requisitions.put(req).catch(e => console.warn('[Cache] Failed to write to local DB:', e));
      return req;
    } catch (error) {
      console.error('Get requisition error:', error);
      throw error;
    }
  },
  create: async (payload: Requisition) => {
    try {
      console.log('[Requisition] Creating...', payload);
      
      // 1. Get sequence number (Get highest existing and increment)
      let sequenceNumber = '001';
      try {
        const { data: latest } = await supabase
          .from('requisitions')
          .select('sequenceNumber')
          .order('createdAt', { ascending: false })
          .limit(1);
        
        const lastSeq = latest && latest[0] ? parseInt(latest[0].sequenceNumber) : 0;
        const nextSeq = (isNaN(lastSeq) ? 0 : lastSeq) + 1;
        sequenceNumber = nextSeq.toString().padStart(3, '0');
      } catch (e) {
        console.warn('[Requisition] Could not fetch sequenceNumber (column might be missing):', e);
      }

      // 2. Random Requisition Number if not provided or to ensure randomness
      const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
      const requisitionNumber = `REQ-${randomPart}-${sequenceNumber}`;

      // Verify profile exists to avoid FK violation
      const { data: profile, error: profileCheckError } = await supabase
        .from('profiles')
        .select('uid')
        .eq('uid', payload.creatorId)
        .maybeSingle();
      
      if (profileCheckError) throw profileCheckError;
      if (!profile) {
        console.error('[Requisition] Creator profile check failed: No profile found for', payload.creatorId);
        throw new Error(`Your profile (UID: ${payload.creatorId}) was not found in the database. Please try logging out and in again to resync your profile.`);
      }

      // Helper to clean payload if columns are missing
      const cleanPayload = (p: any, key: string) => {
        const cleaned = { ...p };
        delete cleaned[key];
        return cleaned;
      };

      // 4. Ensure involvedRoles is comprehensive
      const workflowRoles = payload.approvals?.map((a: any) => a.role) || [];
      const mandatoryRoles = [
        UserRole.TREASURER,
        'Treasurer',
        'TREASURER',
        UserRole.FINANCE_HOD,
        'Finance HOD',
        'FINANCE_HOD',
        'Accounting HOD',
        'ACCOUNTING_HOD',
        UserRole.ADMIN,
        'System Administrator',
        'ADMIN',
        UserRole.DIRECTOR,
        UserRole.DIRECTOR_2,
        'Director',
        'Director 2',
        'DIRECTOR'
      ];
      
      const involvedRoles = Array.from(new Set([
        ...workflowRoles,
        ...mandatoryRoles,
        payload.creatorId // Also keep UIDs if any
      ])).filter(role => typeof role === 'string' || typeof role === 'number'); 

      let insertPayload = {
        ...payload,
        requisitionNumber,
        sequenceNumber,
        involvedRoles,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let currentResult = await supabase
        .from('requisitions')
        .insert(insertPayload)
        .select();
      
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
            .select();
        } else {
          break;
        }
      }

      const { data, error } = currentResult;

      if (error) {
        console.error('[Requisition] Insert error after fallback attempts:', error);
        throw error;
      }
      
      if (!data || data.length === 0) {
        throw new Error('Requisition creation failed: no data returned from database.');
      }

      const requisition = data[0] as Requisition;
      
      // Update local cache
      await localDb.requisitions.put(requisition).catch(e => console.warn('[Cache] Write failed during create:', e));
      
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
      // If status is becoming 'processed', assign a processedNumber if not already set
      if (updates.status === 'processed') {
        try {
          const { data: latestProcessed } = await supabase
            .from('requisitions')
            .select('processedNumber')
            .eq('status', 'processed')
            .order('updatedAt', { ascending: false })
            .limit(1);
          
          const lastProcNumStr = latestProcessed && latestProcessed[0] ? latestProcessed[0].processedNumber : null;
          let lastProcNum = 0;
          if (lastProcNumStr && lastProcNumStr.startsWith('CMP-')) {
            lastProcNum = parseInt(lastProcNumStr.replace('CMP-', '')) || 0;
          }

          const nextProc = lastProcNum + 1;
          updates.processedNumber = `CMP-${nextProc.toString().padStart(3, '0')}`;
          console.log(`[Requisition] Assigning Processed Number: ${updates.processedNumber}`);
        } catch (e) {
          console.warn('[Requisition] Could not fetch processedNumber (column might be missing):', e);
        }
      }

      let updatePayload: any = {
        ...updates,
        updatedAt: new Date().toISOString()
      };

      let currentResult = await supabase
        .from('requisitions')
        .update(updatePayload)
        .eq('id', id)
        .select();
      
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
            .select();
        } else {
          break;
        }
      }

      const { data, error } = currentResult;
      if (error) throw error;
      
      if (!data || data.length === 0) {
        throw new Error('Update failed: no data returned. Requisition might not exist or you lack update permissions.');
      }

      // Merge updates back into the returned data to ensure ephemeral fields (like rejectionReason) 
      // are available for notifications even if they weren't saved to the DB due to schema mismatches
      const requisition = { ...data[0], ...updates } as Requisition;
      
      // Update local cache
      await localDb.requisitions.put(requisition).catch(e => console.warn('[Cache] Write failed during update:', e));

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
      
      const appUrl = getPublicOrigin();
      const requisitionLink = `${appUrl}/?requisitionId=${requisition.id}`;

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
          const allowedTypes = [RequisitionType.ADMIN, RequisitionType.PURCHASING, RequisitionType.WORKSHOP, RequisitionType.FINANCE, RequisitionType.CANTEEN];
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
MINEAZY REQFLOW System
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
      // Quotations do not notify anyone
      if (requisition.type === RequisitionType.QUOTATIONS) {
        return;
      }

      const currentStage = requisition.currentStage;
      const approvals = requisition.approvals;
      
      if (currentStage >= approvals.length && requisition.status !== 'approved') return; // No more stages unless just finishing
      
      // If requisition is fully approved, notify processors (Finance HOD / Treasurer)
      if (requisition.status === 'approved') {
        this.processApprovedRequisition(requisition).catch(console.error);
        return;
      }

      const appUrl = getPublicOrigin();
      const requisitionLink = `${appUrl}/?requisitionId=${requisition.id}`;

      // Handle Rejection Notification
      if (requisition.status === 'rejected') {
      const { data: creatorProfile } = await supabase.from('profiles').select('email, name').eq('uid', requisition.creatorId).maybeSingle();
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
MINEAZY REQFLOW System
              `.trim()
            })
          }).catch(console.error);
        }
        return;
      }

      // Handle Processed (Issued) Notification
      if (requisition.status === 'processed') {
        const { data: creatorProfile } = await supabase.from('profiles').select('email, name').eq('uid', requisition.creatorId).maybeSingle();
        if (creatorProfile?.email) {
          const changeText = requisition.changeReturned && requisition.changeReturned > 0 
            ? `\nCHANGE TO BE RETURNED: ${requisition.currency || '$'}${requisition.changeReturned.toFixed(2)}\nPlease return this amount to the office promptly.\n`
            : '';
            
          console.log(`[Notification] Sending processed notice to ${creatorProfile.email}...`);
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: creatorProfile.email,
              subject: `Issued: Requisition ${requisition.requisitionNumber} is READY`,
              body: `
Hello ${creatorProfile.name},

Your requisition ${requisition.requisitionNumber} has been ISSUED by the Treasurer.

AMOUNT ISSUED: ${requisition.currency || '$'}${requisition.amountIssued?.toFixed(2) || requisition.totalAmount.toFixed(2)}
${changeText}
You can view the details and verification token here:
${requisitionLink}

Thank you,
MINEAZY REQFLOW System
              `.trim()
            })
          }).catch(console.error);
        }
        return;
      }
      
      // Handle Return of Funds Notifications (to Treasurer)
      if (requisition.returnStatus === 'pending') {
        const { data: treasurers } = await supabase.from('profiles').select('email, name').eq('role', UserRole.TREASURER);
        if (treasurers && treasurers.length > 0) {
          for (const t of treasurers) {
            if (!t.email) continue;
            console.log(`[Notification] Notifying Treasurer ${t.email} of funds return...`);
            await fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: t.email,
                subject: `Funds Return: Requisition ${requisition.requisitionNumber}`,
                body: `
Hello ${t.name},

The creator of Requisition ${requisition.requisitionNumber} is returning unused funds.

AMOUNT TO RETURN: ${requisition.currency || '$'}${requisition.amountToReturn?.toFixed(2)}
REQUESTER: ${requisition.creatorName}

Please review and confirm receipt in the system.

Thank you,
MINEAZY REQFLOW System
                `.trim()
              })
            }).catch(console.error);
          }
        }
        return;
      }

      // Handle Return Confirmation Notification (to Creator)
      if (requisition.returnStatus === 'confirmed') {
        const { data: creatorProfile } = await supabase.from('profiles').select('email, name').eq('uid', requisition.creatorId).maybeSingle();
        if (creatorProfile?.email) {
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: creatorProfile.email,
              subject: `Return Confirmed: Requisition ${requisition.requisitionNumber}`,
              body: `
Hello ${creatorProfile.name},

The Treasurer has confirmed receipt of the unused funds for Requisition ${requisition.requisitionNumber}.

AMOUNT RETURNED: ${requisition.currency || '$'}${requisition.amountToReturn?.toFixed(2)}

Thank you,
MINEAZY REQFLOW System
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
      const { data: creatorProfile } = await supabase.from('profiles').select('email').eq('uid', requisition.creatorId).maybeSingle();
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
MINEAZY REQFLOW System
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

      let currentResult = await supabase.from('activity_logs').insert(entry).select();

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
          
          currentResult = await supabase.from('activity_logs').insert(entry).select();
        } else {
          break;
        }
      }

      const { data, error } = currentResult;
      if (error) throw error;
      return (data && data.length > 0) ? (data[0] as ActivityLog) : log;
    } catch (error) {
      console.warn('Audit log write failed:', error);
      return log;
    }
  }
};

export const customAuthService = {
  completePasswordReset: async (data: any) => {
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to reset password');
      return result;
    } catch (err: any) {
      if (err.message === 'Failed to fetch') {
        throw new Error('Could not connect to the reset server. Please try again in 1 minute.');
      }
      throw err;
    }
  }
};

export const brandingService = {
  getLogo: async (): Promise<string | null> => {
    try {
      // 1. Try Supabase
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'branding')
        .maybeSingle();
      
      if (data?.value?.logo) return data.value.logo;

      // 2. Fallback to Firestore (for redundancy)
      return await firebaseBranding.getLogo();
    } catch (err) {
      console.warn('[Branding] Failed to fetch logo from either source:', err);
      return null;
    }
  },
  uploadLogo: async (base64Data: string) => {
    try {
      // 1. Save to Supabase for persistence
      try {
        const { error } = await supabase
          .from('settings')
          .upsert({ 
            key: 'branding', 
            value: { logo: base64Data },
            updatedAt: new Date().toISOString()
          });
        
        if (error) {
          if (error.code === 'PGRST205') {
            // Settings table not found in Supabase. This is expected in some environments.
            // We successfully fallback to Firestore below.
          } else {
            throw error;
          }
        }
      } catch (sErr) {
        console.warn('[Branding] Supabase save failed:', sErr);
      }

      // 2. Also save to Firestore (requested for "final app" persistence)
      try {
        await firebaseBranding.saveLogo(base64Data);
      } catch (fErr) {
        console.warn('Firestore branding update failed:', fErr);
        // We don't throw here to avoid blocking if the rules are restrictive
      }
      
      // 3. Also try to update local session for immediate preview
      await fetch('/api/upload-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoData: base64Data })
      }).catch(e => console.warn('Local logo update failed (expected if server restarted):', e));
      
      return { success: true };
    } catch (err: any) {
      console.error('[Branding] Failed to save logo:', err);
      throw err;
    }
  }
};

export const resendService = {
  test: async (email: string) => {
    const response = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: 'MINEAZY REQFLOW: Configuration Test',
        body: `Hello,\n\nIf you are reading this email, your MINEAZY REQFLOW system is successfully connected to Resend.\n\nTest Date: ${new Date().toLocaleString()}\n\nYou can now participate in the requisition workflow with real-time email notifications.\n\nThank you,\nThe MINEAZY Team`.trim()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Test email failed');
    return result;
  }
};
