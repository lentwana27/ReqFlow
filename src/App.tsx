import React, { useState, useEffect, useRef } from 'react';
import { authService } from './services/api';
import { UserProfile } from './types';
import Navbar from './components/layout/Navbar';
import Dashboard from './views/Dashboard';
import AuditLogView from './views/AuditLog';
import AdminPanel from './views/AdminPanel';
import VerificationView from './components/requisition/VerificationView';
import ProfileSettingsModal from './components/modals/ProfileSettingsModal';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AuthView from './views/AuthView';
import { ToastProvider } from './context/ToastContext';

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

// ─── Fast session cache key ────────────────────────────────────────────────────
const SESSION_CACHE_KEY = 'reqflow_has_session';

function AppContent() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'audit' | 'admin'>('dashboard');
  const [verifyParams, setVerifyParams] = useState<{ id: string; signatureId: string } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ─── Loading state ─────────────────────────────────────────────────────────
  const hasCachedSession = localStorage.getItem(SESSION_CACHE_KEY) === '1';
  const [loading, setLoading] = useState(!hasCachedSession);
  const authResolved = useRef(false);

  // ─── Deep link capturing ───────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requisitionId = params.get('requisitionId') || params.get('reqId');
    if (requisitionId && !params.get('verify')) {
      console.log('[App] Deep link detected:', requisitionId);
      sessionStorage.setItem('reqflow_deep_link', requisitionId);
    }
  }, []);

  // ─── Verification URL params ───────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verify = params.get('verify');
    const reqId = params.get('reqId');
    if (verify && reqId) {
      setVerifyParams({ id: reqId, signatureId: verify });
    }
  }, []);

  // ─── Local Auth Refresh ───────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      try {
        const profile = await authService.getCurrentUser();
        if (isMounted) {
          setUserProfile(profile);
          if (profile) localStorage.setItem(SESSION_CACHE_KEY, '1');
          else localStorage.removeItem(SESSION_CACHE_KEY);
        }
      } catch (err) {
        console.error('Initial auth check failed:', err);
      } finally {
        if (isMounted) {
          authResolved.current = true;
          setLoading(false);
        }
      }
    };

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleLoginSuccess = (user: UserProfile) => {
    localStorage.setItem(SESSION_CACHE_KEY, '1');
    setUserProfile(user);
    // If logging in as admin, default to admin panel
    if (user.username === 'admin' || user.username === 'admin1') {
      setCurrentView('admin');
    } else {
      setCurrentView('dashboard');
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem(SESSION_CACHE_KEY);
    await authService.logout();
    setUserProfile(null);
    setCurrentView('dashboard');
  };

  // ─── Public verification page (no login required) ──────────────────────────
  if (verifyParams) {
    return (
      <div className="min-h-screen bg-[#F4F4F2]">
        <VerificationView
          id={verifyParams.id}
          signatureId={verifyParams.signatureId}
          onClose={() => {
            setVerifyParams(null);
            window.history.replaceState({}, document.title, window.location.pathname);
          }}
          onPublic={true}
        />
      </div>
    );
  }

  // ─── Loading spinner ───────────────────────────────────────────────────────
  // Only shown when there is no cached session hint (i.e. first-ever load or
  // after an explicit logout). Otherwise the app renders immediately.
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F4F4F2]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // ─── Auth wall ─────────────────────────────────────────────────────────────
  if (!userProfile) {
    return (
      <AuthView
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  // ─── Main app ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F4F4F2]">
      <Navbar
        userProfile={userProfile}
        currentView={currentView}
        onViewChange={setCurrentView}
        onLogout={handleLogout}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <ProfileSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userName={userProfile.username}
      />
      <main className="p-4 sm:p-8 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {currentView === 'dashboard' ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Dashboard userProfile={userProfile} />
            </motion.div>
          ) : currentView === 'audit' ? (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AuditLogView
                userProfile={userProfile}
                onBack={() => setCurrentView('dashboard')}
              />
            </motion.div>
          ) : (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AdminPanel userProfile={userProfile} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
