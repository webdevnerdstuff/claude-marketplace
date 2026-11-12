<h1 align="center">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="../../docs/brand/banners/handoff-dark.svg">
		<img alt="handoff" src="../../docs/brand/banners/handoff-light.svg" width="720">
	</picture>
</h1>

<p align="center">
	<strong>A self-contained summary of your session in one copyable block, so work picks up cleanly in a fresh session. For finished work, a short completion summary ready for Jira, Slack or an email.</strong>
</p>

<p align="center">
	<img alt="Version" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fwebdevnerdstuff%2Fclaude-marketplace%2Fmain%2Fplugins%2Fhandoff%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&prefix=v&color=2492ff">
	<a href="../../README.md"><img alt="Marketplace: webdevnerdstuff" src="https://img.shields.io/badge/marketplace-webdevnerdstuff-ff1190"></a>
	<a href="../../LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/webdevnerdstuff/claude-marketplace?color=555"></a>
</p>

<p align="center">
	<a href="#install">Install</a> ·
	<a href="#usage">Usage</a> ·
	<a href="#what-you-get">What you get</a> ·
	<a href="#commands">Commands</a> ·
	<a href="#size-handoff">Size handoff</a> ·
	<a href="#idle-handoff">Idle handoff</a> ·
	<a href="#saved-files">Saved files</a> ·
	<a href="#good-to-know">Good to know</a>
</p>

## Install

Add the [marketplace](../../README.md#quick-start) if you haven't, then:

```bash
/plugin install handoff@webdevnerdstuff
```

> [!TIP]
> If you already have a `/handoff` command, use the long form: `/handoff:handoff`.

## Usage

```bash
/handoff                         # the whole session
/handoff just the auth migration # one thread of the work
```

The handoff is saved to your project, and a band above the prompt offers:

| Button | Does |
| --- | --- |
| **Copy** | Copies it, ready to paste into a new chat |
| **Start new chat** | Opens a new chat in the Claude desktop app with it filled in; press Return to start |
| **Open file** | Opens the saved file |
| **Close** | Hides the band |

Paste it as the first message of a new session. The new session confirms what it's picking up and proposes the first step.

## What you get

It works out whether the work is in progress, blocked or complete, and writes for whoever reads it next.

**In progress or blocked: a full handoff** for a fresh session or a developer who wasn't there. Empty sections are left out.

| Section | What's in it |
| --- | --- |
| Goal | What "done" looks like, and why |
| Environment & context | Repo, branch, uncommitted changes, stack, URLs and tickets |
| Done so far | Each item, and how it was verified |
| Current state | What works, what's broken, the latest error verbatim |
| Blocker | What's blocking, who can unblock it, what to do after (blocked only) |
| Next steps | In priority order, specific enough to start on |
| Key decisions & constraints | Each decision and why it was made |
| Tried and ruled out | So the next session doesn't go in circles |
| Relevant files & commands | Paths and exact command lines |
| Open questions | Anything waiting on a decision |
| Working conventions | How the work should be done, e.g. "don't commit without approval" |

**Complete: a completion summary** for a person, such as a teammate, a project manager or a ticket. It reads as if you wrote it, with no mention of the session or AI.

<details>
<summary>Example completion summary</summary>

```markdown
## ✅ Complete: Fix duplicate order emails

**Summary:** Customers were getting two confirmation emails for some orders. Orders now send exactly one.

**What was done**
- Stopped the payment webhook from re-sending the confirmation when it retries
- Added a test that covers the retry case

**References:** Branch `fix-duplicate-order-emails`, PR #142

**Notes / follow-ups:** Deploy needed; no migration.
```

</details>

## Commands

| Command | Does |
| --- | --- |
| **Write** | |
| `/handoff` | Writes a handoff of the session |
| `/handoff <focus>` | Writes one about just that part of the work. Quote a focus that is also a command: `/handoff "list"` |
| **Find** | |
| `/handoff list` | Opens a pane of this project's saved handoffs (see [Saved files](#saved-files)) |
| `/handoff purge` | Moves all of this project's saved handoffs to the Trash, after you confirm |
| **Size handoff** | |
| `/handoff 80%` or `/handoff at 80%` | Offers one at this share of the point where the session compacts, 50–95%. **Default: 80%** |
| `/handoff 250k` or `/handoff at 250k` | Offers one at a fixed number of tokens instead, 50k–900k |
| `/handoff at off` | Turns the size handoff off |
| `/handoff size ask` | Asks first, with **Write handoff** and **Not now**. **Default** |
| `/handoff size auto` | Writes it straight away |
| **Idle handoff** | |
| `/handoff on` / `/handoff off` | Turns idle handoff on or off. **Default: on** |
| `/handoff auto` | Waits until about a minute before the prompt cache expires. **Default** |
| `/handoff 20` or `/handoff 20m` | Waits 20 minutes instead, 1–120 |
| `/handoff sleep on` / `off` | macOS: hands off a few minutes before the Mac goes to sleep. **Default: on** |
| `/handoff awake on` / `off` | macOS: keeps the Mac awake while a timer waits, on power only. **Default: off** |
| **Settings** | |
| `/handoff settings` | Shows the current settings |
| `/handoff help` or `/handoff h` | Lists every command, with your current settings |
| `/handoff reset` | Puts every setting back to its default |

Setting a wait, `sleep on` or `awake on` also turns idle handoff on. Settings apply to every session, open ones included.

## Size handoff

When the context fills up, Claude Code compacts the conversation, and a handoff written after that has less to work from. The size handoff gets in first.

- **When:** after a reply ends, once the context passes the threshold. 80% of the compaction point is about 775k tokens on a 1M window and about 135k on a 200k one. With auto-compact off, it's a share of the whole window.
- **Not now:** it asks once more, halfway through the room left before compaction (at least 10k tokens later).
- **After `/compact` or `/clear`:** it's ready to fire again.
- **`ask` or `auto`:** `auto` spends a model call you didn't ask for each time it fires, which is why `ask` is the default.

## Idle handoff

When you've been away long enough that the session's prompt cache is about to expire, it writes a handoff while the conversation is still cached. It's waiting above the prompt when you come back, with the same buttons.

- **When:** about a minute before the cache expires, so 4 minutes on a 5-minute cache and 59 on a 1-hour cache. It fires once per idle stretch; your next message re-arms it.
- **Cost:** each one is a model call. With a 5-minute cache and frequent short breaks, try a longer wait or turn it off.
- **Skipped:** sessions with no real work, such as a single quick question.
- **Limits:** the session must stay open, and it doesn't run in `claude -p`. Each session times itself.

> [!IMPORTANT]
> **It can't wake a sleeping computer.** If the computer sleeps and the cache expires meanwhile, the idle handoff is skipped, rather than re-reading the whole conversation at full price. Run `/handoff` yourself when you're back.

### Sleep and keep-awake (macOS)

Most Macs sleep soon after the display turns off, often before a 1-hour cache runs out. Pick one:

- **`/handoff sleep on`** (default). It reads the Mac's sleep timers and how long you've been away, then hands off about 3 minutes before the Mac is due to sleep. With the display set to turn off after 30 minutes, an hour away gets its handoff at about minute 28. The timing is an estimate: an app keeping the Mac awake, such as one playing audio, makes it hand off earlier than needed.
- **`/handoff awake on`**. Uses macOS's `caffeinate` to keep the Mac awake while a timer waits, then lets go when the handoff fires or you type.
  - It only works on power: on battery, or when you unplug, the Mac sleeps as usual.
  - The display still turns off and locks, and closing the lid still sleeps.
  - With both on, `sleep on` only acts while `awake` isn't holding the Mac, e.g. on battery.
- **System Settings › Battery › Options › Prevent automatic sleeping on power adapter when the display is off.** The Mac never idle-sleeps while plugged in.
- **`caffeinate -i -t 3900`** in a terminal before you step away keeps the Mac awake for 65 minutes.

## Saved files

Every handoff, whether typed, size or idle, is saved in the project:

```text
<project>/.claude/handoff/2026-11-12-0905-fix-duplicate-order-emails.md
```

`<project>` is the git root, or the working folder outside a repo. The file name is the date, the time and the title.

**`/handoff list`** opens a pane beside the chat, newest first.
- Each handoff shows its title, when it was saved and its status, with **Copy**, **Open file**, **Start new chat** and **Delete** (to the Trash).
- **Refresh** picks up handoffs saved by other sessions or changed in Finder. Escape closes the pane.
- It's how you reach an idle handoff later. Where a pane can't open, it prints a table instead.

**`/handoff purge`** moves every saved handoff to the Trash, after you confirm. It never deletes for good: on Linux it uses `gio trash`, and with no Trash it deletes nothing.

**`.claude/handoff/handoff.log`** has one line per event:
- what started each handoff, and whether it was saved, skipped, cancelled or failed;
- size offers, **Not now**, deletes and purges;
- list buttons that failed, and why.

It keeps the last 500 lines and never holds handoff text.

```text
2026-11-12 15:42:07  a1b2c3d4  start      size-auto · context 252k
2026-11-12 15:42:20  a1b2c3d4  saved      786 words in 13 s → 2026-11-12-1542-plan-dry-run-flag.md
```

Nothing is added to `.gitignore`. To keep handoffs out of git, add `.claude/handoff/` to `.gitignore`, or to `.git/info/exclude` for just your clone.

## Good to know

- **Requirements.**
  - The buttons, the size handoff and the list pane need Claude Code 2.1.311 or later. On older versions, `/handoff` still writes and saves the handoff as a normal reply.
  - Idle handoff runs a small bash script, so it needs macOS, Linux, or Windows with [Git Bash](https://git-scm.com/downloads/win). It hasn't been tested on Windows.
- **One file, nothing else.** It runs only read-only git commands (`status`, `log`, the branch) and writes only the handoff file. It never changes, stages or commits anything.
- **Kept out of your chat.** It writes the handoff in the background, checked against the files, skills and links the session used, so no long reply lands in the conversation.
- **No secrets.** API keys, passwords and tokens become `<REDACTED>`, with a note on where the real value lives.
- **Facts only.** Anything not confirmed working is marked "not verified".
- **Settings** live in `~/.claude/handoff/`. Uninstalling leaves that folder behind; delete it if you want them gone.

## Update and remove

See [Update and remove](../../README.md#update-and-remove) in the marketplace README.

## License

MIT © WebDevNerdStuff
