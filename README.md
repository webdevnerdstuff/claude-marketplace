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
| [**gac**](plugins/gac) | Git add and commit in one step, with shorthands that push, open a PR, merge it once CI passes and you confirm, and publish a release. GitHub, Bitbucket Cloud, Forgejo and Gitea. | `/gac` `/gacp` `/gacpp` `/gacppm` `/gacppmr` |
| [**handoff**](plugins/handoff) | A self-contained handoff summary of the session in one copyable block, so work picks up cleanly in a fresh session. For finished work, a short completion summary ready for Jira, Slack or an email. Can write one by itself before an idle session's cache expires. | `/handoff` |

```bash
/plugin install gac@webdevnerdstuff
```

```bash
/plugin install handoff@webdevnerdstuff
```

Each skill's README has its full docs: [gac](plugins/gac#readme), [handoff](plugins/handoff#readme).

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
