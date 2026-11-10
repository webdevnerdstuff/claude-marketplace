---
name: gacppm
description: Git add, commit, push, open a pull request, wait for CI and merge it once the user confirms, on GitHub, Bitbucket Cloud or self-hosted Forgejo/Gitea. Use when the user types "/gacppm" or "gacppm". Shorthand for the gac skill all the way to a merge.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/*)
---

# gacppm: commit, push, open a PR and merge it

Read `${CLAUDE_PLUGIN_ROOT}/skills/gac/SKILL.md` and follow it exactly, as if the user had typed **`gacppm`**: commit, push, open a PR into the repo's default branch, wait for CI to pass, ask the user to confirm the merge, merge it (a merge commit, deleting the branch), then fast-forward the local default branch. Typing `/gacppm` is the user's go-ahead for every step except the merge itself: that waits for the user to click **Merge** (see **Merging** in the main skill). Never merge while a check is failing or pending, or a required review is missing.

The helper scripts the main skill refers to are in `${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/`.

Arguments, if any (files to stage and/or a commit message): $ARGUMENTS
