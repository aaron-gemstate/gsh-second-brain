/**
 * Payroll-tier operations: pay rate (wage items), W-4 withholding, direct deposit.
 *
 * QBO REST API v3 (standard tier) supports basic employee fields.
 * Full payroll operations (wage items, W-4, direct deposit) require the QBO Payroll
 * product to be active on the account AND the OAuth2 app to request the additional scope:
 *   com.intuit.quickbooks.payroll
 *
 * These functions are gated on QBO_PAYROLL_TIER_ENABLED=true.  When that env var is set,
 * the actual API calls are made; otherwise each function degrades gracefully via the
 * caller in index.ts (logs a warning, continues setup).
 *
 * API base for payroll-extended calls: same QBO REST base URL, minorversion 65+
 * Endpoints used once gated:
 *   - Employee PrimaryEarning (salary/hourly rate)     POST /v3/company/{realmId}/employee (update)
 *   - Employee FederalTaxDetails (W-4 filing status)   POST /v3/company/{realmId}/employee (update)
 *   - Employee BankAccount (direct deposit routing)    POST /v3/company/{realmId}/employee/{id}/bankaccounts
 */
import { QBOClient } from "./client";
import { OnboardingRecord, QBOEmployeeRef, QBOPayrollError } from "./types";

const PAYROLL_TIER_ENV = "QBO_PAYROLL_TIER_ENABLED";

function requirePayrollTier(step: string): void {
  if (process.env[PAYROLL_TIER_ENV] !== "true") {
    throw new QBOPayrollError(
      step,
      `QBO Payroll tier is not enabled. Set ${PAYROLL_TIER_ENV}=true after confirming ` +
        "Payroll API access with Intuit (Settings → Payroll in QBO). See GEM-129."
    );
  }
}

const PAY_PERIOD_MAP: Record<"salary" | "hourly", string> = {
  salary: "Annual",
  hourly: "Hourly",
};

/**
 * Set employee pay type and rate via QBO REST API Employee sparse update.
 * Uses PrimaryEarning with PayPeriod + Rate — available when QBO Payroll is active.
 * Returns updated employeeRef (SyncToken advances on each write).
 */
export async function setPayRate(
  client: QBOClient,
  employeeRef: QBOEmployeeRef,
  payType: "salary" | "hourly",
  payRate: number
): Promise<QBOEmployeeRef> {
  requirePayrollTier("pay-rate");

  const resp = await client.request<{ Employee: { Id: string; SyncToken: string } }>(
    {
      method: "POST",
      url: `/v3/company/${client.realmId}/employee`,
      params: { minorversion: 65, operation: "update" },
      headers: { "Content-Type": "application/json" },
      data: {
        Id: employeeRef.id,
        SyncToken: employeeRef.syncToken,
        sparse: true,
        PrimaryEarning: {
          PayPeriod: PAY_PERIOD_MAP[payType],
          Rate: payRate,
        },
      },
    },
    "pay-rate"
  );

  return { id: resp.Employee.Id, syncToken: resp.Employee.SyncToken };
}

const FILING_STATUS_MAP: Record<string, string> = {
  Single: "Single",
  MarriedFilingJointly: "Married",
  MarriedFilingSeparately: "MarriedFilingSeparately",
  HeadOfHousehold: "HeadOfHousehold",
};

/**
 * Set W-4 federal filing status and additional withholding via QBO Employee FederalTaxDetails.
 * Available when QBO Payroll is active on the account.
 * Returns updated employeeRef.
 */
export async function setFilingStatus(
  client: QBOClient,
  employeeRef: QBOEmployeeRef,
  filingStatus: string,
  additionalWithholding: number
): Promise<QBOEmployeeRef> {
  requirePayrollTier("filing-status");

  const resp = await client.request<{ Employee: { Id: string; SyncToken: string } }>(
    {
      method: "POST",
      url: `/v3/company/${client.realmId}/employee`,
      params: { minorversion: 65, operation: "update" },
      headers: { "Content-Type": "application/json" },
      data: {
        Id: employeeRef.id,
        SyncToken: employeeRef.syncToken,
        sparse: true,
        FederalTaxDetails: {
          FilingStatus: FILING_STATUS_MAP[filingStatus] ?? filingStatus,
          ExtraWithholdingAmount: additionalWithholding,
        },
      },
    },
    "filing-status"
  );

  return { id: resp.Employee.Id, syncToken: resp.Employee.SyncToken };
}

/**
 * Configure direct deposit bank account for an employee.
 * Bank info is transmitted to QBO and not persisted locally.
 * Returns true when QBO responds 200 (deposit record created/updated).
 *
 * SECURITY: bankInfo fields must never be logged; this function enforces that.
 * QBO masks account number in all subsequent GET responses.
 */
export async function setupDirectDeposit(
  client: QBOClient,
  employeeRef: QBOEmployeeRef,
  bankInfo: OnboardingRecord["bankInfo"]
): Promise<boolean> {
  requirePayrollTier("direct-deposit");

  await client.request<unknown>(
    {
      method: "POST",
      url: `/v3/company/${client.realmId}/employee/${employeeRef.id}/bankaccounts`,
      params: { minorversion: 65 },
      headers: { "Content-Type": "application/json" },
      data: {
        RoutingNumber: bankInfo.routingNumber,
        AccountNumber: bankInfo.accountNumber,
        AccountType: bankInfo.accountType,
        IsActive: true,
      },
    },
    "direct-deposit"
  );

  return true;
}
