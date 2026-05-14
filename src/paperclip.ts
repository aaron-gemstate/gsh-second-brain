import axios, { AxiosInstance } from "axios";

export interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  issueNumber: number;
  assigneeAgentId?: string | null;
  executionAgentNameKey?: string | null;
}

export interface PaperclipComment {
  id: string;
  body: string;
  authorAgentId?: string | null;
  authorUserId?: string | null;
  createdAt: string;
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

  /** Returns true only if the description contains both the expected Slack ts and channel markers.
   *  Used as a client-side guard in close/update-by-origin to prevent modifying issues
   *  that the server returned despite not matching the originFingerprint filter. */
  private descriptionMatchesOrigin(
    description: string | undefined,
    slackMessageTs: string,
    slackChannelId: string
  ): boolean {
    if (!description) return false;
    return (
      description.includes(`<!-- slack-message-ts:${slackMessageTs} -->`) &&
      description.includes(`<!-- slack-channel-id:${slackChannelId} -->`)
    );
  }

  /** Extract GitHub issue number embedded by createIdeaIssue. Returns null if not found. */
  extractGitHubIssueNumber(description: string): number | null {
    const match = description.match(/<!--\s*github-issue:(\d+)\s*-->/);
    return match ? parseInt(match[1], 10) : null;
  }

  async getIssueByOrigin(slackMessageTs: string, slackChannelId: string): Promise<PaperclipIssue & { description?: string } | null> {
    // originFingerprint filter is ignored by the API (returns all issues) — search by
    // description content instead and validate both slack markers are present.
    const search = await this.http.get(
      `/api/companies/${this.companyId}/issues?q=${encodeURIComponent(slackMessageTs)}&projectId=${this.projectId}&limit=50`
    );
    const issues: Array<PaperclipIssue & { description?: string }> = search.data?.items ?? search.data ?? [];
    const matching = issues.filter((i) => this.descriptionMatchesOrigin(i.description, slackMessageTs, slackChannelId));
    const active = matching.find((i) => i.status !== "cancelled" && i.status !== "done");
    return active ?? matching[0] ?? null;
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
      // Guard: verify the issue actually belongs to this Slack message before modifying.
      // Protects against server-side filter failures returning unrelated issues.
      if (!this.descriptionMatchesOrigin(issue.description, slackMessageTs, slackChannelId)) {
        continue;
      }
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
      // Guard: verify the issue actually belongs to this Slack message before modifying.
      if (!this.descriptionMatchesOrigin(issue.description, slackMessageTs, slackChannelId)) {
        continue;
      }
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

  async postComment(issueId: string, body: string): Promise<void> {
    const attempt = () => this.http.post(`/api/issues/${issueId}/comments`, { body });
    try {
      await attempt();
    } catch (err) {
      // 409 means the issue is currently checked out by another run — retry once after a delay
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        await new Promise((resolve) => setTimeout(resolve, 12000));
        await attempt();
      } else {
        throw err;
      }
    }
  }

  async getIssueComments(issueId: string, afterCommentId?: string): Promise<PaperclipComment[]> {
    const resp = await this.http.get(`/api/issues/${issueId}/comments`);
    const all: PaperclipComment[] = resp.data?.items ?? resp.data ?? [];
    if (!afterCommentId) return all;
    // Server-side ?after= pagination is unsupported — filter client-side instead.
    const idx = all.findIndex((c) => c.id === afterCommentId);
    return idx === -1 ? all : all.slice(idx + 1);
  }

  async getSlackOriginIssues(): Promise<Array<PaperclipIssue & { description?: string }>> {
    // Search by description content — originKind=slack is not reliably set on manually-created issues
    const resp = await this.http.get(
      `/api/companies/${this.companyId}/issues?projectId=${this.projectId}&q=slack-channel-id&status=todo,in_progress,in_review,blocked&limit=100`
    );
    const issues: Array<PaperclipIssue & { description?: string }> = resp.data?.items ?? resp.data ?? [];
    return issues.filter(
      (i) => i.description && this.extractSlackChannelId(i.description) && this.extractSlackMessageTs(i.description)
    );
  }

  extractSlackChannelId(description: string): string | null {
    const match = description.match(/<!--\s*slack-channel-id:([^\s>]+)\s*-->/);
    return match ? match[1] : null;
  }

  extractSlackMessageTs(description: string): string | null {
    const match = description.match(/<!--\s*slack-message-ts:([^\s>]+)\s*-->/);
    return match ? match[1] : null;
  }

  issueUrl(companyPrefix: string, identifier: string): string {
    return `/${companyPrefix}/issues/${identifier}`;
  }
}
