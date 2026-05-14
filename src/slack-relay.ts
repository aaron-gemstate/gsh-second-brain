import type { WebClient } from "@slack/web-api";
import type { PaperclipClient } from "./paperclip";

export interface RelayLogger {
  info: (msg: string) => void;
  warn: (msg: string, err?: unknown) => void;
  error: (msg: string, err?: unknown) => void;
}

// Tracks the last-relayed comment ID per issue to avoid double-posting.
const lastRelayedCommentId = new Map<string, string | null>();

// Runtime registry: populated by the ingest handler whenever a thread reply is
// routed to a Paperclip issue. Allows relaying for issues that don't have Slack
// metadata embedded in their description (e.g. manually-created issues).
const threadRegistry = new Map<string, { channelId: string; threadTs: string }>();

export function registerSlackThread(issueId: string, channelId: string, threadTs: string): void {
  threadRegistry.set(issueId, { channelId, threadTs });
}

// Comments injected by the ingest bot from Slack should not be echoed back.
const INGEST_COMMENT_PREFIX = "**Slack thread reply from";

/**
 * Poll Paperclip for new agent comments and relay them back to the originating
 * Slack thread. Sources: description-embedded markers (ingest-bot-created issues)
 * + the runtime registry (any issue that received a thread reply this session).
 */
export async function relayAgentCommentsToSlack(
  paperclip: PaperclipClient,
  slack: WebClient,
  logger: RelayLogger
): Promise<void> {
  // Build the candidate list: description-based + registry-based, deduplicated by id
  const candidates = new Map<string, { id: string; identifier: string; channelId: string; threadTs: string }>();

  // 1. Description-embedded markers (ingest-bot-created issues)
  try {
    const descIssues = await paperclip.getSlackOriginIssues();
    for (const issue of descIssues) {
      if (!issue.description) continue;
      const channelId = paperclip.extractSlackChannelId(issue.description);
      const threadTs = paperclip.extractSlackMessageTs(issue.description);
      if (channelId && threadTs) {
        candidates.set(issue.id, { id: issue.id, identifier: issue.identifier, channelId, threadTs });
      }
    }
  } catch (err) {
    logger.error("slack-relay: failed to fetch Slack-origin issues", err);
  }

  // 2. Runtime registry (covers manually-created issues that received thread replies)
  for (const [issueId, { channelId, threadTs }] of threadRegistry) {
    if (!candidates.has(issueId)) {
      candidates.set(issueId, { id: issueId, identifier: issueId, channelId, threadTs });
    }
  }

  for (const { id, identifier, channelId, threadTs } of candidates.values()) {
    const knownLastId = lastRelayedCommentId.get(id);

    try {
      if (knownLastId === undefined) {
        // First time seeing this issue: snapshot without relaying to avoid history spam.
        const existing = await paperclip.getIssueComments(id);
        const last = existing[existing.length - 1];
        lastRelayedCommentId.set(id, last?.id ?? null);
        continue;
      }

      const newComments = knownLastId
        ? await paperclip.getIssueComments(id, knownLastId)
        : await paperclip.getIssueComments(id);

      for (const comment of newComments) {
        lastRelayedCommentId.set(id, comment.id);

        // Skip comments the ingest bot injected from Slack (avoid echo loop).
        if (comment.body.startsWith(INGEST_COMMENT_PREFIX)) continue;
        // Only relay agent-authored comments.
        if (!comment.authorAgentId) continue;

        try {
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: comment.body,
            mrkdwn: true,
          });
          logger.info(`slack-relay: relayed comment ${comment.id} for ${identifier} → ${channelId}/${threadTs}`);
        } catch (err) {
          logger.warn(`slack-relay: failed to post to Slack for ${identifier}`, err);
        }
      }
    } catch (err) {
      logger.warn(`slack-relay: skipped issue ${identifier}`, err);
    }
  }
}
