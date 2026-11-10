---
name: gacppm
description: Git add, commit, push, open a pull request, wait for CI and merge it, on GitHub or self-hosted Forgejo/Gitea. Use when the user types "/gacppm" or "gacppm". Shorthand for the gac skill all the way to a merge.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/forge.sh *)
---

# gacppm: commit, push, open a PR and merge it

Read `${CLAUDE_PLUGIN_ROOT}/skills/gac/SKILL.md` and follow it exactly, as if the user had typed **`gacppm`**: commit, push, open a PR into the repo's default branch, wait for CI to pass, merge it (a merge commit, deleting the branch), then fast-forward the local default branch. Typing `/gacppm` is the user's go-ahead for those steps and nothing past them. Never merge while a check is failing or pending.

The forge helper the main skill refers to is `${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/forge.sh`.

Arguments, if any (files to stage and/or a commit message): $ARGUMENTS
