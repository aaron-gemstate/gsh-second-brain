import { App, LogLevel } from "@slack/bolt";
import { config } from "./config";
import { PaperclipClient } from "./paperclip";
import { GitHubClient } from "./github";
import { registerIngestHandlers } from "./ingest";

const isSocketMode = Boolean(config.slack.appToken);

const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  ...(isSocketMode
    ? { socketMode: true, appToken: config.slack.appToken }
    : {}),
  logLevel: process.env["NODE_ENV"] === "production" ? LogLevel.INFO : LogLevel.DEBUG,
  port: config.port,
});

const paperclip = new PaperclipClient(
  config.paperclip.apiUrl,
  config.paperclip.apiKey,
  config.paperclip.companyId,
  config.paperclip.projectId
);

const github = new GitHubClient({
  token: config.github.token,
  owner: config.github.owner,
  repo: config.github.repo,
  defaultLabels: config.github.defaultLabels,
  defaultAssignees: config.github.defaultAssignees,
});

registerIngestHandlers(app, paperclip, github);

(async () => {
  await app.start();
  console.log(`⚡ 2nd Brain bot running on port ${config.port} (${isSocketMode ? "Socket Mode" : "HTTP"})`);
  console.log(`   Watching channel: ${config.slack.secondBrainChannelId}`);
  console.log(`   Paperclip project: ${config.paperclip.projectId}`);
  console.log(`   GitHub database: ${config.github.owner}/${config.github.repo}`);
})();
