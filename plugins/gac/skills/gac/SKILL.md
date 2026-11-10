---
name: gac
description: >
  Git add and commit helper, with shorthands that go further. Use this skill
  whenever the user types "/gac", "gac", "gacp" (commit + push), "gacpp"
  (commit + push + open a PR) or "gacppm" (commit + push + PR + merge), or asks
  to stage and commit files. Sources nvm first when it is installed (NVM_DIR is
  unset in the Bash tool shell) so Husky pre-commit hooks work correctly.
  Opens and merges PRs on GitHub (gh) and on self-hosted Forgejo/Gitea
  (bundled scripts/forge.sh, REST API). Accepts optional arguments: files to
  stage and a commit message. If not provided, checks git status and prompts
  interactively. Never includes the JIRA ticket in the commit message — Husky
  prepends it automatically from the branch name.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/forge.sh *)
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
| `gacppm` | commit, push, open a PR, wait for CI to pass, merge it (a merge commit, deleting the branch), then fast-forward local main |

### Which forge (GitHub vs Forgejo/Gitea)

Before any PR step, check the remote with the bundled helper (run from the repo):

```bash
${CLAUDE_SKILL_DIR}/scripts/forge.sh kind
```

- `github`: use `gh` as usual.
- `forgejo` / `gitea`: use the helper; `gh` doesn't work there. It reads the
  host from `origin`, the web URL from `~/.config/gac/hosts.json`, and the API
  token from the macOS Keychain (service `gac-forge:<host>`). Nothing about a
  particular server is hard-coded. The helper needs macOS, `curl` and `jq`.
  - default branch: `forge.sh default-branch`
  - open the PR: `forge.sh pr-create <base> "<title>" "<body>"` → prints `<number> <url>`
  - CI: `forge.sh pr-checks <number>` → `success` / `pending` / `failure` / `error` /
    `none`. `none` means the repo has no CI, so it's OK to merge. While `pending`, re-check
    (in the background, not a tight loop). Never merge on `pending`, `failure` or `error`.
  - merge: `forge.sh pr-merge <number>` (merge commit, deletes the branch) → `merged`
  - Then `git switch <default> && git pull --ff-only && git fetch --prune && git branch -d <branch>`.
- `unknown`: the host isn't registered yet. Ask the user for the forge's web URL (e.g.
  `http://git.example.lan:3000`), then launch `${CLAUDE_SKILL_DIR}/scripts/forge.sh setup <web-url>`
  in a terminal the user can type in (it prompts for the token, hidden). Never put a token on a
  command line or in a file yourself.

If the helper reports an HTTP 401/403 on create or merge, the token is missing a scope
(it needs write access to repositories and issues): say so and stop.

- Typing a shorthand is the user's explicit go-ahead for every step it names,
  and only those. Nothing past them (no tag, no release) without a new ask.
- Never commit on a main branch: create a descriptively named branch first.
- Never merge while a check is failing or pending; if CI fails, stop and show it.
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
