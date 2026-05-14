import { App, GenericMessageEvent } from "@slack/bolt";
import { config } from "./config";
import { PaperclipClient } from "./paperclip";
import { GitHubClient } from "./github";

export function registerIngestHandlers(app: App, paperclip: PaperclipClient, github: GitHubClient): void {
  // @helgi mentions in #ask-helgi → create Paperclip issue assigned directly to Helgi
  const askHelgiChannelId = config.slack.askHelgiChannelId;
  const helgiUserId = config.slack.helgiUserId;
  if (askHelgiChannelId && helgiUserId) {
    app.message(async ({ message, client, logger }) => {
      const msg = message as GenericMessageEvent;
      if (msg.channel !== askHelgiChannelId) return;
      if (msg.subtype || (msg as unknown as Record<string, unknown>).bot_id || msg.thread_ts) return;

      const text = msg.text ?? "";
      if (!text.includes(`<@${helgiUserId}>`)) return;

      logger.info(`@helgi mention in #ask-helgi from ${msg.user}: "${text.slice(0, 80)}"`);

      // Gather last 10 messages for context per Aaron's spec
      let context = "";
      try {
        const history = await client.conversations.history({ channel: askHelgiChannelId, limit: 10 });
        context = (history.messages ?? [])
          .filter((m) => !m.bot_id && m.text)
          .reverse()
          .map((m) => `<@${m.user}>: ${m.text}`)
          .join("\n");
      } catch (err) {
        logger.warn("Could not fetch #ask-helgi history for context", err);
      }

      const title = deriveTitle(text.replace(/<@[^>]+>/g, "").trim()) || "Question for Helgi";
      const permalink = await getPermalink(client, msg.channel, msg.ts);

      try {
        const issue = await paperclip.createDirectIssue({
          title,
          body: text,
          submitterUserId: msg.user,
          slackMessageLink: permalink,
          slackMessageTs: msg.ts,
          slackChannelId: msg.channel,
          assigneeAgentId: config.helgiAgentId,
          context,
        });

        const issueUrl = `${config.paperclip.appBaseUrl}${paperclip.issueUrl(config.paperclip.companyPrefix, issue.identifier)}`;
        await client.chat.postMessage({
          channel: msg.channel,
          thread_ts: msg.ts,
          text: `Got it — I'll get back to you shortly (<${issueUrl}|${issue.identifier}>).`,
        });
      } catch (err) {
        logger.error("Failed to create Paperclip issue for #ask-helgi mention", err);
        await client.chat.postMessage({
          channel: msg.channel,
          thread_ts: msg.ts,
          text: "Something went wrong capturing your message. Please try again or contact an admin.",
        });
      }
    });
  }


  // New message in #second-brain → log to GitHub, then create Paperclip issue
  app.message(async ({ message, client, logger }) => {
    const msg = message as GenericMessageEvent;

    if (msg.channel !== config.slack.secondBrainChannelId) return;
    // Ignore bot messages (Slack omits subtype for bot messages, so also check bot_id) and thread replies
    if (msg.subtype || (msg as unknown as Record<string, unknown>).bot_id || msg.thread_ts) return;

    const text = msg.text ?? "";
    if (!text.trim()) return;

    const title = deriveTitle(text);
    const permalink = await getPermalink(client, msg.channel, msg.ts);

    logger.info(`Capturing idea from ${msg.user}: "${title}"`);

    let ghIssue: { number: number; url: string } | null = null;

    // Step 1: Log to GitHub second-brain database
    try {
      const ghBody = buildGitHubBody({ text, submitterUserId: msg.user, slackMessageLink: permalink });
      ghIssue = await github.createIssue({ title, body: ghBody });
      logger.info(`GitHub issue created: #${ghIssue.number} ${ghIssue.url}`);
    } catch (err) {
      logger.error("Failed to create GitHub issue — will still create Paperclip issue", err);
    }

    // Step 2: Create Paperclip issue (with GitHub link if available)
    try {
      const issue = await paperclip.createIdeaIssue({
        title,
        body: text,
        submitterUserId: msg.user,
        slackMessageLink: permalink,
        slackMessageTs: msg.ts,
        slackChannelId: msg.channel,
        githubIssueNumber: ghIssue?.number,
        githubIssueUrl: ghIssue?.url,
        triageAgentId: config.paperclip.triageAgentId,
      });

      const issueUrl = `${config.paperclip.appBaseUrl}${paperclip.issueUrl(config.paperclip.companyPrefix, issue.identifier)}`;

      const replyParts = [`Captured — triaging now (<${issueUrl}|${issue.identifier}>)`];
      if (ghIssue) replyParts.push(`GitHub: <${ghIssue.url}|#${ghIssue.number}>`);

      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.ts,
        text: replyParts.join(" · "),
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

  // Message deleted → close GitHub issue + cancel Paperclip issue
  app.event("message", async ({ event, logger }) => {
    const ev = event as unknown as { subtype?: string; deleted_ts?: string; channel?: string };
    if (ev.subtype !== "message_deleted" || !ev.deleted_ts || !ev.channel) return;
    if (ev.channel !== config.slack.secondBrainChannelId) return;

    logger.info(`Message deleted: ${ev.deleted_ts} — closing GitHub issue and cancelling Paperclip issue`);

    const reason = "Slack message was deleted by submitter";
    try {
      const { githubIssueNumber } = await paperclip.closeIssueByOrigin(ev.deleted_ts, ev.channel, reason);
      if (githubIssueNumber != null) {
        await github.closeIssue(githubIssueNumber, reason);
      }
    } catch (err) {
      logger.error("Failed to close issues on Slack message delete", err);
    }
  });

  // Message edited → update GitHub issue + Paperclip issue
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

    logger.info(`Message edited: ${ev.message.ts} — updating GitHub issue and Paperclip issue`);

    const newTitle = deriveTitle(text);
    try {
      const { githubIssueNumber } = await paperclip.updateIssueTitleByOrigin(
        ev.message.ts,
        ev.channel,
        newTitle,
        text
      );
      if (githubIssueNumber != null) {
        await github.updateIssue(githubIssueNumber, { title: newTitle, body: text });
      }
    } catch (err) {
      logger.error("Failed to update issues on Slack message edit", err);
    }
  });
}

function deriveTitle(text: string): string {
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() ?? text;
  return firstSentence.length > 80 ? firstSentence.slice(0, 77) + "…" : firstSentence;
}

function buildGitHubBody(params: {
  text: string;
  submitterUserId?: string;
  slackMessageLink: string;
}): string {
  return [
    "## Idea",
    "",
    params.text,
    "",
    "---",
    `**Submitted via:** Slack #second-brain`,
    params.submitterUserId ? `**Slack user:** <@${params.submitterUserId}>` : "",
    params.slackMessageLink ? `**Slack message:** ${params.slackMessageLink}` : "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

async function getPermalink(client: App["client"], channel: string, ts: string): Promise<string> {
  try {
    const result = await client.chat.getPermalink({ channel, message_ts: ts });
    return (result.permalink as string) ?? "";
  } catch {
    return "";
  }
}
