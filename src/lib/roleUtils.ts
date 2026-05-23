import { UserProfile, UserRole, Department } from '../types';

export const checkRoleMatch = (userProfile: UserProfile, targetRole: string, reqDept: Department | string) => {
  if (userProfile.username === 'admin' || userProfile.username === 'admin1') return true;
  
  // Explicit match
  if (userProfile.role === targetRole) return true;

  // Backward compatibility for old requisitions created before recent role changes
  if (targetRole === 'Accounting HOD' && userProfile.role === UserRole.FINANCE_HOD) return true;
  if (targetRole === 'Shop Supervisor' && userProfile.role === UserRole.SHOP_MANAGER) return true;

  // Resolving generic HOD to department-specific HOD and vice-versa
  if (targetRole === UserRole.HOD) {
    if (reqDept === Department.IT && userProfile.role === UserRole.IT_HOD) return true;
    if (reqDept === Department.WAREHOUSE && userProfile.role === UserRole.WAREHOUSE_HOD) return true;
    if (reqDept === Department.PURCHASING && userProfile.role === UserRole.PURCHASING_HOD) return true;
    if (reqDept === Department.SHOP && userProfile.role === UserRole.SHOP_HOD) return true;
    return userProfile.role === UserRole.HOD && userProfile.department === reqDept;
  }

  if (targetRole === UserRole.IT_HOD) {
    if (userProfile.role === UserRole.HOD && userProfile.department === Department.IT) return true;
  }

  if (targetRole === UserRole.WAREHOUSE_HOD) {
    if (userProfile.role === UserRole.HOD && userProfile.department === Department.WAREHOUSE) return true;
  }

  if (targetRole === UserRole.PURCHASING_HOD) {
    if (userProfile.role === UserRole.HOD && userProfile.department === Department.PURCHASING) return true;
  }

  if (targetRole === UserRole.SHOP_HOD) {
    if (userProfile.role === UserRole.HOD && userProfile.department === Department.SHOP) return true;
  }

  return false;
};
