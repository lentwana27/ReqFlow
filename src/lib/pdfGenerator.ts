import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { Requisition} from '../types';
import QRCode from 'qrcode';
import { getPublicOrigin } from './urls';
import { brandingService } from '../services/api';

export const generateRequisitionPDF = async (requisition: Requisition) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;

  const headerY = 20;
  let textStartY = 15;
  const isQuotation = requisition.type === 'Quotations';

  // Logo Support: The user can upload logo.png or save to Firestore
  try {
    const loadImg = (url: string): Promise<HTMLImageElement | null> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    };

    // Try Firestore first for persistence, fallback to local logo.png
    const dbLogo = await brandingService.getLogo();
    const logoSource = dbLogo || '/logo.png';
    
    const logo = await loadImg(logoSource);
    if (logo) {
      const aspect = logo.width / logo.height;
      const width = 60;
      const height = width / aspect;
      doc.addImage(logo, 'PNG', 14, 8, width, height);
      textStartY = Math.max(textStartY, height + 15);
    }
  } catch (e) {
    console.log('No logo found');
  }

  if (isQuotation) {
    doc.setFontSize(22);
    doc.setTextColor(0, 51, 102);
    doc.setFont('', 'bold');
    doc.text('QUOTATION', pageWidth - 14, 20, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.setFont('', 'normal');
    doc.text('Address: 15 Unit Plumtree Road', pageWidth - 14, 28, { align: 'right' });
    doc.text('Contact: 0712290046', pageWidth - 14, 33, { align: 'right' });
    doc.text('Email: sales@mineazy.co.zw', pageWidth - 14, 38, { align: 'right' });
    textStartY = Math.max(textStartY, 45);
  } else {
    doc.setFontSize(18);
    doc.setTextColor(100, 100, 100);
    doc.setFont('', 'bold');
    doc.text('INTERNAL REQUISITION', pageWidth - 14, 20, { align: 'right' });
    doc.setFontSize(10);
    doc.text(`Type: ${requisition.type.toUpperCase()}`, pageWidth - 14, 26, { align: 'right' });
    textStartY = Math.max(textStartY, 35);
  }

  // Divider
  doc.setDrawColor(230, 230, 230);
  doc.line(14, textStartY, pageWidth - 14, textStartY);

  // Info Section
  doc.setFontSize(10);
  doc.setTextColor(26, 26, 26);

  if (isQuotation) {
    // STRICTOR INFO FOR QUOTATIONS
    doc.setFont('', 'bold');
    doc.text('Quotation Number:', 14, textStartY + 10);
    doc.setFont('', 'normal');
    doc.text(requisition.requisitionNumber, 55, textStartY + 10);

    doc.setFont('', 'bold');
    doc.text('Customer Name:', 14, textStartY + 17);
    doc.setFont('', 'normal');
    doc.text(requisition.writtenTo || 'N/A', 55, textStartY + 17);

    if (requisition.customerNumber) {
      doc.setFont('', 'bold');
      doc.text('Customer Number:', 14, textStartY + 24);
      doc.setFont('', 'normal');
      doc.text(requisition.customerNumber, 55, textStartY + 24);
    }

    doc.setFont('', 'bold');
    doc.text('Prepared By:', 14, textStartY + 31);
    doc.setFont('', 'normal');
    doc.text(requisition.creatorName, 55, textStartY + 31);

    doc.setFont('', 'bold');
    doc.text('Date:', pageWidth - 80, textStartY + 10);
    doc.setFont('', 'normal');
    const createdDate = requisition.createdAt ? (typeof requisition.createdAt === 'string' ? parseISO(requisition.createdAt) : (requisition.createdAt as any).toDate?.() || new Date(requisition.createdAt as any)) : new Date();
    doc.text(format(createdDate, 'PPP'), pageWidth - 60, textStartY + 10);
  } else {
    // STANDARD INTERNAL REQUISITION INFO
    doc.setFont('', 'bold');
    doc.text('Requisition Number:', 14, textStartY + 10);
    doc.setFont('', 'normal');
    doc.text(requisition.requisitionNumber, 55, textStartY + 10);

    doc.setFont('', 'bold');
    doc.text('Requisition Type:', 14, textStartY + 17);
    doc.setFont('', 'normal');
    doc.text(requisition.type || 'N/A', 55, textStartY + 17);

    doc.setFont('', 'bold');
    doc.text('Department:', 14, textStartY + 24);
    doc.setFont('', 'normal');
    doc.text(requisition.department, 55, textStartY + 24);

    doc.setFont('', 'bold');
    doc.text('Requested By:', 14, textStartY + 31);
    doc.setFont('', 'normal');
    doc.text(requisition.creatorName, 55, textStartY + 31);

    const isInternalInternal = requisition.type === 'Warehouse' || requisition.type === 'Shop Use' || requisition.type === 'Shop QR' || requisition.type === 'Warehouse QR';

    if (!isInternalInternal) {
      doc.setFont('', 'bold');
      doc.text('Written To:', 14, textStartY + 38);
      doc.setFont('', 'normal');
      doc.text(requisition.writtenTo || 'N/A', 55, textStartY + 38);
    }

    doc.setFont('', 'bold');
    doc.text('Date Created:', pageWidth - 80, textStartY + 10);
    doc.setFont('', 'normal');
    const createdDate = requisition.createdAt ? (typeof requisition.createdAt === 'string' ? parseISO(requisition.createdAt) : (requisition.createdAt as any).toDate?.() || new Date(requisition.createdAt as any)) : new Date();
    doc.text(format(createdDate, 'PPP p'), pageWidth - 45, textStartY + 10);

    doc.setFont('', 'bold');
    doc.text('Status:', pageWidth - 80, textStartY + 17);
    doc.setFont('', 'normal');
    doc.text(requisition.status.toUpperCase(), pageWidth - 45, textStartY + 17);

    if (requisition.processedNumber) {
      doc.setFont('', 'bold');
      doc.text('Processed No:', pageWidth - 80, textStartY + 24);
      doc.setFont('', 'normal');
      doc.text(requisition.processedNumber, pageWidth - 45, textStartY + 24);
    }
  }

  // Adjusted Y positions for rest of elements
  const detailsEndY = textStartY + 45;

  // Rejection Reason if it exists
  if (requisition.status === 'rejected' && requisition.rejectionReason) {
    doc.setFont('', 'bold');
    doc.setTextColor(200, 0, 0);
    doc.text('REJECTION REASON:', 14, detailsEndY + 7);
    doc.setFont('', 'normal');
    doc.setFontSize(9);
    const splitReason = doc.splitTextToSize(requisition.rejectionReason, pageWidth - 65);
    doc.text(splitReason, 55, detailsEndY + 7);
    doc.setFontSize(10);
    doc.setTextColor(26, 26, 26);
  }

  // Notes if they exist
  if (requisition.notes) {
    const notesY = (requisition.status === 'rejected' && requisition.rejectionReason) ? detailsEndY + 14 : detailsEndY + 7;
    doc.setFont('', 'bold');
    doc.text('Notes:', 14, notesY);
    doc.setFont('', 'normal');
    doc.setFontSize(9);
    const splitNotes = doc.splitTextToSize(requisition.notes, pageWidth - 65);
    doc.text(splitNotes, 55, notesY);
    doc.setFontSize(10);
  }


  const isQR = requisition.type === 'Shop QR' || requisition.type === 'Warehouse QR';
  const hasCodeColumn = requisition.type === 'Warehouse' || requisition.type === 'Shop Use' || isQR || requisition.type === 'Quotations';
  const hasPricingColumns = !isQR && requisition.type !== 'Fuel';
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
      hasCodeColumn && hasPricingColumns
        ? ['Code', 'Description', 'Quantity', 'Price', 'Total']
        : isQR 
          ? ['Code', 'Description', 'Quantity'] 
          : isFuel 
            ? ['Description', 'Litres', 'Type'] 
            : ['Description', 'Quantity', 'Unit Cost', 'Total Cost']
    ],
    body: requisition.items.map(item => {
      if (hasCodeColumn && hasPricingColumns) {
        return [
          item.code || '-',
          item.description,
          item.qty,
          `${symbol}${item.unitCost.toFixed(2)}${suffix}`,
          `${symbol}${item.totalCost.toFixed(2)}${suffix}`
        ];
      } else if (isQR) {
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
    foot: !hasPricingColumns ? undefined : [[
      '', 
      '', 
      hasCodeColumn ? '' : undefined, 
      'TOTAL AMOUNT', 
      `${symbol}${requisition.totalAmount.toFixed(2)}${suffix}`
    ].filter(v => v !== undefined)],
    footStyles: { fillColor: [245, 245, 245], textColor: [26, 26, 26], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4 },
  });

  // Approval History & Signatures (ONLY for Internal Requisitions)
  if (!isQuotation) {
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

      if (requisition.amountIssued !== undefined && requisition.amountIssued !== null) {
        doc.setFont('', 'bold');
        doc.text('Amount Issued:', 14, nextY + 25);
        doc.setFont('', 'normal');
        doc.text(`${symbol}${requisition.amountIssued.toFixed(2)}${suffix}`, 45, nextY + 25);
      }

      if (requisition.returnStatus === 'confirmed') {
        doc.setFont('', 'bold');
        doc.setTextColor(0, 100, 0);
        doc.text('Amount Returned:', 14, nextY + 31);
        doc.setFont('', 'normal');
        doc.text(`${symbol}${requisition.amountToReturn?.toFixed(2)}${suffix}`, 45, nextY + 31);
      } else if (requisition.changeReturned && requisition.changeReturned > 0) {
        doc.setFont('', 'bold');
        doc.setTextColor(150, 100, 0);
        doc.text('Change Due:', 14, nextY + 31);
        doc.setFont('', 'normal');
        doc.text(`${symbol}${requisition.changeReturned.toFixed(2)}${suffix}`, 45, nextY + 31);
      }

      // QR Code for Issuance
      const verifyUrl = `${getPublicOrigin()}/?verify=${requisition.issuedInfo.signatureId}&reqId=${requisition.id}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 100 });
      doc.addImage(qrDataUrl, 'PNG', pageWidth - 45, nextY + 2, 25, 25);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text('Scan to verify disbursement', pageWidth - 32.5, nextY + 29, { align: 'center' });
    }
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
