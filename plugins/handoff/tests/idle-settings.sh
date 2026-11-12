#!/usr/bin/env bash
# Checks idle.sh's size-handoff settings words against a throwaway settings folder.
# Run: bash plugins/handoff/tests/idle-settings.sh

set -u

# Run inside a session with the mod loaded, these would make the Stop hook stand down.
unset HANDOFF_IDLE_MOD HANDOFF_IDLE_FROM_MOD

script="$(cd "$(dirname "$0")/.." && pwd)/scripts/idle.sh"
failures=0

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	failures=$((failures + 1))
}

new_dir() { mktemp -d "${TMPDIR:-/tmp}/handoff-test.XXXXXX"; }

conf() { sed -n "s/^$2=//p" "$1/idle.conf" 2>/dev/null | tail -1; }

expect_conf() { # expect_conf <dir> <key> <value> <label>
	[ "$(conf "$1" "$2")" = "$3" ] || fail "$4: expected $2=$3, got '$(conf "$1" "$2")'"
}

expect_out() { # expect_out <text> <extended regex> <label>
	printf '%s\n' "$1" | grep -qE "$2" || fail "$3: output lacks /$2/"
}

mins_dir=$(new_dir)
bash "$script" set 5m "$mins_dir" >/dev/null 2>&1 || fail "set 5m exited non-zero"
expect_conf "$mins_dir" wait 5 "set 5m waits 5 minutes"
expect_conf "$mins_dir" enabled on "set 5m turns idle handoff on"
bash "$script" set 20 "$mins_dir" >/dev/null 2>&1 || fail "set 20 exited non-zero"
expect_conf "$mins_dir" wait 20 "set 20 still waits 20 minutes"
for bad in 0m 121m; do
	bash "$script" set "$bad" "$mins_dir" >/dev/null 2>&1 && fail "set $bad should fail"
done
expect_conf "$mins_dir" wait 20 "a bad minutes value changes nothing"
rm -rf "$mins_dir"

dir=$(new_dir)

out=$(bash "$script" set at 120k "$dir" 2>&1) || fail "set at 120k exited non-zero"
expect_conf "$dir" size_at 120 "set at 120k"
expect_out "$out" '\| Size handoff +\| on at 120k, ask' "set at 120k"
expect_conf "$dir" enabled "" "set at 120k leaves idle handoff alone"

bash "$script" set at 300 "$dir" >/dev/null 2>&1 || fail "set at 300 exited non-zero"

# A number ending in k is the size threshold on its own, without "at".
bash "$script" set 150k "$dir" >/dev/null 2>&1 || fail "set 150k exited non-zero"
expect_conf "$dir" size_at 150 "set 150k"
err=$(bash "$script" set 2k "$dir" 2>&1 >/dev/null) && fail "set 2k should fail"
expect_out "$err" '50.*900' "set 2k error names the range"
bash "$script" set at 300 "$dir" >/dev/null 2>&1
expect_conf "$dir" size_at 300 "set at 300"

bash "$script" set "at 120k" "$dir" >/dev/null 2>&1 || fail "set \"at 120k\" exited non-zero"
expect_conf "$dir" size_at 120 "set \"at 120k\" as one argument"

out=$(bash "$script" set size auto "$dir" 2>&1) || fail "set size auto exited non-zero"
expect_conf "$dir" size_mode auto "set size auto"
expect_out "$out" '\| Size handoff +\| on at 120k, auto' "set size auto"

out=$(bash "$script" set at off "$dir" 2>&1) || fail "set at off exited non-zero"
expect_conf "$dir" size_at off "set at off"
expect_out "$out" '\| Size handoff +\| off ' "set at off"

bash "$script" set size ask "$dir" >/dev/null 2>&1 || fail "set size ask exited non-zero"
expect_conf "$dir" size_at off "set size ask keeps the trigger off"

pct_dir=$(new_dir)
out=$(bash "$script" set at 70% "$pct_dir" 2>&1) || fail "set at 70% exited non-zero"
expect_conf "$pct_dir" size_at 70% "set at 70%"
expect_out "$out" '\| Size handoff +\| on at 70% of the compaction point, ask' "set at 70%"
bash "$script" set 90% "$pct_dir" >/dev/null 2>&1 || fail "set 90% exited non-zero"
expect_conf "$pct_dir" size_at 90% "set 90% on its own"
printf 'size_at=auto\n' > "$pct_dir/idle.conf"
out=$(bash "$script" status "$pct_dir" 2>&1)
expect_out "$out" '\| Size handoff +\| on at 80% of the compaction point, ask' "an old auto reads as the default"
rm -rf "$pct_dir"

for bad in "at 40k" "at 901" "at 40%" "at 96%" "at auto" "size later"; do
	# shellcheck disable=SC2086
	err=$(bash "$script" set $bad "$dir" 2>&1 >/dev/null) && fail "set $bad should fail"
	case "$bad" in at*) expect_out "$err" '50.*95%.*50.*900' "set $bad error names both ranges" ;; esac
done

fresh=$(new_dir)
out=$(bash "$script" status "$fresh" 2>&1) || fail "status exited non-zero"
expect_out "$out" '\| Size handoff +\| on at 80% of the compaction point, ask' "default size settings"
expect_out "$out" '\| Idle handoff +\| on ' "idle handoff is on by default"
expect_out "$out" '\| Before sleep +\| on' "before-sleep is on by default"
expect_out "$out" '\| Keep awake +\| off ' "keep-awake is off by default"

# On by default means a fresh settings folder arms the idle timer.
printf '{"session_id":"s0","transcript_path":"/nonexistent"}' | HANDOFF_IDLE_DIR="$fresh" HANDOFF_IDLE_FROM_MOD=1 HANDOFF_IDLE_MOD=1 bash "$script" stop >/dev/null 2>&1 &
stop_pid=$!
sleep 1
[ -e "$fresh/sessions/s0.token" ] || fail "idle handoff on by default did not arm the timer"
kill "$stop_pid" 2>/dev/null
wait "$stop_pid" 2>/dev/null
expect_out "$out" '\| Saved to +\| .*\.claude/handoff/' "Saved to row"

out=$(bash "$script" help "$fresh" 2>&1) || fail "help exited non-zero"
expect_out "$out" '/handoff at <N>k` \(or `<N>k`\)' "help lists at <N>k and its shortcut"
expect_out "$out" '/handoff at off' "help lists at off"
expect_out "$out" '/handoff <N>` \(or `<N>m`\)' "help lists minutes and the m shortcut"
expect_out "$out" '/handoff at <N>%` \(or `<N>%`\)' "help lists at <N>% and its shortcut"
printf '%s\n' "$out" | grep -q 'at auto' && fail "help still lists at auto"
expect_out "$out" '/handoff size ask/auto' "help lists size ask/auto"

for word in reset default; do
	used=$(new_dir)
	for setting in on 20 "awake on" "sleep on" "at 120k" "size auto"; do
		# shellcheck disable=SC2086
		bash "$script" set $setting "$used" >/dev/null 2>&1
	done
	out=$(bash "$script" set "$word" "$used" 2>&1) || fail "set $word exited non-zero"
	expect_out "$out" '\| Idle handoff +\| on ' "$word puts idle handoff back on, the default"
	expect_out "$out" '\| Wait +\| auto' "$word sets the wait back to auto"
	expect_out "$out" '\| Keep awake +\| off ' "$word turns keep-awake off"
	expect_out "$out" '\| Before sleep +\| on' "$word puts before-sleep back on, the default"
	expect_out "$out" '\| Size handoff +\| on at 80% of the compaction point, ask' "$word puts the size handoff back to 80%"
	rm -rf "$used"
done

out=$(bash "$script" help "$fresh" 2>&1)
expect_out "$out" '/handoff reset' "help lists reset"
expect_out "$out" '/handoff help` \(or `h`\)' "help lists h"
expect_out "$out" '/handoff list' "help lists list"
expect_out "$out" '/handoff purge' "help lists purge"
printf '%s\n' "$out" | grep -q 'cleanup' && fail "help still lists cleanup"

# A reset forgets the measured cache length too: nothing from an earlier session survives it.
used=$(new_dir)
printf 'detected_ttl=300\nenabled=on\n' > "$used/idle.conf"
out=$(bash "$script" set reset "$used" 2>&1) || fail "set reset with a measured TTL exited non-zero"
expect_conf "$used" detected_ttl "" "reset clears detected_ttl"
expect_out "$out" '\| Wait +\| auto: 1 min before the cache expires' "reset shows no measured cache length"

# A session with no cache writes yet is a guess, not a measurement: the stop hook must not save it.
transcript="$used/session.jsonl"
printf '{"type":"user","message":{"content":"hi"}}\n' > "$transcript"
bash "$script" set on "$used" >/dev/null 2>&1
HANDOFF_IDLE_DIR="$used" bash "$script" stop <<EOF_IN >/dev/null 2>&1 &
{"session_id":"s1","transcript_path":"$transcript"}
EOF_IN
stop_pid=$!
sleep 1
kill "$stop_pid" 2>/dev/null
wait "$stop_pid" 2>/dev/null
expect_conf "$used" detected_ttl "" "an undetected cache length is not saved"

# A measured one is.
printf '{"usage":{"cache_creation":{"ephemeral_1h_input_tokens":1200}}}\n' > "$transcript"
HANDOFF_IDLE_DIR="$used" bash "$script" stop <<EOF_IN >/dev/null 2>&1 &
{"session_id":"s2","transcript_path":"$transcript"}
EOF_IN
stop_pid=$!
sleep 1
kill "$stop_pid" 2>/dev/null
wait "$stop_pid" 2>/dev/null
expect_conf "$used" detected_ttl 3600 "a detected cache length is saved"

# With the mod loaded it runs the idle timer itself: the Stop hook stands down (no token, exits at
# once), and only the mod's own start (HANDOFF_IDLE_FROM_MOD=1) arms the timer.
rm -f "$used/sessions/"*
start=$(date +%s)
printf '{"session_id":"s3","transcript_path":"%s"}' "$transcript" | HANDOFF_IDLE_DIR="$used" HANDOFF_IDLE_MOD=1 bash "$script" stop >/dev/null 2>&1
[ $(( $(date +%s) - start )) -le 2 ] || fail "the Stop hook waits although the mod runs the timer"
[ ! -e "$used/sessions/s3.token" ] || fail "the Stop hook armed a timer although the mod runs it"

printf '{"session_id":"s4","transcript_path":"%s"}' "$transcript" | HANDOFF_IDLE_DIR="$used" HANDOFF_IDLE_MOD=1 HANDOFF_IDLE_FROM_MOD=1 bash "$script" stop >/dev/null 2>&1 &
stop_pid=$!
sleep 1
[ -e "$used/sessions/s4.token" ] || fail "the mod's own start did not arm the timer"
kill "$stop_pid" 2>/dev/null
wait "$stop_pid" 2>/dev/null
rm -rf "$used"

rm -rf "$dir" "$fresh"

if [ "$failures" -gt 0 ]; then
	printf '%s check(s) failed\n' "$failures" >&2
	exit 1
fi
echo "idle-settings: all checks passed"
