import { QBOClient, qboClientFromEnv } from "./client";
import { findOrCreateDepartment } from "./department";
import { findLaborAccount } from "./accounts";
import { activateEmployee, buildPayUpdate, createEmployee, updateEmployee } from "./employee";
import { setFilingStatus, setPayRate, setupDirectDeposit } from "./payroll";
import { EmployeeSetupResult, OnboardingRecord, QBOPayrollError } from "./types";

export { QBOPayrollError } from "./types";
export type { OnboardingRecord, EmployeeSetupResult } from "./types";

export class QBOPayrollIntegration {
  constructor(private readonly client: QBOClient) {}

  /** Full onboarding flow. Executes all 7 setup steps in order.
   *  Throws QBOPayrollError with step + message on any failure.
   *  Caller (orchestrator) should surface error.message back to the pipeline. */
  async setupEmployee(record: OnboardingRecord): Promise<EmployeeSetupResult> {
    // Step 1: Department lookup or auto-create
    const dept = await findOrCreateDepartment(this.client, record.department);

    // Step 2: COA template mapping (non-blocking — warn but continue if not found)
    const laborAccount = await findLaborAccount(this.client);
    if (!laborAccount.found) {
      console.warn(
        "[qbo-payroll] No labor expense account found for COA mapping. " +
          "Manual mapping may be required in QBO."
      );
    }

    // Step 3: Create employee (inactive until final activation)
    let employeeRef = await createEmployee(this.client, {
      record,
      departmentId: dept.id,
    });

    // Step 4: Set pay type + rate
    // Payroll tier path: PrimaryEarning via QBO Employee update (preferred)
    // Fallback: BillRate on base Employee (always available, informational only)
    try {
      employeeRef = await setPayRate(this.client, employeeRef, record.payType, record.payRate);
    } catch (err) {
      if (err instanceof QBOPayrollError && err.step === "pay-rate") {
        console.warn(`[qbo-payroll] ${err.message} — BillRate set on base Employee as fallback.`);
        employeeRef = await updateEmployee(
          this.client,
          employeeRef,
          buildPayUpdate(record.payType, record.payRate),
          "pay-rate-base"
        );
      } else {
        throw err;
      }
    }

    // Step 5: W-4 filing status (requires Payroll tier)
    try {
      employeeRef = await setFilingStatus(
        this.client,
        employeeRef,
        record.w4Data.filingStatus,
        record.w4Data.additionalWithholding
      );
    } catch (err) {
      if (err instanceof QBOPayrollError && err.step === "filing-status") {
        console.warn(`[qbo-payroll] ${err.message} — filing status must be set manually in QBO.`);
      } else {
        throw err;
      }
    }

    // Step 6: Direct deposit (requires Payroll tier)
    let directDepositConfigured = false;
    try {
      directDepositConfigured = await setupDirectDeposit(
        this.client,
        employeeRef,
        record.bankInfo
      );
    } catch (err) {
      if (err instanceof QBOPayrollError && err.step === "direct-deposit") {
        console.warn(`[qbo-payroll] ${err.message} — direct deposit must be set up manually.`);
      } else {
        throw err;
      }
    }

    // Step 7: Activate employee so they appear in next pay run
    await activateEmployee(this.client, employeeRef);

    return {
      qboEmployeeId: employeeRef.id,
      directDepositConfigured,
      departmentCreated: dept.created,
      departmentId: dept.id,
    };
  }
}

/** Convenience factory — reads config from environment variables.
 *  Required: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID
 *  Optional: QBO_ENVIRONMENT (default: production), QBO_PAYROLL_TIER_ENABLED */
export function createQBOPayrollIntegration(): QBOPayrollIntegration {
  return new QBOPayrollIntegration(qboClientFromEnv());
}
