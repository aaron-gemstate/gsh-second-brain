import { QBOClient } from "./client";
import { QBODepartmentRef, QBOPayrollError } from "./types";

interface QBODepartment {
  Id: string;
  SyncToken: string;
  Name: string;
  Active: boolean;
}

export async function findOrCreateDepartment(
  client: QBOClient,
  name: string
): Promise<QBODepartmentRef> {
  const existing = await findDepartment(client, name);
  if (existing) {
    return { id: existing.Id, name: existing.Name, created: false };
  }

  const created = await createDepartment(client, name);
  return { id: created.Id, name: created.Name, created: true };
}

async function findDepartment(client: QBOClient, name: string): Promise<QBODepartment | null> {
  const escaped = name.replace(/'/g, "\\'");
  const query = `SELECT * FROM Department WHERE Name = '${escaped}' AND Active = true MAXRESULTS 1`;

  const resp = await client.request<{ QueryResponse: { Department?: QBODepartment[] } }>(
    {
      method: "GET",
      url: `/v3/company/${client.realmId}/query`,
      params: { query, minorversion: 65 },
    },
    "department-lookup"
  );

  return resp.QueryResponse.Department?.[0] ?? null;
}

async function createDepartment(client: QBOClient, name: string): Promise<QBODepartment> {
  const resp = await client.request<{ Department: QBODepartment }>(
    {
      method: "POST",
      url: `/v3/company/${client.realmId}/department`,
      params: { minorversion: 65 },
      headers: { "Content-Type": "application/json" },
      data: { Name: name },
    },
    "department-create"
  );

  if (!resp.Department?.Id) {
    throw new QBOPayrollError("department-create", "QBO did not return a department ID");
  }

  return resp.Department;
}
