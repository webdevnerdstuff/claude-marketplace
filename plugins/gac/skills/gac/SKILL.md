---
name: gac
description: >
  Git add and commit helper, with shorthands that go further. Use this skill
  whenever the user types "/gac" or "gac", or asks to stage and commit files.
  The shorthands "gacp" (commit + push), "gacpp" (commit + push + open a PR),
  "gacppm" (commit + push + PR + merge) and "gacppmr" (all that + a release)
  have their own skills that follow this one. Sources nvm first when it is installed (NVM_DIR is
  unset in the Bash tool shell) so Husky pre-commit hooks work correctly.
  Opens and merges PRs on GitHub (gh), Bitbucket Cloud and self-hosted
  Forgejo/Gitea (bundled scripts, REST APIs); a merge always waits for the
  user to confirm it. Accepts optional arguments: files to stage and a commit
  message. If not provided, checks git status and prompts interactively. Never
  includes the JIRA ticket in the commit message — Husky prepends it
  automatically from the branch name.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/*)
---

# Git Add & Commit (gac)

## What this skill does

Stages files and creates a git commit, making sure nvm is sourced first when
it is installed, so Husky hooks (lint-staged, commit-msg hooks, etc.) can run
without failing.

## Why nvm is sourced first

The Bash tool starts with `NVM_DIR` unset. Without it, nvm can't find its
installation and tries to write to root paths (`/alias`, `/.cache`) which are
read-only in this environment, causing Husky hooks to crash before they even
run. Sourcing nvm at the start of the command fixes this. When nvm isn't
installed (no `~/.nvm/nvm.sh`), the step is skipped and git runs as normal.

## Authorization

Invoking `/gac` is explicit, one-time authorization to stage and commit the
determined files — do not ask "should I commit?" or "ready to proceed?"
before step 3. Only pause for confirmation if the files/message are
genuinely ambiguous (per step 1/2 below).

This authorization is scoped to this skill only. Outside of `/gac`, never
stage or commit files on your own initiative without asking first.

## Shorthands

Each letter after `gac` adds a step, run in this order, stopping at the first
failure and reporting it:

| Typed | Steps |
| --- | --- |
| `gac` | commit |
| `gacp` | commit, push (`git push -u origin <branch>`) |
| `gacpp` | commit, push, open a PR into the repo's default branch |
| `gacppm` | commit, push, open a PR, **ask the user once to confirm the merge** (see **Merging** below), wait for CI to pass, merge it (a merge commit, deleting the branch), then fast-forward local main |
| `gacppmr` | everything `gacppm` does, then tag the merge and publish a release (see **Release** below). On Bitbucket, which has no releases, it runs as `gacppm` |

### Merging (`gacppm` and `gacppmr`)

The shorthand authorizes getting the PR ready, not the merge itself. Ask the user
**once**, as soon as the PR is open, and never make them time it against CI:

1. Right after opening the PR, check where it stands:
   - CI: `pr-checks <number>`, or `gh pr checks <number>` on GitHub. It may still be
     running; that's fine.
   - Reviews: on GitHub `gh pr view <number> --json reviewDecision`; on Bitbucket and
     Forgejo/Gitea `pr-approvals <number>`.
   If a check has already failed, or a required review is missing or changes were
   requested (`REVIEW_REQUIRED`, `CHANGES_REQUESTED`), stop: show what failed or who
   needs to approve, give the PR link, and don't offer to merge.
2. Otherwise ask the user with a question that has buttons (the AskUserQuestion
   tool where it exists): the PR link, the CI state ("passed", "running", or "no CI")
   and the approvals. While CI is still running, the buttons are
   **Merge when CI passes** / **Don't merge**; once it has passed (or there's no CI),
   **Merge** / **Don't merge**. On anything other than a merge button, leave the PR
   open, give its link and stop (no release either).
3. The merge click is the user's approval for this PR. If CI was still running, wait
   for it in the background (`gh pr checks <number> --watch` on GitHub; elsewhere
   re-run `pr-checks` every 15–30 seconds, never a tight loop). Don't ask again:
   - all checks passed: merge right away;
   - a check failed: don't merge; show the failure and the PR link and stop (no
     release either).
4. Merge with `gh pr merge <number> --merge --delete-branch` on GitHub, or
   `pr-merge <number>` elsewhere. On GitHub, a PR can read `BLOCKED` while required
   checks are still running; that's not a refusal, keep waiting for CI. If the merge
   itself is refused after CI passed (branch protection, a required check that never
   runs, a missing approval), show the host's message and stop. Never retry with admin
   or bypass flags.

### Release (`gacppmr` only)

**On Bitbucket** (see **Which host** below), skip everything in this section: there
are no releases there. Tell the user up front that releases aren't supported on
Bitbucket and that you'll run `gacppm` instead, then do exactly that. Don't run
`release-version.sh` and don't push a tag.

Everywhere else, **before step 1**, always ask the user which version to release, so
nothing is committed until the number is settled:

1. Get the options:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/release-version.sh
   ```

   It prints `current` (the latest release, or `0.0.0` when there are none), the
   version files and the version in them (`.claude-plugin/plugin.json`, `package.json`,
   `composer.json`), and the next `patch`, `minor` and `major` versions. If it fails
   because the version files disagree, stop and show its message.

2. Pick a suggestion from the changes being released (the diff and the conversation):
   **major** for anything that breaks how people use it (removed or renamed commands,
   options or files they rely on), **minor** for new features, **patch** for fixes and
   small changes only. If the version files are already ahead of `current` (the user
   bumped them by hand), suggest keeping that version instead.

3. Ask with a question that has buttons (the AskUserQuestion tool where it exists):
   one option each for patch, minor and major, labeled with the bump and the resulting
   version (e.g. "Minor: 1.3.0"), plus "Keep 0.5.1" when the files are already ahead.
   Put your suggestion first and mark it "(Recommended)", and say in a few words why.
   The user can also type a different version.

4. Check the chosen version isn't already released:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/release-version.sh check <version>
   ```

   It prints the tag (e.g. `v1.3.0`; the `v` follows the repo's existing tags). If the
   tag already exists, say so and ask again.

5. If the version files don't already hold that version, write it into them, so it's
   part of the commit:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/release-version.sh set <version>
   ```

   With no version files it changes nothing, and the release is just the tag.

After the merge and the local fast-forward, publish the release on the default branch:

- GitHub: `gh release create <tag> --target <default> --title "<tag>" --notes "<notes>"`
- Forgejo / Gitea: `${CLAUDE_SKILL_DIR}/scripts/gitea.sh release-create <tag> <default> "<tag>" "<notes>"`

`<notes>` is the merged PR's title as a heading, then its summary. Then run
`git fetch --tags` and report the release URL.

### Which host (GitHub, Bitbucket, Forgejo/Gitea)

Before any PR step (and before the release check for `gacppmr`), find the host (run from the repo):

```bash
${CLAUDE_SKILL_DIR}/scripts/detect-host.sh
```

- `github`: use `gh`.
- `bitbucket` (Bitbucket Cloud): use `${CLAUDE_SKILL_DIR}/scripts/bitbucket.sh`; `gh`
  doesn't work there. Commands: `default-branch`, `pr-create <base> "<title>" "<body>"`
  → `<number> <url>`, `pr-checks <number>`, `pr-approvals <number>`, `pr-merge <number>`.
  If it says there's no token, launch `bitbucket.sh setup` in a terminal the user can
  type in (it asks for their Atlassian email and a token, hidden). Setup needs a real
  interactive terminal, run from the repo: use a terminal tool if you have one, otherwise
  ask the user to run it in Terminal/iTerm. Never suggest the `!` prefix or the Bash
  tool for it; neither has a terminal, so it can't prompt. The same goes for `gitea.sh setup`.
- `gitea` (a registered Forgejo or Gitea server): use `${CLAUDE_SKILL_DIR}/scripts/gitea.sh`;
  `gh` doesn't work there. Same commands as Bitbucket, plus `release-create`.
- `unknown`: probably a Forgejo/Gitea server that isn't registered yet. Ask the user for
  its web URL (e.g. `http://git.example.lan:3000`), then launch
  `${CLAUDE_SKILL_DIR}/scripts/gitea.sh setup <web-url>` in a terminal the user can type in
  (it prompts for the token, hidden). If it isn't Forgejo/Gitea either, say PR steps
  aren't supported for that host and stop after the push.

The scripts read the host and repo from `origin`, settings from `~/.config/gac/hosts.json`
and tokens from the macOS Keychain; nothing about a particular server is hard-coded. They
need macOS, `curl` and `jq`. Never put a token on a command line or in a file yourself.

`pr-checks` prints `success` / `pending` / `failure` / `error` / `none`. `none` means the
repo has no CI, which counts as passing. After a merge, run
`git switch <default> && git pull --ff-only && git fetch --prune && git branch -d <branch>`.

If a script reports HTTP 401/403, the token is missing a permission (write access to
repositories and pull requests): say so and stop.

- Typing a shorthand is the user's explicit go-ahead for every step it names except
  the merge, which always waits for the user's one click (given while CI may still
  be running). Nothing past the steps it
  names (no tag, no release) without a new ask.
- Never commit on a main branch: create a descriptively named branch first.
- Never merge while a check is failing or pending, or a required review is missing.
- Attribution in commit messages and PR descriptions follows the user's and
  the project's CLAUDE.md, not this skill.

## Steps

### 1. Determine what to stage

If the user provided specific files as arguments, use those. Otherwise run:

```bash
git -C <project_root> status --short
```

Show the user the status output and ask which files to stage if it's not
obvious from context. For "add all changed files", use `.` or `-A`.

### 2. Determine the commit message

If the user provided a message (e.g., `/gac "fix typo in header"`), use it.

Otherwise, infer the best message from context — run `git diff --staged` (after
staging) and use what was just done in the conversation to write a clear,
accurate message. Don't ask the user unless the changes are genuinely ambiguous
(e.g., unrelated files spanning multiple concerns where a single message would
be misleading).

Do NOT include a JIRA (or other) ticket number in the message, even when the
branch name contains one. Repos that want it run Husky's
`jira-prepare-commit-msg` hook, which reads the branch name and prepends the
ticket automatically; adding it yourself would duplicate it. Only include a
ticket if the user puts it in the message they give you.

Attribution (a `Co-Authored-By: Claude` trailer, a "Generated with" line, or
any mention of Claude or AI) is not this skill's call. Follow the user's
CLAUDE.md and the project's CLAUDE.md / AGENTS.md; when they say nothing, use
Claude Code's default.

### 3. Run add and commit

```bash
[ -s "$HOME/.nvm/nvm.sh" ] && { export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; }; cd <project_root> && git add <files> && git commit -m "<message>"
```

When nvm is installed, `nvm use` prints `Now using node vX.X.X`, which confirms
the environment is correct. If the repo has no `.nvmrc`, it prints a warning
instead; the commit still runs.

### 4. Report the result

Show the commit hash and summary line from the git output. If the commit fails
(e.g. lint errors), show the error output clearly so the user knows what to fix.

## Finding the project root

Use the current working directory. If the Bash tool is running inside a git
worktree, find the actual repo root with:

```bash
git rev-parse --show-toplevel
```

## Commit message style

- Short, imperative, present tense (e.g. "fix broken archive filter", not "fixed" or "fixes")
- No period at the end
- No JIRA ticket prefix — Husky adds it
- If the user gives a vague message, use it as-is — don't rewrite it without asking
