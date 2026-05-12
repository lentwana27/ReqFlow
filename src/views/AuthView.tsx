import React, { useState, useRef } from 'react';
import { authService, auditService } from '../services/api';
import { UserRole, Department, ROLES, DEPARTMENTS, UserProfile } from '../types';
import {
  LogIn, UserPlus, Shield, Loader2, ArrowRight,
  User as UserIcon, Lock, Building2, KeyRound
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AuthViewProps {
  onAdminEntrance: () => void;
  onLoginSuccess: (user: UserProfile) => void;
}

// ─── Utility: generate a random 6-digit numeric code ─────────────────────────
function generateResetCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function AuthView({ onAdminEntrance, onLoginSuccess }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Prevents double-submit while request is in-flight
  const submitting = useRef(false);

  // ─── Form fields ────────────────────────────────────────────────────────────
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [department, setDepartment] = useState<Department>(Department.GENERAL);
  const [role, setRole] = useState<UserRole>(UserRole.REQUESTER);

  const resetForm = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setResetCode('');
    setFirstName('');
    setLastName('');
    setError('');
    setSuccess('');
  };

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard against double-submit
    if (submitting.current) return;
    submitting.current = true;
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      // ── LOGIN ──────────────────────────────────────────────────────────────
      if (mode === 'login') {
        const { user } = await authService.login(username.trim().toLowerCase(), password);
        onLoginSuccess(user);

      // ── SIGN UP ────────────────────────────────────────────────────────────
      } else if (mode === 'signup') {
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');

        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const { user } = await authService.register({
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          password,
          name: fullName,
          role,
          department,
        });

        // Fire-and-forget audit — don't block login
        auditService.log({
          user: user.name,
          username: user.username,
          action: 'Account Registration',
          module: 'SYSTEM',
          target: 'N/A',
          details: `New user registered: ${user.name} as ${user.role} in ${user.department}. Status: ${user.status}`,
        }).catch(console.warn);

        onLoginSuccess(user);

      // ── FORGOT PASSWORD ────────────────────────────────────────────────────
      } else if (mode === 'forgot') {
        if (!username.trim()) throw new Error('Please enter your username.');

        // 1. Generate a secure 6-digit code
        const code = generateResetCode();

        // 2. Write it to the audit log so the admin can see it instantly
        await auditService.log({
          user: 'Anonymous',
          username: username.trim().toLowerCase(),
          action: 'Password Reset Request',
          module: 'AUTH',
          target: 'USER',
          details: `User requested password reset. Code: ${code}`,
        });

        // 3. Optional: call Supabase reset method (standard flow)
        try {
          await authService.requestPasswordReset(username.trim().toLowerCase());
        } catch (_) { /* ignore if not configured */ }

        setSuccess(`Reset request logged. YOUR CODE: ${code}. Please provide this code to your Admin to authorize your access.`);

      // ── RESET PASSWORD (LOGIN WITH CODE) ───────────────────────────────────
      } else if (mode === 'reset') {
        if (!username.trim() || !resetCode.trim()) {
          throw new Error('Username and Code are required.');
        }
        if (password.length < 6) {
          throw new Error('New password must be at least 6 characters.');
        }

        // 1. Try to login with the code assuming the admin set it as the password
        const { user } = await authService.login(username.trim().toLowerCase(), resetCode.trim());

        // 2. Immediately update to the new permanent password
        try {
          await authService.changePassword(password);
        } catch (updateErr) {
          console.warn('Password update after code login failed:', updateErr);
          // We still let them in, but warn them
          setSuccess('Logged in with code, but permanent password update failed. Please update it manually in Profile.');
        }

        // Fire-and-forget audit
        auditService.log({
          user: user.name,
          username: user.username,
          action: 'Password reset completed',
          module: 'AUTH',
          target: 'USER',
          details: `User @${user.username} logged in with code and set a new password.`,
        }).catch(console.warn);

        if (!success) setSuccess('Password updated successfully. Logging you in...');
        onLoginSuccess(user);
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      let msg = 'Authentication failed.';
      
      // Try to parse structured error
      try {
        if (err.message?.startsWith('{')) {
          const parsed = JSON.parse(err.message);
          msg = parsed.error || msg;
        } else {
          msg = err.message || msg;
        }
      } catch {
        msg = err.message || msg;
      }

      const lowerMsg = msg.toLowerCase();
      
      // Avoid overriding specific helpful messages from api.ts
      const isGeneric = lowerMsg === 'invalid login credentials' || lowerMsg === 'invalid credentials';
      
      if (isGeneric) {
        msg = mode === 'reset' 
          ? 'Invalid code or username. If you just requested a reset, please wait for an administrator to approve it.'
          : 'Invalid username or password. Check your credentials or contact an admin.';
      } else if (lowerMsg.includes('already registered') || lowerMsg.includes('already exists')) {
        // If the service provided a very specific message, use it, otherwise use our generic one
        if (msg.length < 50) {
          msg = 'That username or email is already taken. Please choose another or try signing in.';
        }
      } else if (lowerMsg.includes('rate limit')) {
        msg = 'Too many attempts. Please wait a moment and try again.';
      }

      setError(msg);
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  const titles: Record<typeof mode, string> = {
    login: 'Welcome Back',
    signup: 'Create Account',
    forgot: 'Forgot Password',
    reset: 'Login with Code',
  };
  const subtitles: Record<typeof mode, string> = {
    login: 'Sign in to manage your department requisitions.',
    signup: 'Join the system to start processing requisitions.',
    forgot: 'Enter your username to request a reset code from your admin.',
    reset: 'Enter the 6-digit code from your admin to access your account.',
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#F4F4F2] p-4 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden border border-gray-100"
      >
        <div className="p-8 md:p-12">
          {/* ── Brand ── */}
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-black p-2.5 rounded-lg">
              <Shield className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tighter">REQFLOW PRO</h1>
          </div>

          {/* ── Heading ── */}
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-1">{titles[mode]}</h2>
            <p className="text-gray-500 text-sm">{subtitles[mode]}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {mode === 'signup' && (
                  <motion.div
                    key="signup-fields"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="text"
                        placeholder="First Name"
                        required
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        className="w-full border border-gray-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Surname"
                        required
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        className="w-full border border-gray-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <select
                        value={department}
                        onChange={e => setDepartment(e.target.value as Department)}
                        className="w-full border border-gray-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm bg-white"
                      >
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <select
                        value={role}
                        onChange={e => setRole(e.target.value as UserRole)}
                        className="w-full border border-gray-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm bg-white"
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative">
                <UserIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Username"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full border border-gray-200 pl-10 pr-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm"
                />
              </div>

              {mode === 'signup' && (
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    placeholder="Personal Email Address"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full border border-gray-200 pl-10 pr-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm"
                  />
                </div>
              )}

              {mode === 'reset' && (
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="6-Digit Code"
                    required
                    value={resetCode}
                    onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-gray-200 pl-10 pr-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm tracking-widest font-mono"
                  />
                </div>
              )}

              {mode !== 'forgot' && (
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    placeholder={mode === 'reset' ? 'New Password' : 'Password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full border border-gray-200 pl-10 pr-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm"
                  />
                </div>
              )}

              {(mode === 'signup' || mode === 'reset') && (
                <input
                  type="password"
                  placeholder="Confirm Password"
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full border border-gray-200 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-black text-sm"
                />
              )}
            </div>

            {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
            {success && <div className="p-4 bg-green-50 border border-green-100 rounded-lg text-green-700 text-xs font-medium">{success}</div>}

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={isLoading}
              className="w-full bg-black text-white py-3 rounded-lg flex items-center justify-center gap-2 group font-bold text-sm hover:bg-gray-900 transition-colors disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Submit'}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-gray-100 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <button
                id="toggle-auth-mode-btn"
                onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); resetForm(); }}
                className="text-sm font-bold text-gray-400 hover:text-black transition-colors"
              >
                {mode === 'login' ? 'Create Account' : 'Back to Login'}
              </button>

              {mode === 'login' && (
                <div className="flex flex-col items-end gap-2">
                  <button
                    onClick={() => switchMode('forgot')}
                    className="text-xs font-bold text-black border-b border-black pb-0.5"
                  >
                    Forgot Password?
                  </button>
                  <button
                    onClick={() => switchMode('reset')}
                    className="text-[10px] font-bold text-gray-400 hover:text-black uppercase tracking-wider"
                  >
                    I have a code
                  </button>
                </div>
              )}
              {mode === 'forgot' && (
                <button
                  onClick={() => switchMode('reset')}
                  className="text-xs font-bold text-black border-b border-black pb-0.5"
                >
                  I have a code
                </button>
              )}
            </div>

            <button
              id="admin-entrance-btn"
              onClick={onAdminEntrance}
              className="text-[10px] font-bold uppercase tracking-wider text-gray-300 hover:text-black transition-colors text-left"
            >
              Administrator Entrance
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
