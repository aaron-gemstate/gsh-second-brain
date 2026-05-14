import { App, LogLevel } from "@slack/bolt";
import { config } from "./config";
import { PaperclipClient } from "./paperclip";
import { GitHubClient } from "./github";
import { registerIngestHandlers } from "./ingest";
import { syncContextToGitHub } from "./context-sync";
import { relayAgentCommentsToSlack } from "./slack-relay";

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

const SYNC_INTERVAL_MS = parseInt(process.env["CONTEXT_SYNC_INTERVAL_MS"] ?? String(10 * 60 * 1000), 10);
const RELAY_INTERVAL_MS = parseInt(process.env["SLACK_RELAY_INTERVAL_MS"] ?? String(60 * 1000), 10);

const syncLogger = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string, err?: unknown) => console.warn(msg, err ?? ""),
  error: (msg: string, err?: unknown) => console.error(msg, err ?? ""),
};

function runContextSync() {
  syncContextToGitHub(
    paperclip,
    github,
    config.paperclip.companyPrefix,
    config.paperclip.appBaseUrl,
    syncLogger
  ).catch((err) => console.error("context-sync: unhandled error", err));
}

function runSlackRelay() {
  relayAgentCommentsToSlack(paperclip, app.client, syncLogger).catch(
    (err) => console.error("slack-relay: unhandled error", err)
  );
}

(async () => {
  await app.start();
  console.log(`⚡ 2nd Brain bot running on port ${config.port} (${isSocketMode ? "Socket Mode" : "HTTP"})`);
  console.log(`   Watching channel: ${config.slack.secondBrainChannelId}`);
  console.log(`   Paperclip project: ${config.paperclip.projectId}`);
  console.log(`   GitHub database: ${config.github.owner}/${config.github.repo}`);

  // Sync Paperclip plans to GitHub on startup and then every SYNC_INTERVAL_MS
  runContextSync();
  setInterval(runContextSync, SYNC_INTERVAL_MS);
  console.log(`   Context sync: every ${SYNC_INTERVAL_MS / 1000}s`);

  // Relay agent comments back to Slack threads on startup and then every RELAY_INTERVAL_MS
  runSlackRelay();
  setInterval(runSlackRelay, RELAY_INTERVAL_MS);
  console.log(`   Slack relay: every ${RELAY_INTERVAL_MS / 1000}s`);
})();
