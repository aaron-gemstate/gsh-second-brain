import axios, { AxiosInstance } from "axios";

export interface GitHubIssue {
  number: number;
  url: string;
}

export class GitHubClient {
  private http: AxiosInstance;
  private owner: string;
  private repo: string;
  private defaultLabels: string[];
  private defaultAssignees: string[];

  constructor(params: {
    token: string;
    owner: string;
    repo: string;
    defaultLabels: string[];
    defaultAssignees: string[];
  }) {
    this.owner = params.owner;
    this.repo = params.repo;
    this.defaultLabels = params.defaultLabels;
    this.defaultAssignees = params.defaultAssignees;
    this.http = axios.create({
      baseURL: "https://api.github.com",
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
    });
  }

  async createIssue(params: {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<GitHubIssue> {
    const { data } = await this.http.post(`/repos/${this.owner}/${this.repo}/issues`, {
      title: params.title,
      body: params.body,
      labels: [...this.defaultLabels, ...(params.labels ?? [])],
      assignees: [...this.defaultAssignees, ...(params.assignees ?? [])],
    });
    return { number: data.number as number, url: data.html_url as string };
  }

  async updateIssue(issueNumber: number, params: { title?: string; body?: string }): Promise<void> {
    await this.http.patch(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, params);
  }

  async closeIssue(issueNumber: number, reason: string): Promise<void> {
    await this.http.post(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, {
      body: reason,
    });
    await this.http.patch(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
      state: "closed",
      state_reason: "not_planned",
    });
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    await this.http.post(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, { body });
  }

  /** Returns true if any existing comment on the issue contains the given marker string. */
  async hasComment(issueNumber: number, marker: string): Promise<boolean> {
    let page = 1;
    while (true) {
      const { data } = await this.http.get(
        `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`
      );
      if (!Array.isArray(data) || data.length === 0) return false;
      if (data.some((c: { body?: string }) => c.body?.includes(marker))) return true;
      if (data.length < 100) return false;
      page++;
    }
  }
}
