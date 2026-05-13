export interface OnboardingRecord {
  firstName: string;
  lastName: string;
  email: string;
  /** Pre-encrypted SSN — never log or echo */
  ssn: string;
  /** ISO 8601 date, e.g. "2024-03-01" */
  startDate: string;
  department: string;
  payType: "salary" | "hourly";
  /** Annual amount for salary; hourly rate for hourly */
  payRate: number;
  w4Data: {
    filingStatus: "Single" | "MarriedFilingJointly" | "MarriedFilingSeparately" | "HeadOfHousehold";
    additionalWithholding: number;
  };
  bankInfo: {
    routingNumber: string;
    accountNumber: string;
    accountType: "Checking" | "Savings";
  };
}

export interface EmployeeSetupResult {
  qboEmployeeId: string;
  directDepositConfigured: boolean;
  /** True when a new department was created; false if it already existed */
  departmentCreated: boolean;
  departmentId: string;
}

export interface QBOEmployeeRef {
  id: string;
  syncToken: string;
}

export interface QBODepartmentRef {
  id: string;
  name: string;
  created: boolean;
}

export class QBOPayrollError extends Error {
  constructor(
    public readonly step: string,
    message: string,
    public readonly qboCode?: string,
  ) {
    super(`[qbo-payroll:${step}] ${message}`);
    this.name = "QBOPayrollError";
  }
}
