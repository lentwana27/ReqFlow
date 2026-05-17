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
    <nav className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-8 sticky top-0 z-50">
      <div className="flex items-center gap-4 sm:gap-8">
        <div 
          className="flex items-center gap-2 sm:gap-3 cursor-pointer"
          onClick={() => onViewChange('dashboard')}
        >
          <div className="bg-black p-1.5 rounded-sm shrink-0">
            <FileText className="text-white w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <h1 className="font-mono font-bold tracking-tighter text-base sm:text-xl text-black truncate max-w-[100px] sm:max-w-none">MINEAZY</h1>
        </div>

        {userProfile && (
          <div className="flex items-center gap-1">
            <button 
              onClick={() => onViewChange('dashboard')}
              className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-sm text-xs font-bold transition-colors ${
                currentView === 'dashboard' ? 'bg-gray-100 text-black' : 'text-gray-400 hover:text-black'
              }`}
              title="Dashboard"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Dashboard</span>
            </button>
            {isSuperAdmin && (
              <>
                <button 
                  onClick={() => onViewChange('audit')}
                  className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-sm text-xs font-bold transition-colors ${
                    currentView === 'audit' ? 'bg-gray-100 text-black' : 'text-gray-400 hover:text-black'
                  }`}
                  title="Audit Logs"
                >
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Logs</span>
                </button>
                <button 
                  onClick={() => onViewChange('admin')}
                  className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-sm text-xs font-bold transition-colors ${
                    currentView === 'admin' ? 'bg-gray-100 text-black' : 'text-gray-400 hover:text-black'
                  }`}
                  title="Admin Panel"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Admin</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-6">
        {userProfile && (
          <div className="flex items-center gap-2 sm:gap-4 border-r border-gray-200 pr-2 sm:pr-6 mr-1 sm:mr-2">
            <div className="text-right hidden sm:flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-black uppercase px-1 rounded-[2px] ${
                  userProfile.isVerified ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
                }`}>
                  {userProfile.isVerified ? 'Verified' : 'Unverified'}
                </span>
                <p className="text-xs font-bold leading-tight uppercase">{userProfile.name}</p>
              </div>
              <p className="text-[10px] text-gray-500 font-mono leading-tight">{userProfile.department}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200 shrink-0">
              <UserIcon className="w-4 h-4 text-gray-600" />
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-2 sm:gap-4">
          <button 
            onClick={onOpenSettings}
            className="text-gray-400 hover:text-black transition-colors p-1.5 rounded-sm hover:bg-gray-50"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button 
            onClick={onLogout}
            className="text-gray-400 hover:text-red-600 transition-colors p-1.5 rounded-sm hover:bg-red-50"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
