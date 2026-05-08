import React, { useState, useEffect } from 'react';
import { auditService } from '../services/api';
import { UserProfile } from '../types';
import { History, Search, Filter, Calendar, User as UserIcon, ArrowLeft, Loader2, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion } from 'motion/react';

interface AuditLogViewProps {
  userProfile: UserProfile;
  onBack: () => void;
}

export default function AuditLogView({ userProfile, onBack }: AuditLogViewProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('ALL');

  useEffect(() => {
    let isMounted = true;

    const fetchLogs = async () => {
      try {
        const localLogs = await auditService.list();
        if (isMounted) {
          setLogs(localLogs);
          setLoading(false);
        }
      } catch (err) {
        console.error('Audit fetch error:', err);
        if (isMounted) setLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 30000); // Audit logs don't need frequent polling
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const filteredLogs = logs.filter(log => {
      const userIdent = (log.user || '').toLowerCase();
      const userIdent2 = (log.username || '').toLowerCase();
    const matchesSearch = 
      userIdent.includes(searchTerm.toLowerCase()) ||
      userIdent2.includes(searchTerm.toLowerCase()) ||
      log.target?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.details.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = filterAction === 'ALL' || log.action === filterAction;

    return matchesSearch && matchesAction;
  });

  const uniqueActions = Array.from(new Set(logs.map(l => l.action)));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <h2 className="text-4xl font-bold tracking-tighter">System Audit Log</h2>
            <p className="text-gray-500 text-sm mt-1">Real-time trail of all requisition activities and events.</p>
          </div>
        </div>
      </div>

      <div className="card !p-0">
        <div className="p-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4 bg-gray-50/50">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search user, action, req#..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-sm text-xs focus:outline-none focus:ring-1 focus:ring-black bg-white font-medium"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="w-3 h-3 text-gray-400" />
              <select 
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                className="text-xs border border-gray-200 p-1.5 rounded-sm bg-white font-bold"
              >
                <option value="ALL">All Actions</option>
                {uniqueActions.map(action => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="text-[10px] font-mono text-gray-400 bg-white px-3 py-1 border border-gray-200 rounded-full uppercase tracking-widest font-black">
            Showing latest {filteredLogs.length} events
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="data-grid-header">
                <th className="text-left px-6 py-4">Timestamp</th>
                <th className="text-left px-6 py-4">Action</th>
                <th className="text-left px-6 py-4">User</th>
                <th className="text-left px-6 py-4">Target</th>
                <th className="text-left px-6 py-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-300" />
                  </td>
                </tr>
              ) : filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-[11px] font-mono whitespace-nowrap font-bold">
                      <Calendar className="w-3 h-3 text-gray-300" />
                      {log.timestamp ? format(parseISO(log.timestamp), 'yyyy-MM-dd HH:mm:ss') : '...'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 bg-gray-100 rounded-sm">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center">
                        <UserIcon className="w-3 h-3 text-white" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-black uppercase">{log.user}</span>
                        <span className="text-[10px] text-gray-400 font-mono italic">@{log.username || 'system'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {log.target && log.target !== 'N/A' ? (
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-gray-600">
                        <FileText className="w-3 h-3 opacity-50" />
                        {log.target}
                      </div>
                    ) : (
                      <span className="text-gray-300">N/A</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs text-gray-500 max-w-md line-clamp-1 hover:line-clamp-none transition-all cursor-help font-medium">
                      {log.details}
                    </p>
                  </td>
                </tr>
              ))}
              {!loading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-gray-400 text-sm">
                    No activity logs recorded matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
