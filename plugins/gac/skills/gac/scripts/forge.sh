#!/usr/bin/env bash
# forge.sh: PR helper for self-hosted Forgejo / Gitea remotes (GitHub uses gh instead).
#
# Run from inside the repo. Works out host/owner/repo from the `origin` remote, so no
# server is hard-coded. Per-user state:
#   ~/.config/gac/hosts.json   { "<git host>": { "type": "forgejo", "url": "http://host:3000" } }
#   macOS Keychain             service "gac-forge:<git host>", account $USER  (API token)
#
# Commands:
#   kind                      github | forgejo | unknown   (unknown = host not set up yet)
#   setup <web-url>           register this repo's host (checks /api/v1/version), then
#                             prompts for a token (hidden) and saves it to the Keychain
#   default-branch            the repo's default branch
#   pr-create <base> <title> [body]   open a PR from the current branch; prints "<number> <url>"
#   pr-checks <number>        success | pending | failure | error | none  (none = no CI)
#   pr-merge <number>         merge commit + delete the branch; prints "merged"
set -euo pipefail

CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/gac/hosts.json"

die() { echo "forge.sh: $*" >&2; exit 1; }

remote_url() { git remote get-url origin 2>/dev/null || die "no origin remote"; }

# Parse origin into HOST and SLUG (owner/repo). Handles scp-style, ssh:// and https://,
# and resolves ~/.ssh/config aliases to their real HostName.
parse_remote() {
  local url rest
  url=$(remote_url)
  case "$url" in
    http://*|https://*|ssh://*)
      rest=${url#*://}; rest=${rest#*@}
      HOST=${rest%%/*}; HOST=${HOST%%:*}
      SLUG=${rest#*/} ;;
    *@*:*|*:*)
      rest=${url#*@}
      HOST=${rest%%:*}
      SLUG=${rest#*:} ;;
    *) die "can't parse remote: $url" ;;
  esac
  SLUG=${SLUG%.git}; SLUG=${SLUG%/}
  if [[ "$url" != http* ]] && command -v ssh >/dev/null; then
    local real
    real=$(ssh -G "$HOST" 2>/dev/null | awk '/^hostname /{print $2; exit}')
    [[ -n "$real" ]] && HOST=$real
  fi
}

host_field() { [[ -f "$CONFIG" ]] && jq -r --arg h "$HOST" --arg f "$1" '.[$h][$f] // empty' "$CONFIG"; }

token() {
  security find-generic-password -a "$USER" -s "gac-forge:$HOST" -w 2>/dev/null \
    || die "no token for $HOST in the Keychain; run: forge.sh setup <web-url>"
}

api() { # api METHOD PATH [JSON]
  local base; base=$(host_field url); [[ -n "$base" ]] || die "$HOST isn't set up; run: forge.sh setup <web-url>"
  local args=(-sS -X "$1" -H "Authorization: token $(token)" -H "Accept: application/json" -w '\n%{http_code}')
  [[ $# -ge 3 ]] && args+=(-H "Content-Type: application/json" -d "$3")
  local out code
  out=$(curl "${args[@]}" "${base%/}/api/v1$2") || die "request failed: $1 $2"
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [[ "$code" -ge 400 ]]; then die "$1 $2 -> HTTP $code: $(jq -r '.message // .' <<<"$out" 2>/dev/null || echo "$out")"; fi
  printf '%s' "$out"
}

parse_remote
cmd=${1:-}; shift || true

case "$cmd" in
  kind)
    if [[ "$HOST" == "github.com" ]]; then echo github
    elif [[ -n "$(host_field type)" ]]; then host_field type
    else echo unknown; fi ;;

  setup)
    web=${1:?usage: forge.sh setup <web-url>}; web=${web%/}
    ver=$(curl -sS "$web/api/v1/version" | jq -r '.version // empty') || true
    [[ -n "$ver" ]] || die "$web/api/v1/version didn't answer like Forgejo/Gitea"
    type=gitea; [[ "$ver" == *forgejo* || "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+\+gitea ]] && type=forgejo
    mkdir -p "$(dirname "$CONFIG")"; [[ -f "$CONFIG" ]] || echo '{}' > "$CONFIG"
    tmp=$(mktemp); jq --arg h "$HOST" --arg u "$web" --arg t "$type" '.[$h] = {type: $t, url: $u}' "$CONFIG" > "$tmp" && mv "$tmp" "$CONFIG"
    echo "Registered $HOST -> $web ($type $ver)"
    if ! security find-generic-password -a "$USER" -s "gac-forge:$HOST" >/dev/null 2>&1; then
      read -r -s -p "API token for $HOST (Settings → Applications; write:repository + write:issue): " tok; echo
      security add-generic-password -U -a "$USER" -s "gac-forge:$HOST" -l "gac token ($HOST)" -w "$tok"
      echo "Token saved to the Keychain."
    fi ;;

  default-branch)
    api GET "/repos/$SLUG" | jq -r '.default_branch' ;;

  pr-create)
    base=${1:?base}; title=${2:?title}; body=${3:-}
    head=$(git branch --show-current)
    api POST "/repos/$SLUG/pulls" "$(jq -n --arg b "$base" --arg h "$head" --arg t "$title" --arg d "$body" '{base:$b, head:$h, title:$t, body:$d}')" \
      | jq -r '"\(.number) \(.html_url)"' ;;

  pr-checks)
    n=${1:?number}
    sha=$(api GET "/repos/$SLUG/pulls/$n" | jq -r '.head.sha')
    api GET "/repos/$SLUG/commits/$sha/status" | jq -r 'if (.total_count // 0) == 0 then "none" else .state end' ;;

  pr-merge)
    n=${1:?number}
    api POST "/repos/$SLUG/pulls/$n/merge" '{"Do":"merge","delete_branch_after_merge":true}' >/dev/null
    api GET "/repos/$SLUG/pulls/$n" | jq -r 'if .merged then "merged" else "not merged" end' ;;

  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
