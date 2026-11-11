import type { EngineInterface, Register } from 'claude-code'

// /handoff's settings words (help, settings, on, 20, sleep on, ...) are answered here, straight
// from the script, the way a mod's own command answers: no turn for the model, and the tables
// drawn exactly as printed. Anything else, a quoted word included, goes on to the handoff skill.
//
// Because no turn runs, the Stop hook that normally starts the idle timer doesn't fire either. So
// when a setting leaves idle handoff on, this starts the timer itself, counted from the end of
// Claude's last reply, and if it runs out, sends the handoff prompt the Stop hook would have.

const SETTING = /^(help|status|settings|on|off|auto|\d+|(awake|sleep) (on|off))$/

// The skill's command, by its short or its plugin-qualified name.
const isHandoff = (command: string) => command === 'handoff' || command === 'handoff:handoff'

// When the main conversation's last turn ended, in seconds: the prompt cache was last refreshed
// then. Unknown after a reload until the next turn ends, and the timer then counts from now.
let lastTurnEnd: number | undefined

const script = ($: EngineInterface) => `${$.plugin.root}/scripts/idle.sh`

// Runs the timer as the Stop hook would, in the background for as long as the module is loaded.
// A newer reply or prompt cancels it through the script's own token, as it does the hook's.
const startTimer = ($: EngineInterface) => {
	void (async () => {
		const sessionId = await $.session.id()
		const env: Record<string, string> = lastTurnEnd === undefined ? {} : { HANDOFF_IDLE_SINCE: String(lastTurnEnd) }
		const timer = $.process.spawn({ argv: [script($), 'stop'], env, input: JSON.stringify({ session_id: sessionId }) })
		let stderr = ''

		for await (const piece of timer) {
			if (piece.stream === 'stderr') {
				stderr += piece.text
			}
		}

		if ((await timer.result).code === 2) {
			await $.prompt.submit({ text: stderr.trim() })
		}
	})().catch(() => undefined)
}

export const register: Register = on => {
	on('turn.complete', async ($, e, next) => {
		const result = await next(e)

		if (e.agentId === undefined) {
			lastTurnEnd = Math.floor(Date.now() / 1000)
		}

		return result
	})

	on('command.run', async ($, e, next) => {
		const word = e.args.trim().replace(/\s+/g, ' ').toLowerCase()

		if (!isHandoff(e.command) || !SETTING.test(word)) {
			return next(e)
		}

		const args =
			word === 'help' ? ['help'] : word === 'status' || word === 'settings' ? ['status'] : ['set', ...word.split(' ')]
		// If the script can't run here (no bash, say), the skill takes the word instead.
		const run = await $.process.run([script($), ...args]).catch(() => undefined)

		if (run === undefined) {
			return next(e)
		}

		if (run.exitCode !== 0) {
			return { text: run.stderr.trim().replace(/^idle\.sh: /, '') }
		}

		if (args[0] === 'set' && /^\| Idle handoff +\| on /m.test(run.stdout)) {
			startTimer($)
		}

		return { text: run.stdout.trimEnd() }
	})
}
