---
name: gacppmr
description: Git add, commit, push, open a pull request, wait for CI, merge it and publish a release tagged from the project's version, on GitHub or self-hosted Forgejo/Gitea. Use when the user types "/gacppmr" or "gacppmr". Shorthand for the gac skill all the way to a release.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/forge.sh *) Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/release-version.sh)
---

# gacppmr: commit, push, open a PR, merge it and release

Read `${CLAUDE_PLUGIN_ROOT}/skills/gac/SKILL.md` and follow it exactly, as if the user had typed **`gacppmr`**: work out the release tag first, then commit, push, open a PR into the repo's default branch, wait for CI to pass, merge it (a merge commit, deleting the branch), fast-forward the local default branch, and publish the release. Typing `/gacppmr` is the user's go-ahead for those steps and nothing past them. Never merge while a check is failing or pending, and stop before committing if the release tag can't be worked out.

The helpers the main skill refers to are in `${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/`: `forge.sh` and `release-version.sh`.

Arguments, if any (files to stage and/or a commit message): $ARGUMENTS
