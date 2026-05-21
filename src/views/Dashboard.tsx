import React, { useState, useEffect } from 'react';
import { requisitionService, auditService } from '../services/api';
import { UserProfile, Requisition, UserRole, REQUISITION_WORKFLOWS, RequisitionType, Currency, Department } from '../types';
import RequisitionForm from '../components/requisition/RequisitionForm';
import { Plus, Search, ArrowUpRight, CheckCircle2, Clock, XCircle, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import RequisitionDetails from '../components/requisition/RequisitionDetails';
import { generateSummaryPDF } from '../lib/reportGenerator';
import { checkRoleMatch } from '../lib/roleUtils';
import { useToast } from '../context/ToastContext';

interface DashboardProps {
  userProfile: UserProfile;
}

export default function Dashboard({ userProfile }: DashboardProps) {
  const { showToast } = useToast();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedType, setSelectedType] = useState<RequisitionType | null>(null);
  const [editingReq, setEditingReq] = useState<Requisition | null>(null);
  const [selectedReq, setSelectedReq] = useState<Requisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [reportType, setReportType] = useState<RequisitionType | 'ALL'>('ALL');
  const [tab, setTab] = useState<'ALL' | 'ACTION' | 'MY' | 'RETURNS'>('ALL');
  const [isExporting, setIsExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

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
            const isApprover = r.status === 'pending' && currentApproval && checkRoleMatch(userProfile, currentApproval.role, r.department) && userProfile.isVerified;
            const isProcessor = r.status === 'approved' && (userProfile.role === UserRole.TREASURER || userProfile.role === UserRole.FINANCE_HOD) && userProfile.isVerified;
            const isTreasurerReturn = userProfile.role === UserRole.TREASURER && r.returnStatus === 'pending' && userProfile.isVerified;
            return isApprover || isProcessor || isTreasurerReturn;
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

  // Separate Effect for Auto-opening from URL
  useEffect(() => {
    if (!userProfile) return;

    const params = new URLSearchParams(window.location.search);
    const reqIdFromUrl = params.get('requisitionId') || params.get('reqId');
    const reqIdFromSession = sessionStorage.getItem('reqflow_deep_link');
    const targetId = reqIdFromUrl || reqIdFromSession;
    
    if (targetId && !selectedReq) {
      console.log('[Dashboard] Attempting auto-open for:', targetId);
      requisitionService.getById(targetId).then(req => {
        if (req) {
          setSelectedReq(req);
          // Cleanup
          sessionStorage.removeItem('reqflow_deep_link');
          const newUrl = window.location.pathname;
          window.history.replaceState({}, '', newUrl);
        }
      }).catch(err => {
        console.warn('Auto-open failed:', err);
        sessionStorage.removeItem('reqflow_deep_link');
        showToast('The requested requisition was not found or you do not have permission to view it.', 'error');
      });
    }
  }, [userProfile]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStartDate, filterEndDate, reportType, tab]);

  const filteredRequisitions = requisitions.filter(req => {
    // 1. Tab Filter
    if (tab === 'ACTION') {
      const currentApproval = req.approvals[req.currentStage];
      const isApprover = req.status === 'pending' && currentApproval && checkRoleMatch(userProfile, currentApproval.role, req.department) && userProfile.isVerified;
      const isProcessor = req.status === 'approved' && (userProfile.role === UserRole.TREASURER || userProfile.role === UserRole.FINANCE_HOD) && userProfile.isVerified;
      const isTreasurerReturn = userProfile.role === UserRole.TREASURER && req.returnStatus === 'pending' && userProfile.isVerified;
      
      if (!isApprover && !isProcessor && !isTreasurerReturn) {
        return false;
      }
    } else if (tab === 'RETURNS') {
      const hasChangeDue = req.status === 'processed' && ((req.changeReturned && req.changeReturned > 0) || (req.amountToReturn && req.amountToReturn > 0));
      const hasReturnStatus = req.returnStatus && req.returnStatus !== 'none';
      if (!hasChangeDue && !hasReturnStatus && !req.amountToReturn) return false;
    } else if (tab === 'MY') {
      if (req.creatorId !== userProfile.uid) return false;
    }

    // 2. Search & Report Type Filter
    const matchesSearch = 
      req.requisitionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.creatorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.items.some(item => item.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const getReqDate = (date: any) => {
      if (!date) return null;
      if (typeof date === 'string') return parseISO(date);
      if (date && typeof date === 'object' && date.seconds) return new Date(date.seconds * 1000);
      return null;
    };

    const reqDate = getReqDate(req.createdAt);
    
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

  // Handle pagination
  const totalPages = Math.ceil(filteredRequisitions.length / itemsPerPage);
  const paginatedRequisitions = filteredRequisitions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

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

  const handleSubmitRequisition = async (data: any) => {
    if (!userProfile) return;
    try {
      const isUpdate = !!editingReq;
      const now = new Date().toISOString();
      
      const requisitionData = {
        ...data,
        creatorId: userProfile.uid,
        creatorName: userProfile.name,
        involvedRoles: Array.from(new Set([
          ...data.approvals.map((a: any) => a.role),
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
        ])).filter(role => typeof role === 'string'),
        updatedAt: now,
      };

      if (!isUpdate) {
        // Create Path
        const newReq = await requisitionService.create(requisitionData as Requisition);
        setRequisitions(prev => [newReq, ...prev]);

        await auditService.log({
          user: userProfile.name,
          username: userProfile.username || userProfile.email,
          action: 'Create Requisition',
          module: 'SYSTEM',
          target: newReq.id,
          details: `Requisition of type ${requisitionData.type} created by ${userProfile.name}. REQ#: ${requisitionData.requisitionNumber}`
        });
        showToast('Requisition created successfully');
      } else {
        // Update Path (Resubmit)
        const updatedReq = await requisitionService.update(editingReq!.id, requisitionData);
        setRequisitions(prev => prev.map(r => r.id === updatedReq.id ? updatedReq : r));

        await auditService.log({
          user: userProfile.name,
          username: userProfile.username || userProfile.email,
          action: 'Resubmit Requisition',
          module: 'SYSTEM',
          target: updatedReq.id,
          details: `Requisition ${requisitionData.requisitionNumber} modified and resubmitted by creator. Resetting to Stage 1 approval.`
        });
        showToast('Requisition resubmitted successfully');
      }

      setShowForm(false);
      setEditingReq(null);
    } catch (error: any) {
      console.error('Submit req error:', error);
      
      let msg = 'Failed to submit requisition';
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
      case 'completed': return 'bg-emerald-100 text-emerald-800';
      case 'rejected': return 'bg-red-100 text-red-700';
      case 'cancelled': return 'bg-gray-200 text-gray-700';
      default: return 'bg-yellow-100 text-yellow-700';
    }
  };

  const stats = [
    { 
      label: 'Pending My Action', 
      count: requisitions.filter(r => {
        const currentApproval = r.approvals[r.currentStage];
        const isApprover = r.status === 'pending' && currentApproval && checkRoleMatch(userProfile, currentApproval.role, r.department) && userProfile.isVerified;
        const isProcessor = r.status === 'approved' && (userProfile.role === UserRole.TREASURER || userProfile.role === UserRole.FINANCE_HOD) && userProfile.isVerified;
        const isTreasurerReturn = userProfile.role === UserRole.TREASURER && r.returnStatus === 'pending' && userProfile.isVerified;
        return isApprover || isProcessor || isTreasurerReturn;
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

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tighter">Inventory & Requisitions</h2>
          <p className="text-gray-500 text-sm mt-1">Manage and track your digital requisition workflow.</p>
        </div>
        <button 
          id="new-req-btn"
          onClick={() => setShowTypeSelector(true)}
          className="w-full sm:w-auto btn-primary flex items-center gap-2 h-12 px-6 justify-center"
        >
          <Plus className="w-4 h-4" /> Write Requisition
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
              const isApprover = r.status === 'pending' && currentApproval && checkRoleMatch(userProfile, currentApproval.role, r.department) && userProfile.isVerified;
              const isProcessor = r.status === 'approved' && (userProfile.role === UserRole.TREASURER || userProfile.role === UserRole.FINANCE_HOD) && userProfile.isVerified;
              const isTreasurerReturn = userProfile.role === UserRole.TREASURER && r.returnStatus === 'pending' && userProfile.isVerified;
              return isApprover || isProcessor || isTreasurerReturn;
            }).length})
            {requisitions.some(r => {
              const currentApproval = r.approvals[r.currentStage];
              const isApprover = r.status === 'pending' && currentApproval && checkRoleMatch(userProfile, currentApproval.role, r.department) && userProfile.isVerified;
              const isProcessor = r.status === 'approved' && (userProfile.role === UserRole.TREASURER || userProfile.role === UserRole.FINANCE_HOD) && userProfile.isVerified;
              const isTreasurerReturn = userProfile.role === UserRole.TREASURER && r.returnStatus === 'pending' && userProfile.isVerified;
              return isApprover || isProcessor || isTreasurerReturn;
            }) && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
          </button>
          <button 
            onClick={() => setTab('MY')}
            className={`text-xs font-bold uppercase tracking-wider pb-4 border-b-2 transition-all ${tab === 'MY' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            My Submissions ({requisitions.filter(r => r.creatorId === userProfile.uid).length})
          </button>
          {[UserRole.TREASURER, UserRole.FINANCE_HOD, UserRole.ADMIN].includes(userProfile.role) && (
            <button 
              onClick={() => setTab('RETURNS')}
              className={`text-xs font-bold uppercase tracking-wider pb-4 border-b-2 transition-all flex items-center gap-2 ${tab === 'RETURNS' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              Funds Returns ({requisitions.filter(r => (r.status === 'processed' && ((r.changeReturned && r.changeReturned > 0) || (r.amountToReturn && r.amountToReturn > 0))) || (r.returnStatus && r.returnStatus !== 'none')).length})
              {requisitions.some(r => r.returnStatus === 'pending') && <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
            </button>
          )}
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
            {[UserRole.FINANCE_HOD, UserRole.DIRECTOR, UserRole.ADMIN, UserRole.TREASURER].includes(userProfile.role) && (
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
                {(reportType === RequisitionType.SHOP_QR || reportType === RequisitionType.WAREHOUSE_QR) ? (
                  <>
                    <th className="text-left px-6 py-4">Code</th>
                    <th className="text-left px-6 py-4">Description</th>
                    <th className="text-left px-6 py-4">Quantity</th>
                  </>
                ) : (
                  <>
                    <th className="text-left px-6 py-4">Type</th>
                    <th className="text-left px-6 py-4">Creator / Dept</th>
                    <th className="text-right px-6 py-4">Amount</th>
                  </>
                )}
                <th className="text-left px-6 py-4">Date</th>
                <th className="text-left px-6 py-4">Status</th>
                <th className="text-left px-6 py-4">Stage</th>
                <th className="text-right px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRequisitions.map((req) => {
                const currentApproval = req.approvals[req.currentStage];
                const isApprover = req.status === 'pending' && currentApproval && checkRoleMatch(userProfile, currentApproval.role, req.department) && userProfile.isVerified;
                const isProcessor = req.status === 'approved' && (userProfile.role === UserRole.TREASURER || userProfile.role === UserRole.FINANCE_HOD) && userProfile.isVerified;
                const isTreasurerReturn = userProfile.role === UserRole.TREASURER && req.returnStatus === 'pending' && userProfile.isVerified;
                const needsMyAction = isApprover || isProcessor || isTreasurerReturn;
                
                // For QR types, we show the first item's details in the table if filtered
                const firstItem = req.items[0] || { code: '-', description: '-', qty: 0 };

                // Extra check for Treasurer to see only Approved items in the list unless they are the creator or it has pending return or they are an approver
                if (userProfile.role === UserRole.TREASURER && !isApprover && req.creatorId !== userProfile.uid && req.status !== 'approved' && req.status !== 'processed' && req.returnStatus !== 'pending') {
                  return null;
                }

                const hasPendingChange = req.returnStatus === 'pending';
                const hasChangeToSubmit = req.status === 'processed' && req.changeReturned && req.changeReturned > 0 && req.returnStatus === 'none' && req.creatorId === userProfile.uid;

                return (
                  <tr 
                    key={req.id} 
                    className={`data-row ${needsMyAction ? 'bg-amber-50/50 hover:bg-amber-100/50' : hasPendingChange ? 'bg-blue-50/50 hover:bg-blue-100/50' : hasChangeToSubmit ? 'bg-indigo-50/50 hover:bg-indigo-100/50' : ''}`}
                    onClick={() => setSelectedReq(req)}
                  >
                    <td className="px-6 py-4 font-mono text-xs font-bold">
                      <div className="flex items-center gap-2">
                        {needsMyAction && <Clock className="w-3 h-3 text-amber-500" />}
                        {hasPendingChange && <ArrowUpRight className="w-3 h-3 text-blue-500" />}
                        {hasChangeToSubmit && <Clock className="w-3 h-3 text-indigo-500" />}
                        <div className="flex flex-col">
                          <span>{req.requisitionNumber}</span>
                          <span className="text-[10px] text-gray-400">#{req.sequenceNumber || '---'}</span>
                        </div>
                      </div>
                    </td>
                    
                    {(reportType === RequisitionType.SHOP_QR || reportType === RequisitionType.WAREHOUSE_QR) ? (
                      <>
                        <td className="px-6 py-4 font-mono text-xs text-blue-600 font-bold">{firstItem.code || 'N/A'}</td>
                        <td className="px-6 py-4 text-xs font-medium max-w-[200px] truncate">{firstItem.description}</td>
                        <td className="px-6 py-4 font-mono text-xs font-bold">{firstItem.qty}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-1 py-1"><span className="text-xs px-2 py-1 bg-gray-200 text-gray-700">{req.type}</span></td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold uppercase">{req.creatorName}</span>
                            <span className="text-[10px] text-gray-400 font-mono italic">{req.department}</span>
                          </div>
                        </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-gray-900">
                            {req.currency === Currency.USD || !req.currency ? '$' : ''}
                            {req.totalAmount.toFixed(2)}
                            {req.currency && req.currency !== Currency.USD ? ` ${req.currency}` : ''}
                          </span>
                          {req.status === 'processed' && req.amountIssued !== undefined && (
                            <span className="text-[10px] text-green-600 mt-1">
                              Issued: {req.currency === Currency.USD || !req.currency ? '$' : ''}{req.amountIssued.toFixed(2)}{req.currency && req.currency !== Currency.USD ? ` ${req.currency}` : ''}
                            </span>
                          )}
                          {(req.amountToReturn && req.amountToReturn > 0) || (req.changeReturned && req.changeReturned > 0) ? (
                            <span className={`text-[10px] mt-0.5 px-1 rounded-sm ${req.returnStatus === 'confirmed' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                              {req.returnStatus === 'confirmed' ? 'Returned' : 'Owing'}: {req.currency === Currency.USD || !req.currency ? '$' : ''}{(req.amountToReturn || req.changeReturned || 0).toFixed(2)}{req.currency && req.currency !== Currency.USD ? ` ${req.currency}` : ''}
                            </span>
                          ) : null}
                        </div>
                    </td>
                      </>
                    )}

                    <td className="px-6 py-4 text-xs text-gray-500">
                      {req.createdAt ? (
                        (() => {
                           try {
                             return format(typeof req.createdAt === 'string' ? parseISO(req.createdAt) : new Date(req.createdAt as any), 'MMM dd, HH:mm');
                           } catch (e) {
                             return 'Invalid Date';
                           }
                        })()
                      ) : '...'}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-sm ${getStatusColor(req.status)}`}>
                          {req.status === 'approved' ? 'Completed' : 
                           req.status === 'processed' ? 'Issued' : 
                           req.status === 'cancelled' ? 'Cancelled' : 
                           req.status}
                        </span>
                        {req.returnStatus === 'pending' && (
                          <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1 border border-blue-100 rounded-sm">
                            Return Pending
                          </span>
                        )}
                        {req.returnStatus === 'confirmed' && (
                          <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1 border border-indigo-100 rounded-sm">
                            Funds Returned
                          </span>
                        )}
                        {req.processedNumber && (
                          <span className="text-[9px] font-mono font-bold text-green-700 bg-green-50 px-1 border border-green-100 rounded-sm">
                            {req.processedNumber}
                          </span>
                        )}
                        {(req.changeReturned && req.changeReturned > 0) && (
                          <span className={`text-[9px] font-bold px-1 border rounded-sm ${req.returnStatus === 'confirmed' ? 'text-green-700 bg-green-50 border-green-100' : 'text-amber-700 bg-amber-50 border-amber-100'}`}>
                            Balance: {req.currency === Currency.USD || !req.currency ? '$' : ''}{req.changeReturned.toFixed(2)}
                          </span>
                        )}
                      </div>
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
                            needsMyAction 
                              ? 'bg-amber-500 border-amber-600 text-white hover:bg-amber-600' 
                              : 'text-gray-400 border-transparent hover:text-black hover:border-gray-200'
                          }`}
                        >
                          {req.status === 'approved' ? 'Approved' : 
                           req.status === 'processed' ? 'Issued' : 
                           needsMyAction ? 'Review' : 'View'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginatedRequisitions.length === 0 && !loading && (
                <tr>
                  <td colSpan={(reportType === RequisitionType.SHOP_QR || reportType === RequisitionType.WAREHOUSE_QR) ? 8 : 8} className="px-6 py-20 text-center text-gray-400 text-sm">
                    {tab === 'ACTION' ? 'No requisitions awaiting your approval.' : 'No requisitions found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/30">
            <p className="text-[10px] uppercase font-bold text-gray-400">
              Page {currentPage} of {totalPages} ({filteredRequisitions.length} items)
            </p>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-[10px] font-bold uppercase border border-gray-200 rounded-sm disabled:opacity-30 bg-white"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded-sm border transition-all ${
                    currentPage === page ? 'bg-black text-white border-black' : 'bg-white text-gray-400 border-gray-200 hover:border-black'
                  }`}
                >
                  {page}
                </button>
              )).slice(Math.max(0, currentPage - 3), Math.min(totalPages, currentPage + 2))}
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-[10px] font-bold uppercase border border-gray-200 rounded-sm disabled:opacity-30 bg-white"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showTypeSelector && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-sm shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold uppercase tracking-tight">Select Requisition Type</h3>
                <button onClick={() => setShowTypeSelector(false)} className="text-gray-400 hover:text-black transition-colors">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                {Object.values(RequisitionType).map((t) => {
                  let isAllowed = true;
                  let restrictionMsg = '';

                  if (t === RequisitionType.PURCHASING || t === RequisitionType.PROJECTS || t === RequisitionType.CASH) {
                    isAllowed = userProfile.department === Department.PURCHASING;
                    restrictionMsg = 'Purchasing Dept Only';
                  } else if (t === RequisitionType.IT) {
                    isAllowed = userProfile.department === Department.IT;
                    restrictionMsg = 'IT Dept Only';
                  } else if (t === RequisitionType.FINANCE) {
                    isAllowed = userProfile.department === Department.FINANCE || userProfile.department === Department.ADMINISTRATION;
                    restrictionMsg = 'Finance/Admin Only';
                  }

                  return (
                    <button
                      key={t}
                      disabled={!isAllowed}
                      onClick={() => {
                        setSelectedType(t);
                        setShowTypeSelector(false);
                        setShowForm(true);
                      }}
                      className={`text-left p-4 rounded-sm border transition-all flex flex-col gap-1 ${
                        isAllowed 
                          ? 'border-gray-200 hover:border-black bg-white hover:shadow-md' 
                          : 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                      }`}
                    >
                      <span className="text-xs font-bold uppercase tracking-tight text-gray-900">{t}</span>
                      {!isAllowed && <span className="text-[9px] font-black text-red-500 uppercase">{restrictionMsg}</span>}
                      {isAllowed && <span className="text-[9px] text-gray-400">Next: Fill details & items</span>}
                    </button>
                  );
                })}
              </div>
              <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
                <button onClick={() => setShowTypeSelector(false)} className="px-6 py-2 text-xs font-bold uppercase text-gray-500 hover:text-black">Close</button>
              </div>
            </motion.div>
          </div>
        )}
        {showForm && userProfile && (
          <RequisitionForm 
            userDept={userProfile.department}
            userEmail={userProfile.username || userProfile.email}
            userProfile={userProfile}
            initialData={editingReq || undefined}
            fixedType={editingReq ? undefined : (selectedType || undefined)}
            onClose={() => {
              setShowForm(false);
              setEditingReq(null);
              setSelectedType(null);
            }}
            onSubmit={handleSubmitRequisition}
          />
        )}
        {selectedReq && userProfile && (
          <RequisitionDetails 
            requisition={selectedReq}
            userProfile={userProfile}
            onEdit={(req) => {
              setSelectedReq(null);
              setEditingReq(req);
              setShowForm(true);
            }}
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
