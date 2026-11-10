---
name: handoff
description: Write a self-contained handoff summary of the current session in one copyable code block, so work can resume in a fresh session. Use for /handoff or 'summarize this session'.
---

# Session Handoff

Produce a handoff summary of the current work. For unfinished work, the reader is either a fresh AI session or another developer picking it up. Neither has any memory of this conversation, so everything needed to continue must be in the block. For finished work, the reader is a person receiving a status update.

## Arguments

An optional argument narrows the focus, e.g. `/handoff just the auth migration`. If one is given, cover only that thread and leave out unrelated work from the session.

## Before writing

1. Review the whole session, not just the last few turns. Early decisions and dead ends matter most and are easiest to forget.
2. If the work is in a git repo and you have a shell, run only read-only commands to capture accurate state: `git branch --show-current`, `git status --short`, `git log --oneline -5`. Do not commit, stash, or change anything.
3. Do not create or modify any files. The output goes in the reply only.
4. Decide the status of the work, judged against the Goal:
   - **Complete**: the goal was met and confirmed (tests pass, user confirmed, verified in browser, etc.).
   - **In progress**: work remains.
   - **Blocked**: work can't continue without something external (user input, access, a decision, an upstream fix).
   If the user said it's done, use Complete.

## Output format

If the status is **Complete**, skip this section and use the **Completion summary format** below instead. No further sessions are needed, so the audience changes from a fresh Claude to a person.

Reply with a single fenced block and nothing else except, at most, one short line after it (e.g. a note about anything you couldn't verify). Use a **four-backtick** outer fence (````markdown … ````) so any triple-backtick code inside the summary doesn't break the block.

Inside the block, use this structure. Omit a section only if it truly has nothing in it.

````markdown
# Handoff: <short title of the work>

**Status: <🟡 IN PROGRESS | ⛔ BLOCKED: reason>**

<1–2 sentence overview: what this work is and where it stands, so a reader knows in seconds what they're picking up.>

## Goal
<The overall objective in 1–3 sentences: what "done" looks like and why.>

## Environment & context
- Project / repo: <name, absolute path>
- Branch: <branch>, uncommitted changes: <summary or none>
- Stack / versions relevant to this work: <e.g. Laravel 11, Vue 3 + TS, Vite>
- Key URLs, services, tickets: <…>

## Done so far
- <Completed item>. Verified: <how, e.g. tests pass / confirmed in browser / not verified>
- …

## Current state
<Exactly where things stand right now: what works, what's broken, what was mid-flight when the session ended. Include the latest error message verbatim if there is one.>

## Blocker
<Only when Blocked: what exactly is blocking, who or what can unblock it, and what to do once it's unblocked.>

## Next steps (in priority order)
1. <Concrete, actionable step: specific enough that a developer could start on it without asking questions>
2. …

## Key decisions & constraints
- <Decision>: <why it was made>
- <Requirement or constraint>

## Tried and ruled out
- <Approach>: <why it failed or was rejected>

## Relevant files & commands
- `path/to/file`: <what it is / what changed>
- `command`: <what it's for>

## Open questions
- <Anything unresolved that needs a decision from the project owner>

## Working conventions
- <How work on this should be done, e.g. "ask before editing files", "don't commit without approval", "no AI mentions in commit messages">

## If you're an AI assistant
Read everything above, then confirm your understanding in 2–3 sentences and propose the first next step. Don't redo anything listed under Done so far, and don't retry anything under Tried and ruled out.
````

## Completion summary format

Use this when the status is Complete. The reader is a person: a project manager, a teammate, or a Jira/ticket comment. Write a short, scannable summary of what was accomplished, not a working context for Claude.

Reply with a single fenced block (````markdown … ````) and nothing else except, at most, one short line after it.

````markdown
## ✅ Complete: <short title of the work>

**Summary:** <1–3 plain-language sentences: what the problem or goal was and what was delivered.>

**What was done**
- <Change or deliverable, described by its effect, not its implementation steps>
- …

**References:** <Branch, PR, commit, ticket, or URLs, if any>

**Notes / follow-ups:** <Only things a reader needs to know or act on: deploy needed, config change, known limitation, suggested follow-up ticket. Omit this line if there are none.>
````

Rules for the completion summary:
- **Write it as if the user wrote it themselves.** It gets pasted as-is into Jira, Slack, or an email. Never mention the session, the chat, the conversation, Claude, AI, "the user", "this skill", or how the summary was produced. Describe the work, not the process of doing it. Use neutral past tense ("Added…", "Fixed…", "Updated…").
- Keep it short: usually under 15 lines. No session instructions, no "Tried and ruled out", no working preferences, no file-by-file detail.
- Write for someone who wasn't in the session and may not be technical. Lead with outcome and impact; mention technical specifics only where a reader would act on them (a migration to run, an env var to set).
- Use only markdown that pastes cleanly into Jira, Slack, or GitHub: bold, bullets, and inline code. No tables, headings below `##`, or emoji beyond the ✅.
- Omit any section or line that has nothing in it.

## Writing rules

- **Self-contained.** Never write "as discussed", "the earlier fix", or "that file". Name the thing.
- **Readable by a developer and an AI alike.** Write it like a good handoff note between engineers. Don't mention the session, the chat, Claude, or "the user" outside the final AI section; say "project owner" or use their name if known. Explain why behind decisions, not just what, so a developer can judge whether they still hold.
- **Exact over vague.** Use absolute paths, exact command lines, exact error text, exact config keys and values, and version numbers. Paraphrase only prose.
- **Facts only.** Don't invent progress. If something was attempted but not confirmed working, say "not verified". If you're unsure of a detail, flag it with `(unverified)`.
- **Completed work gets the completion summary.** Don't produce the full handoff for finished work, and don't imply there's remaining work when there isn't.
- **Tried and ruled out is mandatory when anything failed.** Its purpose is to stop the next session from going in circles.
- **Code snippets** only when the next session needs them verbatim, such as a key function signature, a working config block, or a failing test. Keep them short. Reference files by path rather than pasting them.
- **No secrets.** Replace API keys, passwords, and tokens with `<REDACTED>` and note where the real value lives (e.g. `.env`).
- **Concise but complete.** Aim for something a fresh session can absorb in one read. Trim chatter, keep substance. Longer is fine for a long, complex session, but every line should earn its place.
