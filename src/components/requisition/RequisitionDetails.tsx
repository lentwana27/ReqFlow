import { useState } from 'react';
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
}

export default function RequisitionDetails({ requisition, userProfile, onClose }: RequisitionDetailsProps) {
  const { showToast } = useToast();
  const [comment, setComment] = useState('');
  const [isProcessing, setIsProcessing] = useState<'approved' | 'rejected' | 'processed' | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);

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
    // Admin, Treasurer, Director, and Accounting HOD can always download
    if (
      userProfile.username === 'admin' || 
      userProfile.role === UserRole.ADMIN || 
      userProfile.role === UserRole.TREASURER ||
      userProfile.role === UserRole.DIRECTOR ||
      userProfile.role === UserRole.ACCOUNTING_HOD
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
    // In the new spec, roles are specific and don't strictly require dept matching in logic
    // because the role string itself (e.g. "Purchasing HOD") describes the authority.
    return userProfile.role === targetRole;
  };

  const canApprove = () => {
    if (requisition.status !== 'pending') return false;
    const currentApproval = requisition.approvals[requisition.currentStage];
    if (!currentApproval) return false;

    // Block unverified users from approving
    if (!userProfile.isVerified && userProfile.username !== 'admin') return false;

    return checkRoleMatch(userProfile, currentApproval.role, requisition.department);
  };

  const handleUpdateStatus = async (newStatus: 'approved' | 'rejected' | 'processed', isApproval = false) => {
    setIsProcessing(newStatus);
    try {
      const updates: any = {
        updatedAt: new Date().toISOString()
      };

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
          comment,
          signatureId: newStatus === 'approved' ? sigId : null
        };

        // 2. If approved, check for future stages that this user ALSO fulfills
        if (newStatus === 'approved') {
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

        updates.approvals = newApprovals;

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
          detailsText = `Requisition rejected at stage ${requisition.currentStage + 1} by ${userProfile.name}${comment ? `: ${comment}` : ''}`;
        } else {
          actionLabel = 'Requisition Approved';
          detailsText = `Requisition stage ${requisition.currentStage + 1} approved by ${userProfile.name}${comment ? `: ${comment}` : ''}`;
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
        if (!isApproval || newStatus === 'rejected' || requisition.currentStage === requisition.approvals.length - 1) {
          onClose();
        }
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

  const isFinance = userProfile?.role === UserRole.FINANCE_HOD;
  const isTreasurer = userProfile?.role === UserRole.TREASURER;
  
  // Treasurer issues for Admin, Fuel, Workshop. others might be Finance or generic
  const canProcess = (isTreasurer || isFinance) && requisition.status === 'approved';

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
              <p className="text-[10px] font-mono text-gray-400 uppercase">
                {requisition.type === 'Quotations' ? requisition.type : `${requisition.type} Requisition`}
              </p>
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
          {/* Header Info */}
          <div className="grid grid-cols-2 gap-8 bg-gray-50/50 p-6 rounded-sm border border-gray-100">
            <div className="space-y-4">
              <div>
                <label className="input-label">Creator</label>
                <p className="text-sm font-bold uppercase">{requisition.creatorName}</p>
                <p className="text-xs text-gray-500 font-mono italic">{requisition.department}</p>
              </div>
              <div>
                <label className="input-label">Written To</label>
                <p className="text-sm font-semibold text-blue-900">{requisition.writtenTo || 'N/A'}</p>
              </div>
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
                const isQR = requisition.type === RequisitionType.SHOP_QR || requisition.type === RequisitionType.WAREHOUSE_QR;
                return (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr className="font-mono text-[10px] uppercase text-gray-500">
                        {isQR && <th className="text-left px-4 py-3">Code</th>}
                        <th className="text-left px-4 py-3">Description</th>
                        <th className="text-center px-4 py-3">Qty</th>
                        {!isQR && (
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
                          {isQR && <td className="px-4 py-3 font-mono text-blue-600 font-bold">{item.code || 'N/A'}</td>}
                          <td className="px-4 py-3">{item.description}</td>
                          <td className="px-4 py-3 text-center">{item.qty}</td>
                          {!isQR && (
                            <>
                              <td className="px-4 py-3 text-right">{symbol}{item.unitCost.toFixed(2)}{suffix}</td>
                              <td className="px-4 py-3 text-right font-bold">{symbol}{item.totalCost.toFixed(2)}{suffix}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {!isQR && (
                      <tfoot className="bg-gray-50/50">
                        <tr className="font-bold">
                          <td colSpan={3} className="px-4 py-4 text-right uppercase tracking-wider text-[10px]">Total Amount ({currency})</td>
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
                          })()}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {approval.status === 'pending' ? 'Waiting for approval' : 
                       approval.approverName ? `Approved by ${approval.approverName}` : approval.status}
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
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50">
          {canApprove() ? (
            <div className="space-y-4">
              <textarea 
                placeholder="Add an optional comment..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full h-20 p-3 text-sm border border-gray-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-black bg-white resize-none"
              />
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => handleUpdateStatus('rejected', true)}
                  disabled={!!isProcessing || isSuccess}
                  className="flex-1 btn-secondary text-red-600 border-red-200 hover:bg-red-50 flex items-center justify-center gap-2 h-12 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> 
                  {isProcessing === 'rejected' ? 'Rejecting...' : 'Reject Request'}
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
                onClick={() => handleUpdateStatus('processed')}
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
          )}
        </div>
      </motion.div>
    </div>
  );
}
