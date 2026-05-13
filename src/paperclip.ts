import axios, { AxiosInstance } from "axios";

export interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  issueNumber: number;
}

export class PaperclipClient {
  private http: AxiosInstance;
  private companyId: string;
  private projectId: string;

  constructor(apiUrl: string, apiKey: string, companyId: string, projectId: string) {
    this.companyId = companyId;
    this.projectId = projectId;
    this.http = axios.create({
      baseURL: apiUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  async createIdeaIssue(params: {
    title: string;
    body: string;
    submitterUserId?: string;
    slackMessageLink: string;
    slackMessageTs: string;
    slackChannelId: string;
  }): Promise<PaperclipIssue> {
    const description = [
      params.body,
      "",
      "---",
      `**Slack message:** ${params.slackMessageLink}`,
      params.submitterUserId ? `**Submitted by:** <@${params.submitterUserId}>` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.http.post(`/api/companies/${this.companyId}/issues`, {
      title: params.title,
      description,
      status: "todo",
      priority: "medium",
      projectId: this.projectId,
      originKind: "slack",
      originId: params.slackMessageTs,
      originFingerprint: `slack:${params.slackChannelId}:${params.slackMessageTs}`,
    });

    return response.data as PaperclipIssue;
  }

  async closeIssueByOrigin(slackMessageTs: string, slackChannelId: string, reason: string): Promise<void> {
    const fingerprint = `slack:${slackChannelId}:${slackMessageTs}`;
    const search = await this.http.get(
      `/api/companies/${this.companyId}/issues?originFingerprint=${encodeURIComponent(fingerprint)}&projectId=${this.projectId}`
    );
    const issues: PaperclipIssue[] = search.data?.items ?? search.data ?? [];
    for (const issue of issues) {
      await this.http.patch(`/api/issues/${issue.id}`, {
        status: "cancelled",
        comment: reason,
      });
    }
  }

  async updateIssueTitleByOrigin(slackMessageTs: string, slackChannelId: string, newTitle: string, newBody: string): Promise<void> {
    const fingerprint = `slack:${slackChannelId}:${slackMessageTs}`;
    const search = await this.http.get(
      `/api/companies/${this.companyId}/issues?originFingerprint=${encodeURIComponent(fingerprint)}&projectId=${this.projectId}`
    );
    const issues: PaperclipIssue[] = search.data?.items ?? search.data ?? [];
    for (const issue of issues) {
      await this.http.patch(`/api/issues/${issue.id}`, {
        title: newTitle,
        description: newBody,
      });
    }
  }

  issueUrl(companyPrefix: string, identifier: string): string {
    return `/${companyPrefix}/issues/${identifier}`;
  }
}
