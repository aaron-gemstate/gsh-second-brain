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
    githubIssueNumber?: number;
    githubIssueUrl?: string;
    triageAgentId?: string;
  }): Promise<PaperclipIssue> {
    const description = [
      params.body,
      "",
      "---",
      `**Slack message:** ${params.slackMessageLink}`,
      params.submitterUserId ? `**Submitted by:** <@${params.submitterUserId}>` : "",
      params.githubIssueUrl
        ? `**GitHub issue:** [#${params.githubIssueNumber}](${params.githubIssueUrl})`
        : "",
      // Machine-readable markers for the Triage Agent and future lookups
      `<!-- slack-channel-id:${params.slackChannelId} -->`,
      `<!-- slack-message-ts:${params.slackMessageTs} -->`,
      params.githubIssueNumber != null
        ? `<!-- github-issue:${params.githubIssueNumber} -->`
        : "",
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
      ...(params.triageAgentId ? { assigneeAgentId: params.triageAgentId } : {}),
    });

    return response.data as PaperclipIssue;
  }

  async createDirectIssue(params: {
    title: string;
    body: string;
    submitterUserId?: string;
    slackMessageLink: string;
    slackMessageTs: string;
    slackChannelId: string;
    assigneeAgentId?: string;
    context?: string;
  }): Promise<PaperclipIssue> {
    const description = [
      params.body,
      "",
      params.context ? `**Recent channel context:**\n${params.context}` : "",
      "",
      "---",
      `**Slack message:** ${params.slackMessageLink}`,
      params.submitterUserId ? `**Submitted by:** <@${params.submitterUserId}>` : "",
      `<!-- slack-channel-id:${params.slackChannelId} -->`,
      `<!-- slack-message-ts:${params.slackMessageTs} -->`,
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
      ...(params.assigneeAgentId ? { assigneeAgentId: params.assigneeAgentId } : {}),
    });

    return response.data as PaperclipIssue;
  }

  /** Extract GitHub issue number embedded by createIdeaIssue. Returns null if not found. */
  extractGitHubIssueNumber(description: string): number | null {
    const match = description.match(/<!--\s*github-issue:(\d+)\s*-->/);
    return match ? parseInt(match[1], 10) : null;
  }

  async getIssueByOrigin(slackMessageTs: string, slackChannelId: string): Promise<PaperclipIssue & { description?: string } | null> {
    const fingerprint = `slack:${slackChannelId}:${slackMessageTs}`;
    const search = await this.http.get(
      `/api/companies/${this.companyId}/issues?originFingerprint=${encodeURIComponent(fingerprint)}&projectId=${this.projectId}`
    );
    const issues = search.data?.items ?? search.data ?? [];
    return issues[0] ?? null;
  }

  async closeIssueByOrigin(
    slackMessageTs: string,
    slackChannelId: string,
    reason: string
  ): Promise<{ githubIssueNumber: number | null }> {
    const fingerprint = `slack:${slackChannelId}:${slackMessageTs}`;
    const search = await this.http.get(
      `/api/companies/${this.companyId}/issues?originFingerprint=${encodeURIComponent(fingerprint)}&projectId=${this.projectId}`
    );
    const issues: Array<PaperclipIssue & { description?: string }> = search.data?.items ?? search.data ?? [];
    let githubIssueNumber: number | null = null;
    for (const issue of issues) {
      if (issue.description && githubIssueNumber == null) {
        githubIssueNumber = this.extractGitHubIssueNumber(issue.description);
      }
      await this.http.patch(`/api/issues/${issue.id}`, {
        status: "cancelled",
        comment: reason,
      });
    }
    return { githubIssueNumber };
  }

  async updateIssueTitleByOrigin(
    slackMessageTs: string,
    slackChannelId: string,
    newTitle: string,
    newBody: string
  ): Promise<{ githubIssueNumber: number | null }> {
    const fingerprint = `slack:${slackChannelId}:${slackMessageTs}`;
    const search = await this.http.get(
      `/api/companies/${this.companyId}/issues?originFingerprint=${encodeURIComponent(fingerprint)}&projectId=${this.projectId}`
    );
    const issues: Array<PaperclipIssue & { description?: string }> = search.data?.items ?? search.data ?? [];
    let githubIssueNumber: number | null = null;
    for (const issue of issues) {
      if (issue.description && githubIssueNumber == null) {
        githubIssueNumber = this.extractGitHubIssueNumber(issue.description);
      }
      await this.http.patch(`/api/issues/${issue.id}`, {
        title: newTitle,
        description: newBody,
      });
    }
    return { githubIssueNumber };
  }

  async getProjectIssues(statuses: string[]): Promise<Array<PaperclipIssue & { description?: string; assigneeAgentId?: string | null }>> {
    const resp = await this.http.get(
      `/api/companies/${this.companyId}/issues?projectId=${this.projectId}&status=${statuses.join(",")}&limit=100`
    );
    return resp.data?.items ?? resp.data ?? [];
  }

  async getIssueDocument(issueId: string, key: string): Promise<{ body: string; revisionId: string; title?: string } | null> {
    try {
      const resp = await this.http.get(`/api/issues/${issueId}/documents/${key}`);
      return resp.data ?? null;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  issueUrl(companyPrefix: string, identifier: string): string {
    return `/${companyPrefix}/issues/${identifier}`;
  }
}
