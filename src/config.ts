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
  port: parseInt(process.env["PORT"] ?? "3000", 10),
};
