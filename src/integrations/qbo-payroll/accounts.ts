import { QBOClient } from "./client";
import { QBOPayrollError } from "./types";

interface QBOAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Active: boolean;
  Classification: string;
}

export interface LaborAccountMapping {
  /** Labor expense account to associate with this department's payroll costs */
  accountId: string;
  accountName: string;
  /** True if a suitable account was found; false means payroll must be mapped manually */
  found: boolean;
}

/** Find the standard labor expense account for COA template mapping.
 *  Looks for an active Expense account with AccountSubType = 'OtherMiscellaneousServiceCost'
 *  or name matching common payroll patterns (Wages, Salaries, Payroll).
 *  Returns found=false with a warning rather than throwing — COA mapping is non-blocking. */
export async function findLaborAccount(client: QBOClient): Promise<LaborAccountMapping> {
  const query =
    "SELECT * FROM Account WHERE AccountType = 'Expense' AND Active = true MAXRESULTS 100";

  const resp = await client.request<{ QueryResponse: { Account?: QBOAccount[] } }>(
    {
      method: "GET",
      url: `/v3/company/${client.realmId}/query`,
      params: { query, minorversion: 65 },
    },
    "coa-lookup"
  );

  const accounts = resp.QueryResponse.Account ?? [];

  const laborPatterns = /wage|salary|salari|payroll|compensation/i;
  const match =
    accounts.find((a) => a.AccountSubType === "OtherMiscellaneousServiceCost") ??
    accounts.find((a) => laborPatterns.test(a.Name));

  if (!match) {
    return { accountId: "", accountName: "", found: false };
  }

  return { accountId: match.Id, accountName: match.Name, found: true };
}
