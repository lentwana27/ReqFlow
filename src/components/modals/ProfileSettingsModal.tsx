import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Key, ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { authService } from '../../services/api';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
}

export default function ProfileSettingsModal({ isOpen, onClose, userName }: ProfileSettingsModalProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match' });
      return;
    }

    if (newPassword.length < 6) {
      setStatus({ type: 'error', message: 'Password must be at least 6 characters' });
      return;
    }

    setIsLoading(true);
    setStatus(null);

    try {
      await authService.changePassword(newPassword);
      setStatus({ type: 'success', message: 'Password updated successfully' });
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        onClose();
        setStatus(null);
      }, 2000);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to update password' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-md relative rounded-sm shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="bg-black p-2 rounded-sm">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-mono font-bold text-lg tracking-tighter">PROFILE SETTINGS</h2>
                  <p className="text-[10px] text-gray-500 font-mono uppercase">User: {userName}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold font-mono text-gray-400 uppercase tracking-widest">Change Password</h3>
                
                {status && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3 rounded-sm flex items-center gap-2 text-xs font-bold font-mono ${
                      status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {status.message}
                  </motion.div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase font-mono">New Password</label>
                    <div className="relative">
                      <Key className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full border border-gray-200 pl-10 pr-4 py-2 rounded-sm focus:outline-none focus:ring-1 focus:ring-black text-sm"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase font-mono">Confirm Password</label>
                    <div className="relative">
                      <Key className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full border border-gray-200 pl-10 pr-4 py-2 rounded-sm focus:outline-none focus:ring-1 focus:ring-black text-sm"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-black text-white py-2.5 rounded-sm text-xs font-bold tracking-widest uppercase hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Update Password'
                  )}
                </button>
              </div>
            </form>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-center">
               <p className="text-[9px] text-gray-400 font-mono text-center uppercase">
                 Security Note: Updating your password will secure your account across all active sessions.
               </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
