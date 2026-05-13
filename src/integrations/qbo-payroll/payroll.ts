/**
 * Payroll-tier operations: pay rate (wage items), W-4 withholding, direct deposit.
 *
 * These endpoints are part of the QBO Payroll API, which is a separate product tier
 * from the standard QBO REST API. All functions here will throw with a clear message
 * if QBO_PAYROLL_TIER_ENABLED is not set to "true" in env.
 *
 * Once Payroll tier access is confirmed (see GEM-129 open questions), these stubs
 * can be completed with the actual Intuit Payroll API endpoints.
 *
 * Intuit Payroll API base: https://payroll.api.intuit.com (requires separate OAuth scope)
 * Scope needed: com.intuit.quickbooks.payroll (add to QBO OAuth2 app settings)
 */
import { QBOClient } from "./client";
import { OnboardingRecord, QBOPayrollError } from "./types";

const PAYROLL_TIER_ENV = "QBO_PAYROLL_TIER_ENABLED";

function requirePayrollTier(step: string): void {
  if (process.env[PAYROLL_TIER_ENV] !== "true") {
    throw new QBOPayrollError(
      step,
      `QBO Payroll tier is not enabled. Set ${PAYROLL_TIER_ENV}=true after confirming ` +
        "Payroll API access with Intuit. See GEM-129 open questions."
    );
  }
}

/** Set pay type and rate via QBO Payroll wage item API.
 *  Requires Payroll tier. Stubs the implementation pending tier confirmation. */
export async function setPayRate(
  client: QBOClient,
  employeeId: string,
  payType: "salary" | "hourly",
  payRate: number
): Promise<void> {
  requirePayrollTier("pay-rate");

  // TODO: implement when Payroll tier is confirmed
  // POST /v2/company/{realmId}/employees/{employeeId}/payrates
  // Body: { WageType: payType === "salary" ? "Salary" : "Hourly", WagePayPeriod: "Annual"|"Hourly", Rate: payRate }
  throw new QBOPayrollError("pay-rate", "Not yet implemented — awaiting Payroll tier confirmation");
}

/** Configure W-4 withholding via QBO Payroll employee tax settings.
 *  Requires Payroll tier. Stubs the implementation pending tier confirmation. */
export async function setFilingStatus(
  client: QBOClient,
  employeeId: string,
  filingStatus: string,
  additionalWithholding: number
): Promise<void> {
  requirePayrollTier("filing-status");

  // TODO: implement when Payroll tier is confirmed
  // POST /v2/company/{realmId}/employees/{employeeId}/taxinfo
  // Body: { FederalFilingStatus: filingStatus, AdditionalFederalWithholding: additionalWithholding }
  throw new QBOPayrollError(
    "filing-status",
    "Not yet implemented — awaiting Payroll tier confirmation"
  );
}

/** Set up direct deposit for an employee via QBO Payroll API.
 *  Requires Payroll tier. Bank info is transmitted once and not persisted locally.
 *  Returns true when QBO accepts and marks deposit as verified. */
export async function setupDirectDeposit(
  client: QBOClient,
  employeeId: string,
  bankInfo: OnboardingRecord["bankInfo"]
): Promise<boolean> {
  requirePayrollTier("direct-deposit");

  // TODO: implement when Payroll tier is confirmed
  // POST /v2/company/{realmId}/employees/{employeeId}/directdepositbankaccounts
  // Body: { RoutingNumber: bankInfo.routingNumber, AccountNumber: bankInfo.accountNumber,
  //         AccountType: bankInfo.accountType, IsActive: true }
  // SECURITY: do not log bankInfo fields; use HTTPS only
  throw new QBOPayrollError(
    "direct-deposit",
    "Not yet implemented — awaiting Payroll tier confirmation"
  );
}
