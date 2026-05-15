import { Settings, LogOut, FileText, User as UserIcon, History, LayoutDashboard, Users } from 'lucide-react';
import { UserProfile, UserRole } from '../../types';

interface NavbarProps {
  userProfile: UserProfile | null;
  currentView: 'dashboard' | 'audit' | 'admin';
  onViewChange: (view: 'dashboard' | 'audit' | 'admin') => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}

export default function Navbar({ userProfile, currentView, onViewChange, onLogout, onOpenSettings }: NavbarProps) {
  const isSuperAdmin = userProfile && [UserRole.ADMIN, UserRole.DIRECTOR].includes(userProfile.role);

  return (
    <nav className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 sticky top-0 z-50">
      <div className="flex items-center gap-8">
        <div 
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => onViewChange('dashboard')}
        >
          <div className="bg-black p-1.5 rounded-sm">
            <FileText className="text-white w-5 h-5" />
          </div>
          <h1 className="font-mono font-bold tracking-tighter text-xl text-black">MINEAZY REQFLOW</h1>
        </div>

        {userProfile && (
          <div className="flex items-center gap-1">
            <button 
              onClick={() => onViewChange('dashboard')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-bold transition-colors ${
                currentView === 'dashboard' ? 'bg-gray-100 text-black' : 'text-gray-400 hover:text-black'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Dashboard
            </button>
            {isSuperAdmin && (
              <>
                <button 
                  onClick={() => onViewChange('audit')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-bold transition-colors ${
                    currentView === 'audit' ? 'bg-gray-100 text-black' : 'text-gray-400 hover:text-black'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  Audit Logs
                </button>
                <button 
                  onClick={() => onViewChange('admin')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-bold transition-colors ${
                    currentView === 'admin' ? 'bg-gray-100 text-black' : 'text-gray-400 hover:text-black'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Admin Panel
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        {userProfile && (
          <div className="flex items-center gap-4 border-r border-gray-200 pr-6 mr-2">
            <div className="text-right flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-black uppercase px-1 rounded-[2px] ${
                  userProfile.isVerified ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
                }`}>
                  {userProfile.isVerified ? 'Verified' : 'Not Verified'}
                </span>
                <p className="text-xs font-bold leading-tight uppercase">{userProfile.name}</p>
              </div>
              <p className="text-[10px] text-gray-500 font-mono leading-tight">{userProfile.department} / {userProfile.role}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
              <UserIcon className="w-4 h-4 text-gray-600" />
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-4">
          <button 
            onClick={onOpenSettings}
            className="text-gray-400 hover:text-black transition-colors p-1 rounded-sm hover:bg-gray-50"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button 
            onClick={onLogout}
            className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-sm hover:bg-red-50"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
