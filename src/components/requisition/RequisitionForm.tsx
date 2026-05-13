import React, { useState, useRef } from 'react';
import { Plus, Trash2, X, Loader2, Paperclip, FileText, Image as ImageIcon, FileIcon, Eye, ArrowLeft } from 'lucide-react';
import { RequisitionType, RequisitionItem, Department, REQUISITION_WORKFLOWS, UserRole, Attachment, Currency } from '../../types';
import { motion, AnimatePresence } from 'motion/react';

interface RequisitionFormProps {
  onClose: () => void;
  onSubmit: (data: any) => void;
  userDept: Department;
  userEmail: string;
  initialData?: Requisition;
}

export default function RequisitionForm({ onClose, onSubmit, userDept, userEmail, initialData }: RequisitionFormProps) {
  const [type, setType] = useState<RequisitionType>(initialData?.type || RequisitionType.ADMIN);
  const [currency, setCurrency] = useState<Currency>(initialData?.currency || Currency.USD);
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [writtenTo, setWrittenTo] = useState(initialData?.writtenTo || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [items, setItems] = useState<RequisitionItem[]>(
    initialData?.items || [{ description: '', qty: 1, unitCost: 0, totalCost: 0 }]
  );
  const [attachments, setAttachments] = useState<Attachment[]>(initialData?.attachments || []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addItem = () => {
    setItems([...items, { description: '', qty: 1, unitCost: 0, totalCost: 0 }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof RequisitionItem, value: any) => {
    const newItems = [...items];
    const item = { ...newItems[index], [field]: value };
    if (field === 'qty' || field === 'unitCost') {
      item.totalCost = (item.qty || 0) * (item.unitCost || 0);
    }
    newItems[index] = item;
    setItems(newItems);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

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

    setAttachments([...attachments, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const totalAmount = items.reduce((sum, item) => sum + item.totalCost, 0);

  const handleClose = () => {
    const isDirty = writtenTo.trim() !== '' || items.some(item => item.description !== '' || item.qty !== 1 || item.unitCost !== 0) || attachments.length > 0;
    if (isDirty && !isPreview) {
      if (window.confirm('You have unsaved changes. Are you sure you want to exit?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handlePreview = () => {
    // Validate
    if (!writtenTo.trim()) {
      alert('The "WRITE TO" field is required.');
      return;
    }

    if (items.some(item => !item.description || item.qty <= 0)) {
      alert('Please fill in all item descriptions and quantities.');
      return;
    }

    setIsPreview(true);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    // Final validation
    if (!writtenTo.trim()) {
      alert('The "WRITE TO" field is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      let workflowStages = [...REQUISITION_WORKFLOWS[type]];
      
      // Resolve HOD to specific department role if needed
      workflowStages = workflowStages.map(role => {
        if (role === UserRole.HOD) {
          if (userDept === Department.IT) return UserRole.IT_HOD;
          if (userDept === Department.WAREHOUSE) return UserRole.WAREHOUSE_HOD;
          return UserRole.HOD;
        }
        return role;
      });

      const initialApprovals = workflowStages.map(role => ({
        role,
        status: 'pending' as const,
      }));

      const isAutoApproved = workflowStages.length === 0;

      const submissionData: any = {
        type,
        writtenTo,
        currency,
        quotationBook: initialData?.quotationBook || '',
        items,
        totalAmount,
        approvals: initialApprovals,
        status: isAutoApproved ? 'approved' : 'pending',
        currentStage: 0,
        department: userDept,
        attachments,
        notes,
        rejectionReason: null, // Clear rejection reason on resubmit
        updatedAt: new Date().toISOString()
      };

      if (!initialData) {
        submissionData.id = crypto.randomUUID();
        submissionData.requisitionNumber = `REQ-${Date.now().toString().slice(-6)}`;
        submissionData.createdAt = new Date().toISOString();
      } else {
        submissionData.id = initialData.id;
        submissionData.requisitionNumber = initialData.requisitionNumber;
        submissionData.createdAt = initialData.createdAt;
      }

      await onSubmit(submissionData);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className="bg-white rounded-sm shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {isPreview && (
              <button 
                onClick={() => setIsPreview(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors mr-2"
                title="Back to Edits"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                {isPreview ? 'Preview Requisition' : initialData ? 'Edit & Resubmit Requisition' : 'Write Requisition'}
              </h2>
              <p className="text-xs text-gray-400 font-mono mt-1">DEPARTMENT: {userDept} | CREATOR: {userEmail}</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {isPreview ? (
          <div className="flex-1 overflow-y-auto p-12 bg-gray-50/50">
            <div className="max-w-3xl mx-auto bg-white shadow-sm border border-gray-100 p-8 space-y-10">
              <div className="flex justify-between items-start border-b border-gray-100 pb-8">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-black tracking-widest text-gray-400">Destination</p>
                  <p className="text-xl font-bold text-black uppercase">{writtenTo}</p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[10px] uppercase font-black tracking-widest text-gray-400">Requisition Type</p>
                  <span className="inline-block px-2 py-1 bg-black text-white text-[10px] font-bold uppercase">{type}</span>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] uppercase font-black tracking-widest text-gray-400">Requested Items</p>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-y border-gray-100">
                    <tr className="text-[10px] uppercase font-bold text-gray-500">
                      <th className="text-left px-4 py-3">Description</th>
                      <th className="text-center px-4 py-3">Qty</th>
                      <th className="text-right px-4 py-3">Unit Cost</th>
                      <th className="text-right px-4 py-3">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3 font-medium">{item.description}</td>
                        <td className="px-4 py-3 text-center">{item.qty}Units</td>
                        <td className="px-4 py-3 text-right">{currency === Currency.USD ? '$' : ''}{item.unitCost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-bold">{currency === Currency.USD ? '$' : ''}{item.totalCost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-black">
                    <tr className="font-black text-lg">
                      <td colSpan={3} className="px-4 py-6 text-right uppercase tracking-tighter">Grand Total ({currency})</td>
                      <td className="px-4 py-6 text-right">{currency === Currency.USD ? '$' : ''}{totalAmount.toFixed(2)} {currency !== Currency.USD ? currency : ''}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {attachments.length > 0 && (
                <div className="space-y-4 pt-8 border-t border-gray-100">
                   <p className="text-[10px] uppercase font-black tracking-widest text-gray-400">Attached Documentation ({attachments.length})</p>
                   <div className="grid grid-cols-2 gap-3">
                     {attachments.map((file, i) => (
                       <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-sm border border-gray-100">
                         {file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-gray-500" />}
                         <div className="flex-1 min-w-0">
                           <p className="text-[10px] font-bold truncate">{file.name}</p>
                           <p className="text-[9px] text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
              )}

              {notes && (
                <div className="space-y-2 pt-8 border-t border-gray-100">
                  <p className="text-[10px] uppercase font-black tracking-widest text-gray-400">Additional Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap italic bg-gray-50 p-4 border-l-4 border-gray-200">{notes}</p>
                </div>
              )}

              <div className="pt-8 border-t border-gray-100">
                <p className="text-[10px] uppercase font-black tracking-widest text-gray-400 mb-4">Required Approvals</p>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-tight">
                   {(() => {
                      let workflow = [...REQUISITION_WORKFLOWS[type]];
                      return workflow.map((role, i) => (
                        <div key={i} className="flex items-center">
                          <span className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-sm">{role === UserRole.HOD ? `HOD (${userDept})` : role}</span>
                          {i < workflow.length - 1 && <span className="mx-2 text-gray-300">→</span>}
                        </div>
                      ));
                   })()}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); handlePreview(); }} className="flex-1 overflow-hidden flex flex-col md:flex-row">
            <div className="flex-1 overflow-y-auto p-8 space-y-8 border-r border-gray-100">
              <div className="space-y-4">
                <label className="input-label">WRITE TO: (Destination of funds) <span className="text-red-500">*</span></label>
                <input 
                  placeholder="Name of recipient or department receiving funds"
                  className="w-full px-4 py-3 rounded-sm border border-gray-200 focus:border-black focus:ring-0 text-sm transition-all bg-gray-50/30 font-bold uppercase"
                  value={writtenTo}
                  onChange={(e) => setWrittenTo(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <label className="input-label">Line Items</label>
                  <button 
                    type="button" 
                    onClick={addItem}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600 hover:text-green-700 bg-green-50 px-2 py-1 rounded-sm"
                  >
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>
                
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-4 data-grid-header px-4">
                    {(type === RequisitionType.SHOP_QR || type === RequisitionType.WAREHOUSE_QR) ? (
                      <>
                        <div className="col-span-3">Code</div>
                        <div className="col-span-7">Description</div>
                        <div className="col-span-2">Qty</div>
                      </>
                    ) : (
                      <>
                        <div className="col-span-6">Description</div>
                        <div className="col-span-2">Qty</div>
                        <div className="col-span-2">Unit Cost</div>
                        <div className="col-span-2 text-right">Total</div>
                      </>
                    )}
                  </div>

                  {items.map((item, idx) => {
                    const isQR = type === RequisitionType.SHOP_QR || type === RequisitionType.WAREHOUSE_QR;
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-4 items-center px-4 py-3 bg-white border border-gray-100 hover:border-black transition-colors rounded-sm group relative">
                        {isQR && (
                          <div className="col-span-3">
                            <input 
                              placeholder="CODE"
                              className="w-full bg-transparent text-sm focus:outline-none uppercase font-mono"
                              value={item.code || ''}
                              onChange={(e) => updateItem(idx, 'code', e.target.value.toUpperCase())}
                            />
                          </div>
                        )}
                        <div className={isQR ? "col-span-7" : "col-span-6"}>
                          <input 
                            placeholder="e.g. Printer Paper A4"
                            className="w-full bg-transparent text-sm focus:outline-none"
                            value={item.description}
                            onChange={(e) => updateItem(idx, 'description', e.target.value)}
                          />
                        </div>
                        <div className="col-span-2">
                          <input 
                            type="number"
                            className="w-full bg-transparent text-sm focus:outline-none"
                            value={item.qty}
                            onChange={(e) => updateItem(idx, 'qty', parseInt(e.target.value) || 0)}
                          />
                        </div>
                        {!isQR && (
                          <>
                            <div className="col-span-2">
                              <input 
                                type="number"
                                className="w-full bg-transparent text-sm focus:outline-none"
                                value={item.unitCost}
                                onChange={(e) => updateItem(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                              />
                            </div>
                            <div className="col-span-2 flex items-center justify-end gap-3 pr-6">
                              <span className="text-sm font-mono font-medium">${item.totalCost.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                        
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            type="button" 
                            onClick={() => removeItem(idx)}
                            className="p-1.5 text-gray-300 hover:text-red-500 transition-all rounded-full hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4 pt-8 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <label className="input-label flex items-center gap-2">
                    <Paperclip className="w-4 h-4" /> 
                    Attachments <span className="text-[10px] text-gray-400 font-normal">(Max 2MB each)</span>
                  </label>
                  <button 
                    type="button" 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded-sm"
                  >
                    <Plus className="w-3 h-3" /> Add Files
                  </button>
                </div>
                
                <input 
                  type="file"
                  className="hidden"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <AnimatePresence>
                    {attachments.map((file, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-sm relative group"
                      >
                        <div className="w-8 h-8 rounded-sm bg-white border border-gray-200 flex items-center justify-center shrink-0">
                          {file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-gray-700 truncate">{file.name}</p>
                          <p className="text-[9px] text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <button 
                          type="button" 
                          onClick={() => removeAttachment(idx)}
                          className="p-1 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {attachments.length === 0 && (
                    <div className="col-span-full py-8 border-2 border-dashed border-gray-100 rounded-sm flex flex-col items-center justify-center gap-2">
                      <Paperclip className="w-6 h-6 text-gray-200" />
                      <p className="text-[10px] uppercase font-bold text-gray-300 tracking-widest">No files attached</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 pt-8 border-t border-gray-100">
                <label className="input-label">Notes (Optional)</label>
                <textarea 
                  placeholder="Additional context, justification, or special instructions..."
                  className="w-full px-4 py-3 rounded-sm border border-gray-200 focus:border-black focus:ring-0 text-sm transition-all bg-gray-50/30 min-h-[100px] resize-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="w-full md:w-80 bg-gray-50/50 p-6 space-y-6 overflow-y-auto border-l border-gray-100">
              <div className="space-y-4">
                <label className="input-label">Currency</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.values(Currency).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCurrency(c)}
                      className={`text-center px-2 py-2 rounded-sm border transition-all text-[11px] font-bold ${
                        currency === c 
                          ? 'border-black bg-black text-white' 
                          : 'border-gray-200 hover:border-black bg-white text-gray-600'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="input-label">Requisition Type</label>
                <div className="space-y-1.5">
                  {Object.values(RequisitionType).map((t) => {
                    let isAllowed = true;
                    let restrictionMsg = '';

                    if (t === RequisitionType.PURCHASING || t === RequisitionType.PROJECTS) {
                      isAllowed = userDept === Department.PURCHASING;
                      restrictionMsg = 'Purchasing Dept Only';
                    } else if (t === RequisitionType.IT) {
                      isAllowed = userDept === Department.IT;
                      restrictionMsg = 'IT Dept Only';
                    }
                    
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={!isAllowed}
                        onClick={() => setType(t)}
                        className={`w-full text-left px-3 py-2.5 rounded-sm border transition-all flex items-center justify-between ${
                          type === t 
                            ? 'border-black bg-black text-white' 
                            : !isAllowed 
                              ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed opacity-50'
                              : 'border-gray-200 hover:border-black bg-white text-gray-600 font-medium'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold uppercase tracking-tight">
                            {t}
                          </span>
                          {!isAllowed && <span className="text-[9px] font-black text-red-400 mt-0.5">{restrictionMsg}</span>}
                        </div>
                        {type === t && <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200">
                <label className="input-label mb-4">Approval Workflow</label>
                <div className="space-y-3">
                  {(() => {
                    let workflow = [...REQUISITION_WORKFLOWS[type]];
                    
                    workflow = workflow.map(role => {
                      if (role === UserRole.HOD) {
                        if (userDept === Department.IT) return UserRole.IT_HOD;
                        if (userDept === Department.WAREHOUSE) return UserRole.WAREHOUSE_HOD;
                        return `HOD (${userDept})`;
                      }
                      return role;
                    });

                    return workflow.map((stage, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center text-[9px] font-mono shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <p className="text-[12px] text-gray-700 font-bold leading-tight">{stage}</p>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </form>
        )}

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
              {isPreview ? 'Submission Total' : `Estimated Total (${currency})`}
            </p>
            <p className="text-2xl font-mono font-bold">
              {currency === Currency.USD ? '$' : ''}{totalAmount.toFixed(2)} {currency !== Currency.USD ? currency : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isPreview ? (
              <>
                <button 
                  type="button" 
                  onClick={() => setIsPreview(false)} 
                  className="btn-secondary"
                >
                  Edit Requisition
                </button>
                <button 
                  onClick={() => handleSubmit()} 
                  disabled={isSubmitting}
                  className="btn-primary flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? 'Sending...' : initialData ? 'Update & Resubmit' : 'Confirm & Send'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={handleClose} disabled={isSubmitting} className="btn-secondary">Cancel</button>
                <button 
                  type="button"
                  onClick={handlePreview}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-sm text-sm font-bold flex items-center gap-2 transition-all active:scale-95"
                >
                  <Eye className="w-4 h-4" /> Preview
                </button>
                <button 
                  onClick={() => handleSubmit()} 
                  disabled={isSubmitting}
                  className="btn-primary flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? 'Submitting...' : initialData ? 'Update & Resubmit' : 'Submit Requisition'}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
