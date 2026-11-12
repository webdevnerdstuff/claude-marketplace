import type { EngineInterface, Register } from 'claude-code'

import { LIST, PURGE, SETTING, armCheck, armFrom, bar, compactPoint, chatBlock, ringLoader, freshSteps, idleTimerEnv, listTable, newChatUrl, scriptArgs, shortReason, sizeThreshold, writeProgress } from './lib'
import { listHandoffs, readHandoffs, readSize, trashFiles, writeHandoff, writeLog } from './writer'
import type { Panel } from './writer'
import type { HandoffList, Step } from '../types'

// /handoff's settings words (help, settings, on, 20, sleep on, at 250k, size auto, ...) are answered
// here, straight from the script, the way a mod's own command answers: no turn for the model, and
// the tables drawn exactly as printed. Anything else is a focus: the mod writes the handoff itself
// (a fork of the session, saved to <project>/.claude/handoff/), and the skill takes it only when
// that fails.
//
// Idle handoff: the mod runs idle.sh's timer itself after each reply of the main conversation (and
// after a settings word that leaves idle handoff on), counted from the end of that reply. When it runs
// out, the handoff is written in the background like the size trigger's: saved, with the band's
// buttons, and nothing in the chat. The mod sets HANDOFF_IDLE_MOD so the Stop hook stands down; where
// the mod isn't loaded, that hook wakes Claude to run the skill instead.
//
// The size handoff: after each turn of the main conversation, when the context has passed the
// threshold (/handoff at 80%, a share of the compaction point, or a fixed /handoff at 250k), it offers a handoff in a band above the prompt (size ask) or
// writes one straight away (size auto), once per crossing.

// The band: one key for the offer, the progress and the buttons. A literal here, so the engine
// can list what the module reads and writes.
const PANEL = { plugin: 'handoff', key: 'panel' } as const

// The /handoff list pane and what it shows.
const LIST_PANE = 'handoff-list'
const LIST_STATE = { plugin: 'handoff', key: 'list' } as const

const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'
// The empty part of a progress bar: visible on dark and light, quieter than the filled part.
const TRACK = '#6b7280'
// The running step's loader in the app, built once.
const RING = ringLoader(ACCENT)

// The idle words: only these start the idle timer after a setting changes.
const IDLE_WORD = /^(on|auto|\d+|(awake|sleep) on)$/

// The skill's command, by its short or its plugin-qualified name.
const isHandoff = (command: string) => command === 'handoff' || command === 'handoff:handoff'

// When the main conversation's last turn ended, in seconds: the prompt cache was last refreshed
// then. Unknown after a reload until the next turn ends, and the timer then counts from now.
let lastTurnEnd: number | undefined

// A handoff is being written; a second one waits for it rather than racing it.
let busy = false

const script = ($: EngineInterface) => `${$.plugin.root}/scripts/idle.sh`

// Runs idle.sh's timer in the background for as long as the module is loaded. A newer reply or
// prompt cancels it through the script's own token. Exit 2 means it ran out: write the handoff.
const startTimer = ($: EngineInterface) => {
	void (async () => {
		const sessionId = await $.session.id()
		const timer = $.process.spawn({ argv: [script($), 'stop'], env: idleTimerEnv(lastTurnEnd), input: JSON.stringify({ session_id: sessionId }) })

		let said = ''

		for await (const piece of timer) {
			if (piece.stream === 'stderr') {
				said += piece.text
			}
		}

		// The script says why it fired: the wait ran out, or the Mac is about to sleep.
		if ((await timer.result).code === 2) {
			await run($, '', false, /before sleep/.test(said) ? 'idle-sleep' : 'idle')
		}
	})().catch(() => undefined)
}

async function getPanel($: EngineInterface): Promise<Panel | null> {
	const { value } = await $.state.get(PANEL)

	return (value as Panel | undefined) ?? null
}

async function setPanel($: EngineInterface, panel: Panel | null) {
	await $.state.set(PANEL, panel)
}

const blank = (phase: Panel['phase'], tokens: number): Panel => ({ phase, tokens, steps: [], tick: 0, words: 0, file: '', path: '', text: '', error: '', note: '' })

// The steps of the handoff being written: the one copy every update starts from, so the writer's
// reports and the writing step's ticking never undo each other.
let live: Step[] = []
let liveTick = 0

async function publishSteps($: EngineInterface) {
	const panel = await getPanel($)

	if (panel?.phase === 'working') {
		await setPanel($, { ...panel, tick: liveTick, steps: live.map(step => ({ ...step })) })
	}
}

// How often the band moves while writing: the writing step's bar and seconds, and the tick.
const TICK_MS = 350

// The path from the project down, for the band: .claude/handoff/<name>.md.
const shown = (path: string) => {
	const at = path.lastIndexOf('/.claude/handoff/')

	return at >= 0 ? path.slice(at + 1) : path
}

async function getList($: EngineInterface): Promise<HandoffList | null> {
	const { value } = await $.state.get(LIST_STATE)

	return (value as HandoffList | undefined) ?? null
}

async function setList($: EngineInterface, list: HandoffList | null) {
	await $.state.set(LIST_STATE, list)
}

// The list's folder reads and deletes run one at a time: a refresh that read the folder
// just before a delete can't bring its row back, and a second press finds the row gone.
let listQueue: Promise<unknown> = Promise.resolve()

const inListQueue = <T,>(work: () => Promise<T>): Promise<T> => {
	const next = listQueue.then(work, work)
	listQueue = next.catch(() => undefined)

	return next
}

// Reads the saved handoffs again. A save keeps the note on show; Refresh clears it, as it may be about rows now gone.
async function reloadList($: EngineInterface, isNoteKept: boolean) {
	await inListQueue(async () => {
		const { dir, entries } = await readHandoffs($)
		const list = isNoteKept ? await getList($) : null

		await setList($, { dir, entries, note: list?.note ?? '', isFailure: list?.isFailure ?? false })
	})
}

// After a save, while the list pane is open.
async function refreshList($: EngineInterface) {
	const panes = await $.ui.panes().catch(() => [])

	if (panes.some(pane => pane.id === LIST_PANE)) {
		await reloadList($, true)
	}
}

async function listNote($: EngineInterface, note: string, isFailure = false) {
	const list = await getList($)

	if (list) {
		await setList($, { ...list, note, isFailure })
	}
}

// A row's action that failed: a red note, and a line in handoff.log saying why.
async function entryFailed($: EngineInterface, path: string, action: 'copy' | 'start' | 'delete', note: string, reason: string) {
	await listNote($, note, true)
	await writeLog($, 'failed', `${action} ${path.split('/').pop()}: ${reason}`)
}

// Reads one row's file for Copy or Start new chat; undefined, with the failure noted and logged, when it can't.
async function readEntry($: EngineInterface, path: string, title: string, action: 'copy' | 'start') {
	let text = ''
	let reason = ''

	try {
		text = String(await $.fs.read(path)).trim()
		reason = text ? '' : 'the file is empty'
	} catch (error) {
		reason = shortReason(error) || 'unknown error'
	}

	if (reason) {
		await entryFailed($, path, action, `Couldn't read "${title}": ${reason}.`, reason)

		return undefined
	}

	return text
}

// Copy for one row of the list: the clipboard of the surface pressed on, else pbcopy.
async function copyEntry($: EngineInterface, path: string, title: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
	const text = await readEntry($, path, title, 'copy')

	if (text === undefined) {
		return
	}

	const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
	const code = copied.isCopied ? 0 : (await $.process.spawn({ argv: ['pbcopy'], input: text }).result.catch(() => ({ code: 1 }))).code

	if (code === 0) {
		await listNote($, `Copied "${title}". Paste it as the first message of a new chat.`)

		return
	}

	const reason = `the clipboard refused it and pbcopy exited ${code}`

	await entryFailed($, path, 'copy', `Copy failed for "${title}": ${reason}. Use Open file instead.`, reason)
}

// Start new chat for one row: the new chat opening is the answer; a note only when it doesn't.
async function startEntry($: EngineInterface, path: string, title: string) {
	const text = await readEntry($, path, title, 'start')

	if (text === undefined) {
		return
	}

	let reason = ''

	try {
		const opened = await $.process.run(['open', newChatUrl(text, path)])
		reason = opened.exitCode === 0 ? '' : shortReason(opened.stderr) || `open exited ${opened.exitCode}`
	} catch (error) {
		reason = shortReason(error) || 'open failed'
	}

	if (reason) {
		await entryFailed($, path, 'start', `The new chat did not open for "${title}": ${reason}. Copy it instead.`, reason)

		return
	}

	await listNote($, '')
}

// Delete for one row: to the Trash, never for good, as purge does. A file already gone counts as done;
// a row already gone (a second press) does nothing.
async function trashEntry($: EngineInterface, path: string, name: string, title: string) {
	await inListQueue(async () => {
		if (!(await getList($))?.entries.some(entry => entry.name === name)) {
			return
		}

		const trashed = await trashFiles($, [path])

		if (!trashed.ok) {
			await entryFailed($, path, 'delete', `Couldn't delete "${title}": ${shortReason(trashed.reason)}.`, shortReason(trashed.reason))

			return
		}

		const list = await getList($)

		if (list) {
			await setList($, { ...list, entries: list.entries.filter(entry => entry.name !== name), note: `Moved "${title}" to the Trash.`, isFailure: false })
		}

		await writeLog($, 'trashed', name)
	})
}

const plural = (n: number) => `${n} saved handoff${n === 1 ? '' : 's'}`

const tokensNow = async ($: EngineInterface) => (await $.session.usage()).context.tokens ?? 0

async function note($: EngineInterface, text: string) {
	const panel = await getPanel($)

	if (panel) {
		await setPanel($, { ...panel, note: text })
	}
}

// Writes a handoff with the band showing its progress. Returns what writeHandoff did, or
// undefined when one was already being written.
// `asked`: the owner asked for this one (typed /handoff, Write handoff, Try again); the size
// trigger's auto mode is the only handoff nobody asked for.
// `trigger` says what started it, for the log: typed, size-ask, size-auto, idle, idle-sleep, retry.
async function run($: EngineInterface, focus: string, asked: boolean, trigger: string) {
	if (busy) {
		return undefined
	}

	busy = true
	const tokens = await tokensNow($).catch(() => 0)
	await writeLog($, 'start', `${trigger}${focus ? ` "${focus}"` : ''} · context ${Math.round(tokens / 1000)}k`)
	let ticker: { cancel: () => void } | undefined
	// What the band keeps showing once the run is over: every step, a running one marked failed.
	const finalSteps = () => live.map(step => (step.status === 'run' ? { ...step, status: 'fail' as const } : { ...step }))

	try {
		live = freshSteps()
		liveTick = 0
		let writingSince = 0
		await setPanel($, { ...blank('working', tokens), steps: live })

		// For the whole run: the tick counts up, and while the model writes, its bar creeps forward and
		// its seconds count up.
		ticker = $.clock.every(TICK_MS, () => {
			void (async () => {
				liveTick += 1
				const writing = live[3]

				if (writing?.status === 'run' && writingSince) {
					const ms = (await $.clock.now()) - writingSince
					live[3] = { ...writing, progress: writeProgress(ms), detail: `${Math.round(ms / 1000)} s` }
				}

				await publishSteps($)
			})().catch(() => undefined)
		})

		const written = await writeHandoff($, focus, asked, async (i, change) => {
			const current = live[i]

			if (!current) {
				return
			}

			live[i] = { ...current, ...change }

			if (i === 3 && change.status === 'run') {
				writingSince = await $.clock.now()
			}

			await publishSteps($)
		})
		ticker.cancel()

		if (written.ok) {
			await setPanel($, {
				...blank('ready', tokens),
				steps: finalSteps(),
				words: written.text.split(/\s+/).filter(Boolean).length,
				file: shown(written.path),
				path: written.path,
				text: written.text,
			})
			void refreshList($).catch(() => undefined)
			const words = written.text.split(/\s+/).filter(Boolean).length
			await writeLog($, 'saved', `${words} words in ${live[3]?.detail ?? '?'} → ${written.path.split('/').pop() ?? ''}`)
		} else if (written.reason === 'nothing to hand off yet') {
			await setPanel($, null)
			await writeLog($, 'skipped', asked ? 'nothing to hand off yet' : 'nothing to hand off (quick chat)')
		} else if (written.reason === 'cancelled') {
			await writeLog($, 'cancelled', 'cancelled with Esc')
		} else {
			await setPanel($, { ...blank('failed', tokens), steps: finalSteps(), error: `The handoff did not finish: ${written.reason}` })
			const failed = live.find(step => step.status === 'fail' || step.status === 'run')
			await writeLog($, 'failed', `${failed ? `${failed.label.toLowerCase()}: ` : ''}${written.reason}`)
		}

		return written
	} catch (err) {
		await setPanel($, {
			...blank('failed', tokens),
			steps: finalSteps(),
			error: `The handoff did not finish: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
		})
		await writeLog($, 'failed', String(err instanceof Error ? err.message : err).slice(0, 160))

		return { ok: false as const, reason: String(err) }
	} finally {
		ticker?.cancel()
		busy = false
	}
}

// After a turn of the main conversation: fire once per crossing of the threshold.
async function checkSize($: EngineInterface) {
	if (busy) {
		return
	}

	const size = await readSize($)
	const panel = await getPanel($)

	if (size.at === null) {
		if (panel?.phase === 'offer') {
			await setPanel($, null)
		}

		return
	}

	// The summary breakdown is estimated locally: no requests. Before the first response, or just
	// after a compaction, there is no count yet, so the check waits a turn.
	const { context } = await $.session.usage({ breakdown: 'summary' })
	const tokens = context.tokens
	const compactAt = compactPoint({ window: context.window, breakdown: context.breakdown })

	if (tokens === undefined || compactAt === null) {
		return
	}

	const at = sizeThreshold(size.at, compactAt)
	const key = `arm:${await $.session.id()}`
	const stored = await $.store.get(key)
	const step = armCheck(armFrom(stored, at), tokens, at, compactAt)

	await $.store.set(key, { at, armedAt: step.armedAt })

	if (tokens < at && panel?.phase === 'offer') {
		await setPanel($, null)
	}

	if (!step.fire) {
		return
	}

	if (size.mode === 'auto') {
		void run($, '', false, 'size-auto').catch(() => undefined)
	} else if (!panel || panel.phase === 'offer') {
		await setPanel($, blank('offer', tokens))
		await writeLog($, 'offer', `size offer at ${Math.round(tokens / 1000)}k`)
	}
}

async function copy($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
	const panel = await getPanel($)

	if (!panel?.text) {
		return
	}

	const copied = await $.ui.copy({ text: panel.text, surface }).catch(() => ({ isCopied: false }))

	if (copied.isCopied) {
		await note($, 'Copied. Paste it as the first message of a new chat.')

		return
	}

	const pbcopy = $.process.spawn({ argv: ['pbcopy'], input: panel.text })
	const done = await pbcopy.result.catch(() => ({ code: 1 }))

	await note($, done.code === 0 ? 'Copied. Paste it as the first message of a new chat.' : 'Copy failed. Use Open file instead.')
}

async function startNew($: EngineInterface) {
	const panel = await getPanel($)

	if (!panel?.text) {
		return
	}

	const opened = await $.process.run(['open', newChatUrl(panel.text, panel.path)]).catch(() => undefined)

	// The new chat opening is the answer; a note only says when it didn't.
	await note($, opened?.exitCode === 0 ? '' : 'The new chat did not open. Copy it instead.')
}

export const register: Register = on => {
	on('session.start', async ($, e, next) => {
		// This mod runs the idle timer; the Stop hook reads this and stands down.
		await $.env.set('HANDOFF_IDLE_MOD', '1').catch(() => undefined)

		// A reload while a handoff was being written leaves a dead "working" band behind.
		const panel = await getPanel($).catch(() => null)

		if (panel?.phase === 'working') {
			await setPanel($, null)
		}

		return next(e)
	})

	// Again on every message: a session that reloaded this mod mid-session never ran session.start
	// with it, and without the flag its Stop hook would wake Claude to write the handoff in the chat.
	on('prompt.submit', async ($, e, next) => {
		await $.env.set('HANDOFF_IDLE_MOD', '1').catch(() => undefined)

		return next(e)
	}).catch(($, e, next) => next(e))

	on('turn.complete', async ($, e, next) => {
		const result = await next(e)

		if (e.agentId === undefined) {
			lastTurnEnd = Math.floor((await $.clock.now()) / 1000)
			void checkSize($).catch(() => undefined)
			startTimer($)
		}

		return result
	})

	// A compaction of the main conversation answers the offer: it re-arms at the threshold, and an
	// offer to write "before it compacts" is gone.
	on('session.compact', async ($, e, next) => {
		const result = await next(e)

		if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in result)) {
			try {
				const size = await readSize($)

				// Cleared, the trigger re-arms at the threshold the next check works out.
				if (size.at !== null) {
					await $.store.set(`arm:${await $.session.id()}`, null)
				}

				if ((await getPanel($))?.phase === 'offer') {
					await setPanel($, null)
				}
			} catch {
				// The next turn's check puts it right.
			}
		}

		return result
	}).catch(($, e, next) => next(e))

	on('command.run', async ($, e, next) => {
		if (!isHandoff(e.command)) {
			return next(e)
		}

		const word = e.args.trim().replace(/\s+/g, ' ').toLowerCase()

		if (LIST.test(word)) {
			const { dir, entries } = await readHandoffs($)

			if (!entries.length) {
				return { text: 'No saved handoffs in .claude/handoff/.' }
			}

			await setList($, { dir, entries, note: '' })
			const opened = await $.ui.open({ id: LIST_PANE, title: 'Handoffs', focus: true }).catch(() => ({ isPlaced: false }))

			// Where no pane can open, the chat gets the same list as a table.
			return { text: opened.isPlaced ? `Opened the list of ${plural(entries.length)}.` : listTable(entries) }
		}

		if (PURGE.test(word)) {
			const { files } = await listHandoffs($)

			if (!files.length) {
				return { text: 'No saved handoffs in .claude/handoff/.' }
			}

			await setPanel($, { ...blank('purge', 0), files })

			return {
				text: `${plural(files.length)} in .claude/handoff/:\n${files.map(file => `- ${shown(file).split('/').pop()}`).join('\n')}\n\nPress Delete above the prompt to move them to the Trash, or Cancel.`,
			}
		}

		if (!SETTING.test(word)) {
			// A focus, or nothing: the mod writes it. A quoted focus loses its quotes, as in the skill.
			const focus = e.args.trim().replace(/^"(.*)"$/s, '$1')
			const written = await run($, focus, true, 'typed')

			if (written === undefined) {
				return { text: 'A handoff is already being written. Watch the band above the prompt.' }
			}

			if (written.ok) {
				return { text: chatBlock(written.text, shown(written.path)) }
			}

			if (written.reason === 'nothing to hand off yet') {
				return { text: 'Nothing to hand off yet.' }
			}

			if (written.reason === 'cancelled') {
				await setPanel($, null)

				return { text: 'Handoff cancelled.' }
			}

			// The fork failed: the skill writes it in a turn instead.
			await setPanel($, null)

			return next(e)
		}

		const args = scriptArgs(word)
		// If the script can't run here (no bash, say), the skill takes the word instead.
		const ran = await $.process.run([script($), ...args]).catch(() => undefined)

		if (ran === undefined) {
			return next(e)
		}

		if (ran.exitCode !== 0) {
			return { text: ran.stderr.trim().replace(/^idle\.sh: /, '') }
		}

		if (args[0] === 'set' && IDLE_WORD.test(word) && /^\| Idle handoff +\| on /m.test(ran.stdout)) {
			startTimer($)
		}

		return { text: ran.stdout.trimEnd() }
	}).catch(($, e, next) => next(e))

	// Presses go to these hooks, not to onPress: a closure lives one drawing only.
	on('ui.press', { plugin: 'handoff', element: 'write' }, async ($, e) => {
		void run($, '', true, 'size-ask').catch(() => undefined)

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'retry' }, async ($, e) => {
		void run($, '', true, 'retry').catch(() => undefined)

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'later' }, async ($, e) => {
		// The snooze is stored when the offer fires; Not now only clears the band, and says so in the log.
		const panel = await getPanel($)
		await setPanel($, null)

		if (panel?.phase === 'offer') {
			await writeLog($, 'not-now', `size offer at ${Math.round(panel.tokens / 1000)}k`)
		}

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'close' }, async ($, e) => {
		await setPanel($, null)

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'trash' }, async ($, e) => {
		const panel = await getPanel($)

		if (panel?.phase === 'purge' && panel.files) {
			const trashed = await trashFiles($, panel.files)

			if (trashed.ok) {
				await setPanel($, null)
				$.ui.toast(`Moved ${plural(trashed.count)} to the Trash.`)
				await writeLog($, 'purged', `${plural(trashed.count)} moved to the Trash`)
			} else {
				await setPanel($, { ...panel, note: `Nothing was deleted: ${trashed.reason}` })
				await writeLog($, 'failed', `purge: ${trashed.reason}`)
			}
		}

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'copy' }, async ($, e) => {
		await copy($, e.surface)

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'start' }, async ($, e) => {
		await startNew($)

		return { element: e.element }
	})
	on('ui.press', { plugin: 'handoff', element: 'open' }, async ($, e) => {
		const panel = await getPanel($)

		if (panel?.path) {
			await $.process.run(['open', panel.path]).catch(() => undefined)
		}

		return { element: e.element }
	})

	// The list pane. It redraws only when the list changes, so its buttons press through onPress.
	on('ui.render', { component: 'Pane', requestId: LIST_PANE }, async ($, e) => {
		const { Box, Text, Button } = $.ui.resolve(e)
		const list = await getList($)

		// The count and Refresh share a line; in a narrow pane Refresh wraps under the count.
		const header = (text: string) => (
			<Box key="list-header" flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={1} rowGap="xs">
				<Text dimColor>{text}</Text>
				<Button key="refresh" label="Refresh" onPress={() => void reloadList($, false).catch(() => undefined)} />
			</Box>
		)

		if (!list) {
			return <Text dimColor>No saved handoffs in .claude/handoff/.</Text>
		}

		if (!list.entries.length) {
			return header('No saved handoffs in .claude/handoff/.')
		}

		return (
			<Box flexDirection="column" gap={1}>
				{header(`${plural(list.entries.length)} in .claude/handoff/, newest first`)}
				{list.note ? <Text color={list.isFailure ? BAD : GOOD}>{list.note}</Text> : null}
				{list.entries.map(entry => {
					const path = `${list.dir}/${entry.name}`

					return (
						<Box key={`row:${entry.name}`} flexDirection="column" gap={1}>
							<Box flexDirection="column">
								<Text bold wrap="truncate-end">
									{entry.title}
								</Text>
								<Text dimColor wrap="truncate-end">
									{[entry.when, entry.status].filter(Boolean).join(' · ') || entry.name}
								</Text>
							</Box>
							<Box key={`buttons:${entry.name}`} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap="xs">
								<Button
									key={`copy:${entry.name}`}
									label="Copy"
									variant="primary"
									onPress={press => void copyEntry($, path, entry.title, press.surface).catch(() => undefined)}
								/>
								<Button
									key={`open:${entry.name}`}
									label="Open file"
									onPress={() => void $.process.run(['open', path]).catch(() => undefined)}
								/>
								<Button
									key={`start:${entry.name}`}
									label="Start new chat"
									onPress={() => void startEntry($, path, entry.title).catch(() => undefined)}
								/>
								<Button
									key={`trash:${entry.name}`}
									label="Delete"
									onPress={() => void trashEntry($, path, entry.name, entry.title).catch(() => undefined)}
								/>
							</Box>
						</Box>
					)
				})}
			</Box>
		)
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const panel = await getPanel($)

		if (!panel || e.props.hasSurvey || (panel.phase === 'offer' && e.props.isWorking)) {
			return next(e)
		}

		const rest = await next(e)
		const elements = $.ui.resolve(e)
		const { Box, Text, Button } = elements
		// Graphics are the app's; the terminal's element table has no Svg.
		const Svg = 'Svg' in elements ? elements.Svg : undefined
		const noop = () => undefined
		const k = Math.round(panel.tokens / 1000)

		const body =
			panel.phase === 'offer' ? (
				<Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
					<Text>
						<Text color={ACCENT}>●</Text>
						<Text dimColor> Context at {k}k. Write a handoff before it compacts?</Text>
					</Text>
					<Box flexDirection="row" gap={1}>
						<Button key="write" label="Write handoff" variant="primary" onPress={noop} />
						<Button key="later" label="Not now" role="dismiss" onPress={noop} />
					</Box>
				</Box>
			) : panel.phase === 'purge' ? (
				<Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
					<Text>
						<Text color={BAD}>●</Text>
						<Text> Delete {plural(panel.files?.length ?? 0)} from .claude/handoff/? They go to the Trash.</Text>
					</Text>
					<Box flexDirection="row" gap={1}>
						<Button key="trash" label="Delete" variant="primary" onPress={noop} />
						<Button key="close" label="Cancel" role="dismiss" onPress={noop} />
					</Box>
				</Box>
			) : panel.phase === 'working' ? (
				<Text bold color={ACCENT}>
					Handing off…
				</Text>
			) : panel.phase === 'ready' ? (
				<Box key="handoff-ready" flexDirection="column" gap={1}>
					<Text dimColor wrap="truncate-middle">{`Saved to ${panel.file}`}</Text>
					<Box flexDirection="row" gap={1}>
						<Button key="copy" label="Copy" variant="primary" onPress={noop} />
						<Button key="start" label="Start new chat" variant="secondary" onPress={noop} />
						<Button key="open" label="Open file" onPress={noop} />
						<Button key="close" label="Close" role="dismiss" onPress={noop} />
					</Box>
				</Box>
			) : (
				<Box key="handoff-failed" flexDirection="column" gap={1}>
					<Text color={BAD}>{panel.error}</Text>
					<Box flexDirection="row" gap={1}>
						<Button key="retry" label="Try again" variant="primary" onPress={noop} />
						<Button key="close" label="Close" role="dismiss" onPress={noop} />
					</Box>
				</Box>
			)

		// The steps: one tight table, a block of its own a line apart from the title above it (while
		// writing) or from the saved line and buttons below it (after).
		const mark = (step: Step) =>
			step.status === 'done' ? (
				<Text color={GOOD}>✓</Text>
			) : step.status === 'fail' ? (
				<Text color={BAD}>✕</Text>
			) : step.status === 'run' ? (
				// The app draws the fading ring as an animated graphic; the terminal can't, so a dot.
				e.surface === 'terminal' || !Svg ? (
					<Text color={ACCENT}>•</Text>
				) : (
					<Svg source={RING} alt="Working" width={14} height={14} isInteractive />
				)
			) : (
				<Text dimColor>○</Text>
			)
		// Once it's done, the band must still show its buttons: where the full table won't fit in the
		// terminal's rows for the band, the steps fold into one summary line instead.
		const isDone = panel.phase === 'ready' || panel.phase === 'failed'
		// Rows: what's drawn above in this band (the terminal's usage strip), the gap above the band, the
		// title and its gap, the steps, then (once done) a gap, the saved line, a gap and the buttons, or
		// for a failure a gap, the error, a gap and the buttons; and a note with its gap.
		const rowsNeeded =
			(rest ? 1 : 0) + 1 + 2 + panel.steps.length + (panel.phase === 'ready' ? 4 : panel.phase === 'failed' ? 3 : 0) + (panel.note ? 2 : 0)
		// Only the terminal cuts the band off at its rows ("↓ 3 more"); the app grows it to fit, so
		// there the full list always stays.
		const fold = e.surface === 'terminal' && isDone && panel.steps.length > 0 && rowsNeeded > e.props.maxRows
		const failed = panel.steps.find(step => step.status === 'fail')
		const summary = [
			...panel.steps.slice(0, 3).filter(step => step.status === 'done' && step.detail).map(step => step.detail),
			...(panel.steps[3]?.status === 'done' ? [`written in ${panel.steps[3].detail}`] : []),
			...(failed ? [`${failed.label.toLowerCase()} failed`] : []),
		].join(' · ')
		const steps = fold ? (
			<Text key="handoff-steps-summary" wrap="truncate-end">
				<Text color={failed ? BAD : GOOD}>{failed ? '✕' : '✓'} </Text>
				<Text dimColor>{summary}</Text>
			</Text>
		) : panel.steps.length ? (
			<Box key="handoff-steps" flexDirection="column">
				{panel.steps.map((step, i) => {
					const filled = bar(step.progress, 24)

					return (
						<Box key={`step-${i}`} flexDirection="row" gap={1}>
							<Box width={2}>{mark(step)}</Box>
							<Box width={24}>
								<Text dimColor={step.status === 'wait'} wrap="truncate-end">
									{step.label}
								</Text>
							</Box>
							<Text>
								<Text color={step.status === 'fail' ? BAD : step.status === 'done' ? GOOD : ACCENT}>{filled.on}</Text>
								<Text color={TRACK}>{filled.off}</Text>
							</Text>
							{/* The file is too long to read after a bar; it gets its own line under the list. */}
							<Text dimColor wrap="truncate-end">
								{i === 4 ? '' : step.detail}
							</Text>
						</Box>
					)
				})}
			</Box>
		) : null

		// The title over the steps: what's happening, or what came of it.
		const title =
			panel.phase === 'working' ? (
				<Text bold color={ACCENT}>
					Handing off…
				</Text>
			) : panel.phase === 'ready' && panel.steps.length ? (
				<Text bold color={GOOD}>{`✓ Handoff saved · ${panel.words.toLocaleString('en-US')} words`}</Text>
			) : null

		// The band is its own block, always a line below what sits above it. In the desktop app that is
		// the app's own usage strip, which is outside this band, so `rest` is usually empty there: the
		// space can't depend on it.
		return (
			<Box flexDirection="column">
				{rest}
				<Box key="handoff-band" flexDirection="column" marginTop={1} gap={1}>
					{title}
					{steps}
					{panel.phase === 'working' ? null : body}
					{panel.note ? <Text dimColor>{panel.note}</Text> : null}
				</Box>
			</Box>
		)
	})
}
