import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
import { QBOPayrollError } from "./types";

const QBO_BASE_URL = "https://quickbooks.api.intuit.com";
const QBO_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 2000, 4000];

export interface QBOClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
  environment: "production" | "sandbox";
}

export class QBOClient {
  private http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private readonly config: QBOClientConfig;

  constructor(config: QBOClientConfig) {
    this.config = config;
    const baseURL = config.environment === "sandbox" ? QBO_SANDBOX_URL : QBO_BASE_URL;
    this.http = axios.create({ baseURL });
  }

  private async refreshAccessToken(): Promise<void> {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const resp = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    this.accessToken = resp.data.access_token as string;
    this.tokenExpiresAt = Date.now() + (resp.data.expires_in as number) * 1000 - 60_000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }
  }

  async request<T>(config: AxiosRequestConfig, step: string): Promise<T> {
    await this.ensureToken();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await this.http.request<T>({
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "application/json",
          },
        });
        return resp.data;
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        if (status === 401 && attempt === 0) {
          await this.refreshAccessToken();
          continue;
        }

        const shouldRetry = status === 429 || (status !== undefined && status >= 500);
        if (shouldRetry && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS[attempt]);
          continue;
        }

        const qboFault = (axiosErr.response?.data as any)?.Fault;
        const qboCode = qboFault?.Error?.[0]?.code;
        const qboMsg = qboFault?.Error?.[0]?.Detail ?? axiosErr.message;
        throw new QBOPayrollError(step, qboMsg, qboCode);
      }
    }

    throw new QBOPayrollError(step, "Max retries exceeded");
  }

  get realmId(): string {
    return this.config.realmId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function qboClientFromEnv(): QBOClient {
  const required = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REFRESH_TOKEN", "QBO_REALM_ID"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
  return new QBOClient({
    clientId: process.env.QBO_CLIENT_ID!,
    clientSecret: process.env.QBO_CLIENT_SECRET!,
    refreshToken: process.env.QBO_REFRESH_TOKEN!,
    realmId: process.env.QBO_REALM_ID!,
    environment: (process.env.QBO_ENVIRONMENT as "production" | "sandbox") ?? "production",
  });
}
