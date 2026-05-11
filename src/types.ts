export enum RequisitionType {
  ADMIN = 'Admin',
  WAREHOUSE = 'Warehouse',
  PURCHASING = 'Purchasing',
  FUEL = 'Fuel',
  SHOP_USE = 'Shop Use',
  SHOP_QR = 'Shop QR',
  WAREHOUSE_QR = 'Warehouse QR',
  WORKSHOP = 'Workshop',
  QUOTATIONS = 'Quotations'
}

export enum UserRole {
  REQUESTER = 'Requester',
  HOD = 'Head of Department',
  PURCHASING_HOD = 'Purchasing HOD',
  FINANCE_HOD = 'Finance HOD',
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
  FUEL = 'Fuel'
}

export interface RequisitionItem {
  description: string;
  qty: number;
  unitCost: number;
  totalCost: number;
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
    UserRole.HOD, // Dept HOD first
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.ADMIN]: [
    UserRole.OPERATIONS_MANAGER,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.WAREHOUSE]: [
    UserRole.HOD,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FINANCE_HOD
  ],
  [RequisitionType.FUEL]: [
    UserRole.HOD,
    UserRole.FINANCE_HOD
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
    UserRole.HOD,
    UserRole.FINANCE_HOD,
    UserRole.DIRECTOR
  ],
  [RequisitionType.QUOTATIONS]: []
};

export const DEPARTMENTS = Object.values(Department);
export const ROLES = Object.values(UserRole);
