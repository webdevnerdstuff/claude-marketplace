---
name: gacpp
description: Git add, commit, push and open a pull request in one step, on GitHub, Bitbucket Cloud or self-hosted Forgejo/Gitea. Use when the user types "/gacpp" or "gacpp". Shorthand for the gac skill with a push and a PR.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/*)
---

# gacpp: commit, push and open a PR

Read `${CLAUDE_PLUGIN_ROOT}/skills/gac/SKILL.md` and follow it exactly, as if the user had typed **`gacpp`**: commit, push, then open a PR into the repo's default branch. Typing `/gacpp` is the user's go-ahead for those steps and nothing past them.

The helper scripts the main skill refers to are in `${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/`.

Arguments, if any (files to stage and/or a commit message): $ARGUMENTS
