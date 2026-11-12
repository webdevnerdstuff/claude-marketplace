import type { EngineInterface } from 'claude-code';

import { appendLog, count, describeHandoff, logLine, factsBlock, fileName, forkPrompt, gatherFacts, handoffFiles, hasWork, parseConf, sizeSettings, unfence } from './lib';
import type { SizeSettings } from './lib';
import type { HandoffEntry, Panel, Step } from '../types';

export type { Panel };

/** Told about each step as it starts, finishes or fails, so the band can show it. */
export type OnStep = (index: number, change: Partial<Step>) => void | Promise<void>;

// The engine side of one handoff: read the session, ask a fork of it to write, save the file.

export type Written = { ok: true; path: string; text: string } | { ok: false; reason: string };

export async function homeDir($: EngineInterface): Promise<string> {
	return (await $.env.get('HOME')) ?? '';
}

/** The size handoff settings from idle.conf, the file idle.sh keeps; the defaults when it's missing. */
export async function readSize($: EngineInterface): Promise<SizeSettings> {
	try {
		const path = `${await homeDir($)}/.claude/handoff/idle.conf`;

		return sizeSettings((await $.fs.exists(path)) ? parseConf(String(await $.fs.read(path))) : {});
	} catch {
		return sizeSettings({});
	}
}

/** The git root of `cwd`, or `cwd` outside a repo. */
export async function projectRoot($: EngineInterface, cwd: string): Promise<string> {
	const run = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined);
	const root = run?.exitCode === 0 ? run.stdout.trim() : '';

	return root || cwd;
}

/** Branch, short status and the last five commits, or '' outside a repo. */
export async function gitState($: EngineInterface, root: string): Promise<string> {
	const parts: string[] = [];

	for (const args of [['branch', '--show-current'], ['status', '--short'], ['log', '--oneline', '-5']]) {
		const run = await $.process.run(['git', '-C', root, ...args]).catch(() => undefined);

		if (run?.exitCode !== 0) {
			return parts.join('\n');
		}

		parts.push(`$ git ${args.join(' ')}\n${run.stdout.trim() || '(nothing)'}`);
	}

	return parts.join('\n');
}

/**
 * Writes and saves one handoff. `asked`: the owner asked for it (typed /handoff, Write handoff), so
 * any session with something said gets one. `onStep` hears each step start, finish or fail.
 */
export async function writeHandoff($: EngineInterface, focus: string, asked = false, onStep?: OnStep): Promise<Written> {
	const step = async (index: number, change: Partial<Step>) => {
		await onStep?.(index, change);
	};
	const home = await homeDir($);
	const tilde = (path: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

	await step(0, { status: 'run', progress: 0.5 });
	const cwd = await $.session.cwd();
	const root = await projectRoot($, cwd);
	const messages = await $.session.messages();
	await step(0, { status: 'done', progress: 1, detail: count(messages.length, 'message') });

	if (asked && !hasWork(messages)) {
		return { ok: false, reason: 'nothing to hand off yet' };
	}

	await step(1, { status: 'run', progress: 0.5 });
	const found = gatherFacts(messages, (path) => path.startsWith(`${root}/.claude/handoff/`));
	const files: string[] = [];

	for (const file of found.files) {
		const path = file.startsWith('~/') ? home + file.slice(1) : file;

		if (await $.fs.exists(path).catch(() => false)) {
			files.push(path);
		}
	}

	await step(1, { status: 'done', progress: 1, detail: count(files.length, 'file') });

	await step(2, { status: 'run', progress: 0.5 });
	const facts = factsBlock({ ...found, files, git: await gitState($, root) }, tilde);
	const skill = String(await $.fs.read(`${$.plugin.root}/skills/handoff/SKILL.md`));
	await step(2, { status: 'done', progress: 1, detail: `${count(found.skills.length, 'skill')}, ${count(found.links.length, 'link')}` });

	await step(3, { status: 'run', progress: 0.02 });
	const started = await $.clock.now();
	const reply = await $.model.fork({ prompt: forkPrompt(skill, focus, facts, cwd, asked) });
	const seconds = `${Math.round(((await $.clock.now()) - started) / 1000)} s`;

	if (!reply.isAnswered && reply.reason === 'aborted') {
		await step(3, { status: 'fail', detail: 'cancelled' });

		return { ok: false, reason: 'cancelled' };
	}

	if (!reply.isAnswered) {
		const status = 'status' in reply && reply.status !== undefined ? ` ${reply.status}` : '';
		await step(3, { status: 'fail', detail: seconds });

		return { ok: false, reason: `the model call failed (${reply.reason}${status})` };
	}

	await step(3, { status: 'done', progress: 1, detail: seconds });
	const body = unfence(reply.text);

	if (body === null) {
		return { ok: false, reason: 'nothing to hand off yet' };
	}

	await step(4, { status: 'run', progress: 0.5 });
	const dir = `${root}/.claude/handoff`;
	const name = fileName(await $.clock.now(), body);
	const path = `${dir}/${name}`;

	await $.process.run(['mkdir', '-p', dir]);
	await $.fs.write(path, `${body}\n`);
	await step(4, { status: 'done', progress: 1, detail: `.claude/handoff/${name}` });

	return { ok: true, path, text: body };
}

/** This project's saved handoffs: the .md files directly in <project>/.claude/handoff/. */
export async function listHandoffs($: EngineInterface): Promise<{ dir: string; files: string[] }> {
	const dir = `${await projectRoot($, await $.session.cwd())}/.claude/handoff`;
	const entries = (await $.fs.exists(dir).catch(() => false)) ? await $.fs.list(dir) : [];

	return { dir, files: handoffFiles(entries).map((name) => `${dir}/${name}`) };
}

/**
 * Moves the files that still exist to the Trash: macOS's trash, else gio trash. Where neither
 * runs, it refuses: a purge never deletes for good.
 */
export async function trashFiles($: EngineInterface, paths: readonly string[]): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
	const there: string[] = [];

	for (const path of paths) {
		if (await $.fs.exists(path).catch(() => false)) {
			there.push(path);
		}
	}

	if (!there.length) {
		return { ok: true, count: 0 };
	}

	for (const argv of [['trash', ...there], ['gio', 'trash', ...there]]) {
		const run = await $.process.run(argv).catch(() => undefined);

		if (run?.exitCode === 0) {
			return { ok: true, count: there.length };
		}

		if (run !== undefined && run.exitCode !== 127) {
			return { ok: false, reason: run.stderr.trim() || `${argv[0]} exited ${run.exitCode}` };
		}
	}

	return { ok: false, reason: 'there is no Trash command here (trash or gio), so nothing was deleted' };
}

/** This project's saved handoffs for the list: newest first, each with its title, status and time. */
export async function readHandoffs($: EngineInterface): Promise<{ dir: string; entries: HandoffEntry[] }> {
	const { dir, files } = await listHandoffs($);
	const entries: HandoffEntry[] = [];

	for (const path of [...files].reverse()) {
		const text = String(await $.fs.read(path).catch(() => ''));
		entries.push(describeHandoff(path.slice(dir.length + 1), text));
	}

	return { dir, entries };
}

/**
 * Adds one line to <project>/.claude/handoff/handoff.log: what triggered a handoff and what came of
 * it. Never throws; the log must not break a handoff.
 */
export async function writeLog($: EngineInterface, event: string, detail: string): Promise<void> {
	try {
		const dir = `${await projectRoot($, await $.session.cwd())}/.claude/handoff`;
		const path = `${dir}/handoff.log`;
		const line = logLine(await $.clock.now(), await $.session.id(), event, detail);
		const existing = (await $.fs.exists(path).catch(() => false)) ? String(await $.fs.read(path)) : '';

		await $.process.run(['mkdir', '-p', dir]);
		await $.fs.write(path, appendLog(existing, line));
	} catch {
		// A log that can't be written is skipped.
	}
}
