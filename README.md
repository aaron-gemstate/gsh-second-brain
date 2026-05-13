# gsh-second-brain

Gemstate Holdings company-wide 2nd Brain — Slack idea capture pipeline.

## What it does

Listens on the `#second-brain` Slack channel. When someone posts an idea, it:
1. Creates a Paperclip issue in the 2nd Brain project
2. Replies in-thread with the issue link
3. Handles edits (updates the issue) and deletions (cancels the issue)

A separate Triage Agent then picks up the issue, classifies it, generates a plan, and posts it back to Slack for the submitter to approve.

## Setup

```bash
cp .env.example .env
# fill in .env
npm install
npm run dev      # Socket Mode (no public URL needed)
# or
npm start        # HTTP mode (requires public URL + Slack event subscription)
```

## Required Slack scopes

- `channels:history` / `groups:history`
- `chat:write`
- `chat:getPermalink`
- Event subscriptions: `message.channels` (or `message.groups` for private channel)

## Environment variables

See `.env.example` for all required and optional variables.
