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
	<a href="#saved-handoffs">Saved handoffs</a> ·
	<a href="#size-handoff">Size handoff</a> ·
	<a href="#idle-handoff">Idle handoff</a> ·
	<a href="#good-to-know">Good to know</a>
</p>

## Install

Add the [marketplace](../../README.md#quick-start) if you haven't, then:

```bash
/plugin install handoff@webdevnerdstuff
```

> [!TIP]
> If you already have a `/handoff` command, use the long form instead: `/handoff:handoff`.

## Usage

Write a handoff of the whole session:

```bash
/handoff
```

Or add text after the command to cover just one thread of the work:

```bash
/handoff just the auth migration
```

The handoff shows in the chat and is saved as a file in your project (see [Saved handoffs](#saved-handoffs)). A band above the prompt offers **Copy**, **Start new chat** and **Open file**. Paste it as the first message of a new session; the new session confirms what it's picking up and proposes the first step.

## What you get

It decides whether the work is in progress, blocked or complete, and writes for whoever reads it next.

**In progress or blocked: a full handoff**, written for a fresh session or another developer who wasn't there. It covers:

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

Empty sections are left out.

**Complete: a completion summary**, written for a person: a teammate, a project manager or a ticket comment. It reads as if you wrote it yourself, with no mention of the session or AI, and pastes cleanly into Jira, Slack, GitHub or an email.

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

## Saved handoffs

Every handoff is saved as a markdown file in the project you're working in:

```text
<project>/.claude/handoff/2026-11-12-0905-fix-duplicate-order-emails.md
```

- `<project>` is the git repo's root, or the working folder outside a repo.
- The name is the date and time, then the handoff's title.
- Idle handoffs and size handoffs are saved the same way, so one is waiting for you when you come back.
- `/handoff list` opens a pane beside the chat with this project's saved handoffs, newest first: each one's title, when it was saved and its status, with **Copy**, **Open file**, **Start new chat** and **Delete**, which moves that one file to the Trash. It updates when a new handoff is saved in this session while it's open; **Refresh** at the top reads the folder again, for handoffs saved by another session or files changed in Finder. Escape closes it. Where a pane can't open, the list prints as a table instead. It's the way to reach an idle handoff, which is saved while you're away and gets no buttons of its own.
- `/handoff purge` lists this project's saved handoffs and, after you press **Delete** (or say yes), moves them to the Trash. It never deletes them for good: on Linux it uses `gio trash`, and where there's no Trash it deletes nothing.
- `.claude/handoff/handoff.log` records what happened, one line per event: what started each handoff (typed, size offer, size auto, idle, idle before sleep, Try again) with the context size, then whether it was saved (words, time, file), skipped, cancelled or failed (and at which step). It also records size offers, **Not now**, purges and single deletes from the list. When a list button fails (Copy, Start new chat or Delete), it logs a `failed` line with the file and why, and the note in the list turns red. It keeps the last 500 lines and never holds the handoff text itself. `/handoff purge` leaves it in place.

  ```text
  2026-11-12 15:42:07  a1b2c3d4  start      size-auto · context 252k
  2026-11-12 15:42:20  a1b2c3d4  saved      786 words in 13 s → 2026-11-12-1542-plan-dry-run-flag.md
  ```
- Nothing is added to `.gitignore`. To keep handoffs out of git, add `.claude/handoff/` to your `.gitignore`, or to `.git/info/exclude` for just your clone.

After a handoff, a band above the prompt offers:

| Button | Does |
| --- | --- |
| **Copy** | Copies the handoff, ready to paste into a new chat |
| **Start new chat** | Opens a new chat in the Claude desktop app with the handoff filled in; press Return to start it |
| **Open file** | Opens the saved file |
| **Close** | Hides the band |

When you type `/handoff`, the plugin writes the handoff in the background from a copy of the session, so it doesn't add a long reply to your conversation. It reads the session's record first (the files you read and changed, the skills and MCP servers you used, links, and the git state) and gives those to the writer to check against. If that fails, Claude writes it in a normal reply instead.

## Size handoff

Long sessions run out of room: when the context fills up, Claude Code compacts the conversation, and a handoff written after that has less to work from. The size handoff catches it first. After each reply, when the context has passed the threshold, it either asks or writes one straight away. It's on by default at 80% of the point where this session compacts, asking first. That follows the model's window: about 775k on a 1M window, about 135k on a 200k one.

| Command | Does |
| --- | --- |
| `/handoff at 80%` or `/handoff 80%` | Sets the threshold as a share of the point where the session compacts, worked out each reply (with auto-compact off, of the whole window), from 50% to 95%. 80% is the default |
| `/handoff at 250k` or `/handoff 250k` | Sets a fixed threshold instead, in thousands of tokens (50k–900k). Also turns the size handoff on. A plain number, or one ending in `m`, is the idle wait in minutes |
| `/handoff at off` | Turns the size handoff off |
| `/handoff size ask` | When the threshold is passed, shows "Context at 252k. Write a handoff before it compacts?" with **Write handoff** and **Not now**. The default |
| `/handoff size auto` | Writes the handoff as soon as the reply that passed the threshold ends |

- It fires once per crossing. After it fires, or after **Not now**, it waits half the room left before compaction (at least 10k tokens), so it asks once more before the session compacts.
- If the context drops back under the threshold (after `/compact` or `/clear`), it's ready to fire again.
- It never fires while Claude is replying, only after a reply ends.
- `size auto` makes a model call you didn't ask for each time it fires, which is why `ask` is the default.
- The size and idle handoffs are separate: neither setting turns the other on or off.

## Idle handoff

Turn it on and a handoff is written by itself when you've been idle long enough that the session's prompt cache is about to expire, so the summary is written while the whole conversation is still cached. It's on by default; `/handoff off` turns it off.

It's written in the background, like the size handoff: saved to `.claude/handoff/`, with the **Copy**, **Start new chat** and **Open file** buttons waiting above the prompt when you come back, and nothing added to the conversation. (Where the plugin's hooks module can't load, Claude writes it as a normal reply instead.) Like the size handoff, it skips a session with no real work in it, such as a single quick question.

| Command | Does |
| --- | --- |
| `/handoff on` / `/handoff off` | Turns idle handoff on (the default) or off. On uses the wait you last chose, `auto` until you pick one |
| `/handoff auto` | Turns it on and waits until about a minute before your cache expires: 4 minutes on a 5-minute cache, 59 on a 1-hour cache. Detected from the session; the default |
| `/handoff 20` or `/handoff 20m` | Turns it on and waits 20 minutes instead (1–120) |
| `/handoff awake on` / `/handoff awake off` | Keeps your Mac from going to sleep while a timer waits, so the handoff still happens. The screen still turns off and locks as usual (see below). Off by default; `awake on` also turns idle handoff on |
| `/handoff sleep on` / `/handoff sleep off` | Hands off a few minutes before your Mac goes to sleep, if that comes before the wait runs out (see below). On by default; `sleep on` also turns idle handoff on |
| `/handoff reset` or `/handoff default` | Puts every setting, idle and size, back to its default: idle handoff on (wait `auto`, before-sleep on, keep-awake off), size handoff on at 80%, asking first |
| `/handoff settings` or `/handoff status` | Shows the current settings |
| `/handoff help` or `/handoff h` | Lists every option, with your current settings |

- It fires once per idle stretch. Your next message re-arms it.
- Each idle handoff is a model call, so it uses tokens. On a 5-minute cache, with frequent short breaks, you may prefer it off or a longer wait.
- It needs the session to stay open, and doesn't run in `claude -p`.
- Each session times itself. Working in another session doesn't stop it.
- **The settings apply to every session.** `/handoff 5` in one session sets a 5-minute wait in all of them, open ones included.
- It runs a small bash script after each reply, so it needs macOS, Linux, or Windows with [Git Bash](https://git-scm.com/downloads/win). It hasn't been tested on Windows.
- For a focus that is one of those words, quote it: `/handoff "settings"`, `/handoff "reset"`, `/handoff "list"`, `/handoff "purge"`.

### Sleep and keep-awake

> [!IMPORTANT]
> **It can't wake a sleeping computer.** The handoff only happens while the computer is awake. If it sleeps while you're away (say, an hour at lunch) and the cache expires in the meantime, the idle handoff is skipped when the computer wakes, rather than re-reading the whole conversation at full price. Run `/handoff` yourself when you're back.

Most Macs go to sleep a few minutes after the display turns off, which is often well before a 1-hour cache runs out. To keep idle handoff working while you step away, pick one:

- **`/handoff sleep on`** (macOS, on by default). Hands off early instead of keeping the Mac awake. It reads your Mac's sleep timers and how long it's been since you last touched the keyboard or mouse, in any app, and hands off about 3 minutes before the Mac is due to sleep. The Mac then sleeps as usual. For example, with the display set to turn off after 30 minutes, an hour away gets its handoff at about minute 28, still cached.
  - The timing is an estimate. If an app is keeping the Mac awake (playing audio, say), the handoff comes earlier than it needed to, which is still cheap.
  - With `awake on` too, it only acts while keep-awake isn't holding the Mac awake, e.g. on battery.
  - On Linux and Windows it does nothing.
- **`/handoff awake on`** (macOS). While a timer is waiting, it keeps the Mac itself from going to sleep (not the screen: that still turns off) with macOS's built-in `caffeinate`, and lets go the moment the handoff fires or you type. Nothing to install.
  - Only on power: on battery it lets the Mac sleep as usual, and unplugging mid-wait lets go within seconds.
  - The display still turns off and locks as usual, and closing the lid still puts the Mac to sleep.
  - On Linux and Windows it does nothing.
- **System Settings › Battery › Options › Prevent automatic sleeping on power adapter when the display is off.** The Mac never idle-sleeps while plugged in, not just during the wait.
- **`caffeinate -i -t 3900`** in a terminal tab before you step away keeps the Mac awake for 65 minutes.

## Good to know

- **One file, nothing else.** Writing a handoff runs only read-only git commands (`status`, `log`, the current branch) and creates exactly one file, the handoff in `.claude/handoff/`. It never changes, stages or commits anything else.
- **The buttons need the mod.** The size handoff, the band, its buttons and the `/handoff list` pane come from the plugin's hooks module, which needs Claude Code 2.1.311 or later. Where it doesn't load, `/handoff` still writes and saves the handoff as a normal reply.
- **Settings file.** The idle and size handoff settings are saved in `~/.claude/handoff/`. Uninstalling the plugin leaves that folder behind; delete it if you want them gone.
- **No secrets.** API keys, passwords and tokens become `<REDACTED>`, with a note on where the real value lives.
- **Facts only.** Anything not confirmed working is marked "not verified" rather than reported as done.

## Update and remove

See [Update and remove](../../README.md#update-and-remove) in the marketplace README.

## License

MIT © WebDevNerdStuff
