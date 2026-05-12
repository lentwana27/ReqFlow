import React, { useState } from 'react';
import { Plus, Trash2, X, Loader2 } from 'lucide-react';
import { RequisitionType, RequisitionItem, Department, REQUISITION_WORKFLOWS, UserRole } from '../../types';
import { motion } from 'motion/react';

interface RequisitionFormProps {
  onClose: () => void;
  onSubmit: (data: any) => void;
  userDept: Department;
  userEmail: string;
}

export default function RequisitionForm({ onClose, onSubmit, userDept, userEmail }: RequisitionFormProps) {
  const [type, setType] = useState<RequisitionType>(RequisitionType.ADMIN);
  const [writtenTo, setWrittenTo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [items, setItems] = useState<RequisitionItem[]>([
    { description: '', qty: 1, unitCost: 0, totalCost: 0 }
  ]);

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

  const totalAmount = items.reduce((sum, item) => sum + item.totalCost, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate
    if (!writtenTo.trim()) {
      alert('The "WRITE TO" field is required.');
      return;
    }

    if (items.some(item => !item.description || item.qty <= 0)) {
      alert('Please fill in all item descriptions and quantities.');
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

      await onSubmit({
        type,
        writtenTo,
        quotationBook: '', // Keeping empty to avoid breaking types
        items,
        totalAmount,
        approvals: initialApprovals,
        status: isAutoApproved ? 'approved' : 'pending',
        currentStage: 0,
        department: userDept,
        requisitionNumber: `REQ-${Date.now().toString().slice(-6)}`
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-sm shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold tracking-tight">New Requisition</h2>
            <p className="text-xs text-gray-400 font-mono mt-1">DEPARTMENT: {userDept} | CREATOR: {userEmail}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="border-b border-gray-100 pb-8">
            <div className="space-y-4 max-w-xl">
              <label className="input-label">WRITE TO: (Destination of funds) <span className="text-red-500">*</span></label>
              <input 
                placeholder="Name of recipient or department receiving funds"
                className="w-full px-4 py-3 rounded-sm border border-gray-200 focus:border-black focus:ring-0 text-sm transition-all"
                value={writtenTo}
                onChange={(e) => setWrittenTo(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <label className="input-label">Requisition Type</label>
              <div className="grid grid-cols-1 gap-2">
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
                      className={`text-left px-4 py-3 rounded-sm border transition-all flex items-center justify-between ${
                        type === t 
                          ? 'border-black bg-black text-white shadow-md' 
                          : !isAllowed 
                            ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                            : 'border-gray-200 hover:border-black text-gray-600'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {t === RequisitionType.QUOTATIONS ? t : `${t} Requisition`}
                        </span>
                        {!isAllowed && <span className="text-[10px] uppercase font-bold text-red-400">{restrictionMsg}</span>}
                      </div>
                      {type === t && <div className="w-2 h-2 rounded-full bg-white animate-pulse" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-gray-50 p-6 rounded-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <label className="input-label mb-0">Approval Workflow</label>
              </div>
              <div className="space-y-3">
                {(() => {
                  let workflow = [...REQUISITION_WORKFLOWS[type]];
                  
                  // Resolve HOD to specific department role if needed
                  workflow = workflow.map(role => {
                    if (role === UserRole.HOD) {
                      if (userDept === Department.IT) return UserRole.IT_HOD;
                      if (userDept === Department.WAREHOUSE) return UserRole.WAREHOUSE_HOD;
                      return `HOD (${userDept})`;
                    }
                    return role;
                  });

                  return workflow.map((stage, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center text-[10px] font-mono shrink-0">
                        {idx + 1}
                      </div>
                      <p className="text-sm text-gray-700 font-medium">{stage}</p>
                    </div>
                  ));
                })()}
              </div>
              <p className="mt-6 text-[10px] text-gray-400 leading-relaxed italic">
                Note: Approvals will proceed sequentially through the stages listed above.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="input-label">Line Items</label>
              <button 
                type="button" 
                onClick={addItem}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600 hover:text-green-700"
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
                  <div key={idx} className="grid grid-cols-12 gap-4 items-center px-4 py-3 bg-gray-50/50 border border-transparent hover:border-gray-100 transition-colors rounded-sm group">
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
                        <div className="col-span-2 flex items-center justify-end gap-3">
                          <span className="text-sm font-mono font-medium">${item.totalCost.toFixed(2)}</span>
                          <button 
                            type="button" 
                            onClick={() => removeItem(idx)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                    {isQR && (
                      <div className="col-span-12 md:col-span-0 hidden group-hover:flex items-center justify-end absolute right-4 top-1/2 -translate-y-1/2">
                         <button 
                            type="button" 
                            onClick={() => removeItem(idx)}
                            className="p-1 text-gray-300 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                      </div>
                    )}
                    {/* Fallback for QR delete button position if above is too tricky */}
                    {isQR && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                         <button 
                            type="button" 
                            onClick={() => removeItem(idx)}
                            className="p-1 text-gray-300 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Estimated Total</p>
            <p className="text-2xl font-mono font-bold">${totalAmount.toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-secondary">Cancel</button>
            <button 
              onClick={handleSubmit} 
              disabled={isSubmitting}
              className="btn-primary flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Submitting...' : 'Submit Requisition'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
