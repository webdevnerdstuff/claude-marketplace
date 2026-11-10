---
name: gacp
description: Git add, commit and push in one step. Use when the user types "/gacp" or "gacp". Shorthand for the gac skill with a push.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/*)
---

# gacp: commit and push

Read `${CLAUDE_PLUGIN_ROOT}/skills/gac/SKILL.md` and follow it exactly, as if the user had typed **`gacp`**: commit, then push (`git push -u origin <branch>`). Typing `/gacp` is the user's go-ahead for both steps and nothing past them.

Arguments, if any (files to stage and/or a commit message): $ARGUMENTS
