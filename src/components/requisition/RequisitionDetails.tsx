import { useState, useEffect } from 'react';
import { requisitionService, auditService } from '../../services/api';
import { Requisition, UserProfile, UserRole, Department, RequisitionType, Attachment, Currency } from '../../types';
import { X, Check, XCircle, Clock, ArrowRight, Shield, Download, Loader2, AlertCircle, Lock, Paperclip, Eye, FileText, Image as ImageIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import { generateRequisitionPDF } from '../../lib/pdfGenerator';
import { useToast } from '../../context/ToastContext';
import { getPublicOrigin } from '../../lib/urls';

interface RequisitionDetailsProps {
  requisition: Requisition;
  userProfile: UserProfile;
  onClose: () => void;
  onEdit?: (req: Requisition) => void;
}

export default function RequisitionDetails({ requisition, userProfile, onClose, onEdit }: RequisitionDetailsProps) {
  const { showToast } = useToast();
  const [comment, setComment] = useState('');
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState<'approved' | 'rejected' | 'processed' | null>(null);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [amountIssued, setAmountIssued] = useState<string>('');
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [amountToReturnRaw, setAmountToReturnRaw] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);

  // Silent repair for involvedRoles on old requisitions
  useEffect(() => {
    const repairInvolvedRoles = async () => {
      const isSystemAdmin = userProfile.username === 'admin' || userProfile.role === UserRole.ADMIN;
      const isCurrentlyInvolved = requisition.involvedRoles?.includes(userProfile.role);
      
      if (!(isSystemAdmin || isCurrentlyInvolved)) return;

      const mandatoryRoles = [
        UserRole.TREASURER, 'Treasurer', 'TREASURER',
        UserRole.FINANCE_HOD, 'Finance HOD', 'FINANCE_HOD', 'Accounting HOD', 'ACCOUNTING_HOD',
        UserRole.ADMIN, 'System Administrator', 'ADMIN',
        UserRole.DIRECTOR, UserRole.DIRECTOR_2, 'Director', 'Director 2', 'DIRECTOR'
      ];
      
      const missingRoles = mandatoryRoles.filter(r => !requisition.involvedRoles?.includes(r));
      
      if (missingRoles.length > 0) {
        console.log('[Requisition] Repairing involvedRoles (missing):', missingRoles);
        const newRoles = Array.from(new Set([
          ...(requisition.involvedRoles || []),
          ...mandatoryRoles
        ])).filter(r => typeof r === 'string');
        
        try {
          await requisitionService.update(requisition.id, { involvedRoles: newRoles });
        } catch (e) {
          console.warn('[Requisition] Silent repair failed:', e);
        }
      }
    };

    if (requisition.id && userProfile) {
      repairInvolvedRoles();
    }
  }, [requisition.id, userProfile]);

  const canDelete = () => {
    const isSystemAdmin = userProfile.username === 'admin' || userProfile.role === UserRole.ADMIN;
    if (isSystemAdmin) return true;

    const isCreator = requisition.creatorId === userProfile.uid;
    if (isCreator) {
      // Requesters can delete only if stage is 0 and status is pending (Draft/Incomplete)
      return requisition.currentStage === 0 && requisition.status === 'pending';
    }

    // Approvers can delete if it is at their stage and NOT reached Director
    const currentApproval = requisition.approvals[requisition.currentStage];
    const isAtMyStage = currentApproval && currentApproval.role === userProfile.role;
    const isNotDirectorStage = currentApproval && currentApproval.role !== UserRole.DIRECTOR;

    return isAtMyStage && isNotDirectorStage;
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this requisition permanently?')) return;

    setIsDeleting(true);
    try {
      await requisitionService.delete(requisition.id, userProfile);
      
      await auditService.log({
        user: userProfile.name,
        username: userProfile.username || userProfile.email,
        action: 'Delete Requisition',
        module: 'REQUISITION',
        target: requisition.id,
        details: `Requisition ${requisition.requisitionNumber} deleted by ${userProfile.name}`
      });

      showToast('Requisition deleted successfully');
      onClose();
    } catch (error: any) {
      showToast(error.message || 'Failed to delete requisition', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const canDownload = () => {
    // Admin, Treasurer, Director, and Finance HOD can always download
    if (
      userProfile.username === 'admin' || 
      userProfile.role === UserRole.ADMIN || 
      userProfile.role === UserRole.TREASURER ||
      userProfile.role === UserRole.DIRECTOR ||
      userProfile.role === UserRole.FINANCE_HOD
    ) return true;
    
    // Any one in the workflow can download (Approvers)
    const isApproverRole = requisition.approvals.some(a => a.role === userProfile.role);
    if (isApproverRole) return true;
    
    // Creator can also download their own req
    if (requisition.creatorId === userProfile.uid) return true;
    
    return false;
  };

  const handleDownload = async () => {
    if (!canDownload()) {
      showToast('You do not have permission to download this requisition.', 'error');
      return;
    }
    setIsDownloading(true);
    try {
      await generateRequisitionPDF(requisition);
    } catch (error) {
      console.error('PDF Generation failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const checkRoleMatch = (userProfile: UserProfile, targetRole: string, reqDept: Department) => {
    if (userProfile.username === 'admin') return true;
    
    // Explicit match
    if (userProfile.role === targetRole) return true;

    // Backward compatibility for old requisitions created before recent role changes
    if (targetRole === 'Accounting HOD' && userProfile.role === UserRole.FINANCE_HOD) return true;
    if (targetRole === 'Shop Supervisor' && userProfile.role === UserRole.SHOP_MANAGER) return true;

    // Resolve generic HOD to department-specific HOD
    if (targetRole === UserRole.HOD) {
      if (reqDept === Department.IT && userProfile.role === UserRole.IT_HOD) return true;
      if (reqDept === Department.WAREHOUSE && userProfile.role === UserRole.WAREHOUSE_HOD) return true;
      return userProfile.role === UserRole.HOD && userProfile.department === reqDept;
    }

    return false;
  };

  const canApprove = () => {
    if (requisition.status !== 'pending') return false;
    const currentApproval = requisition.approvals[requisition.currentStage];
    if (!currentApproval) return false;

    // Block unverified users from approving
    if (!userProfile.isVerified && userProfile.username !== 'admin') return false;

    if (checkRoleMatch(userProfile, currentApproval.role, requisition.department)) return true;

    // Special case: Director can override Finance Requisition at any stage
    if (userProfile.role === UserRole.DIRECTOR && requisition.type === RequisitionType.FINANCE) return true;

    return false;
  };

  const handleUpdateStatus = async (newStatus: 'approved' | 'rejected' | 'processed', isApproval = false, overrideComment?: string, customUpdates: any = {}) => {
    setIsProcessing(newStatus);
    const activeComment = overrideComment ?? comment;
    
    try {
      const updates: any = {
        updatedAt: new Date().toISOString(),
        ...customUpdates
      };

      if (newStatus === 'rejected' && isApproval) {
        if (!activeComment || activeComment.trim().length < 5) {
          showToast('Please provide a reason for rejection (at least 5 characters).', 'error');
          setIsProcessing(null);
          return;
        }
        updates.rejectionReason = activeComment;
      }

      if (isApproval) {
        let newApprovals = [...requisition.approvals];
        const sigId = `SIG-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        const timestamp = new Date().toISOString();
        
        // 1. Approve current stage
        newApprovals[requisition.currentStage] = {
          ...newApprovals[requisition.currentStage],
          status: newStatus === 'rejected' ? 'rejected' : 'approved',
          approverId: userProfile.uid,
          approverName: userProfile.name,
          timestamp,
          comment: activeComment,
          signatureId: newStatus === 'approved' ? sigId : null
        };

        // 2. If approved, check for future stages that this user ALSO fulfills
        if (newStatus === 'approved') {
          // Special case: Director approves Finance Requisition instantly completes it
          const isDirector = userProfile.role === UserRole.DIRECTOR;
          const isFinanceReq = requisition.type === RequisitionType.FINANCE;

          if (isDirector && isFinanceReq) {
            for (let i = requisition.currentStage + 1; i < newApprovals.length; i++) {
              if (newApprovals[i].status === 'pending') {
                newApprovals[i] = {
                  ...newApprovals[i],
                  status: 'approved',
                  approverId: userProfile.uid,
                  approverName: userProfile.name,
                  timestamp,
                  comment: `Bypassed: Director sign-off completed requisition instantly.`,
                  signatureId: `SIG-OVERRIDE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
                };
              }
            }
          } else {
            // Standard multi-role auto-approval
            for (let i = requisition.currentStage + 1; i < newApprovals.length; i++) {
              if (checkRoleMatch(userProfile, newApprovals[i].role, requisition.department)) {
                newApprovals[i] = {
                  ...newApprovals[i],
                  status: 'approved',
                  approverId: userProfile.uid,
                  approverName: userProfile.name,
                  timestamp,
                  comment: `Auto-approved: User holds multiple roles (${newApprovals[i].role})`,
                  signatureId: `SIG-AUTO-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
                };
              }
            }
          }
        }

        updates.approvals = newApprovals;
        
        // Always ensure mandatory roles are in involvedRoles on every approval update
        updates.involvedRoles = Array.from(new Set([
          ...(requisition.involvedRoles || []),
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
        ])).filter(role => typeof role === 'string');

        if (newStatus === 'rejected') {
          updates.status = 'rejected';
        } else {
          let nextStep = requisition.currentStage + 1;
          while (nextStep < newApprovals.length && newApprovals[nextStep].status === 'approved') {
            nextStep++;
          }

          if (nextStep >= newApprovals.length) {
            updates.status = 'approved'; // This will be displayed as "Completed"
            updates.currentStage = newApprovals.length - 1;
          } else {
            updates.currentStage = nextStep;
          }
        }
      } else if (newStatus === 'processed') {
        const sigId = `SIG-DISB-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        updates.status = 'processed';
        updates.issuedInfo = {
          userId: userProfile.uid,
          userName: userProfile.name,
          timestamp: new Date().toISOString(),
          signatureId: sigId
        };
      } else {
        updates.status = newStatus;
      }

      await requisitionService.update(requisition.id, updates);

      // Log activity
      let actionLabel = '';
      let detailsText = '';

      if (isApproval) {
        if (newStatus === 'rejected') {
          actionLabel = 'Requisition Rejected';
          detailsText = `Requisition rejected at stage ${requisition.currentStage + 1} by ${userProfile.name}${activeComment ? `: ${activeComment}` : ''}`;
        } else {
          actionLabel = 'Requisition Approved';
          detailsText = `Requisition stage ${requisition.currentStage + 1} approved by ${userProfile.name}${activeComment ? `: ${activeComment}` : ''}`;
        }
      } else {
        actionLabel = 'Requisition Processed';
        detailsText = `Requisition marked as processed (Disbursed) by ${userProfile.name}`;
      }

      await auditService.log({
        user: userProfile.name,
        username: userProfile.username || userProfile.email,
        action: actionLabel,
        module: 'REQUISITION',
        target: requisition.id,
        details: detailsText
      });

      showToast(
        newStatus === 'rejected' 
          ? `Requisition ${requisition.requisitionNumber} rejected.` 
          : newStatus === 'processed'
            ? `Requisition ${requisition.requisitionNumber} issued by Treasurer.`
            : `Stage ${requisition.currentStage + 1} approved/completed by Director.`,
        newStatus === 'rejected' ? 'error' : 'success'
      );

      setIsSuccess(true);
      setIsProcessing(null);

      setTimeout(() => {
        onClose();
        setComment('');
        setIsSuccess(false);
      }, 500);
    } catch (error: any) {
      console.error('Update status error:', error);
      setIsProcessing(null);
      
      let msg = 'Failed to update requisition';
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.error) msg = parsed.error;
      } catch (e) {
        msg = error.message || msg;
      }

      showToast(msg, 'error');
    }
  };

  const userRole = userProfile?.role as string;
  const isTreasurer = userRole === UserRole.TREASURER || userRole === 'Treasurer' || userRole === 'TREASURER';

  const typesEligibleForReturn = [
    RequisitionType.ADMIN,
    RequisitionType.FINANCE,
    RequisitionType.PURCHASING,
    RequisitionType.PROJECTS,
    RequisitionType.IT,
    RequisitionType.FUEL
  ];

  const canRequestReturn = requisition.status === 'processed' && 
                           requisition.creatorId === userProfile.uid && 
                           (requisition.returnStatus === 'none' || !requisition.returnStatus) &&
                           typesEligibleForReturn.includes(requisition.type as any);

  const canConfirmReturn = isTreasurer && 
                           requisition.status === 'processed' && 
                           requisition.returnStatus === 'pending';

  const canProcess = isTreasurer && requisition.status === 'approved';

  const currency = requisition.currency || Currency.USD;
  const symbol = currency === Currency.USD ? '$' : '';
  const suffix = currency !== Currency.USD ? ` ${currency}` : '';

  if (!userProfile) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-end">
      <motion.div 
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col border-l border-gray-200"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="bg-gray-100 p-2 rounded-sm">
              <Shield className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Requisition {requisition.requisitionNumber}</h2>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-mono text-gray-400 uppercase">
                  {requisition.type === 'Quotations' ? requisition.type : `${requisition.type} Requisition`}
                </p>
                <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded-sm font-bold text-gray-600">#{requisition.sequenceNumber || '---'}</span>
                {requisition.processedNumber && (
                  <span className="text-[10px] bg-green-100 px-1.5 py-0.5 rounded-sm font-bold text-green-700">PROC: {requisition.processedNumber}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!userProfile.isVerified && userProfile.username !== 'admin' && checkRoleMatch(userProfile, requisition.approvals[requisition.currentStage]?.role || '', requisition.department) && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 rounded-sm text-[10px] font-bold border border-amber-100 mr-4">
                <AlertCircle className="w-3 h-3" />
                VERIFICATION REQUIRED
              </div>
            )}
            {canDownload() && (
              <button 
                onClick={handleDownload}
                disabled={isDownloading}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-black disabled:opacity-50"
                title="Download PDF"
              >
                {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-12">
          {requisition.status === 'rejected' && requisition.rejectionReason && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border-l-4 border-red-500 p-6 rounded-sm space-y-2 mb-8"
            >
              <div className="flex items-center gap-2 text-red-700">
                <XCircle className="w-5 h-5" />
                <h3 className="font-bold text-sm uppercase tracking-tight">Requisition Rejected</h3>
              </div>
              <p className="text-sm text-red-600 italic">"{requisition.rejectionReason}"</p>
            </motion.div>
          )}

          {/* Header Info */}
          <div className="grid grid-cols-2 gap-8 bg-gray-50/50 p-6 rounded-sm border border-gray-100">
            <div className="space-y-4">
              <div>
                <label className="input-label">Creator</label>
                <p className="text-sm font-bold uppercase">{requisition.creatorName}</p>
                <p className="text-xs text-gray-500 font-mono italic">{requisition.department}</p>
              </div>
              {requisition.type !== RequisitionType.SHOP_USE && requisition.type !== RequisitionType.WAREHOUSE && (
                <div>
                  <label className="input-label">Written To</label>
                  <p className="text-sm font-semibold text-blue-900">{requisition.writtenTo || 'N/A'}</p>
                </div>
              )}
              {requisition.amountIssued !== undefined && requisition.amountIssued !== null && (
                <div className="bg-green-50 p-2 border border-green-100 rounded-sm">
                  <label className="text-[9px] uppercase font-bold text-green-600 block">Amount Issued</label>
                  <p className="text-sm font-bold text-green-800">{symbol}{requisition.amountIssued.toFixed(2)}{suffix}</p>
                </div>
              )}
              {requisition.changeReturned !== undefined && requisition.changeReturned > 0 && (
                <div className="bg-amber-50 p-2 border border-amber-100 rounded-sm">
                  <label className="text-[9px] uppercase font-bold text-amber-600 block">Change to be Returned</label>
                  <p className="text-sm font-bold text-amber-800">{symbol}{requisition.changeReturned.toFixed(2)}{suffix}</p>
                </div>
              )}
              {requisition.returnStatus && requisition.returnStatus !== 'none' && (
                <div className={`${requisition.returnStatus === 'confirmed' ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'} p-2 border rounded-sm`}>
                  <label className={`text-[9px] uppercase font-bold ${requisition.returnStatus === 'confirmed' ? 'text-green-600' : 'text-blue-600'} block`}>
                    Funds Return {requisition.returnStatus === 'confirmed' ? '(CONFIRMED)' : '(PENDING)'}
                  </label>
                  <p className={`text-sm font-bold ${requisition.returnStatus === 'confirmed' ? 'text-green-800' : 'text-blue-800'}`}>
                    {symbol}{requisition.amountToReturn?.toFixed(2)}{suffix}
                  </p>
                </div>
              )}
            </div>
            <div className="text-right space-y-4">
              <div>
                <label className="input-label">Date Submitted</label>
                <p className="text-sm font-mono">
                  {requisition.createdAt ? (
                    (() => {
                      try {
                        const d = typeof requisition.createdAt === 'string' ? parseISO(requisition.createdAt) : new Date(requisition.createdAt as any);
                        return format(d, 'PPP p');
                      } catch (e) {
                         return 'Invalid Date';
                      }
                    })()
                  ) : '...'}
                </p>
                <div className={`inline-block mt-2 px-3 py-1 rounded-sm text-[10px] font-bold uppercase ${
                  requisition.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                  requisition.status === 'processed' ? 'bg-green-100 text-green-700' :
                  requisition.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {requisition.status === 'approved' ? 'Completed' : 
                   requisition.status === 'processed' ? 'Issued' : 
                   requisition.status}
                </div>
              </div>
            </div>
          </div>

      <div className="space-y-4">
            <label className="input-label">Requested Items</label>
            <div className="border border-gray-100 rounded-sm overflow-hidden text-sm">
              {(() => {
                const hasCodeColumn = requisition.type === RequisitionType.WAREHOUSE || requisition.type === RequisitionType.SHOP_USE || requisition.type === RequisitionType.SHOP_QR || requisition.type === RequisitionType.WAREHOUSE_QR || requisition.type === RequisitionType.QUOTATIONS;
                const hasPricingColumns = requisition.type !== RequisitionType.SHOP_QR && requisition.type !== RequisitionType.WAREHOUSE_QR && requisition.type !== RequisitionType.FUEL;
                const isFuel = requisition.type === RequisitionType.FUEL;
                
                return (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr className="font-mono text-[10px] uppercase text-gray-500">
                        {hasCodeColumn && <th className="text-left px-4 py-3">Code</th>}
                        <th className="text-left px-4 py-3">Description</th>
                        <th className="text-center px-4 py-3">{isFuel ? 'Litres' : 'Qty'}</th>
                        {isFuel && <th className="text-right px-4 py-3">Type</th>}
                        {hasPricingColumns && (
                          <>
                            <th className="text-right px-4 py-3">Rate</th>
                            <th className="text-right px-4 py-3">Total</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium">
                      {requisition.items.map((item, idx) => (
                        <tr key={idx}>
                          {hasCodeColumn && <td className="px-4 py-3 font-mono text-blue-600 font-bold">{item.code || 'N/A'}</td>}
                          <td className="px-4 py-3">{item.description}</td>
                          <td className="px-4 py-3 text-center">{item.qty}{isFuel ? ' L' : ''}</td>
                          {isFuel && <td className="px-4 py-3 text-right font-bold">{item.fuelType || 'Diesel'}</td>}
                          {hasPricingColumns && (
                            <>
                              <td className="px-4 py-3 text-right">{symbol}{item.unitCost.toFixed(2)}{suffix}</td>
                              <td className="px-4 py-3 text-right font-bold">{symbol}{item.totalCost.toFixed(2)}{suffix}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {hasPricingColumns && (
                      <tfoot className="bg-gray-50/50">
                        <tr className="font-bold">
                          <td colSpan={hasCodeColumn ? 4 : 3} className="px-4 py-4 text-right uppercase tracking-wider text-[10px]">Total Amount ({currency})</td>
                          <td className="px-4 py-4 text-right font-mono text-base font-bold">{symbol}{requisition.totalAmount.toFixed(2)}{suffix}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                );
              })()}
            </div>
          </div>

          {requisition.attachments && requisition.attachments.length > 0 && (
            <div className="space-y-4">
              <label className="input-label flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> 
                Attachments
              </label>
              <div className="grid grid-cols-2 gap-3">
                {requisition.attachments.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-sm">
                    <div className="w-8 h-8 rounded-sm bg-white border border-gray-200 flex items-center justify-center shrink-0">
                      {file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-gray-700 truncate">{file.name}</p>
                      <p className="text-[9px] text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <a 
                      href={file.url} 
                      download={file.name}
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded-full transition-all text-gray-400 hover:text-black"
                      title="Download Attachment"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    {file.type.startsWith('image/') && (
                      <button 
                        onClick={() => window.open(file.url, '_blank')}
                        className="p-1.5 hover:bg-white hover:shadow-sm rounded-full transition-all text-gray-400 hover:text-black"
                        title="View Full Image"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {requisition.notes && (
            <div className="space-y-4 pt-6 border-t border-gray-100">
              <label className="input-label">Additional Notes</label>
              <div className="bg-amber-50/30 p-4 border-l-4 border-amber-200 rounded-sm italic text-sm text-gray-700 whitespace-pre-wrap">
                {requisition.notes}
              </div>
            </div>
          )}

          {requisition.type !== 'Quotations' && (
            <div className="space-y-4">
              <label className="input-label">Approval Workflow</label>
              <div className="space-y-4 relative">
                {requisition.approvals.map((approval, idx) => (
                  <div key={idx} className={`flex items-start gap-4 p-4 rounded-sm border ${
                    idx === requisition.currentStage && requisition.status === 'pending'
                      ? 'border-yellow-200 bg-yellow-50/30' 
                      : approval.status === 'approved' 
                        ? 'border-green-100 bg-green-50/20'
                        : approval.status === 'rejected'
                          ? 'border-red-100 bg-red-50/20'
                          : 'border-gray-100 bg-gray-50/50 opacity-60'
                  }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border mt-0.5 ${
                      approval.status === 'approved' ? 'bg-green-500 border-green-600 text-white' :
                      approval.status === 'rejected' ? 'bg-red-500 border-red-600 text-white' :
                      idx === requisition.currentStage && requisition.status === 'pending' ? 'bg-yellow-400 border-yellow-500 text-white' :
                      'bg-white border-gray-200 text-gray-400'
                    }`}>
                      {approval.status === 'approved' ? <Check className="w-4 h-4" /> : 
                       approval.status === 'rejected' ? <XCircle className="w-4 h-4" /> : 
                       <Clock className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold uppercase tracking-tight">{approval.role}</p>
                          {approval.signatureId && (
                            <div className="flex items-center gap-2">
                              <div 
                                className="p-1.5 bg-white border border-gray-200 rounded-sm shadow-sm hover:scale-[2] transition-transform cursor-pointer origin-left z-20"
                                title="Scan to verify authorization"
                              >
                                <QRCodeCanvas 
                                  value={`${getPublicOrigin()}?verify=${approval.signatureId}&reqId=${requisition.id}`} 
                                  size={40}
                                  level="M"
                                />
                              </div>
                              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter hidden sm:inline">Scan to Verify</span>
                            </div>
                          )}
                        </div>
                        {approval.timestamp && (
                          <span className="text-[10px] font-mono text-gray-400">
                            {(() => {
                              try {
                                const d = typeof approval.timestamp === 'string' ? parseISO(approval.timestamp) : new Date(approval.timestamp as any);
                                return format(d, 'MMM dd, HH:mm');
                              } catch (e) {
                                 return 'Invalid Date';
                              }
                            })() }
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {approval.status === 'pending' ? 'Waiting for approval' : 
                         approval.status === 'approved' ? (approval.role.includes('Director') ? `Approved by ${approval.approverName}` : 'Approved') : approval.status}
                      </p>
                      {approval.comment && (
                        <p className="text-xs italic text-gray-400 mt-2 bg-white p-2 border border-gray-100 rounded-sm">
                          "{approval.comment}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {/* Disbursement Signature */}
                {requisition.issuedInfo && (
                  <div className="flex items-start gap-4 p-4 rounded-sm border border-blue-100 bg-blue-50/20">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-blue-600 border-blue-700 text-white mt-0.5">
                      <Check className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold uppercase tracking-tight">DISBURSEMENT / ISSUANCE</p>
                          <div 
                            className="p-1.5 bg-white border border-gray-200 rounded-sm shadow-sm hover:scale-[2] transition-transform cursor-pointer origin-left z-20"
                            title="Scan to verify issuance"
                          >
                            <QRCodeCanvas 
                              value={`${getPublicOrigin()}?verify=${requisition.issuedInfo.signatureId}&reqId=${requisition.id}`} 
                              size={40}
                              level="M"
                            />
                          </div>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter hidden sm:inline">Scan to Verify</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-400">
                          {format(parseISO(requisition.issuedInfo.timestamp), 'MMM dd, HH:mm')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Issued by {requisition.issuedInfo.userName}
                      </p>
                      <div className="mt-2 py-1 px-2 border border-blue-100 bg-white inline-block text-[10px] font-mono text-blue-700 rounded-sm">
                        TOKEN: {requisition.issuedInfo.signatureId}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50">
          {requisition.status === 'rejected' && requisition.creatorId === userProfile.uid ? (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-100 p-4 rounded-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-900 uppercase">Requisition Rejected</p>
                  <p className="text-xs text-red-700">
                    You can modify the details and resubmit this requisition. This will reset the approval process from Stage 1.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => onEdit && onEdit(requisition)}
                className="w-full btn-primary bg-black hover:bg-gray-700 border-none flex items-center justify-center gap-2 h-12 transition-all active:scale-[0.98]"
              >
                <FileText className="w-4 h-4" /> Edit & Resubmit Requisition
              </button>
            </div>
          ) : canApprove() ? (
            <div className="space-y-4">
              <textarea 
                placeholder="Add an optional comment..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full h-20 p-3 text-sm border border-gray-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-black bg-white resize-none"
              />
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsRejectionModalOpen(true)}
                  disabled={!!isProcessing || isSuccess}
                  className="flex-1 btn-secondary text-red-600 border-red-200 hover:bg-red-50 flex items-center justify-center gap-2 h-12 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> 
                  Reject Request
                </button>
                <button 
                  onClick={() => handleUpdateStatus('approved', true)}
                  disabled={!!isProcessing || isSuccess}
                  className={`flex-1 btn-primary border-none flex items-center justify-center gap-2 h-12 transition-all duration-300 ${
                    isSuccess && isProcessing === null ? 'bg-green-600' : 'bg-blue-600 hover:bg-black'
                  } disabled:opacity-80`}
                >
                  {isProcessing === 'approved' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isSuccess ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {isProcessing === 'approved' ? 'Processing...' : isSuccess ? 'Approved!' : `Approve Stage ${requisition.currentStage + 1}`}
                </button>
              </div>
            </div>
          ) : !userProfile.isVerified && userProfile.username !== 'admin' && checkRoleMatch(userProfile, requisition.approvals[requisition.currentStage]?.role || '', requisition.department) ? (
             <div className="p-6 bg-amber-50 border border-amber-200 rounded-sm flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-900">Account Pending Verification</p>
                  <p className="text-xs text-amber-700 mt-1 max-w-sm">
                    Your account is currently <span className="font-bold underline">Unverified</span>. Until an administrator verifies your identity, 
                    you cannot approve or reject requisitions. Please contact support.
                  </p>
                </div>
             </div>
          ) : canProcess ? (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-sm">
                <p className="text-xs text-blue-700 font-medium flex items-center gap-2">
                  <Check className="w-4 h-4" /> Requisition is fully approved. Ready for fund disbursement.
                </p>
              </div>
              <button 
                onClick={() => {
                  setAmountIssued(requisition.totalAmount.toString());
                  setIsIssueModalOpen(true);
                }}
                disabled={!!isProcessing || isSuccess}
                className={`w-full btn-primary border-none flex items-center justify-center gap-2 h-12 transition-all duration-300 ${
                  isSuccess ? 'bg-green-600' : 'bg-blue-900 hover:bg-black'
                } disabled:opacity-80`}
              >
                {isProcessing === 'processed' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isSuccess ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                {isProcessing === 'processed' ? 'Disbursing...' : isSuccess ? 'Processed!' : 'Disburse & Mark Processed'}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {canConfirmReturn && (
                <div className="bg-green-50 border border-green-100 p-6 rounded-sm space-y-4">
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black text-green-900 uppercase">Confirm Return of Funds</h4>
                      <p className="text-[10px] text-green-600 leading-relaxed mt-0.5">
                        The requester is returning {symbol}{requisition.amountToReturn?.toFixed(2)}{suffix}. Verify receipt.
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      try {
                        await handleUpdateStatus('processed', false, 'Funds Receipt Confirmed', {
                          returnStatus: 'confirmed'
                        });
                        showToast('Funds return confirmed', 'success');
                      } catch (err) {
                        showToast('Failed to confirm return', 'error');
                      }
                    }}
                    disabled={!!isProcessing || isSuccess}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-sm text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    Confirm Receipt
                  </button>
                </div>
              )}

              {canRequestReturn && (
                <div className="bg-amber-50 border border-amber-100 p-6 rounded-sm space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black text-amber-900 uppercase">Return Unused Funds</h4>
                      <p className="text-[10px] text-amber-600 leading-relaxed mt-0.5">
                        If you have unused funds from this requisition, click below to initiate a return.
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsReturnModalOpen(true)}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-sm text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Return Funds
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-medium font-bold">
                  {requisition.status === 'pending' ? (
                    <>
                      <Clock className="w-4 h-4" /> 
                      <span>Waiting for {requisition.approvals[requisition.currentStage]?.role}</span>
                    </>
                  ) : requisition.status === 'processed' ? (
                    <>
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-green-600 uppercase font-black tracking-widest">Requisition Issued</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-blue-600" />
                      <span className="text-blue-600 uppercase">Status: {requisition.status === 'approved' ? 'Completed' : requisition.status}</span>
                    </>
                  )}
                </div>
                {canDelete() && (
                  <button 
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="text-xs text-red-500 hover:text-red-700 font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5"
                  >
                    {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                    Delete Record
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {isRejectionModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-sm shadow-2xl overflow-hidden border border-gray-100"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-red-50">
                <div className="flex items-center gap-2 text-red-700">
                  <XCircle className="w-5 h-5" />
                  <h3 className="font-bold text-sm uppercase tracking-tight">Rejection Reason</h3>
                </div>
                <button onClick={() => setIsRejectionModalOpen(false)} className="text-red-400 hover:text-red-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs text-gray-500 italic">
                  Please provide a clear reason for rejecting this requisition. This feedback will be sent to the creator.
                </p>
                <textarea 
                  autoFocus
                  placeholder="Enter reason here... (min 5 characters)"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full h-32 p-3 text-sm border border-gray-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-red-500 bg-white resize-none"
                />
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsRejectionModalOpen(false)}
                    className="flex-1 px-4 py-2 text-sm font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={async () => {
                      if (rejectionReason.trim().length < 5) {
                        showToast('Please provide a valid reason (min 5 characters)', 'error');
                        return;
                      }
                      await handleUpdateStatus('rejected', true, rejectionReason);
                      setIsRejectionModalOpen(false);
                      setRejectionReason('');
                    }}
                    disabled={!!isProcessing || rejectionReason.trim().length < 5}
                    className="flex-1 bg-red-600 text-white py-2 rounded-sm text-sm font-bold uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {isProcessing === 'rejected' ? 'Rejecting...' : 'Confirm Rejection'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isIssueModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-sm shadow-2xl overflow-hidden border border-gray-100"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-blue-50">
                <div className="flex items-center gap-2 text-blue-700">
                  <ArrowRight className="w-5 h-5" />
                  <h3 className="font-bold text-sm uppercase tracking-tight">Record Disbursement</h3>
                </div>
                <button onClick={() => setIsIssueModalOpen(false)} className="text-blue-400 hover:text-blue-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex justify-between items-center bg-gray-50 p-4 rounded-sm border border-gray-100">
                  <span className="text-xs font-bold text-gray-500 uppercase">Total Requested:</span>
                  <span className="text-lg font-mono font-bold">{symbol}{requisition.totalAmount.toFixed(2)}{suffix}</span>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black tracking-widest text-gray-400">Amount Actually Issued ({currency})</label>
                  <input 
                    type="number"
                    step="0.01"
                    autoFocus
                    placeholder="Enter amount issued..."
                    value={amountIssued}
                    onChange={(e) => setAmountIssued(e.target.value)}
                    className="w-full text-2xl font-bold p-4 border border-gray-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  />
                </div>

                {parseFloat(amountIssued) > requisition.totalAmount && (
                  <div className="bg-amber-50 border border-amber-100 p-4 rounded-sm flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-amber-900 uppercase">Change Detected</p>
                      <p className="text-xl font-black text-amber-700 mt-1">
                        {symbol}{(parseFloat(amountIssued) - requisition.totalAmount).toFixed(2)}{suffix}
                      </p>
                      <p className="text-[10px] text-amber-600 mt-1">This amount must be returned to the office.</p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-4">
                  <button 
                    onClick={() => setIsIssueModalOpen(false)}
                    className="flex-1 px-4 py-2 text-sm font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={async () => {
                      const issued = parseFloat(amountIssued);
                      if (isNaN(issued) || issued <= 0) {
                        showToast('Please enter a valid amount issued', 'error');
                        return;
                      }
                      
                      const change = issued > requisition.totalAmount ? (issued - requisition.totalAmount) : 0;
                      
                      await handleUpdateStatus('processed', false, undefined, {
                        amountIssued: issued,
                        changeReturned: change
                      });
                      setIsIssueModalOpen(false);
                    }}
                    disabled={!!isProcessing}
                    className="flex-1 bg-blue-900 text-white py-4 rounded-sm text-sm font-bold uppercase tracking-widest hover:bg-black transition-colors disabled:opacity-50 shadow-lg"
                  >
                    {isProcessing === 'processed' ? 'Processing...' : 'Confirm Disbursement'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isReturnModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-sm shadow-2xl overflow-hidden border border-gray-100"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-amber-50">
                <div className="flex items-center gap-2 text-amber-700">
                  <ArrowRight className="w-5 h-5" />
                  <h3 className="font-bold text-sm uppercase tracking-tight">Return Unused Funds</h3>
                </div>
                <button onClick={() => setIsReturnModalOpen(false)} className="text-amber-400 hover:text-amber-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black tracking-widest text-gray-400">Amount to Return ({currency})</label>
                  <input 
                    type="number"
                    step="0.01"
                    autoFocus
                    placeholder="Enter amount to return..."
                    value={amountToReturnRaw}
                    onChange={(e) => setAmountToReturnRaw(e.target.value)}
                    className="w-full text-2xl font-bold p-4 border border-gray-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                  />
                </div>

                <div className="flex items-center gap-3 pt-4">
                  <button 
                    onClick={() => setIsReturnModalOpen(false)}
                    className="flex-1 px-4 py-2 text-sm font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={async () => {
                      const amount = parseFloat(amountToReturnRaw);
                      if (isNaN(amount) || amount <= 0) {
                        showToast('Please enter a valid amount', 'error');
                        return;
                      }
                      
                      try {
                        await requisitionService.update(requisition.id, {
                          amountToReturn: amount,
                          returnStatus: 'pending',
                          updatedAt: new Date().toISOString()
                        });
                        showToast('Return request submitted for Treasurer approval', 'success');
                        setIsReturnModalOpen(false);
                        onClose();
                      } catch (err) {
                        showToast('Failed to submit return request', 'error');
                      }
                    }}
                    className="flex-1 bg-amber-600 text-white py-4 rounded-sm text-sm font-bold uppercase tracking-widest hover:bg-black transition-colors shadow-lg"
                  >
                    Request Return
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
