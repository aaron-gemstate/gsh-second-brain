import type { WebClient } from "@slack/web-api";
import type { PaperclipClient } from "./paperclip";

export interface RelayLogger {
  info: (msg: string) => void;
  warn: (msg: string, err?: unknown) => void;
  error: (msg: string, err?: unknown) => void;
}

// Tracks the last-relayed comment ID per issue to avoid double-posting.
// Issues first seen in a run have all existing comments marked as "seen" without relaying
// (so we don't replay history on restart).
const lastRelayedCommentId = new Map<string, string | null>();

// Comments injected by the ingest bot from Slack should not be echoed back.
const INGEST_COMMENT_PREFIX = "**Slack thread reply from";

/**
 * Poll Paperclip for new agent comments on Slack-origin issues and relay them
 * to the originating Slack thread. Call this on a short interval (e.g. 60 s).
 */
export async function relayAgentCommentsToSlack(
  paperclip: PaperclipClient,
  slack: WebClient,
  logger: RelayLogger
): Promise<void> {
  let issues: Awaited<ReturnType<typeof paperclip.getSlackOriginIssues>>;
  try {
    issues = await paperclip.getSlackOriginIssues();
  } catch (err) {
    logger.error("slack-relay: failed to fetch Slack-origin issues", err);
    return;
  }

  for (const issue of issues) {
    if (!issue.description) continue;

    const channelId = paperclip.extractSlackChannelId(issue.description);
    const threadTs = paperclip.extractSlackMessageTs(issue.description);
    if (!channelId || !threadTs) continue;

    const knownLastId = lastRelayedCommentId.get(issue.id);

    try {
      if (knownLastId === undefined) {
        // First time we see this issue: snapshot existing comments without relaying.
        const existing = await paperclip.getIssueComments(issue.id);
        const last = existing[existing.length - 1];
        lastRelayedCommentId.set(issue.id, last?.id ?? null);
        continue;
      }

      const newComments = knownLastId
        ? await paperclip.getIssueComments(issue.id, knownLastId)
        : await paperclip.getIssueComments(issue.id);

      for (const comment of newComments) {
        lastRelayedCommentId.set(issue.id, comment.id);

        // Skip comments that the ingest bot itself posted from Slack.
        if (comment.body.startsWith(INGEST_COMMENT_PREFIX)) continue;
        // Only relay comments authored by an agent (not anonymous/system).
        if (!comment.authorAgentId) continue;

        try {
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: comment.body,
            mrkdwn: true,
          });
          logger.info(`slack-relay: relayed comment ${comment.id} for ${issue.identifier} → ${channelId}/${threadTs}`);
        } catch (err) {
          logger.warn(`slack-relay: failed to post to Slack for ${issue.identifier}`, err);
        }
      }
    } catch (err) {
      logger.warn(`slack-relay: skipped issue ${issue.identifier}`, err);
    }
  }
}
