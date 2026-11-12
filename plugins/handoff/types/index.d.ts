/** One step of writing a handoff, as the band shows it. */
export type Step = {
	label: string
	/** A short result after the bar: "932 messages", "12 s", the file name. */
	detail: string
	status: 'wait' | 'run' | 'done' | 'fail'
	/** 0 to 1. */
	progress: number
}

/** The band above the prompt, kept in $.state so every surface draws the same one. */
export type Panel = {
	/** offer: the size handoff's question. working: being written. ready: the buttons. failed: the error and Try again. purge: Delete or Cancel for the saved handoffs. */
	phase: 'offer' | 'working' | 'ready' | 'failed' | 'purge'
	/** The context size when the band opened. */
	tokens: number
	/** What writing the handoff has done so far; [] outside a run. */
	steps: Step[]
	/** Counts up while a handoff is being written, for anything that animates. */
	tick: number
	/** The saved handoff's length, for the title. */
	words: number
	/** The saved file from the project down: .claude/handoff/<name>.md. */
	file: string
	/** The saved file's absolute path, for Open file. */
	path: string
	/** The handoff itself, for Copy and Start new chat. */
	text: string
	error: string
	/** A line under the buttons: "Copied", "A new chat is filled in". */
	note: string
	/** purge: the absolute paths listed when /handoff purge ran; only these are moved to the Trash. */
	files?: string[]
}

/** One saved handoff, as the /handoff list pane shows it. */
export type HandoffEntry = {
	/** The file name in .claude/handoff/. */
	name: string
	/** From its "# Handoff:" or "## ✅ Complete:" line, else the file name. */
	title: string
	/** In progress, Blocked or Complete; '' when the file doesn't say. */
	status: string
	/** YYYY-MM-DD HH:MM, from the file name; '' when it has none. */
	when: string
}

/** The /handoff list pane: the saved handoffs, newest first, and a line for what a button did. */
export type HandoffList = {
	dir: string
	entries: HandoffEntry[]
	note: string
	/** The note reports something that went wrong, so it shows red, not green. */
	isFailure?: boolean
}

declare module 'claude-code' {
	interface PluginState {
		handoff: { panel: Panel | null; list: HandoffList | null }
	}
}
