import React, { useState, useEffect, useRef } from 'react';
import { requisitionService, auditService } from '../../services/api';
import { Requisition, UserProfile, UserRole, Department, RequisitionType, Attachment, Currency } from '../../types';
import { X, Check, XCircle, Clock, ArrowRight, Shield, Download, Loader2, AlertCircle, Lock, Paperclip, Eye, FileText, Image as ImageIcon, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import { generateRequisitionPDF } from '../../lib/pdfGenerator';
import { checkRoleMatch } from '../../lib/roleUtils';
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
  const [returnTypeSelection, setReturnTypeSelection] = useState<'funds' | 'change'>('funds');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>(requisition.attachments || []);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDeleting, setIsDeleting] = useState(false);

  // Silent repair for involvedRoles on old requisitions
  useEffect(() => {
    const repairInvolvedRoles = async () => {
      const isSystemAdmin = userProfile.username === 'admin' || userProfile.username === 'admin1' || userProfile.role === UserRole.ADMIN;
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsUploading(true);
    const newAttachments: Attachment[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 2 * 1024 * 1024) {
          alert(`File ${file.name} is too large. Max size is 2MB.`);
          continue;
        }

        const reader = new FileReader();
        const promise = new Promise<Attachment>((resolve) => {
          reader.onload = (event) => {
            resolve({
              name: file.name,
              type: file.type,
              size: file.size,
              url: event.target?.result as string
            });
          };
        });
        reader.readAsDataURL(file);
        newAttachments.push(await promise);
    }

    const updated = [...localAttachments, ...newAttachments];
    setLocalAttachments(updated);
    
    try {
        await requisitionService.update(requisition.id, { attachments: updated });
        showToast('Attachments updated successfully', 'success');
    } catch(err) {
        showToast('Failed to update attachments in database', 'error');
    }
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = async (index: number) => {
    if (!window.confirm("Are you sure you want to delete this attachment?")) return;
    const updated = localAttachments.filter((_, i) => i !== index);
    setLocalAttachments(updated);
    try {
        await requisitionService.update(requisition.id, { attachments: updated });
        showToast('Attachment deleted successfully', 'success');
    } catch(err) {
        showToast('Failed to update attachments in database', 'error');
    }
  };

  const canEdit = () => {
    const isCreator = requisition.creatorId === userProfile.uid;
    if (isCreator) {
      return requisition.status === 'pending' || requisition.status === 'rejected' || requisition.status === 'cancelled';
    }
    return false;
  };

  const canCancel = () => {
    return requisition.creatorId === userProfile.uid && 
           requisition.currentStage === 0 && 
           requisition.status === 'pending';
  };

  const handleCancel = async () => {
    if (!window.confirm("Are you sure you want to cancel this requisition?")) return;
    try {
      setIsProcessing('rejected');
      await requisitionService.update(requisition.id, {
        status: 'cancelled',
        updatedAt: new Date().toISOString()
      });
      showToast('Requisition cancelled', 'success');
      onClose();
    } catch(err) {
      showToast('Failed to cancel requisition', 'error');
    } finally {
      setIsProcessing(null);
    }
  };

  const getMyLatestApprovalIndex = () => {
    if (!requisition.approvals) return -1;
    for (let i = requisition.currentStage - 1; i >= 0; i--) {
      if (requisition.approvals[i] && requisition.approvals[i].approverId === userProfile.uid && requisition.approvals[i].status === 'approved') {
        return i;
      }
    }
    return -1;
  };

  const canCallBack = () => {
    if (requisition.status === 'processed' || requisition.status === 'completed' || requisition.status === 'cancelled' || requisition.status === 'rejected') return false;
    return getMyLatestApprovalIndex() !== -1;
  };

  const handleCallBack = async () => {
    if (!window.confirm("Are you sure you want to call back this requisition? This will return it to your approval stage.")) return;
    try {
        const myApprovalIndex = getMyLatestApprovalIndex();
        if (myApprovalIndex === -1) return;

        const newApprovals = [...requisition.approvals];
        for (let i = myApprovalIndex; i <= requisition.currentStage && i < newApprovals.length; i++) {
            newApprovals[i] = {
                ...newApprovals[i],
                status: 'pending',
                approverId: undefined,
                approverName: undefined,
                signatureId: undefined,
                timestamp: undefined,
                comment: undefined
            };
        }

        setIsProcessing('approved');
        await requisitionService.update(requisition.id, {
            status: 'pending',
            currentStage: myApprovalIndex,
            approvals: newApprovals,
            updatedAt: new Date().toISOString()
        });
        showToast('Requisition called back successfully', 'success');
        onClose();
    } catch(err) {
        showToast('Failed to call back requisition', 'error');
    } finally {
        setIsProcessing(null);
    }
  };

  const canDelete = () => {
    // Only the general system administrator (username: 'admin' or 'admin1') can force delete any requisition
    if (userProfile.username === 'admin' || userProfile.username === 'admin1') return true;

    // Audit System Administrators (ADMIN role) can view all requisitions but NOT delete them
    if (userProfile.role === UserRole.ADMIN) return false;

    const isCreator = requisition.creatorId === userProfile.uid;
    if (isCreator) {
      // Requesters can delete if not yet completed (approved) or money given (processed)
      return requisition.status === 'pending' || requisition.status === 'rejected';
    }

    return false;
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
      userProfile.username === 'admin1' || 
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
      await generateRequisitionPDF(requisition, userProfile.role);
    } catch (error) {
      console.error('PDF Generation failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const canApprove = () => {
    if (requisition.status !== 'pending') return false;
    const currentApproval = requisition.approvals[requisition.currentStage];
    if (!currentApproval) return false;

    // Block unverified users from approving
    if (!userProfile.isVerified && userProfile.username !== 'admin' && userProfile.username !== 'admin1') return false;

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
            ? `Issued by ${userProfile.name}`
            : `Approved by ${userProfile.name}`,
        newStatus === 'rejected' ? 'error' : 'success'
      );

      setIsSuccess(true);
      setIsProcessing(null);

      // straight away exit that requisition per user request
      onClose();
      setComment('');
      setIsSuccess(false);
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
    RequisitionType.MARKETING,
    RequisitionType.CASH,
    RequisitionType.CANTEEN
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
        className="bg-white w-full sm:max-w-2xl h-full shadow-2xl flex flex-col border-l border-gray-200"
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
            {!userProfile.isVerified && userProfile.username !== 'admin' && userProfile.username !== 'admin1' && checkRoleMatch(userProfile, requisition.approvals[requisition.currentStage]?.role || '', requisition.department) && (
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-12">
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
              {requisition.type !== RequisitionType.SHOP_USE && requisition.type !== RequisitionType.WAREHOUSE && requisition.type !== RequisitionType.SHOP_QR && requisition.type !== RequisitionType.WAREHOUSE_QR && (
                <div>
                  <label className="input-label">Written To</label>
                  <p className="text-sm font-semibold text-blue-900">{requisition.writtenTo || 'N/A'}</p>
                </div>
              )}
              {requisition.amountIssued !== undefined && requisition.amountIssued !== null && (
                <div className="bg-green-50 p-2 border border-green-100 rounded-sm">
                  <label className="text-[9px] uppercase font-bold text-green-600 block">
                    Amount Issued
                  </label>
                  <p className="text-sm font-bold text-green-800">
                    {symbol}{requisition.amountIssued.toFixed(2)}{suffix}
                  </p>
                </div>
              )}
              {requisition.changeReturned !== undefined && requisition.changeReturned > 0 && (requisition.returnStatus === 'none' || !requisition.returnStatus) && (
                <div className={`p-4 border rounded-sm transition-all duration-500 bg-amber-100 border-amber-400 animate-pulse shadow-md ring-2 ring-amber-500/20`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-amber-700" />
                    <label className="text-[10px] uppercase font-black text-amber-900 block">
                      Change to be Returned
                    </label>
                  </div>
                  <p className="text-xl font-black text-amber-900">
                    {symbol}{requisition.changeReturned.toFixed(2)}{suffix}
                  </p>
                  <p className="text-[10px] font-bold text-amber-700 mt-1 italic">
                    {requisition.creatorId === userProfile.uid ? '!!! ACTION REQUIRED: RETURN THIS CHANGE TO THE OFFICE !!!' : 'Waiting for creator to return funds'}
                  </p>
                </div>
              )}
              {requisition.returnStatus && requisition.returnStatus !== 'none' && (
                <div className={`${requisition.returnStatus === 'confirmed' ? 'bg-green-50 border-green-100' : 'bg-blue-100 border-blue-400 animate-pulse shadow-md ring-2 ring-blue-500/20'} p-4 border rounded-sm`}>
                  <div className="flex items-center gap-2 mb-1">
                    {requisition.returnStatus === 'confirmed' ? <Check className="w-4 h-4 text-green-600" /> : <Clock className="w-4 h-4 text-blue-700" />}
                    <label className={`text-[10px] uppercase font-black ${requisition.returnStatus === 'confirmed' ? 'text-green-600' : 'text-blue-900'} block`}>
                      {requisition.returnType === 'change' ? 'Change Return' : 'Funds Return'} {requisition.returnStatus === 'confirmed' ? '(CONFIRMED)' : '(PENDING TREASURER ACTION)'}
                    </label>
                  </div>
                  <p className={`text-xl font-black ${requisition.returnStatus === 'confirmed' ? 'text-green-800' : 'text-blue-900'}`}>
                    {symbol}{requisition.amountToReturn?.toFixed(2)}{suffix}
                  </p>
                  {requisition.returnStatus === 'pending' && userProfile.role === UserRole.TREASURER && (
                    <p className="text-[10px] font-bold text-blue-700 mt-1 italic underline">TREASURER: PLEASE VERIFY AND CONFIRM RECEIPT BELOW</p>
                  )}
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
                  requisition.status === 'rejected' ? 'bg-red-100 text-red-700' :
                  requisition.status === 'cancelled' ? 'bg-gray-200 text-gray-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {requisition.status === 'approved' ? 'Completed' : 
                   requisition.status === 'processed' ? 'Issued' : 
                   requisition.status === 'cancelled' ? 'Cancelled' : 
                   requisition.status}
                </div>
              </div>
            </div>
          </div>

      <div className="space-y-4">
            <label className="input-label">Requested Items</label>
            <div className="border border-gray-100 rounded-sm overflow-hidden text-sm">
              {(() => {
                const isInternalInternal = requisition.type === RequisitionType.WAREHOUSE || 
                                           requisition.type === RequisitionType.SHOP_USE || 
                                           requisition.type === RequisitionType.SHOP_QR || 
                                           requisition.type === RequisitionType.WAREHOUSE_QR;
                
                const hasCodeColumn = (requisition.type === RequisitionType.WAREHOUSE || 
                                      requisition.type === RequisitionType.SHOP_USE || 
                                      requisition.type === RequisitionType.SHOP_QR || 
                                      requisition.type === RequisitionType.WAREHOUSE_QR || 
                                      requisition.type === RequisitionType.QUOTATIONS) && 
                                      !(isTreasurer && isInternalInternal);
                
                const hasPricingColumns = requisition.type !== RequisitionType.SHOP_QR && 
                                         requisition.type !== RequisitionType.WAREHOUSE_QR;
                
                return (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr className="font-mono text-[10px] uppercase text-gray-500">
                        {hasCodeColumn && <th className="text-left px-4 py-3">Code</th>}
                        <th className="text-left px-4 py-3">Description</th>
                        <th className="text-center px-4 py-3">Qty</th>
                        {hasPricingColumns && (
                          <>
                            <th className="text-right px-4 py-3">Price</th>
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
                          <td className="px-4 py-3 text-center">{item.qty}</td>
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

          {(localAttachments.length > 0 || canEdit()) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="input-label flex items-center gap-2">
                  <Paperclip className="w-4 h-4" /> 
                  Attachments
                  {isUploading && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                </label>
                {canEdit() && (
                  <div>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded-sm"
                    >
                      <Plus className="w-3 h-3" /> Add File
                    </button>
                    <input 
                      type="file"
                      className="hidden"
                      multiple
                      ref={fileInputRef}
                      onChange={handleFileChange}
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {localAttachments.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-sm group relative">
                    <div className="w-8 h-8 rounded-sm bg-white border border-gray-200 flex items-center justify-center shrink-0">
                      {file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-gray-700 truncate">{file.name}</p>
                      <p className="text-[9px] text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <div className="flex items-center gap-1 relative z-10">
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
                    {canEdit() && (
                      <button
                        onClick={() => removeAttachment(idx)}
                        className="absolute -top-2 -right-2 p-1 bg-white border border-gray-200 hover:border-red-200 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all z-20"
                        title="Delete Attachment"
                      >
                        <X className="w-3 h-3" />
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
                          {approval.signatureId && !((isTreasurer || userProfile.role === UserRole.TREASURER) && (requisition.type === RequisitionType.WAREHOUSE || requisition.type === RequisitionType.SHOP_USE || requisition.type === RequisitionType.SHOP_QR || requisition.type === RequisitionType.WAREHOUSE_QR)) && (
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
                         approval.status === 'approved' ? `Approved by ${approval.approverName || 'N/A'}` : approval.status}
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

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex flex-col gap-6">
          {canEdit() && (
            <div className="space-y-4">
              <div className={`${requisition.status === 'rejected' ? 'bg-red-50 border-red-100' : requisition.status === 'cancelled' ? 'bg-gray-100 border-gray-200' : 'bg-blue-50 border-blue-100'} p-4 rounded-sm flex items-start gap-3`}>
                <AlertCircle className={`w-5 h-5 ${requisition.status === 'rejected' ? 'text-red-500' : requisition.status === 'cancelled' ? 'text-gray-500' : 'text-blue-500'} shrink-0 mt-0.5`} />
                <div>
                  <p className={`text-sm font-bold ${requisition.status === 'rejected' ? 'text-red-900' : requisition.status === 'cancelled' ? 'text-gray-900' : 'text-blue-900'} uppercase`}>
                    {requisition.status === 'rejected' ? 'Requisition Rejected' : requisition.status === 'cancelled' ? 'Requisition Cancelled' : 'Modify Requisition'}
                  </p>
                  <p className={`text-xs ${requisition.status === 'rejected' ? 'text-red-700' : requisition.status === 'cancelled' ? 'text-gray-700' : 'text-blue-700'}`}>
                    You can modify details and resubmit. This will reset the approval process from Stage 1.
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
          )}

          {canCancel() && (
            <button 
              onClick={handleCancel}
              disabled={!!isProcessing}
              className="w-full bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 flex items-center justify-center gap-2 h-12 transition-all font-bold text-sm rounded-sm uppercase tracking-widest"
            >
              <XCircle className="w-4 h-4" /> Cancel Requisition
            </button>
          )}

          {canCallBack() && (
            <button 
              onClick={handleCallBack}
              disabled={!!isProcessing}
              className="w-full bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 flex items-center justify-center gap-2 h-12 transition-all font-bold text-sm rounded-sm uppercase tracking-widest"
            >
              <ArrowRight className="w-4 h-4 rotate-180" /> Recall Requisition (Add Comment / Reject)
            </button>
          )}

          {canApprove() && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
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
                  {isProcessing === 'approved' ? 'Processing...' : isSuccess ? 'Approved!' : 'Approve Request'}
                </button>
              </div>
              {requisition.currentStage > 0 && requisition.approvals[requisition.currentStage - 1] && (
                <div className="p-3 bg-gray-50 border border-gray-100 rounded-sm flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Previously Approved by {requisition.approvals[requisition.currentStage - 1].approverName || 'Authorized User'}
                  </p>
                </div>
              )}
            </div>
          )}

          {!userProfile.isVerified && userProfile.username !== 'admin' && userProfile.username !== 'admin1' && requisition.status === 'pending' && checkRoleMatch(userProfile, requisition.approvals[requisition.currentStage]?.role || '', requisition.department) && !canApprove() && (
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
          )}

          {canProcess && (
            <div className="space-y-4 pt-4 border-t border-gray-200">
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
          )}

          {canConfirmReturn && (
            <div className="bg-green-50 border border-green-100 p-6 rounded-sm space-y-4">
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-green-900 uppercase">Confirm Return of {requisition.returnType === 'change' ? 'Change' : 'Funds'}</h4>
                  <p className="text-[10px] text-green-600 leading-relaxed mt-0.5">
                    The requester is returning {symbol}{requisition.amountToReturn?.toFixed(2)}{suffix} as {requisition.returnType || 'funds'}. Verify receipt.
                  </p>
                </div>
              </div>
              <button 
                onClick={async () => {
                  try {
                    setIsProcessing('processed');
                    await requisitionService.update(requisition.id, {
                      returnStatus: 'confirmed',
                      updatedAt: new Date().toISOString()
                    });
                    showToast('Funds return confirmed', 'success');
                    onClose();
                  } catch (err) {
                    showToast('Failed to confirm return', 'error');
                  } finally {
                    setIsProcessing(null);
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
                  <h4 className="text-xs font-black text-amber-900 uppercase">Return Funds / Change</h4>
                  <p className="text-[10px] text-amber-600 leading-relaxed mt-0.5">
                    If you have unused funds or change from this requisition, click below to initiate a return.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsReturnModalOpen(true);
                  if (requisition.changeReturned && requisition.changeReturned > 0) {
                    setReturnTypeSelection('change');
                    setAmountToReturnRaw(requisition.changeReturned.toString());
                  } else {
                    setReturnTypeSelection('funds');
                    setAmountToReturnRaw('');
                  }
                }}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-sm text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Return Funds / Change
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-gray-200 mt-auto">
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
              ) : requisition.status === 'cancelled' ? (
                <>
                  <XCircle className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-500 uppercase font-black tracking-widest">Cancelled</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 text-blue-600" />
                  <span className="text-blue-600 uppercase">Status: {requisition.status === 'approved' ? 'Completed' : requisition.status}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-4">
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
                <div className="space-y-3">
                  <label className="text-[10px] uppercase font-black tracking-widest text-gray-400">Return Type</label>
                  <div className="flex bg-gray-100 p-1 rounded-sm">
                    <button
                      className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors ${returnTypeSelection === 'funds' ? 'bg-white shadow-sm text-amber-700' : 'text-gray-500 hover:text-gray-700'}`}
                      onClick={() => {
                        setReturnTypeSelection('funds');
                        setAmountToReturnRaw('');
                      }}
                    >
                      Funds
                    </button>
                    <button
                      className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors ${returnTypeSelection === 'change' ? 'bg-white shadow-sm text-amber-700' : 'text-gray-500 hover:text-gray-700'}`}
                      onClick={() => {
                        setReturnTypeSelection('change');
                        if (requisition.changeReturned && requisition.changeReturned > 0) {
                          setAmountToReturnRaw(requisition.changeReturned.toString());
                        }
                      }}
                    >
                      Change
                    </button>
                  </div>
                </div>

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
                          returnType: returnTypeSelection,
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
