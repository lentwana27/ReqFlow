export enum RequisitionType {
  ADMIN = 'Admin',
  WAREHOUSE = 'Warehouse',
  PURCHASING = 'Purchasing',
  SHOP_USE = 'Shop Use',
  SHOP_QR = 'Shop QR',
  WAREHOUSE_QR = 'Warehouse QR',
  WORKSHOP = 'Workshop',
  PROJECTS = 'Projects',
  AFTER_SALES = 'After Sales',
  OPERATIONS = 'Operations',
  IT = 'IT',
  CAR_MAINTENANCE = 'Car Maintenance',
  QUOTATIONS = 'Quotations',
  FINANCE = 'Finance Requisition',
  MARKETING = 'Marketing',
  CASH = 'Cash Requisition'
}

export enum UserRole {
  REQUESTER = 'Requester',
  HOD = 'Head of Department',
  PURCHASING_HOD = 'Purchasing HOD',
  FINANCE_HOD = 'Finance HOD',
  OPERATIONS_MANAGER = 'Operations Manager',
  DIRECTOR = 'Director',
  DIRECTOR_2 = 'Director 2',
  ADMIN = 'System Administrator',
  SHOP_SUPERVISOR = 'Shop Supervisor',
  SHOP_MANAGER = 'Shop Manager',
  SHOP_HOD = 'Shop Head of Department',
  IT_HOD = 'IT HOD',
  WAREHOUSE_HOD = 'Warehouse HOD',
  TREASURER = 'Treasurer'
}

export enum Department {
  IT = 'IT',
  PURCHASING = 'Purchasing',
  ACCOUNTING = 'Accounting',
  GENERAL = 'General',
  OPERATIONS = 'Operations',
  WAREHOUSE = 'Warehouse',
  SHOP = 'Shop',
  WORKSHOP = 'Workshop',
  SECURITY = 'Security',
  DRIVER = 'Driver',
  AUDIT = 'Audit',
  FINANCE = 'Finance',
  ADMINISTRATION = 'Administration',
  MARKETING = 'Marketing'
}

export interface RequisitionItem {
  description: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  code?: string;
  fuelType?: 'Diesel' | 'Petrol';
}

export interface Approval {
  role: string;
  approverId?: string;
  approverName?: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp?: any;
  comment?: string;
  signatureId?: string;
}

export interface IssuedInfo {
  userId: string;
  userName: string;
  timestamp: any;
  signatureId: string;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  url: string; // Base64 or URL
}

export enum Currency {
  USD = 'USD',
  ZM = 'ZM',
  P = 'P',
  ZAR = 'ZAR',
  ZWG = 'ZWG'
}

export interface Requisition {
  id: string;
  requisitionNumber: string;
  sequenceNumber: string;
  processedNumber?: string;
  type: RequisitionType;
  creatorId: string;
  creatorName: string;
  department: Department;
  items: RequisitionItem[];
  writtenTo: string;
  customerNumber?: string;
  quotationBook: string;
  currency?: Currency;
  totalAmount: number;
  status: 'pending' | 'approved' | 'rejected' | 'processed' | 'completed';
  currentStage: number;
  involvedRoles: string[];
  approvals: Approval[];
  issuedInfo?: IssuedInfo;
  attachments?: Attachment[];
  notes?: string;
  rejectionReason?: string;
  amountIssued?: number;
  changeReturned?: number;
  amountToReturn?: number;
  returnStatus?: 'none' | 'pending' | 'confirmed';
  returnType?: 'funds' | 'change';
  createdAt: any;
  updatedAt: any;
}

export interface UserProfile {
  uid: string;
  email?: string;
  username?: string;
  name: string;
  role: UserRole;
  department: Department;
  status: 'pending' | 'approved';
  isVerified: boolean;
  resetCode?: string;
  createdAt: any;
}

export interface ActivityLog {
  id: string;
  timestamp: any;
  user: string;
  username: string;
  action: string;
  module: string;
  target?: string;
  details?: string;
  requisitionId?: string;
  userId?: string;
}

// Workflow definitions based on specific department types
export const REQUISITION_WORKFLOWS: Record<RequisitionType, string[]> = {
  [RequisitionType.PURCHASING]: [
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.ADMIN]: [
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.WAREHOUSE]: [
    UserRole.WAREHOUSE_HOD,
    UserRole.PURCHASING_HOD,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FINANCE_HOD
  ],
  [RequisitionType.SHOP_USE]: [
    UserRole.SHOP_MANAGER,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FINANCE_HOD
  ],
  [RequisitionType.SHOP_QR]: [
    UserRole.SHOP_SUPERVISOR,
    UserRole.IT_HOD
  ],
  [RequisitionType.WAREHOUSE_QR]: [
    UserRole.WAREHOUSE_HOD,
    UserRole.IT_HOD
  ],
  [RequisitionType.WORKSHOP]: [
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.PROJECTS]: [
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.AFTER_SALES]: [
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.OPERATIONS]: [
    UserRole.OPERATIONS_MANAGER,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.IT]: [
    UserRole.IT_HOD,
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.CAR_MAINTENANCE]: [
    UserRole.DIRECTOR,
    UserRole.FINANCE_HOD
  ],
  [RequisitionType.FINANCE]: [
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR_2,
    UserRole.DIRECTOR
  ],
  [RequisitionType.MARKETING]: [
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.QUOTATIONS]: [],
  [RequisitionType.CASH]: [
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ]
};

export const DEPARTMENTS = Object.values(Department);
export const ROLES = Object.values(UserRole);
