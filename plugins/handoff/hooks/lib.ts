import type { FsEntry, SessionMessage } from 'claude-code';

import type { HandoffEntry, Step } from '../types';

/** The steps of writing a handoff, in order, as the band lists them. */
export const STEP_LABELS = ['Read the session', 'Find the files', 'Gather skills & links', 'Write the handoff', 'Save it'] as const;

/**
 * The running step's loader in the app: a fading ring, eight dots round a circle with a bright one
 * leading, animated by the SVG itself (SMIL), so it moves without the band redrawing.
 */
export function ringLoader(color: string): string {
	const dots = Array.from({ length: 8 }, (_, i) => {
		const angle = (i / 8) * 2 * Math.PI;
		const x = (8 + 5.2 * Math.cos(angle)).toFixed(2);
		const y = (8 + 5.2 * Math.sin(angle)).toFixed(2);
		const begin = ((i / 8) * 0.9).toFixed(4);

		return `<circle cx="${x}" cy="${y}" r="1.25" fill="${color}" opacity="0.15"><animate attributeName="opacity" values="1;0.15;0.15" keyTimes="0;0.6;1" dur="0.9s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
	});

	return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${dots.join('')}</svg>`;
}

export function freshSteps(): Step[] {
	return STEP_LABELS.map((label) => ({ label, detail: '', status: 'wait', progress: 0 }));
}

/** A thin progress bar of `width` cells: the filled part (drawn in colour) and the rest (dim). */
export function bar(progress: number, width: number): { on: string; off: string } {
	const filled = Math.round(Math.max(0, Math.min(1, progress)) * width);

	return { on: '━'.repeat(filled), off: '━'.repeat(width - filled) };
}

/** The writing step's bar while the model writes: it creeps toward full, and stops short of it. */
export function writeProgress(ms: number): number {
	return Math.min(0.95, 1 - Math.exp(-ms / 40_000));
}

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Pure helpers for the size handoff and the saved handoff file: nothing here calls the engine,
// so all of it is tested on its own (tests/lib.test.ts).

/** Once the trigger fires it waits half the room left before compaction, and never less than this. */
export const SNOOZE_MIN = 10_000;

/** `/handoff at <N>%`: a share of the session's compaction point, from PERCENT_MIN to PERCENT_MAX. */
const PERCENT_DEFAULT = 80;
const PERCENT_MIN = 50;
const PERCENT_MAX = 95;

/** Where the size trigger fires: a share of the compaction point, a fixed token count, or null when it is off. */
export type SizeAt = { percent: number } | { tokens: number };

export type SizeSettings = { at: SizeAt | null; mode: 'ask' | 'auto' };

/** What the transcript says this session touched, plus the git state the caller adds. */
export type Facts = { files: string[]; skills: string[]; links: string[]; git: string };

/** `/handoff`'s settings words, answered by idle.sh; anything else is a focus. */
export const SETTING = /^(help|h|status|settings|reset|default|on|off|auto|\d+[km]?|(awake|sleep) (on|off)|\d+%|at (\d+k?|\d+%|off)|size (ask|auto))$/;

/** `/handoff list`: this project's saved handoffs in a pane, each with Copy, Open and Start new chat. */
export const LIST = /^list$/;

/** A saved handoff's title, status and save time, from its file name and text. */
export function describeHandoff(name: string, text: string): HandoffEntry {
	const title = /^#{1,2}\s*(?:Handoff:|✅\s*Complete:)\s*(.+)$/m.exec(text)?.[1]?.trim() ?? name;
	const stamp = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-/.exec(name);
	const status = /^##\s*✅\s*Complete:/m.test(text)
		? 'Complete'
		: /\*\*Status:[^\n]*BLOCKED/i.test(text)
			? 'Blocked'
			: /\*\*Status:[^\n]*IN PROGRESS/i.test(text)
				? 'In progress'
				: '';

	return { name, title, status, when: stamp ? `${stamp[1]} ${stamp[2]}:${stamp[3]}` : '' };
}

/**
 * The list as the chat shows it where the pane can't open: a line, then a table. The line comes
 * first because the app puts "handoff: " before a command's first line.
 */
export function listTable(entries: readonly HandoffEntry[]): string {
	const cell = (text: string) => text.replace(/\|/g, '\\|');
	const rows = entries.map((entry) => `| ${entry.when || '—'} | ${cell(entry.title)} | ${entry.status || '—'} | \`${entry.name}\` |`);

	return `${entries.length} saved handoff${entries.length === 1 ? '' : 's'} in .claude/handoff/, newest first:\n\n| Saved | Title | Status | File |\n| --- | --- | --- | --- |\n${rows.join('\n')}`;
}

/** The log beside the handoffs keeps this many lines, newest last. */
export const LOG_LINES = 500;

/** One line of .claude/handoff/handoff.log: local time, the session's first 8 characters, the event, then what happened. */
export function logLine(nowMs: number, session: string, event: string, detail: string): string {
	const d = new Date(nowMs);
	const pad = (n: number) => String(n).padStart(2, '0');
	const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

	return `${when}  ${session.slice(0, 8).padEnd(8)}  ${event.padEnd(9)}  ${detail}`;
}

/** The log with one more line, trimmed to the last LOG_LINES. */
export function appendLog(existing: string, line: string): string {
	const lines = existing.split('\n').filter(Boolean);
	lines.push(line);

	return `${lines.slice(-LOG_LINES).join('\n')}\n`;
}

/** `/handoff purge`: moves this project's saved handoffs to the Trash, after a confirmation. */
export const PURGE = /^purge$/;

/** The saved handoffs in a listing of .claude/handoff/: plain .md files, oldest first by name. */
export function handoffFiles(entries: readonly Pick<FsEntry, 'name' | 'kind'>[]): string[] {
	return entries
		.filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
		.map((entry) => entry.name)
		.sort();
}

/**
 * The environment the mod starts idle.sh's timer with: marked as the mod's own, so the Stop hook's
 * stand-down (HANDOFF_IDLE_MOD) doesn't stop it, and counted from the end of the last reply when known.
 */
export function idleTimerEnv(since: number | undefined): Record<string, string> {
	return since === undefined ? { HANDOFF_IDLE_FROM_MOD: '1' } : { HANDOFF_IDLE_FROM_MOD: '1', HANDOFF_IDLE_SINCE: String(since) };
}

/** idle.sh's arguments for a settings word: `h` is short for `help`. */
export function scriptArgs(word: string): string[] {
	if (word === 'help' || word === 'h') {
		return ['help'];
	}

	// A number ending in k or % is the size threshold, short for `at <N>k` or `at <N>%`; a plain number is idle minutes.
	if (/^\d+[k%]$/.test(word)) {
		return ['set', 'at', word];
	}

	return word === 'status' || word === 'settings' ? ['status'] : ['set', ...word.split(' ')];
}

/** idle.conf's `key=value` lines; the last line for a key wins. */
export function parseConf(text: string): Record<string, string> {
	const conf: Record<string, string> = {};

	for (const line of text.split('\n')) {
		const at = line.indexOf('=');

		if (at > 0) {
			conf[line.slice(0, at).trim()] = line.slice(at + 1).trim();
		}
	}

	return conf;
}

export function sizeSettings(conf: Record<string, string>): SizeSettings {
	const raw = conf.size_at;
	const percent = /^(\d+)%$/.exec(raw ?? '')?.[1];
	const share = percent !== undefined && Number(percent) >= PERCENT_MIN && Number(percent) <= PERCENT_MAX ? Number(percent) : PERCENT_DEFAULT;
	const at: SizeAt = raw !== undefined && /^\d+$/.test(raw) ? { tokens: Number(raw) * 1000 } : { percent: share };

	return {
		at: raw === 'off' ? null : at,
		mode: conf.size_mode === 'auto' ? 'auto' : 'ask',
	};
}

/**
 * Where this session compacts, in tokens: the auto-compact threshold when auto-compact is on, else
 * the model's window; null before the engine knows the window.
 */
export function compactPoint(context: { window?: number; breakdown?: { autoCompactThreshold?: number; isAutoCompactEnabled?: boolean } }): number | null {
	const threshold = context.breakdown?.isAutoCompactEnabled ? context.breakdown.autoCompactThreshold : undefined;

	return threshold || context.window || null;
}

/** The size trigger's threshold in tokens: its share of the compaction point, or the fixed count as set. */
export function sizeThreshold(at: SizeAt, compactAt: number): number {
	return 'percent' in at ? Math.round((compactAt * at.percent) / 100) : at.tokens;
}

/**
 * The size trigger's state, one step. `armedAt` starts at `at`; a crossing fires once and moves it
 * past the current count by half the room left before compaction (at least SNOOZE_MIN), so it asks
 * again before the session compacts; dropping below `at` (a compaction, /clear) re-arms it.
 */
export function armCheck(armedAt: number, tokens: number, at: number, compactAt: number): { fire: boolean; armedAt: number } {
	if (tokens < at) {
		return { fire: false, armedAt: at };
	}

	if (tokens >= armedAt) {
		return { fire: true, armedAt: tokens + Math.max(SNOOZE_MIN, Math.round((compactAt - tokens) / 2)) };
	}

	return { fire: false, armedAt };
}

/**
 * Where the trigger is armed, from what the store holds: `{ at, armedAt }` saved for the same
 * threshold, else the threshold itself, so changing `/handoff at` takes effect on the next turn.
 */
export function armFrom(stored: unknown, at: number): number {
	const saved = stored as { at?: unknown; armedAt?: unknown } | undefined;

	return saved && typeof saved === 'object' && saved.at === at && typeof saved.armedAt === 'number' ? saved.armedAt : at;
}

const PATH_RE = /(?:~|\/)[A-Za-z0-9._@+-]+(?:\/[^\s'"`<>()|;,*]+)+/g;
const URL_RE = /https?:\/\/[^\s'"`<>()\]]+/g;
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

const isNoise = (path: string) =>
	path.includes('/.claude/projects/') ||
	path.includes('/tool-results/') ||
	path === '/tmp' ||
	path.startsWith('/tmp/') ||
	path.startsWith('/private/tmp/');

/**
 * Files (most used first, at most 30; the caller checks they still exist), skills and MCP servers,
 * and links (at most 20, newest kept), from the session's messages.
 */
export function gatherFacts(messages: readonly SessionMessage[], skip: (path: string) => boolean): Omit<Facts, 'git'> {
	const weights = new Map<string, number>();
	const skills = new Set<string>();
	const servers = new Set<string>();
	const links = new Set<string>();

	const add = (raw: string, weight: number) => {
		const path = raw.replace(/[.:]+$/, '');

		if (!path.startsWith('/') && !path.startsWith('~/')) {
			return;
		}

		if (isNoise(path) || skip(path)) {
			return;
		}

		weights.set(path, (weights.get(path) ?? 0) + weight);
	};

	for (const message of messages) {
		for (const use of message.toolUses ?? []) {
			const input = use.input ?? {};
			const target = input.file_path ?? input.notebook_path ?? input.path;

			if (typeof target === 'string') {
				add(target, EDITS.has(use.tool) ? 3 : use.tool === 'Read' ? 2 : 1);
			}

			if (use.tool === 'Bash' && typeof input.command === 'string') {
				for (const hit of input.command.match(PATH_RE) ?? []) {
					add(hit, 1);
				}
			}

			if (use.tool === 'Skill' && typeof input.skill === 'string') {
				skills.add(`/${input.skill}`);
			}

			if (use.tool.startsWith('mcp__')) {
				servers.add(use.tool.split('__')[1] ?? use.tool);
			}
		}

		for (const hit of message.text.match(URL_RE) ?? []) {
			const url = hit.replace(/[.,:;)]+$/, '');

			if (!/^https?:\/\/(localhost|127\.0\.0\.1|(www\.)?example\.com)(?=[:/]|$)/.test(url)) {
				links.delete(url);
				links.add(url);
			}
		}
	}

	const files = [...weights.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 30)
		.map(([path]) => path);

	return {
		files,
		skills: [...skills, ...[...servers].map((server) => `MCP ${server}`)],
		links: [...links].slice(-20),
	};
}

export function factsBlock(facts: Facts, tilde: (path: string) => string): string {
	const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none found');

	return `Facts pulled from this session's record. Check them against what you remember and drop what does not matter for the next step.

Files read or changed, most used first:
${list(facts.files.map(tilde))}

Skills and MCP servers used:
${list(facts.skills)}

Links in the chat:
${list(facts.links)}

Git state (branch, git status --short, git log --oneline -5):
${facts.git.trim() ? facts.git.trim() : '- none found'}`;
}

/** Whether anything was said before the handoff: a user message other than a command's wrapper. */
export function hasWork(messages: readonly SessionMessage[]): boolean {
	return messages.some((message) => message.role === 'user' && message.text.trim() !== '' && !message.text.trim().startsWith('<'));
}

/**
 * The prompt for `$.model.fork`: the skill's own format and rules (from "## Output format" to the
 * end of SKILL.md, verbatim), with what the fork can't do for itself said up front. `asked` is a
 * handoff the owner asked for (typed /handoff, Write handoff): it is always written, however short
 * the session, so the quick-question rule and the NOTHING reply are left out.
 */
export function forkPrompt(skillMd: string, focus: string, facts: string, cwd: string, asked = false): string {
	const body = skillMd.replace(/^---\n[\s\S]*?\n---\n/, '');
	const start = body.indexOf('## Output format');
	const format = start >= 0 ? body.slice(start).trim() : body.trim();
	// The skill's "Before writing" rules, less the two the fork can't follow (git commands, the file).
	const before = /## Before writing\n([\s\S]*?)(?=\n## )/.exec(body)?.[1] ?? '';
	const rules = before
		.split(/\n(?=\d+\. )/)
		.map((rule) => rule.trim())
		.filter((rule) => /^\d+\. /.test(rule) && !/read-only commands|Create exactly one file/.test(rule))
		.filter((rule) => !asked || !/no real work to hand off/.test(rule))
		.join('\n');
	const scope = focus.trim()
		? `Cover only this thread of the work, and leave out unrelated work from the session: ${focus.trim()}`
		: 'Cover the whole session.';

	return `Write a handoff of this session, following the instructions below. Working directory: ${cwd}

- The handoff covers this session's work only. The goal, the done list, the decisions and the next steps come from what was asked and done in this conversation, never from other changes you may have seen in the repo.
- You cannot call tools. The git state is in the facts at the end.
- ${scope}
- ${
		asked
			? 'The owner asked for this handoff, so always write one, however short the session: a short session gets a short handoff.'
			: 'If there is nothing to hand off (nothing was asked beyond the handoff itself, or only a quick question), reply with exactly NOTHING.'
	}
- Reply with the single fenced block the format below describes, and nothing else. Leave out the "Saved to" line: the plugin saves the file itself.

## Before writing

${rules}

${format}

${facts}`;
}

/**
 * The handoff inside the reply's outer fence, or the reply itself when it has none; null when there
 * is nothing. A fence counts as the outer one only when no heading comes before it, so the code
 * blocks inside an unfenced handoff are kept whole; a block that never closed keeps all after it.
 */
export function unfence(reply: string): string | null {
	const text = reply.trim();

	if (!text || text === 'NOTHING') {
		return null;
	}

	const lines = text.split('\n');
	const open = lines.findIndex((line) => /^(`{3,})[^`]*$/.test(line) || /^#/.test(line));
	const ticks = open >= 0 ? /^(`{3,})/.exec(lines[open] ?? '')?.[1] : undefined;

	if (ticks === undefined) {
		return text;
	}

	const close = lines.findLastIndex((line, i) => i > open && line.trim() === ticks);
	const inner = close > open ? lines.slice(open + 1, close) : lines.slice(open + 1);

	return inner.join('\n').trim() || null;
}

/**
 * The handoff as the chat shows it: the saved file, then one copyable markdown block, as the skill
 * writes it. The file comes first because the app puts "handoff: " before a command's first line,
 * and a fence that doesn't start its own line isn't a fence. The fence is one backtick longer than
 * any run of backticks inside, at least four.
 */
export function chatBlock(body: string, file: string): string {
	const longest = Math.max(3, ...(body.match(/`+/g) ?? []).map((run) => run.length));
	const fence = '`'.repeat(longest + 1);

	return `Saved to ${file}\n\n${fence}markdown\n${body}\n${fence}`;
}

export function slugFrom(body: string): string {
	const title = /^#{1,2}\s*(?:Handoff:|✅\s*Complete:)\s*(.+)$/m.exec(body)?.[1] ?? '';
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');

	return slug || 'session';
}

/** `YYYY-MM-DD-HHMM-<slug>.md`, in local time. */
export function fileName(nowMs: number, body: string): string {
	const d = new Date(nowMs);
	const pad = (n: number) => String(n).padStart(2, '0');

	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${slugFrom(body)}.md`;
}

// File error codes a person can read, for the ones a saved handoff is likely to meet.
const ERROR_CODES: Record<string, string> = {
	EACCES: 'permission denied',
	ENOENT: 'no such file',
	EPERM: 'not permitted',
};

/**
 * Why a call failed, kept short for a note or a log line: the message without a trailing path or
 * full stop. The engine's own wording (`handoff: $.fs.read(<path>) failed: EACCES`) comes down to
 * the code, named where it is a common one.
 */
export function shortReason(error: unknown): string {
	const message = String(error instanceof Error ? error.message : error)
		.trim()
		.replace(/^\S+: \$\.[\w.]+\(.*\) failed: /, '')
		.replace(/, \w+ '[^']*'$/, '')
		.replace(/\.$/, '');
	const named = ERROR_CODES[message];

	return named ? `${named} (${message})` : message;
}

/**
 * The desktop app's link for a new Claude Code chat with the handoff filled in. `folder` is the
 * project the handoff was saved in (the path before `/.claude/handoff/`); without it the app opens
 * the chat in whichever folder it used last.
 */
export function newChatUrl(text: string, path: string): string {
	const at = path.lastIndexOf('/.claude/handoff/');
	const folder = at > 0 ? `&folder=${encodeURIComponent(path.slice(0, at))}` : '';

	return `claude://code/new?q=${encodeURIComponent(text)}${folder}`;
}
