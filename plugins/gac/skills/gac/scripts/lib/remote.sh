# remote.sh: shared helpers for the gac host scripts. Sourced, not run.
#
# Sets HOST (the git host, with ~/.ssh/config aliases resolved) and SLUG (owner/repo)
# from the `origin` remote, and reads per-host settings from:
#   ~/.config/gac/hosts.json   { "<git host>": { "type": "...", ... } }

CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/gac/hosts.json"
SCRIPT_NAME=$(basename "$0")

die() { echo "$SCRIPT_NAME: $*" >&2; exit 1; }

# Print the comment block at the top of the calling script, as its usage text.
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2; }

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

# host_field <field> [host]: a value from hosts.json for this (or the given) host.
host_field() {
  [[ -f "$CONFIG" ]] || return 0
  jq -r --arg h "${2:-$HOST}" --arg f "$1" '.[$h][$f] // empty' "$CONFIG"
}

# host_set <host> <json object>: replace a host's entry in hosts.json.
host_set() {
  mkdir -p "$(dirname "$CONFIG")"; [[ -f "$CONFIG" ]] || echo '{}' > "$CONFIG"
  local tmp; tmp=$(mktemp)
  jq --arg h "$1" --argjson v "$2" '.[$h] = $v' "$CONFIG" > "$tmp" && mv "$tmp" "$CONFIG"
}

# keychain_get <service>: the token saved under that Keychain service, or nothing.
keychain_get() { security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null; }

# need_tty: stop with a clear message when there is no terminal to prompt on
# (e.g. run through Claude Code's "!" prefix), instead of read failing silently.
need_tty() {
  [[ -t 0 ]] || die "setup asks questions, so it needs an interactive terminal; run it in Terminal/iTerm, not through Claude Code"
}

# keychain_prompt <service> <label> <prompt>: ask for a token (hidden) and save it.
keychain_prompt() {
  need_tty
  local tok
  read -r -s -p "$3: " tok; echo
  [[ -n "$tok" ]] || die "no token entered"
  security add-generic-password -U -a "$USER" -s "$1" -l "$2" -w "$tok"
  echo "Token saved to the Keychain."
}
