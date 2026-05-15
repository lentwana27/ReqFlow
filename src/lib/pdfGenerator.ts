import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { Requisition } from '../types';
import QRCode from 'qrcode';
import { getPublicOrigin } from './urls';

export const generateRequisitionPDF = async (requisition: Requisition) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;

  // Header
  doc.setFontSize(22);
  doc.setTextColor(26, 26, 26);
  doc.text('INTERNAL REQUISITION', pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const typeLabel = requisition.type === 'Quotations' ? requisition.type.toUpperCase() : `${requisition.type.toUpperCase()} REQUISITION`;
  doc.text(typeLabel, pageWidth / 2, 28, { align: 'center' });

  // Divider
  doc.setDrawColor(230, 230, 230);
  doc.line(14, 35, pageWidth - 14, 35);

  // Info Section
  doc.setFontSize(10);
  doc.setTextColor(26, 26, 26);
  doc.setFont('', 'bold');
  doc.text('Requisition Number:', 14, 45);
  doc.setFont('', 'normal');
  doc.text(requisition.requisitionNumber, 55, 45);

  doc.setFont('', 'bold');
  doc.text('Sequence Number:', 14, 52);
  doc.setFont('', 'normal');
  doc.text(requisition.sequenceNumber || 'N/A', 55, 52);

  doc.setFont('', 'bold');
  doc.text('Department:', 14, 59);
  doc.setFont('', 'normal');
  doc.text(requisition.department, 55, 59);

  doc.setFont('', 'bold');
  doc.text('Requested By:', 14, 66);
  doc.setFont('', 'normal');
  doc.text(requisition.creatorName, 55, 66);

  doc.setFont('', 'bold');
  doc.text('Written To:', 14, 73);
  doc.setFont('', 'normal');
  doc.text(requisition.writtenTo || 'N/A', 55, 73);

  doc.setFont('', 'bold');
  doc.text('Date Created:', pageWidth - 80, 45);
  doc.setFont('', 'normal');
  
  const createdDate = requisition.createdAt ? (typeof requisition.createdAt === 'string' ? parseISO(requisition.createdAt) : (requisition.createdAt as any).toDate?.() || new Date(requisition.createdAt as any)) : new Date();
  doc.text(format(createdDate, 'PPP p'), pageWidth - 45, 45);

  doc.setFont('', 'bold');
  doc.text('Status:', pageWidth - 80, 52);
  doc.setFont('', 'normal');
  doc.text(requisition.status.toUpperCase(), pageWidth - 45, 52);

  // Rejection Reason if it exists
  if (requisition.status === 'rejected' && requisition.rejectionReason) {
    doc.setFont('', 'bold');
    doc.setTextColor(200, 0, 0);
    doc.text('REJECTION REASON:', 14, 80);
    doc.setFont('', 'normal');
    doc.setFontSize(9);
    const splitReason = doc.splitTextToSize(requisition.rejectionReason, pageWidth - 65);
    doc.text(splitReason, 55, 80);
    doc.setFontSize(10);
    doc.setTextColor(26, 26, 26);
  }

  // Notes if they exist
  if (requisition.notes) {
    const notesY = (requisition.status === 'rejected' && requisition.rejectionReason) ? 87 : 80;
    doc.setFont('', 'bold');
    doc.text('Notes:', 14, notesY);
    doc.setFont('', 'normal');
    doc.setFontSize(9);
    const splitNotes = doc.splitTextToSize(requisition.notes, pageWidth - 65);
    doc.text(splitNotes, 55, notesY);
    doc.setFontSize(10);
  }

  const isQR = requisition.type === 'Shop QR' || requisition.type === 'Warehouse QR';
  const isFuel = requisition.type === 'Fuel';
  const currency = requisition.currency || 'USD';
  const symbol = currency === 'USD' ? '$' : '';
  const suffix = currency !== 'USD' ? ` ${currency}` : '';

  // Calculate table start Y dynamically
  let tableStartY = 95;
  if (requisition.notes) {
    const notesY = (requisition.status === 'rejected' && requisition.rejectionReason) ? 87 : 80;
    const splitNotes = doc.splitTextToSize(requisition.notes, pageWidth - 65);
    tableStartY = notesY + (splitNotes.length * 5) + 5;
  } else if (requisition.status === 'rejected' && requisition.rejectionReason) {
    const splitReason = doc.splitTextToSize(requisition.rejectionReason, pageWidth - 65);
    tableStartY = 80 + (splitReason.length * 5) + 5;
  }
  
  if (tableStartY < 95) tableStartY = 95;

  // Items Table
  autoTable(doc, {
    startY: tableStartY,
    head: [
      isQR 
        ? ['Code', 'Description', 'Quantity'] 
        : isFuel 
          ? ['Description', 'Litres', 'Type'] 
          : ['Description', 'Quantity', 'Unit Cost', 'Total Cost']
    ],
    body: requisition.items.map(item => {
      if (isQR) {
        return [item.code || 'N/A', item.description, item.qty];
      } else if (isFuel) {
        return [item.description, `${item.qty} L`, item.fuelType || 'Diesel'];
      } else {
        return [
          item.description,
          item.qty,
          `${symbol}${item.unitCost.toFixed(2)}${suffix}`,
          `${symbol}${item.totalCost.toFixed(2)}${suffix}`
        ];
      }
    }),
    theme: 'striped',
    headStyles: { fillColor: [26, 26, 26], textColor: [255, 255, 255], fontStyle: 'bold' },
    foot: (isQR || isFuel) ? undefined : [['', '', 'TOTAL AMOUNT', `${symbol}${requisition.totalAmount.toFixed(2)}${suffix}`]],
    footStyles: { fillColor: [245, 245, 245], textColor: [26, 26, 26], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4 },
  });

  // Approval History
  const finalY = (doc as any).lastAutoTable.finalY + 15;
  doc.setFontSize(12);
  doc.setFont('', 'bold');
  doc.text('Approval Workflow History', 14, finalY);

  // Pre-generate QR codes for approvals
  const approvalWithQR = await Promise.all(requisition.approvals.map(async (approval) => {
    let qrDataUrl = '';
    if (approval.signatureId) {
      const verifyUrl = `${getPublicOrigin()}/?verify=${approval.signatureId}&reqId=${requisition.id}`;
      qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 100 });
    }
    return { ...approval, qrDataUrl };
  }));

  autoTable(doc, {
    startY: finalY + 5,
    head: [['Role', 'Status', 'Approver', 'Date', 'Signature ID', 'Verification QR']],
    body: approvalWithQR.map(approval => [
      approval.role,
      approval.status.toUpperCase(),
      approval.approverName || (approval.status === 'pending' ? 'WAITING' : 'N/A'),
      approval.timestamp ? format(new Date(approval.timestamp), 'MMM dd, yyyy HH:mm') : '-',
      approval.signatureId || '',
      '' // Placeholder for QR code
    ]),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
    headStyles: { fillColor: [240, 240, 240], textColor: [26, 26, 26], fontStyle: 'bold' },
    columnStyles: {
      5: { cellWidth: 20, minCellHeight: 20 } // QR code column
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const qr = approvalWithQR[data.row.index].qrDataUrl;
        if (qr) {
          doc.addImage(qr, 'PNG', data.cell.x + 2, data.cell.y + 2, 16, 16);
        }
      }
    },
  });
  
  // Disbursement Section (if exists)
  if (requisition.status === 'processed' && requisition.issuedInfo) {
    const nextY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setTextColor(0, 50, 150);
    doc.setFont('', 'bold');
    doc.text('DISBURSEMENT / ISSUANCE DETAILS', 14, nextY);
    
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    doc.setFont('', 'normal');
    
    const issuedDate = typeof requisition.issuedInfo.timestamp === 'string' ? parseISO(requisition.issuedInfo.timestamp) : new Date(requisition.issuedInfo.timestamp);
    
    doc.setFont('', 'bold');
    doc.text('Issued By:', 14, nextY + 7);
    doc.setFont('', 'normal');
    doc.text(requisition.issuedInfo.userName, 45, nextY + 7);
    
    doc.setFont('', 'bold');
    doc.text('Issue Date:', 14, nextY + 13);
    doc.setFont('', 'normal');
    doc.text(format(issuedDate, 'PPP p'), 45, nextY + 13);
    
    doc.setFont('', 'bold');
    doc.text('Signature ID:', 14, nextY + 19);
    doc.setFont('', 'normal');
    doc.text(requisition.issuedInfo.signatureId, 45, nextY + 19);

    // QR Code for Issuance
    const verifyUrl = `${getPublicOrigin()}/?verify=${requisition.issuedInfo.signatureId}&reqId=${requisition.id}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 100 });
    doc.addImage(qrDataUrl, 'PNG', pageWidth - 45, nextY + 2, 25, 25);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('Scan to verify disbursement', pageWidth - 32.5, nextY + 29, { align: 'center' });
  }

  // Footer / Verification note
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `This is a digitally generated document. Reference ID: ${requisition.id}`,
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  );

  doc.save(`Requisition_${requisition.requisitionNumber}.pdf`);
};
