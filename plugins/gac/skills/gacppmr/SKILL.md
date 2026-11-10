---
name: gacppmr
description: Git add, commit, push, open a pull request, wait for CI, merge it once the user confirms and publish a release, asking the user for a major/minor/patch version first, on GitHub or self-hosted Forgejo/Gitea. On Bitbucket, which has no releases, it runs as gacppm. Use when the user types "/gacppmr" or "gacppmr". Shorthand for the gac skill all the way to a release.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/*)
---

# gacppmr: commit, push, open a PR, merge it and release

Read `${CLAUDE_PLUGIN_ROOT}/skills/gac/SKILL.md` and follow it exactly, as if the user had typed **`gacppmr`**: first ask the user whether this is a major, minor or patch release, with your suggestion and the resulting versions (see **Release** in the main skill), then commit, push, open a PR into the repo's default branch, wait for CI to pass, ask the user to confirm the merge, merge it (a merge commit, deleting the branch), fast-forward the local default branch, and publish the release. Typing `/gacppmr` is the user's go-ahead for every step except the merge itself: that waits for the user to click **Merge** (see **Merging** in the main skill), and no release is made without it. Never merge while a check is failing or pending, or a required review is missing, and don't commit until the version is chosen.

On Bitbucket there are no releases: tell the user so up front and run it as `gacppm` instead, with no error.

The helper scripts the main skill refers to are in `${CLAUDE_PLUGIN_ROOT}/skills/gac/scripts/`.

Arguments, if any (files to stage and/or a commit message): $ARGUMENTS
