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

/** Fallback pay update using BillRate — informational only, not a payroll wage item.
 *  Used when QBO Payroll tier is not yet enabled. */
export function buildPayUpdate(
  payType: "salary" | "hourly",
  payRate: number
): Record<string, unknown> {
  return { BillRate: payRate };
}
