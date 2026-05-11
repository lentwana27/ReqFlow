import { useEffect, useState } from 'react';
import { requisitionService } from '../../services/api';
import { Requisition } from '../../types';
import { ShieldCheck, ShieldAlert, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface VerificationViewProps {
  id: string;
  signatureId: string;
  onClose: () => void;
  onPublic?: boolean;
}

export default function VerificationView({ id, signatureId, onClose, onPublic }: VerificationViewProps) {
  const [loading, setLoading] = useState(true);
  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verify() {
      try {
        // Use the specific getById method
        const data = await requisitionService.getById(id);
        
        if (data) {
          const approval = data.approvals.find((a: any) => a.signatureId === signatureId);
          const isIssuedSig = data.issuedInfo?.signatureId === signatureId;
          
          if (approval || isIssuedSig) {
            setRequisition(data);
          } else {
            setError('Invalid digital signature for this requisition.');
          }
        } else {
          setError('Requisition not found.');
        }
      } catch (err) {
        setError('Verification failed. Requisition may not exist.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [id, signatureId]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-4">
      <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
        <div className={`p-6 text-center ${error ? 'bg-red-50' : 'bg-blue-50'}`}>
          <div className="flex justify-center mb-4">
            {loading ? (
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            ) : error ? (
              <ShieldAlert className="w-12 h-12 text-red-500" />
            ) : (
              <div className="relative">
                <ShieldCheck className="w-12 h-12 text-blue-600" />
                <CheckCircle2 className="w-5 h-5 text-green-500 absolute -bottom-1 -right-1 bg-white rounded-full" />
              </div>
            )}
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            {loading ? 'Verifying...' : error ? 'Verification Failed' : 'Digital Signature Verified'}
          </h2>
          <p className="text-[10px] font-mono text-gray-400 mt-1 uppercase tracking-widest font-bold">
            {signatureId}
          </p>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4"></div>
              <div className="h-4 bg-gray-100 rounded w-1/2"></div>
              <div className="h-20 bg-gray-100 rounded shadow-sm"></div>
            </div>
          ) : error ? (
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-6">{error}</p>
              <button 
                onClick={onClose}
                className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold text-sm tracking-tight hover:bg-black transition-colors"
              >
                Close
              </button>
            </div>
          ) : requisition && (
              <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Requisition</p>
                  <p className="text-sm font-bold">{requisition.requisitionNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Value</p>
                  <p className="text-sm font-mono font-bold text-blue-600">${requisition.totalAmount.toFixed(2)}</p>
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Items</p>
                <div className="space-y-1">
                  {requisition.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex justify-between text-[11px] font-medium">
                      <span className="text-gray-600 truncate mr-2">{item.description}</span>
                      <span className="font-mono font-bold shrink-0">{item.qty}x</span>
                    </div>
                  ))}
                  {requisition.items.length > 3 && (
                    <p className="text-[10px] text-gray-400 italic">+ {requisition.items.length - 3} more items</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Verification Authority</p>
                <div className="mt-2 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                  {requisition.issuedInfo?.signatureId === signatureId ? (
                    <>
                      <p className="text-sm font-bold text-blue-900">
                        TREASURY / CASH DISBURSEMENT
                      </p>
                      <p className="text-[11px] text-blue-700 mt-1 font-medium">
                        Verified Issuance by {requisition.issuedInfo.userName}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-2 font-mono font-bold flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {format(parseISO(requisition.issuedInfo.timestamp), 'PPP p')}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-blue-900">
                        {requisition.approvals.find(a => a.signatureId === signatureId)?.role}
                      </p>
                      <p className="text-[11px] text-blue-700 mt-1 font-medium">
                        Verified Signature of {requisition.approvals.find(a => a.signatureId === signatureId)?.approverName}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-2 font-mono font-bold flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {requisition.approvals.find(a => a.signatureId === signatureId)?.timestamp ? format(parseISO(requisition.approvals.find(a => a.signatureId === signatureId)!.timestamp), 'PPP p') : 'N/A'}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={onClose}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-sm tracking-tight hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                >
                  {onPublic ? 'Close Verification' : 'Return to App'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
