import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { Requisition } from '../types';

export const generateSummaryPDF = (requisitions: Requisition[], type: string) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape for more space
  const pageWidth = doc.internal.pageSize.width;

  // Header
  doc.setFontSize(20);
  doc.setTextColor(26, 26, 26);
  doc.text(`${type.toUpperCase()} REQUISITIONS SUMMARY REPORT`, pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated on: ${format(new Date(), 'PPP p')}`, pageWidth / 2, 28, { align: 'center' });
  doc.text(`Total Records: ${requisitions.length}`, pageWidth / 2, 33, { align: 'center' });

  const isQR = type === 'Shop QR' || type === 'Warehouse QR';

  // Items Table
  autoTable(doc, {
    startY: 40,
    head: [isQR ? ['REQ#', 'Date', 'Dept', 'Creator', 'Code', 'Description', 'Qty', 'Status'] : ['REQ#', 'Date', 'Dept', 'Creator', 'Items Summary', 'Total Amount', 'Status']],
    body: requisitions.map(req => {
      const date = req.createdAt ? (typeof req.createdAt === 'string' ? parseISO(req.createdAt) : (req.createdAt as any).toDate?.() || new Date(req.createdAt as any)) : new Date();
      if (isQR) {
        const firstItem = req.items[0] || { code: '-', description: '-', qty: 0 };
        return [
          req.requisitionNumber,
          format(date, 'yyyy-MM-dd'),
          req.department,
          req.creatorName,
          firstItem.code || 'N/A',
          firstItem.description,
          firstItem.qty,
          req.status.toUpperCase()
        ];
      }
      return [
        req.requisitionNumber,
        format(date, 'yyyy-MM-dd'),
        req.department,
        req.creatorName,
        req.items.map(item => `${item.qty}x ${item.description}`).join('\n'),
        `${req.currency === 'USD' || !req.currency ? '$' : ''}${req.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}${req.currency && req.currency !== 'USD' ? ` ${req.currency}` : ''}`,
        req.status.toUpperCase()
      ];
    }),
    theme: 'grid',
    headStyles: { fillColor: [26, 26, 26], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
    columnStyles: isQR ? {
      4: { fontStyle: 'bold' },
    } : {
      4: { cellWidth: 80 }, // Items summary column
      5: { halign: 'right' } // Amount column
    },
    didParseCell: (data) => {
      const statusIndex = isQR ? 7 : 6;
      if (data.section === 'body' && data.column.index === statusIndex) {
        if (data.cell.raw === 'PROCESSED') {
          data.cell.styles.textColor = [0, 128, 0];
        }
      }
    }
  });

  if (!isQR) {
    const totalsByCurrency: Record<string, number> = {};
    requisitions.forEach(req => {
      const c = req.currency || 'USD';
      totalsByCurrency[c] = (totalsByCurrency[c] || 0) + req.totalAmount;
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont('', 'bold');
    
    let currentY = finalY;
    doc.text('TOTAL EXPENDITURE BY CURRENCY:', pageWidth - 14, currentY, { align: 'right' });
    
    currentY += 5;
    Object.entries(totalsByCurrency).forEach(([cur, sum]) => {
      const text = `${cur === 'USD' ? '$' : ''}${sum.toLocaleString(undefined, { minimumFractionDigits: 2 })}${cur !== 'USD' ? ` ${cur}` : ''}`;
      doc.text(`${cur}: ${text}`, pageWidth - 14, currentY, { align: 'right' });
      currentY += 5;
    });
  }

  doc.save(`${type}_Summary_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
};
