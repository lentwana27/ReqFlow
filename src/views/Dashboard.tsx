import React, { useState, useEffect } from 'react';
import { requisitionService, auditService } from '../services/api';
import { UserProfile, Requisition, UserRole, REQUISITION_WORKFLOWS, RequisitionType } from '../types';
import RequisitionForm from '../components/requisition/RequisitionForm';
import { Plus, Search, ArrowUpRight, CheckCircle2, Clock, XCircle, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import RequisitionDetails from '../components/requisition/RequisitionDetails';
import { generateSummaryPDF } from '../lib/reportGenerator';
import { useToast } from '../context/ToastContext';

interface DashboardProps {
  userProfile: UserProfile;
}

export default function Dashboard({ userProfile }: DashboardProps) {
  const { showToast } = useToast();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedReq, setSelectedReq] = useState<Requisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [reportType, setReportType] = useState<RequisitionType | 'ALL'>('ALL');
  const [tab, setTab] = useState<'ALL' | 'ACTION' | 'MY'>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!userProfile) return;

    let isMounted = true;

    const fetchRequisitions = async () => {
      try {
        const localData = await requisitionService.list(userProfile);

        if (isMounted) {
          setRequisitions(localData);
          setLoading(false);
          
          // Auto-switch to Action tab if there are items needing approval
          const needsApproval = localData.filter(r => {
            const currentApproval = r.approvals[r.currentStage];
            return r.status === 'pending' && currentApproval && currentApproval.role === userProfile.role && userProfile.isVerified;
          });
          if (needsApproval.length > 0 && tab === 'ALL') {
            // Only auto-switch once? Or just leave it for now.
          }
        }
      } catch (err) {
        console.error('Fetch reqs error:', err);
        if (isMounted) setLoading(false);
      }
    };

    fetchRequisitions();
    
    const interval = setInterval(fetchRequisitions, 20000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [userProfile]);

  const filteredRequisitions = requisitions.filter(req => {
    // 1. Tab Filter
    if (tab === 'ACTION') {
      const currentApproval = req.approvals[req.currentStage];
      if (!(req.status === 'pending' && currentApproval && currentApproval.role === userProfile.role && userProfile.isVerified)) {
        return false;
      }
    } else if (tab === 'MY') {
      if (req.creatorId !== userProfile.uid) return false;
    }

    // 2. Search & Report Type Filter
    const matchesSearch = 
      req.requisitionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.creatorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.items.some(item => item.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const reqDate = req.createdAt ? parseISO(req.createdAt as unknown as string) : null;
    
    let matchesStartDate = true;
    if (filterStartDate && reqDate) {
      const start = new Date(filterStartDate);
      start.setHours(0, 0, 0, 0);
      matchesStartDate = reqDate >= start;
    }

    let matchesEndDate = true;
    if (filterEndDate && reqDate) {
      const end = new Date(filterEndDate);
      end.setHours(23, 59, 59, 999);
      matchesEndDate = reqDate <= end;
    }

    return matchesSearch && matchesStartDate && matchesEndDate && (reportType === 'ALL' || req.type === reportType);
  });

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const processedRequisitions = filteredRequisitions.filter(req => req.status === 'processed' || req.status === 'approved');
      
      if (processedRequisitions.length === 0) {
        alert('No processed or approved requisitions found for this criteria.');
        return;
      }

      await generateSummaryPDF(processedRequisitions, reportType);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = () => {
    const headers = ['REQ#', 'Date', 'Type', 'Creator', 'Dept', 'Items', 'Amount', 'Status'];
    const processedRequisitions = filteredRequisitions.filter(req => req.status === 'processed');
    
    if (processedRequisitions.length === 0) {
      alert('No processed requisitions found in the current filtered view to export.');
      return;
    }

    const rows = processedRequisitions.map(req => [
      req.requisitionNumber,
      req.createdAt ? format(parseISO(req.createdAt as unknown as string), 'yyyy-MM-dd HH:mm') : 'N/A',
      req.type,
      req.creatorName,
      req.department,
      `"${req.items.map(i => `${i.qty}x ${i.description}`).join('; ')}"`,
      req.totalAmount.toFixed(2),
      req.status
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + rows.map(e => e.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `requisitions_report_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCreateRequisition = async (data: any) => {
    if (!userProfile) return;
    try {
      // Role resolving and de-duplication
      const rawStages = data.approvals ? data.approvals.map((a: any) => a.role) : REQUISITION_WORKFLOWS[data.type as keyof typeof REQUISITION_WORKFLOWS];
      
      const resolvedStages = rawStages.map((role: string) => 
        role === 'Dept HOD' ? `${userProfile.department} HOD` : role
      );

      const uniqueStages: string[] = [];
      resolvedStages.forEach((role: string) => {
        if (!uniqueStages.includes(role)) uniqueStages.push(role);
      });

      const finalApprovals = uniqueStages.map(role => ({
        role,
        status: 'pending' as const,
        approverId: null,
        approverName: null,
        timestamp: null,
        comment: ''
      }));

      const requisitionData = {
        ...data,
        creatorId: userProfile.uid,
        creatorName: userProfile.name,
        department: userProfile.department,
        status: 'pending',
        currentStage: 0,
        involvedRoles: Array.from(new Set(uniqueStages)),
        approvals: finalApprovals,
      };

      const newReq = await requisitionService.create(requisitionData);
      setRequisitions(prev => [newReq, ...prev]);

      await auditService.log({
        user: userProfile.name,
        username: userProfile.username || userProfile.email,
        action: 'Create Requisition',
        module: 'SYSTEM',
        target: newReq.id,
        details: `Requisition of type ${requisitionData.type} created by ${userProfile.name}. REQ#: ${requisitionData.requisitionNumber}`
      });

      setShowForm(false);
      showToast('Requisition created successfully');
    } catch (error: any) {
      console.error('Create req error:', error);
      
      let msg = 'Failed to create requisition';
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.error) msg = parsed.error;
      } catch (e) {
        msg = error.message || msg;
      }

      showToast(msg, 'error');
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'approved': return 'bg-blue-100 text-blue-700';
      case 'processed': return 'bg-green-100 text-green-700';
      case 'rejected': return 'bg-red-100 text-red-700';
      default: return 'bg-yellow-100 text-yellow-700';
    }
  };

  const stats = [
    { 
      label: 'Pending My Action', 
      count: requisitions.filter(r => {
        const currentApproval = r.approvals[r.currentStage];
        return r.status === 'pending' && currentApproval && currentApproval.role === userProfile.role && userProfile.isVerified;
      }).length, 
      icon: Clock, 
      color: 'text-amber-600' 
    },
    { label: 'Total Visible', count: requisitions.length, icon: Loader2, color: 'text-gray-600' },
    { label: 'My Submissions', count: requisitions.filter(r => r.creatorId === userProfile.uid).length, icon: FileText, color: 'text-blue-600' },
    { label: 'Processed', count: requisitions.filter(r => r.status === 'processed').length, icon: ArrowUpRight, color: 'text-green-600' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-8"
    >
      {!userProfile.isVerified && userProfile.username !== 'admin' && (
        <div className="bg-amber-100 border-l-4 border-amber-500 p-4 rounded-sm flex items-center gap-4">
          <Clock className="w-6 h-6 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">Account Verification Pending</p>
            <p className="text-xs text-amber-700">
              Your account is currently <span className="font-bold">Not Verified</span>. 
              You can create requisitions, but you cannot approve them until an administrator verifies your identity and allocates your permanent role.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-bold tracking-tighter">Inventory & Requisitions</h2>
          <p className="text-gray-500 text-sm mt-1">Manage and track your digital requisition workflow.</p>
        </div>
        <button 
          id="new-req-btn"
          onClick={() => setShowForm(true)}
          className="btn-primary flex items-center gap-2 h-12 px-6"
        >
          <Plus className="w-4 h-4" /> New Requisition
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className={`card flex items-center justify-between ${idx === 0 && stat.count > 0 ? 'ring-2 ring-amber-400 bg-amber-50/30' : ''}`}>
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">{stat.label}</p>
              <p className="text-3xl font-mono font-bold">{stat.count}</p>
            </div>
            <stat.icon className={`w-8 h-8 ${stat.color} opacity-20`} />
          </div>
        ))}
      </div>

      <div className="card !p-0 overflow-visible relative z-10">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-8 bg-white overflow-x-auto scroller-hide">
          <button 
            onClick={() => setTab('ALL')}
            className={`text-xs font-bold uppercase tracking-wider pb-4 border-b-2 transition-all ${tab === 'ALL' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            All Items ({requisitions.length})
          </button>
          <button 
            onClick={() => setTab('ACTION')}
            className={`text-xs font-bold uppercase tracking-wider pb-4 border-b-2 transition-all flex items-center gap-2 ${tab === 'ACTION' ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            Action Items ({requisitions.filter(r => {
              const currentApproval = r.approvals[r.currentStage];
              return r.status === 'pending' && currentApproval && currentApproval.role === userProfile.role && userProfile.isVerified;
            }).length})
            {requisitions.some(r => {
              const currentApproval = r.approvals[r.currentStage];
              return r.status === 'pending' && currentApproval && currentApproval.role === userProfile.role && userProfile.isVerified;
            }) && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
          </button>
          <button 
            onClick={() => setTab('MY')}
            className={`text-xs font-bold uppercase tracking-wider pb-4 border-b-2 transition-all ${tab === 'MY' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            My Submissions ({requisitions.filter(r => r.creatorId === userProfile.uid).length})
          </button>
        </div>

        <div className="p-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4 bg-gray-50/50">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                id="search-reqs-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search REQ#, name, product..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-sm text-xs focus:outline-none focus:ring-1 focus:ring-black bg-white"
              />
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-[10px] uppercase font-bold text-gray-400 shrink-0">From:</span>
              <input 
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="text-xs border border-gray-200 p-1.5 rounded-sm"
              />
              <span className="text-[10px] uppercase font-bold text-gray-400 shrink-0">To:</span>
              <input 
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="text-xs border border-gray-200 p-1.5 rounded-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-gray-400">Type:</span>
              <select 
                value={reportType}
                onChange={(e) => setReportType(e.target.value as any)}
                className="text-xs border border-gray-200 p-1.5 rounded-sm bg-white"
              >
                <option value="ALL">All Types</option>
                {Object.values(RequisitionType).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {[UserRole.FINANCE_HOD, UserRole.DIRECTOR, UserRole.ADMIN].includes(userProfile.role) && (
              <>
                <button 
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  className="btn-secondary flex items-center gap-2 bg-black text-white hover:bg-gray-800 h-9 px-4 text-xs disabled:opacity-50"
                >
                  <FileText className="w-4 h-4" /> 
                  {isExporting ? 'Generating...' : 'PDF Summary'}
                </button>
                <button 
                  onClick={handleExport}
                  className="btn-secondary flex items-center gap-2 bg-white h-9 px-4 text-xs"
                >
                  <FileSpreadsheet className="w-4 h-4" /> CSV Export
                </button>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="data-grid-header">
                <th className="text-left px-6 py-4">Requisition #</th>
                <th className="text-left px-6 py-4">Type</th>
                <th className="text-left px-6 py-4">Creator / Dept</th>
                <th className="text-left px-6 py-4">Amount</th>
                <th className="text-left px-6 py-4">Date</th>
                <th className="text-left px-6 py-4">Status</th>
                <th className="text-left px-6 py-4">Stage</th>
                <th className="text-right px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequisitions.map((req) => {
                const currentApproval = req.approvals[req.currentStage];
                const needsMyApproval = req.status === 'pending' && currentApproval && currentApproval.role === userProfile.role && userProfile.isVerified;
                
                return (
                  <tr 
                    key={req.id} 
                    className={`data-row ${needsMyApproval ? 'bg-amber-50/50 hover:bg-amber-100/50' : ''}`}
                    onClick={() => setSelectedReq(req)}
                  >
                    <td className="px-6 py-4 font-mono text-xs font-bold">
                      <div className="flex items-center gap-2">
                        {needsMyApproval && <Clock className="w-3 h-3 text-amber-500" />}
                        {req.requisitionNumber}
                      </div>
                    </td>
                    <td className="px-1 py-1"><span className="text-xs px-2 py-1 bg-gray-200 text-gray-700">{req.type}</span></td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold uppercase">{req.creatorName}</span>
                        <span className="text-[10px] text-gray-400 font-mono italic">{req.department}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold">${req.totalAmount.toFixed(2)}</td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {req.createdAt ? format(parseISO(req.createdAt as unknown as string), 'MMM dd, HH:mm') : '...'}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-sm ${getStatusColor(req.status)}`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        {req.approvals.map((_, i) => (
                          <div 
                            key={i} 
                            className={`w-2 h-2 rounded-full ${
                              i < req.currentStage ? 'bg-black' : 
                              i === req.currentStage && req.status === 'pending' ? 'bg-yellow-400' : 'bg-gray-200'
                            }`} 
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedReq(req);
                          }}
                          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 border transition-all ${
                            needsMyApproval 
                              ? 'bg-amber-500 border-amber-600 text-white hover:bg-amber-600' 
                              : 'text-gray-400 border-transparent hover:text-black hover:border-gray-200'
                          }`}
                        >
                          {needsMyApproval ? 'Review' : 'View'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRequisitions.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-6 py-20 text-center text-gray-400 text-sm">
                    {tab === 'ACTION' ? 'No requisitions awaiting your approval.' : 'No requisitions found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showForm && userProfile && (
          <RequisitionForm 
            userDept={userProfile.department}
            userEmail={userProfile.username || userProfile.email}
            onClose={() => setShowForm(false)}
            onSubmit={handleCreateRequisition}
          />
        )}
        {selectedReq && userProfile && (
          <RequisitionDetails 
            requisition={selectedReq}
            userProfile={userProfile}
            onClose={() => {
                setSelectedReq(null);
                // Refresh list on close in case of updates
                requisitionService.list(userProfile).then(setRequisitions);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
