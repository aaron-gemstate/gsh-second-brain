import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    signingSecret: required("SLACK_SIGNING_SECRET"),
    appToken: process.env["SLACK_APP_TOKEN"],
    secondBrainChannelId: required("SLACK_SECOND_BRAIN_CHANNEL_ID"),
  },
  paperclip: {
    apiUrl: required("PAPERCLIP_API_URL"),
    apiKey: required("PAPERCLIP_API_KEY"),
    companyId: required("PAPERCLIP_COMPANY_ID"),
    projectId: required("PAPERCLIP_PROJECT_ID"),
    companyPrefix: process.env["PAPERCLIP_COMPANY_PREFIX"] ?? "GEM",
    appBaseUrl: process.env["APP_BASE_URL"] ?? "https://paperclip.ing",
  },
  github: {
    token: required("GITHUB_TOKEN"),
    owner: required("GITHUB_REPO_OWNER"),
    repo: process.env["GITHUB_REPO_NAME"] ?? "gsh-second-brain",
    defaultLabels: (process.env["GITHUB_DEFAULT_LABELS"] ?? "second-brain,idea")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    defaultAssignees: (process.env["GITHUB_DEFAULT_ASSIGNEES"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  port: parseInt(process.env["PORT"] ?? "3000", 10),
};
