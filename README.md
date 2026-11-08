# claude-mods

All of my Claude Code mods in one marketplace. Add it once, then install any of them.

## Add the marketplace

In a Claude Code terminal session:

```bash
/plugin marketplace add webdevnerdstuff/claude-mods
```

## Install

Pick **user** scope when asked, so a mod loads in every session, including the desktop app's.

### loadout

Every skill and plugin Claude Code has equipped, in one pane. `/loadout` opens it.

```bash
/plugin install loadout@webdevnerdstuff
```

### session-mover

Move Claude desktop Code sessions between sidebar workspaces from a pane. `/move-sessions` opens it.

```bash
/plugin install session-mover@webdevnerdstuff
```

### skin-code

VS Code syntax highlighting and themes for code blocks in Claude Code replies, through Shiki. `/skin-code` switches it.

```bash
/plugin install skin-code@webdevnerdstuff
```

Each mod's own repo has the full docs: [claude-loadout](https://github.com/webdevnerdstuff/claude-loadout), [claude-session-mover](https://github.com/webdevnerdstuff/claude-session-mover), [claude-skin-code](https://github.com/webdevnerdstuff/claude-skin-code).

## Update and remove

To update, refresh the marketplace, then update the mod and restart Claude Code:

```bash
claude plugin marketplace update webdevnerdstuff
```

```bash
claude plugin update <name>@webdevnerdstuff
```

To remove a mod:

```bash
claude plugin uninstall <name>@webdevnerdstuff
```

To remove the marketplace:

```bash
claude plugin marketplace remove webdevnerdstuff
```

## License

MIT © WebDevNerdStuff
