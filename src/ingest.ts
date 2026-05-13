import { App, GenericMessageEvent } from "@slack/bolt";
import { config } from "./config";
import { PaperclipClient } from "./paperclip";

export function registerIngestHandlers(app: App, paperclip: PaperclipClient): void {
  // New message in #second-brain → create Paperclip issue
  app.message(async ({ message, client, logger }) => {
    const msg = message as GenericMessageEvent;

    // Only process messages from the configured channel (bot is always filtered to it at the App level)
    if (msg.channel !== config.slack.secondBrainChannelId) return;
    // Ignore bot messages and thread replies
    if (msg.subtype || msg.thread_ts) return;

    const text = msg.text ?? "";
    if (!text.trim()) return;

    const title = deriveTitle(text);
    const permalink = await getPermalink(client, msg.channel, msg.ts);

    logger.info(`Capturing idea from ${msg.user}: "${title}"`);

    try {
      const issue = await paperclip.createIdeaIssue({
        title,
        body: text,
        submitterUserId: msg.user,
        slackMessageLink: permalink,
        slackMessageTs: msg.ts,
        slackChannelId: msg.channel,
      });

      const issueUrl = `${config.paperclip.appBaseUrl}${paperclip.issueUrl(config.paperclip.companyPrefix, issue.identifier)}`;

      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.ts,
        text: `Captured — triaging now (<${issueUrl}|${issue.identifier}>)`,
      });
    } catch (err) {
      logger.error("Failed to create Paperclip issue", err);
      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.ts,
        text: "Sorry, something went wrong capturing this idea. Please try again or contact an admin.",
      });
    }
  });

  // Message deleted → cancel the corresponding Paperclip issue
  app.event("message", async ({ event, logger }) => {
    const ev = event as unknown as { subtype?: string; deleted_ts?: string; channel?: string };
    if (ev.subtype !== "message_deleted" || !ev.deleted_ts || !ev.channel) return;
    if (ev.channel !== config.slack.secondBrainChannelId) return;

    logger.info(`Message deleted: ${ev.deleted_ts} — cancelling Paperclip issue`);
    try {
      await paperclip.closeIssueByOrigin(ev.deleted_ts, ev.channel, "Slack message was deleted by submitter");
    } catch (err) {
      logger.error("Failed to cancel Paperclip issue on delete", err);
    }
  });

  // Message edited → update title/description on the Paperclip issue
  app.event("message", async ({ event, logger }) => {
    const ev = event as unknown as {
      subtype?: string;
      channel?: string;
      message?: { ts?: string; text?: string };
    };
    if (ev.subtype !== "message_changed" || !ev.message?.ts || !ev.channel) return;
    if (ev.channel !== config.slack.secondBrainChannelId) return;

    const text = ev.message.text ?? "";
    if (!text.trim()) return;

    logger.info(`Message edited: ${ev.message.ts} — updating Paperclip issue`);
    try {
      await paperclip.updateIssueTitleByOrigin(ev.message.ts, ev.channel, deriveTitle(text), text);
    } catch (err) {
      logger.error("Failed to update Paperclip issue on edit", err);
    }
  });
}

function deriveTitle(text: string): string {
  // Use the first sentence or first 80 characters as the title
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() ?? text;
  return firstSentence.length > 80 ? firstSentence.slice(0, 77) + "…" : firstSentence;
}

async function getPermalink(client: App["client"], channel: string, ts: string): Promise<string> {
  try {
    const result = await client.chat.getPermalink({ channel, message_ts: ts });
    return (result.permalink as string) ?? "";
  } catch {
    return "";
  }
}
