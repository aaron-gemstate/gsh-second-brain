import { QBOClient } from "./client";
import { OnboardingRecord, QBOEmployeeRef, QBOPayrollError } from "./types";

interface QBOEmployee {
  Id: string;
  SyncToken: string;
  GivenName: string;
  FamilyName: string;
  Active: boolean;
  Department?: { value: string };
}

interface CreateEmployeeParams {
  record: OnboardingRecord;
  departmentId: string;
}

export async function createEmployee(
  client: QBOClient,
  params: CreateEmployeeParams
): Promise<QBOEmployeeRef> {
  const { record, departmentId } = params;

  const payload: Record<string, unknown> = {
    GivenName: record.firstName,
    FamilyName: record.lastName,
    PrimaryEmailAddr: { Address: record.email },
    PrimaryTaxIdentifier: record.ssn,
    HiredDate: record.startDate,
    Active: false, // activated in the final step
    Department: { value: departmentId },
  };

  const resp = await client.request<{ Employee: QBOEmployee }>(
    {
      method: "POST",
      url: `/v3/company/${client.realmId}/employee`,
      params: { minorversion: 65 },
      headers: { "Content-Type": "application/json" },
      data: payload,
    },
    "employee-create"
  );

  if (!resp.Employee?.Id) {
    throw new QBOPayrollError("employee-create", "QBO did not return an employee ID");
  }

  return { id: resp.Employee.Id, syncToken: resp.Employee.SyncToken };
}

export async function updateEmployee(
  client: QBOClient,
  employeeRef: QBOEmployeeRef,
  fields: Record<string, unknown>,
  step: string
): Promise<QBOEmployeeRef> {
  const payload = {
    Id: employeeRef.id,
    SyncToken: employeeRef.syncToken,
    sparse: true,
    ...fields,
  };

  const resp = await client.request<{ Employee: QBOEmployee }>(
    {
      method: "POST",
      url: `/v3/company/${client.realmId}/employee`,
      params: { minorversion: 65, operation: "update" },
      headers: { "Content-Type": "application/json" },
      data: payload,
    },
    step
  );

  return { id: resp.Employee.Id, syncToken: resp.Employee.SyncToken };
}

export async function activateEmployee(
  client: QBOClient,
  employeeRef: QBOEmployeeRef
): Promise<QBOEmployeeRef> {
  return updateEmployee(client, employeeRef, { Active: true }, "employee-activate");
}

/** Build the pay-type update payload for the sparse update call.
 *  QBO REST API represents pay in BillRate for basic rate tracking.
 *  Full payroll wage item assignment requires QBO Payroll API (Payroll tier). */
export function buildPayUpdate(
  payType: "salary" | "hourly",
  payRate: number
): Record<string, unknown> {
  return {
    BillRate: payRate,
    // PayPeriod is informational at this layer; payroll wage items require Payroll API
    MetaData: {
      LastUpdatedTime: new Date().toISOString(),
    },
  };
}

/** Build the W-4 filing status update payload.
 *  Full W-4 withholding configuration requires QBO Payroll API (Payroll tier).
 *  This sets what is available on the base Employee object. */
export function buildW4Update(filingStatus: string, additionalWithholding: number): Record<string, unknown> {
  // QBO REST API Employee object does not expose W-4 fields directly —
  // these are managed via QBO Payroll API's employee tax settings endpoint.
  // This payload is a no-op on the base Employee but is included as a hook
  // for when Payroll tier is confirmed (see payroll.ts).
  return {};
}
