export enum RequisitionType {
  ADMIN = 'Admin',
  WAREHOUSE = 'Warehouse',
  PURCHASING = 'Purchasing',
  FUEL = 'Fuel',
  SHOP_USE = 'Shop Use',
  SHOP_QR = 'Shop QR',
  WAREHOUSE_QR = 'Warehouse QR',
  WORKSHOP = 'Workshop',
  PROJECTS = 'Projects',
  AFTER_SALES = 'After Sales',
  OPERATIONS = 'Operations',
  IT = 'IT',
  CAR_MAINTENANCE = 'Car Maintenance',
  QUOTATIONS = 'Quotations'
}

export enum UserRole {
  REQUESTER = 'Requester',
  HOD = 'Head of Department',
  PURCHASING_HOD = 'Purchasing HOD',
  FINANCE_HOD = 'Finance HOD',
  ACCOUNTING_HOD = 'Accounting HOD',
  OPERATIONS_MANAGER = 'Operations Manager',
  DIRECTOR = 'Director',
  ADMIN = 'System Administrator',
  SHOP_SUPERVISOR = 'Shop Supervisor',
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
  FUEL = 'Fuel',
  AUDIT = 'Audit'
}

export interface RequisitionItem {
  description: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  code?: string;
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

export interface Requisition {
  id: string;
  requisitionNumber: string;
  type: RequisitionType;
  creatorId: string;
  creatorName: string;
  department: Department;
  items: RequisitionItem[];
  writtenTo: string;
  quotationBook: string;
  totalAmount: number;
  status: 'pending' | 'approved' | 'rejected' | 'processed';
  currentStage: number;
  involvedRoles: string[];
  approvals: Approval[];
  issuedInfo?: IssuedInfo;
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
  [RequisitionType.FUEL]: [
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.SHOP_USE]: [
    UserRole.SHOP_SUPERVISOR,
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
    UserRole.ACCOUNTING_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.IT]: [
    UserRole.IT_HOD,
    UserRole.PURCHASING_HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.CAR_MAINTENANCE]: [
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.QUOTATIONS]: []
};

export const DEPARTMENTS = Object.values(Department);
export const ROLES = Object.values(UserRole);
