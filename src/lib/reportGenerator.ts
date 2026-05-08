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

  // Items Table
  autoTable(doc, {
    startY: 40,
    head: [['REQ#', 'Date', 'Dept', 'Creator', 'Items Summary', 'Total Amount', 'Status']],
    body: requisitions.map(req => {
      const date = req.createdAt ? (typeof req.createdAt === 'string' ? parseISO(req.createdAt) : (req.createdAt as any).toDate?.() || new Date(req.createdAt as any)) : new Date();
      return [
        req.requisitionNumber,
        format(date, 'yyyy-MM-dd'),
        req.department,
        req.creatorName,
        req.items.map(item => `${item.qty}x ${item.description}`).join('\n'),
        `$${req.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        req.status.toUpperCase()
      ];
    }),
    theme: 'grid',
    headStyles: { fillColor: [26, 26, 26], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
    columnStyles: {
      4: { cellWidth: 80 }, // Items summary column
      5: { halign: 'right' } // Amount column
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        if (data.cell.raw === 'PROCESSED') {
          data.cell.styles.textColor = [0, 128, 0];
        }
      }
    }
  });

  const totalSum = requisitions.reduce((sum, req) => sum + req.totalAmount, 0);
  const finalY = (doc as any).lastAutoTable.finalY + 10;

  doc.setFontSize(12);
  doc.setFont('', 'bold');
  doc.text(`TOTAL EXPENDITURE: $${totalSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, pageWidth - 14, finalY, { align: 'right' });

  doc.save(`${type}_Summary_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
};
