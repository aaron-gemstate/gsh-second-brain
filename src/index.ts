import { App, LogLevel } from "@slack/bolt";
import { config } from "./config";
import { PaperclipClient } from "./paperclip";
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

registerIngestHandlers(app, paperclip);

(async () => {
  await app.start();
  console.log(`⚡ 2nd Brain bot running on port ${config.port} (${isSocketMode ? "Socket Mode" : "HTTP"})`);
  console.log(`   Watching channel: ${config.slack.secondBrainChannelId}`);
  console.log(`   Paperclip project: ${config.paperclip.projectId}`);
})();
