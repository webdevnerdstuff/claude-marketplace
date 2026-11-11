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

Copy the block from the reply and paste it as the first message of a new session. The new session confirms what it's picking up and proposes the first step.

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

## Idle handoff

Turn it on and Claude writes the handoff by itself when you've been idle long enough that the session's prompt cache is about to expire, so the summary is written while the whole conversation is still cached. It's off until you turn it on.

| Command | Does |
| --- | --- |
| `/handoff on` / `/handoff off` | Turns idle handoff on or off. On uses the wait you last chose, `auto` until you pick one |
| `/handoff auto` | Turns it on and waits until about a minute before your cache expires: 4 minutes on a 5-minute cache, 59 on a 1-hour cache. Detected from the session; the default |
| `/handoff 20` | Turns it on and waits 20 minutes instead (1–120) |
| `/handoff awake on` / `/handoff awake off` | Keeps your Mac from going to sleep while a timer waits, so the handoff still happens (see below). Off by default; `awake on` also turns idle handoff on |
| `/handoff sleep on` / `/handoff sleep off` | Hands off a few minutes before your Mac goes to sleep, if that comes before the wait runs out (see below). Off by default; `sleep on` also turns idle handoff on |
| `/handoff settings` or `/handoff status` | Shows the current settings |
| `/handoff help` | Lists every option, with your current settings |

- It fires once per idle stretch. Your next message re-arms it.
- Each idle handoff is a full reply, so it uses tokens. On a 5-minute cache, with frequent short breaks, you may prefer it off or a longer wait.
- It needs the session to stay open, and doesn't run in `claude -p`.
- Each session times itself. Working in another session doesn't stop it, and the settings apply to every session.
- For a focus that is one of those words, quote it: `/handoff "settings"`.

### Sleep and keep-awake

> [!IMPORTANT]
> **It can't wake a sleeping computer.** The handoff only happens while the computer is awake. If it sleeps while you're away (say, an hour at lunch) and the cache expires in the meantime, the idle handoff is skipped when the computer wakes, rather than re-reading the whole conversation at full price. Run `/handoff` yourself when you're back.

Most Macs go to sleep a few minutes after the display turns off, which is often well before a 1-hour cache runs out. To keep idle handoff working while you step away, pick one:

- **`/handoff sleep on`** (macOS). Hands off early instead of keeping the Mac awake. It reads your Mac's sleep timers and how long it's been since you last touched the keyboard or mouse, in any app, and hands off about 3 minutes before the Mac is due to sleep. The Mac then sleeps as usual. For example, with the display set to turn off after 30 minutes, an hour away gets its handoff at about minute 28, still cached.
  - The timing is an estimate. If an app is keeping the Mac awake (playing audio, say), the handoff comes earlier than it needed to, which is still cheap.
  - With `awake on` too, it only acts while keep-awake isn't holding the Mac awake, e.g. on battery.
  - On Linux and Windows it does nothing.
- **`/handoff awake on`** (macOS). While a timer is waiting, it keeps the Mac from going to sleep with macOS's built-in `caffeinate`, and lets go the moment the handoff fires or you type. Nothing to install.
  - Only on power: on battery it lets the Mac sleep as usual, and unplugging mid-wait lets go within seconds.
  - The display still turns off and locks as usual, and closing the lid still puts the Mac to sleep.
  - On Linux and Windows it does nothing.
- **System Settings › Battery › Options › Prevent automatic sleeping on power adapter when the display is off.** The Mac never idle-sleeps while plugged in, not just during the wait.
- **`caffeinate -i -t 3900`** in a terminal tab before you step away keeps the Mac awake for 65 minutes.

## Good to know

- **Read-only.** It runs only read-only git commands (`status`, `log`, the current branch) and never creates, changes or commits files. The summary is in the reply only.
- **No secrets.** API keys, passwords and tokens become `<REDACTED>`, with a note on where the real value lives.
- **Facts only.** Anything not confirmed working is marked "not verified" rather than reported as done.

## Update and remove

See [Update and remove](../../README.md#update-and-remove) in the marketplace README.

## License

MIT © WebDevNerdStuff
