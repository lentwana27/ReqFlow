import React, { useState, useEffect, useCallback } from 'react';
import { userService, requisitionService, auditService, authService, brandingService } from '../services/api';
import { UserProfile, UserRole, Department, ROLES, DEPARTMENTS } from '../types';
import {
  Users, CheckCircle2, XCircle, Search, Loader2,
  Lock, ArrowLeft, AlertCircle, RefreshCw, KeyRound,
  Download, Calendar, Filter, Image as ImageIcon, Upload, ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../context/ToastContext';

interface AdminPanelProps {
  userProfile?: UserProfile | null;
  onBack?: () => void;
  onLoginSuccess?: (user: any) => void;
}

export default function AdminPanel({ userProfile, onBack, onLoginSuccess }: AdminPanelProps) {
  const { showToast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'unverified' | 'verified'>('all');
  const [activeTab, setActiveTab] = useState<'users' | 'requisitions' | 'audit' | 'branding'>('users');
  const [requisitions, setRequisitions] = useState<any[]>([]);

  // Requisition Filters
  const [reqSearchTerm, setReqSearchTerm] = useState('');
  const [reqStatusFilter, setReqStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'processed'>('all');
  const [reqDateFilter, setReqDateFilter] = useState('');
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [updatingUids, setUpdatingUids] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const isAdminUser = (u?: UserProfile | null) =>
    !!u && (u.username === 'admin' || (u.role === UserRole.ADMIN && u.isVerified));

  const [isLocked, setIsLocked] = useState(!isAdminUser(userProfile));
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  useEffect(() => {
    if (isAdminUser(userProfile)) setIsLocked(false);
  }, [userProfile]);

  const [systemStatus, setSystemStatus] = useState<any>(null);

  // ─── Data Fetching ───────────────────────────────────────────────────────────

  const fetchData = useCallback(async (tab?: string) => {
    const targetTab = tab || activeTab;
    setLoading(true);
    try {
      if (targetTab === 'users') {
        const localUsers = await userService.list();
        setUsers(localUsers);
      } else if (targetTab === 'requisitions') {
        const localReqs = await requisitionService.list(userProfile);
        setRequisitions(localReqs);
      } else if (targetTab === 'audit') {
        const localLogs = await auditService.list();
        setAuditLogs(localLogs);
        
        // Fetch system status when on logs tab as a health check
        fetch('/api/system/status').then(res => res.json()).then(setSystemStatus).catch(console.warn);
      } else if (targetTab === 'branding') {
        const logo = await brandingService.getLogo();
        setCurrentLogo(logo);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [userProfile, activeTab]);

  useEffect(() => {
    if (!isLocked) fetchData(activeTab);
  }, [isLocked, activeTab, fetchData]);

  const handleSync = async () => {
    setIsSyncing(true);
    await fetchData().finally(() => setIsSyncing(false));
  };

  const [unlockStatus, setUnlockStatus] = useState('');

  // ─── Unlock ──────────────────────────────────────────────────────────────────

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    const validPasswords = ['Admin50$', 'Action50$'];

    if (!validPasswords.includes(trimmed)) {
      setUnlockError('Invalid administrator password');
      setPassword('');
      return;
    }

    setIsUnlocking(true);
    setUnlockError('');
    setUnlockStatus('Elevating credentials...');
    
    // Background auth elevation
    try {
      const { user } = await authService.login('admin', trimmed);
      setUnlockStatus('Syncing profile...');
      if (onLoginSuccess) onLoginSuccess(userProfile || user);
      setIsLocked(false); // Success! Unlock everything
      showToast('Admin access elevated');
    } catch (loginErr: any) {
      let isInvalid = false;
      let errorDetail = '';
      
      try {
        const parsed = JSON.parse(loginErr.message);
        isInvalid = 
          parsed.code === 'auth/invalid-credential' || 
          parsed.code === 'invalid_credentials' ||
          parsed.error?.toLowerCase().includes('invalid') || 
          parsed.error?.toLowerCase().includes('not found');
        errorDetail = parsed.error;
      } catch (e) {
        isInvalid = loginErr.message?.toLowerCase().includes('invalid') || loginErr.message?.toLowerCase().includes('not found');
      }
      
      if (isInvalid) {
        setUnlockStatus('Initializing admin account...');
        try {
          const { user } = await authService.register({
            username: 'admin',
            password: trimmed,
            name: 'System Administrator',
            role: UserRole.ADMIN,
            department: Department.GENERAL,
          });
          if (onLoginSuccess) onLoginSuccess(user);
          setIsLocked(false);
          showToast('Admin account initialized');
        } catch (regErr: any) {
          console.warn('Auto-admin registration failed:', regErr);
          setUnlockError('Initial setup failed. Try refreshing or check console.');
        }
      } else {
        setUnlockStatus('Accessing local view...');
        setUnlockError(errorDetail || 'Connection error. Accessing local mode.');
        setIsLocked(false); // Unlock UI for speed if it's just a sync error
      }
    } finally {
      setIsUnlocking(false);
      setUnlockStatus('');
      setPassword('');
    }
  };

  // ─── User Update (Optimistic) ────────────────────────────────────────────────

  const handleUpdateUser = async (uid: string, data: Partial<UserProfile>) => {
    const previousUsers = [...users];

    // 1. OPTIMISTIC UPDATE — instant UI change
    setUsers((prev) =>
      prev.map((u) => (u.uid === uid ? { ...u, ...data } : u))
    );

    try {
      const updatedUser = await userService.update(uid, data);
      // Reconcile with server response
      setUsers((prev) => prev.map((u) => (u.uid === uid ? updatedUser : u)));
      showToast('Account updated successfully');

      const targetUser = previousUsers.find((u) => u.uid === uid);
      const actingUser = userProfile || {
        uid: 'system-admin', name: 'Direct Admin Access', username: 'admin',
        role: UserRole.ADMIN, department: Department.GENERAL, status: 'approved' as const,
      };

      auditService.log({
        user: actingUser.name,
        username: actingUser.username || 'admin',
        action: 'User Management',
        module: 'SYSTEM',
        target: 'PROFILE',
        details: `Updated ${targetUser?.name}: ${JSON.stringify(data)}`,
      }).catch((e) => console.warn('Audit log failed:', e));

    } catch (err: any) {
      // ROLLBACK on failure
      setUsers(previousUsers);
      
      let msg = 'Update failed';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) msg = parsed.error;
      } catch {
        msg = err.message || msg;
      }
      
      showToast(msg, 'error');
      console.error('Update user error:', err);
    }
  };

  const handleUpdateWithLoading = async (uid: string, data: Partial<UserProfile>) => {
    setUpdatingUids((prev) => [...prev, uid]);
    await handleUpdateUser(uid, data);
    setUpdatingUids((prev) => prev.filter((id) => id !== uid));
  };

  // ─── Password Reset (for user who forgot) ───────────────────────────────────

  const handleAdminPasswordReset = async (user: UserProfile) => {
    // 1. Try to find the code if it exists in audit logs
    let currentLogs = auditLogs;
    if (currentLogs.length === 0) {
      try {
        currentLogs = await auditService.list();
        setAuditLogs(currentLogs);
      } catch (e) {
        console.warn('Could not fetch audit logs for reset code lookup:', e);
      }
    }

    const existingLog = currentLogs.find(l => l.action === 'Password Reset Request' && l.username === user.username);
    const suggestedCode = existingLog ? existingLog.details?.split('Code: ')[1] : Math.floor(100000 + Math.random() * 900000).toString();

    const newPass = prompt(`Reset password for ${user.name}. Entering a custom password here will update the account immediately:`, suggestedCode || '');
    if (!newPass || newPass.length < 6) return;

    try {
      setUpdatingUids(prev => [...prev, user.uid]);
      
      // Call automated reset
      await userService.resetPassword(user.uid, newPass);

      await auditService.log({
        user: userProfile?.name || 'Admin',
        username: userProfile?.username || 'admin',
        action: 'Force Password Reset',
        module: 'USERS',
        target: user.username,
        details: `Admin reset password for @${user.username} to: ${newPass}`,
      });
      
      showToast(`Password successfully reset for ${user.name}`);
      fetchData('audit'); // refresh logs
    } catch (err: any) {
      console.error('Password reset failed:', err);
      showToast(err.message || 'Failed to reset password. Check if Service Role Key is configured.', 'error');
    } finally {
      setUpdatingUids(prev => prev.filter(id => id !== user.uid));
    }
  };

  // ─── Filtered Users ──────────────────────────────────────────────────────────

  const filteredUsers = users.filter((u) => {
    const ident = (u.username || u.email || '').toLowerCase();
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ident.includes(searchTerm.toLowerCase());
    const matchesFilter =
      filter === 'all' ||
      (filter === 'pending' && u.status === 'pending') ||
      (filter === 'approved' && u.status === 'approved') ||
      (filter === 'verified' && u.isVerified) ||
      (filter === 'unverified' && !u.isVerified);
    return matchesSearch && matchesFilter;
  });

  // ─── Filtered Requisitions ──────────────────────────────────────────────────

  const filteredRequisitions = requisitions.filter((req) => {
    const searchLower = reqSearchTerm.toLowerCase();
    const idMatches = (req.requisitionNumber || req.id || '').toLowerCase().includes(searchLower);
    const typeMatches = (req.type || '').toLowerCase().includes(searchLower);
    const creatorMatches = (req.creatorName || '').toLowerCase().includes(searchLower);
    
    const matchesSearch = idMatches || typeMatches || creatorMatches;
    
    const matchesStatus = reqStatusFilter === 'all' || req.status === reqStatusFilter;
    
    const matchesDate = !reqDateFilter || (req.createdAt && new Date(req.createdAt).toISOString().split('T')[0] === reqDateFilter);
    
    return matchesSearch && matchesStatus && matchesDate;
  });

  const handleDownloadAll = () => {
    const dataToDownload = filteredRequisitions.length > 0 ? filteredRequisitions : requisitions;
    if (dataToDownload.length === 0) return;

    const headers = ['ID', 'Number', 'Type', 'Creator', 'Department', 'Total', 'Status', 'Date'];
    const rows = dataToDownload.map(req => [
      req.id,
      req.requisitionNumber || 'N/A',
      req.type,
      req.creatorName,
      req.department,
      req.totalAmount,
      req.status,
      req.createdAt ? new Date(req.createdAt).toLocaleDateString() : 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const filename = filteredRequisitions.length === requisitions.length 
      ? `all_requisitions_${new Date().toISOString().split('T')[0]}.csv`
      : `filtered_requisitions_${new Date().toISOString().split('T')[0]}.csv`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`${dataToDownload.length} records exported`);
  };

  // ─── Reset Logs (from audit) ─────────────────────────────────────────────────

  const resetRequests = auditLogs.filter((l) => l.action === 'Password Reset Request');

  // ─── Locked Screen ──────────────────────────────────────────────────────────

  if (isLocked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-gray-100 shadow-xl rounded-sm max-w-sm w-full p-8 text-center"
        >
          <div className="w-14 h-14 bg-black rounded-full flex items-center justify-center mx-auto mb-5">
            <Lock className="text-white w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold mb-1">Admin Panel</h2>
          <p className="text-gray-500 text-sm mb-6">
            Enter the administrator password to access system controls.
          </p>

          <form onSubmit={handleUnlock} className="space-y-4">
            <input
              id="admin-pass-input"
              type="password"
              placeholder="Administrator password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-200 px-4 py-2.5 rounded-sm focus:outline-none focus:ring-1 focus:ring-black font-mono text-center text-sm"
              autoFocus
              disabled={isUnlocking}
            />
            {unlockError && (
              <p className="text-xs text-red-600 font-medium">{unlockError}</p>
            )}
            <button
              id="admin-unlock-btn"
              type="submit"
              className="w-full bg-black text-white py-2.5 rounded-sm text-sm font-bold flex items-center justify-center gap-2 hover:bg-gray-900 transition-colors disabled:opacity-60"
              disabled={isUnlocking}
            >
              {isUnlocking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {unlockStatus || 'Verifying...'}
                </>
              ) : (
                'Unlock Admin Panel'
              )}
            </button>
          </form>

          {onBack && (
            <button
              onClick={onBack}
              className="mt-5 text-xs text-gray-400 hover:text-black flex items-center gap-1.5 justify-center mx-auto transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Login
            </button>
          )}
        </motion.div>
      </div>
    );
  }

  const isFullAdmin = isAdminUser(userProfile);

  // ─── Main Panel ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Read-only warning */}
      {!isFullAdmin && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-amber-900 font-bold">Elevation Failed: Read-Only Mode</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  Panel is unlocked locally, but admin authentication failed.{' '}
                  <span className="font-bold underline">All changes will be blocked</span> by database rules.
                </p>
              </div>
            </div>
            <button
              onClick={() => { setIsLocked(true); setPassword(''); }}
              className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-sm hover:bg-amber-700 transition-colors shrink-0"
            >
              Retry Admin Login
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-1">
            Admin Control Center
          </h1>
          <p className="text-sm text-gray-500">
            System-level management for Mineazy.
            {resetRequests.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold animate-pulse">
                {resetRequests.length} reset request{resetRequests.length > 1 ? 's' : ''} pending
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isUnlocking && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-sm text-[10px] font-bold uppercase animate-pulse border border-blue-100">
              <Loader2 className="w-3 h-3 animate-spin" />
              Elevating...
            </div>
          )}

          {/* System Maintenance (Master Admin only) */}
          {userProfile?.username === 'admin' && activeTab === 'users' && (
            <button
              onClick={async () => {
                if (confirm('RESET SYSTEM ADMINISTRATORS: This will unverify ALL System Administrators (except yourself) and force them to wait for your approval. This cannot be undone. Proceed?')) {
                  try {
                    setIsSyncing(true);
                    const resetUsers = await userService.unverifyAllAdministrators();
                    const count = resetUsers.length;
                    
                    await auditService.log({
                      action: 'RESET_ADMINS',
                      module: 'USERS',
                      details: `Master Admin reset and unverified ${count} system administrators.`
                    });

                    showToast(`${count} system administrator accounts have been unverified and set to pending.`);
                    await fetchData('users');
                  } catch (e: any) {
                    console.error('[Admin] Reset error:', e);
                    showToast(`Reset failed: ${e.message}`, 'error');
                  } finally {
                    setIsSyncing(false);
                  }
                }
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold bg-red-600 text-white border border-red-700 rounded-sm hover:bg-red-700 transition-colors shadow-sm"
              title="Force all non-master admins to wait for re-approval"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Reset All Admins
            </button>
          )}

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-2 text-xs font-bold border border-gray-200 rounded-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {/* Tab switcher */}
          <div className="flex bg-white border border-gray-200 p-1 rounded-sm gap-1">
            {(['users', 'requisitions', 'audit', 'branding'] as const)
              .filter(tab => tab !== 'branding' || userProfile?.username === 'admin')
              .map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 text-xs font-bold transition-all rounded-sm relative ${
                  activeTab === tab ? 'bg-black text-white' : 'text-gray-400 hover:text-black'
                }`}
              >
                {tab === 'audit' ? 'Audit & Resets' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'audit' && resetRequests.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white rounded-full text-[8px] flex items-center justify-center font-bold">
                    {resetRequests.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* User search/filter */}
          {activeTab === 'users' && (
            <>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-black w-44"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="border border-gray-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white font-bold"
              >
                <option value="all">All Users</option>
                <option value="verified">Verified</option>
                <option value="unverified">Not Verified</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
              </select>
            </>
          )}

          {/* Requisition search/filter/download */}
          {activeTab === 'requisitions' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search requisitions..."
                  value={reqSearchTerm}
                  onChange={(e) => setReqSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-black w-44"
                />
              </div>
              
              <div className="relative">
                <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  value={reqDateFilter}
                  onChange={(e) => setReqDateFilter(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white"
                />
              </div>

              <select
                value={reqStatusFilter}
                onChange={(e) => setReqStatusFilter(e.target.value as any)}
                className="border border-gray-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white font-bold"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="processed">Processed</option>
              </select>

              <button
                onClick={handleDownloadAll}
                className="flex items-center gap-2 px-3 py-2 bg-black text-white text-xs font-bold rounded-sm hover:bg-gray-800 transition-colors"
                title="Download All Requisitions as CSV"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-24 flex flex-col items-center gap-3"
          >
            <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
            <p className="text-xs text-gray-400 font-mono">Loading data...</p>
          </motion.div>
        ) : activeTab === 'users' ? (
          <motion.div key="users" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {filteredUsers.length === 0 ? (
              <div className="bg-white border border-dashed border-gray-200 rounded-sm text-center py-20">
                <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 font-medium text-sm">No users match your criteria</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-sm overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {['User', 'Department', 'Role', 'Status', 'Actions'].map((h, i) => (
                        <th
                          key={h}
                          className={`px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-gray-400 ${i === 4 ? 'text-right' : ''}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredUsers.map((user) => {
                      const isUpdating = updatingUids.includes(user.uid);
                      return (
                        <tr key={user.uid} className="hover:bg-gray-50/70 transition-colors group">
                          {/* User Info */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-sm">{user.name}</p>
                                <p className="text-xs text-gray-500 font-mono">
                                  @{user.username || user.email?.split('@')[0]}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Department */}
                          <td className="px-6 py-4">
                            <select
                              value={user.department}
                              disabled={isUpdating}
                              onChange={(e) =>
                                handleUpdateWithLoading(user.uid, { department: e.target.value as Department })
                              }
                              className="text-sm border border-transparent hover:border-gray-200 bg-transparent hover:bg-white px-2 py-1 rounded-sm focus:ring-1 focus:ring-black transition-all font-medium disabled:opacity-40 cursor-pointer"
                            >
                              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>

                          {/* Role */}
                          <td className="px-6 py-4">
                            <select
                              value={user.role}
                              disabled={isUpdating}
                              onChange={(e) =>
                                handleUpdateWithLoading(user.uid, { role: e.target.value as UserRole })
                              }
                              className="text-sm border border-transparent hover:border-gray-200 bg-transparent hover:bg-white px-2 py-1 rounded-sm focus:ring-1 focus:ring-black transition-all font-medium disabled:opacity-40 cursor-pointer"
                            >
                              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>

                          {/* Status — updates INSTANTLY via optimistic update */}
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border transition-all duration-300 ${
                                user.isVerified
                                  ? 'bg-green-100 text-green-700 border-green-200'
                                  : 'bg-amber-100 text-amber-700 border-amber-200'
                              }`}
                            >
                              {isUpdating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : user.isVerified ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <AlertCircle className="w-3 h-3" />
                              )}
                              {user.isVerified ? 'Verified' : 'Unverified'}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-1">
                              {/* Password reset */}
                              <button
                                onClick={() => handleAdminPasswordReset(user)}
                                className="p-1.5 text-gray-300 hover:text-amber-600 transition-colors rounded"
                                title="Set Temporary Password"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>

                              {/* Sync */}
                              <button
                                onClick={() => handleUpdateWithLoading(user.uid, {})}
                                disabled={isUpdating}
                                title="Force Sync"
                                className="p-1.5 text-gray-300 hover:text-black transition-colors rounded"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
                              </button>

                              {/* Verify / Unverify */}
                              {!user.isVerified ? (
                                <>
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Delete account for ${user.name}?`)) {
                                        try {
                                          await userService.delete(user.uid);
                                          setUsers((prev) => prev.filter((u) => u.uid !== user.uid));
                                          showToast('Account deleted');
                                        } catch (e: any) {
                                          let msg = 'Delete failed';
                                          try {
                                            const parsed = JSON.parse(e.message);
                                            if (parsed.error) msg = parsed.error;
                                          } catch {
                                            msg = e.message || msg;
                                          }
                                          showToast(msg, 'error');
                                        }
                                      }
                                    }}
                                    disabled={isUpdating}
                                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded"
                                    title="Reject & Delete"
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (user.role === UserRole.DIRECTOR && userProfile?.username !== 'admin') {
                                        showToast('Only the Master Administrator can verify Director accounts', 'error');
                                        return;
                                      }
                                      handleUpdateWithLoading(user.uid, { isVerified: true, status: 'approved' });
                                    }}
                                    disabled={isUpdating}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs font-bold rounded-sm hover:bg-gray-800 transition-colors disabled:opacity-50"
                                  >
                                    {isUpdating ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    Verify
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleUpdateWithLoading(user.uid, { isVerified: false })}
                                  disabled={isUpdating}
                                  className="flex items-center gap-1 text-xs text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  {isUpdating ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <XCircle className="w-3.5 h-3.5" />
                                  )}
                                  Revoke
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        ) : activeTab === 'requisitions' ? (
          <motion.div key="reqs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-white border border-gray-100 rounded-sm overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Requisition', 'Total', 'Status', 'Involved Roles', 'Actions'].map((h, i) => (
                      <th
                        key={h}
                        className={`px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-gray-400 ${i === 4 ? 'text-right' : ''}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRequisitions.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="font-bold text-sm font-mono truncate max-w-[180px]">
                          {req.requisitionNumber || req.id}
                        </p>
                        <p className="text-[10px] text-gray-400 uppercase font-bold">
                          {req.type} • {req.creatorName}
                        </p>
                      </td>
                      <td className="px-6 py-4 font-bold text-sm">
                        ${req.totalAmount?.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                            req.status === 'approved'
                              ? 'bg-green-100 text-green-700'
                              : req.status === 'rejected'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex -space-x-1">
                          {req.involvedRoles?.map((r: string, i: number) => (
                            <div
                              key={i}
                              title={r}
                              className="w-6 h-6 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-600"
                            >
                              {r.charAt(0)}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {userProfile?.username === 'admin' && (
                          <button
                            onClick={async () => {
                              if (confirm('Delete this requisition permanently?')) {
                                try {
                                  await requisitionService.delete(req.id, userProfile);
                                  setRequisitions((prev) => prev.filter((r) => r.id !== req.id));
                                  showToast('Requisition deleted');
                                } catch (e: any) {
                                  showToast(`Delete failed: ${e.message}`);
                                }
                              }
                            }}
                            className="text-xs text-red-300 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 font-bold"
                          >
                            Force Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : activeTab === 'branding' ? (
          <motion.div key="branding" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-2xl mx-auto py-8">
            <div className="bg-white border border-gray-100 rounded-sm p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <ImageIcon className="w-6 h-6 text-black" />
                <h3 className="text-lg font-bold">System Branding</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Company Logo (PDF Header)</label>
                  <p className="text-xs text-gray-500 mb-4">
                    Upload a PNG logo for the PDF requisitions. Recommended size: Wide aspect (e.g., 400x150px).
                  </p>
                  
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg p-10 bg-gray-50 hover:bg-gray-100 transition-colors group relative cursor-pointer">
                    <input 
                      type="file" 
                      accept="image/png, image/jpeg" 
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        const reader = new FileReader();
                        reader.onload = async (event) => {
                          const base64 = event.target?.result as string;
                          try {
                            setLoading(true);
                            await brandingService.uploadLogo(base64);
                            setCurrentLogo(base64);
                            showToast('Logo updated successfully! Changes will take effect on new PDFs.');
                            
                            // Log the change
                            await auditService.log({
                              action: 'UPDATE_BRANDING',
                              module: 'SYSTEM',
                              details: 'Updated company logo',
                              user: userProfile?.name || 'Admin'
                            });
                          } catch (err: any) {
                            showToast(err.message || 'Failed to upload logo', 'error');
                          } finally {
                            setLoading(false);
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    <Upload className="w-10 h-10 text-gray-300 group-hover:text-black transition-colors mb-3" />
                    <p className="text-sm font-bold text-gray-600 group-hover:text-black">Click to upload logo.png</p>
                    <p className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-tight">PNG or JPEG • Max 10MB</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold mb-2">Current Logo Preview</h4>
                  <div className="bg-gray-50 p-4 rounded border border-gray-100 flex items-center justify-center">
                    <img 
                      src={currentLogo || `/logo.png?v=${Date.now()}`} 
                      alt="Current Logo" 
                      className="max-h-24 object-contain"
                      onError={(e) => {
                        if (currentLogo) {
                          setCurrentLogo(null);
                        } else {
                          (e.target as HTMLImageElement).src = 'https://placehold.co/400x150?text=No+Logo+Uploaded';
                        }
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 italic text-center">
                    Note: The logo shown above is the one currently stored in the system and will appear on all generated PDFs.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          // ─── Audit & Resets Tab ──────────────────────────────────────────────
          <motion.div key="audit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0}} className="space-y-4">
            {/* System Service Health */}
            {systemStatus && (
              <div className="bg-white border border-gray-100 rounded-sm p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-full ${systemStatus.email.configured ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-black text-gray-400">Email Notification Service</p>
                    <p className="text-sm font-bold flex items-center gap-2">
                      {systemStatus.email.status}
                      {systemStatus.email.isSandbox && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">Sandbox Mode</span>}
                    </p>
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 max-w-md italic text-right">
                  {systemStatus.email.configured 
                    ? `Active using Resend. Emails from: ${systemStatus.email.from}`
                    : `RESEND_API_KEY is missing. Emails are currently being simulated only.`}
                </div>
              </div>
            )}
            {/* Password Reset Requests — prominently shown at top */}
            {resetRequests.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-amber-200 bg-amber-100/50">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-amber-700" />
                    <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wide">
                      Password Reset Requests ({resetRequests.length})
                    </h3>
                  </div>
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-sm">
                    <p className="text-[10px] text-amber-800 font-bold uppercase mb-1">Administrator Instruction:</p>
                    <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                      1. Review the reset request and the 6-digit code below.<br/>
                      2. Locate the user in the "Users" tab and click the <span className="font-bold underline">Key icon</span>.<br/>
                      3. Confirm the automated reset. This updates the account password to the code.<br/>
                      4. The user can then use that code to log in and set a permanent password.
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-amber-100">
                  {resetRequests.map((log) => (
                    <div key={log.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-sm text-amber-900">@{log.username}</p>
                        <p className="text-xs text-amber-700 font-mono">
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-amber-800 font-bold">Reset Code:</span>
                        <span className="px-4 py-2 bg-white border-2 border-amber-300 rounded font-mono text-lg font-black text-black tracking-[0.25em] select-all shadow-sm">
                          {log.details?.split('Code: ')[1] ?? '------'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full Audit Log */}
            <div className="bg-white border border-gray-100 rounded-sm overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Timestamp', 'User', 'Action', 'Module', 'Details'].map((h) => (
                      <th key={h} className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.map((log) => (
                    <tr
                      key={log.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        log.action === 'Password Reset Request' ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      <td className="px-6 py-4 text-[10px] text-gray-500 font-mono whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-sm">{log.user}</p>
                        <p className="text-[10px] text-gray-400 font-mono">@{log.username}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            log.action === 'Password Reset Request'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {log.module}
                      </td>
                      <td className="px-6 py-4 text-xs max-w-xs">
                        {log.action === 'Password Reset Request' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-amber-800 font-bold">Code:</span>
                            <code className="px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-sm font-bold select-all">
                              {log.details?.split('Code: ')[1] ?? '---'}
                            </code>
                          </div>
                        ) : (
                          <p className="text-gray-600 line-clamp-2">{log.details}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
