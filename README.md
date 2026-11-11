<h1 align="center">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="docs/brand/banner-dark.svg">
		<img alt="claude-marketplace" src="docs/brand/banner-light.svg" width="720">
	</picture>
</h1>

<p align="center">
	<strong>All of my Claude Code mods and skills in one marketplace. Add it once, then install any of them.</strong>
</p>

<p align="center">
	<img alt="Marketplace: webdevnerdstuff" src="https://img.shields.io/badge/marketplace-webdevnerdstuff-ff1190">
	<img alt="Mods: 3" src="https://img.shields.io/badge/mods-3-2492ff">
	<img alt="Skills: 2" src="https://img.shields.io/badge/skills-2-ffb46a">
	<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/webdevnerdstuff/claude-marketplace?color=555"></a>
</p>

<p align="center">
	<a href="#quick-start">Quick start</a> ·
	<a href="#mods">Mods</a> ·
	<a href="#skills">Skills</a> ·
	<a href="#update-and-remove">Update and remove</a>
</p>

## Quick start

In a Claude Code terminal session, add the marketplace once:

```bash
/plugin marketplace add webdevnerdstuff/claude-marketplace
```

Then install whatever you want from it by name:

```bash
/plugin install <name>@webdevnerdstuff
```

> [!TIP]
> Pick **user** scope when asked, so it loads in every session, including the desktop app's.

> [!NOTE]
> **Mods** change how Claude Code looks or behaves: panes, hooks, highlighting. Each one lives in its own repo.
> **Skills** are instructions Claude follows for a task. They live in this repo, under [`plugins/`](plugins).
> Both install the same way, as plugins.

## Mods

| Mod | What it does | Opens with |
| --- | --- | --- |
| [**loadout**](https://github.com/webdevnerdstuff/claude-loadout) | Every skill and plugin Claude Code has equipped, in one pane. | `/loadout` |
| [**session-mover**](https://github.com/webdevnerdstuff/claude-session-mover) | Move Claude desktop Code sessions between sidebar workspaces from a pane. | `/move-sessions` |
| [**skin-code**](https://github.com/webdevnerdstuff/claude-skin-code) | VS Code syntax highlighting and themes for code blocks in Claude Code replies, through Shiki. | `/skin-code` |

```bash
/plugin install loadout@webdevnerdstuff
```

```bash
/plugin install session-mover@webdevnerdstuff
```

```bash
/plugin install skin-code@webdevnerdstuff
```

Each mod's own repo has its full docs.

## Skills

| Skill | What it does | Runs with |
| --- | --- | --- |
| [**gac**](plugins/gac/skills/gac/SKILL.md) | Git add and commit in one step, with shorthands that push, open a PR, merge it once CI passes and you confirm, and publish a release. GitHub, Bitbucket Cloud, Forgejo and Gitea. | `/gac` `/gacp` `/gacpp` `/gacppm` `/gacppmr` |
| [**handoff**](plugins/handoff/skills/handoff/SKILL.md) | A self-contained handoff summary of the session in one copyable block, so work picks up cleanly in a fresh session. For finished work, a short completion summary ready for Jira, Slack or an email. | `/handoff` |

If you already have a command with the same name, use the long form instead: `/gac:gac`, `/handoff:handoff`.

### gac

```bash
/plugin install gac@webdevnerdstuff
```

Add files and a message after the command, or leave them off and it works them out from `git status` and the diff: `/gac src/app.ts "fix header link"`. Each extra letter adds a step:

| Command | Does |
| --- | --- |
| `/gac` | Stage and commit |
| `/gacp` | …then push |
| `/gacpp` | …then open a PR into the default branch |
| `/gacppm` | …then wait for CI to pass, merge the PR once you confirm, and update your local default branch |
| `/gacppmr` | …then tag the merge and publish a release |

Typing the shorthand as a plain message (`gacp`) works too.

**Merging waits for one click from you.** As soon as the PR is open, `/gacppm` shows its link, the CI state and its approvals, and asks once. If CI is still running, click **Merge when CI passes** and it waits, then merges by itself when every check passes. If a check fails, it stops without merging. It won't offer to merge on a failed check or a missing required review, and it never bypasses branch protection.

**Releases always ask first.** Before committing anything, `/gacppmr` asks whether this is a major, minor or patch release, showing the version each one gives (e.g. "Minor: 1.3.0") with its suggestion first. It writes the version you pick into `.claude-plugin/plugin.json`, `package.json` and `composer.json` (whichever exist) as part of the commit, and tags the release to match: `1.3.0` becomes `v1.3.0`. If you already bumped the files yourself, it offers to keep that version.

#### Where PRs work

| Host | PRs and merges | Releases |
| --- | --- | --- |
| GitHub | Through the [`gh`](https://cli.github.com) CLI | Yes |
| Forgejo and Gitea | Through a bundled script | Yes |
| Bitbucket Cloud | Through a bundled script | No |
| Anything else | No: commit and push only | No |

> [!NOTE]
> **Bitbucket has no releases.** `/gacppmr` on a Bitbucket repo tells you so and runs as `/gacppm`: commit, push, PR and merge, with no tag or release.

- **Forgejo and Gitea:** the first time, it asks for your server's URL and an API token with write access to repositories and issues.
- **Bitbucket Cloud:** the first time, it asks for your Atlassian email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens) with the Bitbucket scopes `read:repository`, `read:pullrequest` and `write:pullrequest`. A workspace or repository access token works too; leave the email blank for one of those. Self-hosted Bitbucket Server / Data Center isn't supported.
- Tokens are kept in the macOS Keychain, and the scripts need macOS, `curl` and `jq`.
- **Husky hooks:** if you use [nvm](https://github.com/nvm-sh/nvm), it's loaded before committing so Husky hooks (lint-staged and the like) can find Node.
- **Jira tickets:** it never writes the ticket number into the message itself. Pair it with Husky's [`jira-prepare-commit-msg`](https://www.npmjs.com/package/jira-prepare-commit-msg) hook, which adds the ticket from the branch name (`ABC-123-fix-header` → `ABC-123`).
- **Attribution:** whether commits and PRs credit Claude (e.g. a `Co-Authored-By` line) is up to your `CLAUDE.md` and the project's, not this skill.
- It never commits on a main branch.

### handoff

```bash
/plugin install handoff@webdevnerdstuff
```

Add text after the command to narrow the focus, e.g. `/handoff just the auth migration`.

#### Idle handoff

Turn it on and Claude writes the handoff by itself when you've been idle long enough that the session's prompt cache is about to expire, so the summary is written while the whole conversation is still cached. It's off until you turn it on.

| Command | Does |
| --- | --- |
| `/handoff on` / `/handoff off` | Turns idle handoff on or off |
| `/handoff auto` | Waits until about a minute before your cache expires: 4 minutes on a 5-minute cache, 59 on a 1-hour cache. Detected from the session; the default |
| `/handoff 20` | Waits 20 minutes instead (1–120) |
| `/handoff status` | Shows the current setting |

- It fires once per idle stretch. Your next message re-arms it.
- Each idle handoff is a full reply, so it uses tokens. On a 5-minute cache, with frequent short breaks, you may prefer it off or a longer wait.
- It needs the session to stay open, and doesn't run in `claude -p`.
- For a focus that is one of those words, quote it: `/handoff "status"`.

## Update and remove

To update, refresh the marketplace, then update the plugin and restart Claude Code:

```bash
claude plugin marketplace update webdevnerdstuff
```

```bash
claude plugin update <name>@webdevnerdstuff
```

<details>
<summary>Remove a plugin or the marketplace</summary>

To remove a plugin:

```bash
claude plugin uninstall <name>@webdevnerdstuff
```

To remove the marketplace:

```bash
claude plugin marketplace remove webdevnerdstuff
```

</details>

## License

MIT © WebDevNerdStuff
