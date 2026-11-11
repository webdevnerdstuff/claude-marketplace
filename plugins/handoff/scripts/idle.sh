#!/usr/bin/env bash
# Idle handoff: wakes Claude to run /handoff when the user has been idle long enough that the
# prompt cache is about to expire, so the summary is written while the session is still cached.
#
#   idle.sh stop                   Stop hook (asyncRewake). Arms a timer for this session; when it
#                                  runs out with no new prompt, exits 2 so Claude wakes and hands off.
#   idle.sh prompt                 UserPromptSubmit hook. Cancels the timer and re-arms the feature.
#   idle.sh set <value> [data_dir] Change the setting: on, off, auto, minutes (1-120),
#                                  "awake on" / "awake off" (keep the Mac awake while a timer waits), or
#                                  "sleep on" / "sleep off" (hand off before the Mac goes to sleep).
#   idle.sh status [data_dir]      Print the current settings (also: settings).
#
# Settings live in <data_dir>/idle.conf (data_dir defaults to ~/.claude/handoff). Everything is off
# until the user turns it on. No jq: hook input is parsed with sed so this runs anywhere bash does.
# Keep-awake and before-sleep use macOS's built-in caffeinate, pmset and ioreg, and do nothing elsewhere.

set -u

MAX_MINUTES=120
DEFAULT_TTL=300 # seconds; used when the transcript doesn't say which cache the session writes to
MARGIN=60       # fire this many seconds before the cache expires
POLL=${HANDOFF_IDLE_POLL:-15} # seconds between checks while waiting
LATE_GRACE=30   # waking this many seconds past the deadline means the computer slept
SLEEP_MARGIN=180 # with before-sleep on, fire this many seconds before the Mac is expected to sleep

# The settings folder. A fixed path, not $CLAUDE_PLUGIN_DATA: the command hooks get that variable but
# the mod that answers /handoff's settings words can't read it, and both must find the same file.
data_dir() {
	local dir="${1:-${HANDOFF_IDLE_DIR:-$HOME/.claude/handoff}}"
	mkdir -p "$dir/sessions" && printf '%s' "$dir"
}

conf_get() { # conf_get <dir> <key> <default>
	local value=""
	[ -f "$1/idle.conf" ] && value=$(sed -n "s/^$2=//p" "$1/idle.conf" | tail -1)
	printf '%s' "${value:-$3}"
}

conf_set() { # conf_set <dir> <key> <value>
	local file="$1/idle.conf" tmp="$1/idle.conf.$$"
	{ [ -f "$file" ] && grep -v "^$2=" "$file"; printf '%s=%s\n' "$2" "$3"; } > "$tmp" && mv "$tmp" "$file"
}

json_field() { # json_field <json> <key>: a top-level string value
	printf '%s' "$1" | tr -d '\n' | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

safe_id() { printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_'; }

# The cache TTL the session writes to, in seconds, read from the latest non-zero cache write in the
# transcript's API usage records.
detect_ttl() {
	local transcript="$1" last=""
	if [ -n "$transcript" ] && [ -f "$transcript" ]; then
		last=$(tail -c 4000000 "$transcript" 2>/dev/null \
			| grep -oE '"ephemeral_(5m|1h)_input_tokens":[0-9]+' \
			| grep -vE ':0$' | tail -1)
	fi
	case "$last" in
		*_1h_*) echo 3600 ;;
		*_5m_*) echo 300 ;;
		*) echo "$DEFAULT_TTL" ;;
	esac
}

# --- macOS power -------------------------------------------------------------------------------

mac_supported() { command -v pmset >/dev/null 2>&1 && command -v caffeinate >/dev/null 2>&1 && command -v ioreg >/dev/null 2>&1; }

on_power() { pmset -g batt 2>/dev/null | head -1 | grep -q "AC Power"; }

# Seconds of no keyboard or mouse input after which the Mac idle-sleeps, from the timers in use for
# the current power source. The system can't sleep before the display does, so it's the later of the
# two. Prints nothing when the Mac never idle-sleeps (sleep 0).
sleep_after_s() {
	local settings sys disp
	settings=$(pmset -g 2>/dev/null)
	sys=$(printf '%s\n' "$settings" | awk '$1 == "sleep" {print $2; exit}')
	disp=$(printf '%s\n' "$settings" | awk '$1 == "displaysleep" {print $2; exit}')
	case "$sys" in '' | 0 | *[!0-9]*) return ;; esac
	case "$disp" in '' | *[!0-9]*) disp=0 ;; esac
	echo $(( (sys > disp ? sys : disp) * 60 ))
}

# Seconds since the last keyboard or mouse input on this Mac, in any app.
input_idle_s() {
	ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print int($NF / 1000000000); exit}'
}

# Hold off idle sleep while this process ($$) waits, on power only. caffeinate -w lets go by itself
# when this process exits, however it exits. Sets AWAKE_PID, or clears it when there's no hold.
AWAKE_PID=""
awake_update() { # awake_update <dir> <seconds left>
	local want=no
	if [ "$(conf_get "$1" awake off)" = on ] && mac_supported && on_power; then want=yes; fi
	if [ "$want" = yes ] && [ -z "$AWAKE_PID" ]; then
		caffeinate -i -w $$ -t $(( $2 + 60 )) >/dev/null 2>&1 &
		AWAKE_PID=$!
	elif [ "$want" = no ] && [ -n "$AWAKE_PID" ]; then
		kill "$AWAKE_PID" 2>/dev/null
		AWAKE_PID=""
	fi
}

# True when before-sleep is on, nothing of ours is keeping the Mac awake, and the Mac is due to
# idle-sleep within the margin. The margin shrinks for very short sleep timers, so a Mac set to sleep
# after 2 minutes doesn't hand off the moment Claude stops replying.
sleep_due() { # sleep_due <dir>
	local after idle margin
	[ "$(conf_get "$1" sleep off)" = on ] && [ -z "$AWAKE_PID" ] && mac_supported || return 1
	after=$(sleep_after_s)
	[ -n "$after" ] || return 1
	idle=$(input_idle_s)
	[ -n "$idle" ] || return 1
	margin=$(( after / 5 < SLEEP_MARGIN ? after / 5 : SLEEP_MARGIN ))
	[ $(( after - idle )) -le "$margin" ]
}

# --- status ------------------------------------------------------------------------------------

# A markdown table from tab-separated lines on stdin, the first line its head, with every cell
# padded so the columns line up: the desktop draws it as a table, the terminal shows it as aligned
# text. Cells are ASCII, so awk's length is their width.
markdown_table() {
	awk -F '\t' '
		{ for (c = 1; c <= NF; c++) { cell[NR, c] = $c; if (length($c) > w[c]) w[c] = length($c) } if (NF > cols) cols = NF }
		END {
			for (r = 1; r <= NR; r++) {
				line = "|"
				for (c = 1; c <= cols; c++) line = line sprintf(" %-" w[c] "s |", cell[r, c])
				print line
				if (r == 1) {
					line = "|"
					for (c = 1; c <= cols; c++) { dash = ""; for (i = 0; i < w[c]; i++) dash = dash "-"; line = line " " dash " |" }
					print line
				}
			}
		}'
}

# The settings as tab-separated "Setting<TAB>Now" rows.
settings_rows() { # settings_rows <dir>
	local enabled wait ttl awake before after source
	enabled=$(conf_get "$1" enabled off)
	wait=$(conf_get "$1" wait auto)
	ttl=$(conf_get "$1" detected_ttl "")
	if [ "$wait" = auto ]; then
		if [ -n "$ttl" ]; then
			wait="auto: $(( (ttl - MARGIN) / 60 )) min, 1 min before the $(( ttl / 60 ))-min cache expires"
		else
			wait="auto: 1 min before the cache expires"
		fi
	else
		wait="$wait min"
	fi

	awake=$(conf_get "$1" awake off)
	before=$(conf_get "$1" sleep off)
	if ! mac_supported; then
		[ "$awake" = on ] && awake="on, but macOS only: does nothing here"
		[ "$before" = on ] && before="on, but macOS only: does nothing here"
	else
		[ "$awake" = on ] && awake="on: the Mac won't sleep while a timer waits (screen still turns off), on power only"
		if [ "$before" = on ]; then
			after=$(sleep_after_s)
			source=$(on_power && echo power || echo battery)
			if [ -n "$after" ]; then
				before="on: this Mac sleeps after $(( after / 60 )) min idle on $source"
			else
				before="on: this Mac doesn't idle-sleep on $source"
			fi
		fi
	fi
	printf 'Setting\tNow\n'
	printf 'Idle handoff\t%s\n' "$enabled"
	printf 'Wait\t%s\n' "$wait"
	printf 'Keep awake\t%s\n' "$awake"
	printf 'Before sleep\t%s\n' "$before"
}

# The settings reply. It opens with a line of text, not the table, so the table always starts on a
# line of its own.
describe() { # describe <dir>
	printf 'handoff settings\n\n'
	settings_rows "$1" | markdown_table
	printf '\n`/handoff help` shows the commands.\n'
}

# --- hooks -------------------------------------------------------------------------------------

cmd_stop() {
	local input dir session transcript wait_s ttl minutes token state reason
	input=$(cat)
	dir=$(data_dir) || exit 0
	[ "$(conf_get "$dir" enabled off)" = on ] || exit 0
	[ -n "${DISABLE_PROMPT_CACHING:-}" ] && exit 0

	session=$(safe_id "$(json_field "$input" session_id)")
	[ -n "$session" ] || exit 0
	transcript=$(json_field "$input" transcript_path)
	# Started by the plugin's own /handoff command rather than the Stop hook, only the session id is
	# known: the transcript is the file named after it.
	if [ -z "$transcript" ]; then
		transcript=$(find "$HOME/.claude/projects" -maxdepth 2 -name "$(json_field "$input" session_id).jsonl" 2>/dev/null | head -1)
	fi
	state="$dir/sessions/$session"

	# Already handed off in this idle stretch: the handoff turn itself ends with a Stop, which must
	# not arm another timer. The next prompt clears this.
	[ -f "$state.done" ] && exit 0

	ttl=$(detect_ttl "$transcript")
	conf_set "$dir" detected_ttl "$ttl"
	minutes=$(conf_get "$dir" wait auto)
	if [ "$minutes" = auto ]; then
		wait_s=$(( ttl - MARGIN ))
	else
		wait_s=$(( minutes * 60 ))
	fi

	# Tidy up state from sessions that ended long ago.
	find "$dir/sessions" -type f -mtime +2 -delete 2>/dev/null

	token="$$-$(date +%s)-$RANDOM"
	printf '%s' "$token" > "$state.token"

	# Wait by the wall clock in short steps rather than one long sleep: a sleep pauses while the
	# computer sleeps, so only the clock shows when the machine slept past the deadline. Each step
	# also checks whether a newer reply or a new prompt replaced or removed the token, and if so the
	# session isn't idle and there's nothing to do. Keep-awake and before-sleep are re-checked each
	# step, so unplugging, plugging back in, or changing a setting takes effect within a step.
	local start now deadline expiry since
	start=$(date +%s)
	now=$start
	# Started by the /handoff command, the timer counts from the end of Claude's last reply, when
	# the cache was last refreshed. If the cache has expired since, there's nothing left to save.
	since=${HANDOFF_IDLE_SINCE:-}
	case "$since" in '' | *[!0-9]*) ;; *) [ "$since" -le "$now" ] && start=$since ;; esac
	deadline=$(( start + wait_s ))
	expiry=$(( start + ttl ))
	if [ "$now" -ge "$expiry" ]; then
		rm -f "$state.token"
		exit 0
	fi
	reason=wait
	while [ "$now" -lt "$deadline" ]; do
		awake_update "$dir" $(( deadline - now ))
		if sleep_due "$dir"; then
			reason=sleep
			break
		fi
		sleep $(( deadline - now < POLL ? deadline - now : POLL ))
		[ "$(cat "$state.token" 2>/dev/null)" = "$token" ] || exit 0
		now=$(date +%s)
	done

	[ "$(conf_get "$dir" enabled off)" = on ] || exit 0
	[ -f "$state.done" ] && exit 0

	# The computer slept through the deadline and the cache has expired by now: a handoff would
	# re-read the whole conversation at full price, which is what this feature exists to avoid.
	if [ "$reason" = wait ] && [ $(( now - deadline )) -gt "$LATE_GRACE" ] && [ "$now" -ge "$expiry" ]; then
		rm -f "$state.token"
		exit 0
	fi

	touch "$state.done"
	rm -f "$state.token"
	if [ "$reason" = sleep ]; then
		echo "Idle handoff fired: the user turned on idle handoff before sleep, and this Mac is due to go to sleep in a few minutes because nobody has touched it. Run the handoff skill now with no arguments, so the summary is written before the Mac sleeps and while the session is still cached. Do nothing else this turn." >&2
	else
		echo "Idle handoff fired: the user has been idle for $(( wait_s / 60 )) min and turned on idle handoff. Run the handoff skill now with no arguments, so the summary is written while the session is still cached. Do nothing else this turn." >&2
	fi
	exit 2
}

cmd_prompt() {
	local input dir session
	input=$(cat)
	dir=$(data_dir) || exit 0
	session=$(safe_id "$(json_field "$input" session_id)")
	[ -n "$session" ] || exit 0
	# The plugin's own idle handoff prompt isn't the user coming back: keep the once-per-idle-stretch
	# marker, so the handoff turn's Stop doesn't start another timer.
	case "$input" in *"Idle handoff fired"*) exit 0 ;; esac
	rm -f "$dir/sessions/$session.token" "$dir/sessions/$session.done"
	exit 0
}

# --- settings ----------------------------------------------------------------------------------

cmd_set() {
	local value dir
	value=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
	# "awake on" or "sleep on" arrives as one argument when quoted, or as two when not.
	if [ "$value" = awake ] || [ "$value" = sleep ]; then
		value="$value $(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"
		shift
	fi
	value=$(printf '%s' "$value" | tr -s ' ')
	dir=$(data_dir "${2:-}") || exit 1
	case "$value" in
		on | off) conf_set "$dir" enabled "$value" ;;
		# Choosing a wait, keep-awake or before-sleep means the user wants idle handoff, so each one
		# turns it on too.
		auto) conf_set "$dir" wait auto && conf_set "$dir" enabled on ;;
		"awake on") conf_set "$dir" awake on && conf_set "$dir" enabled on ;;
		"awake off") conf_set "$dir" awake off ;;
		"sleep on") conf_set "$dir" sleep on && conf_set "$dir" enabled on ;;
		"sleep off") conf_set "$dir" sleep off ;;
		*)
			if printf '%s' "$value" | grep -qE '^[0-9]+$' && [ "$value" -ge 1 ] && [ "$value" -le "$MAX_MINUTES" ]; then
				conf_set "$dir" wait "$((10#$value))" && conf_set "$dir" enabled on
			else
				echo "idle.sh: expected on, off, auto, awake on, awake off, sleep on, sleep off, or a whole number of minutes from 1 to $MAX_MINUTES" >&2
				exit 1
			fi
			;;
	esac
	describe "$dir"
}

cmd_status() {
	local dir
	dir=$(data_dir "${1:-}") || exit 1
	describe "$dir"
}

cmd_help() {
	local dir
	dir=$(data_dir "${1:-}") || exit 1
	printf 'handoff commands\n\n'
	markdown_table <<'EOF'
Command	What it does
`/handoff`	a handoff of the whole session
`/handoff <focus>`	a handoff of one thread, e.g. `/handoff the auth migration`
`/handoff "<focus>"`	a focus that is one of these words, e.g. `/handoff "status"`
`/handoff on/off`	idle handoff: Claude writes one before the cache expires
`/handoff auto`	wait until 1 min before the cache expires (the default)
`/handoff <minutes>`	wait this many minutes instead, 1-120
`/handoff awake on/off`	macOS: stop the Mac sleeping while a timer waits (screen still turns off)
`/handoff sleep on/off`	macOS: hand off a few minutes before the Mac sleeps
`/handoff settings` (or `status`)	what everything is set to
`/handoff help`	this list
EOF
	printf '\nhandoff settings\n\n'
	settings_rows "$dir" | markdown_table
}

case "${1:-}" in
	stop) cmd_stop ;;
	prompt) cmd_prompt ;;
	set) shift; cmd_set "$@" ;;
	status | settings) shift; cmd_status "$@" ;;
	help) shift; cmd_help "$@" ;;
	*) echo "usage: idle.sh stop | prompt | set <on|off|auto|minutes|awake on|awake off|sleep on|sleep off> [data_dir] | status|settings [data_dir] | help [data_dir]" >&2; exit 1 ;;
esac
