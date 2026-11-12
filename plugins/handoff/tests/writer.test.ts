import { describe, expect, test } from 'claude-code/testing';

import { listHandoffs, readHandoffs, trashFiles, writeHandoff, writeLog } from '../hooks/writer';

const SKILL = `---
name: handoff
---

## Arguments

idle.sh words.

## Output format

Reply with a single fenced block.

## Writing rules

- Self-contained.
`;

const HANDOFF = '````markdown\n# Handoff: Size Trigger\n\n**Status: 🟡 IN PROGRESS**\n````';

type World = {
	cwd?: string;
	isRepo?: boolean;
	fork?: unknown;
	noTrash?: boolean;
	noGio?: boolean;
};

type Seen = {
	writes: { path: string; text: string }[];
	runs: (readonly string[])[];
	prompts: string[];
};

// A hand-built engine for the writer: the kit's own `$` carries only event nouns (session, ui,
// command, ...), not a plugin's env, fs, process or model, so the writer gets this instead.
// A session in `cwd` that edited one file, git answering for a repo at /repo (or failing outside
// one), and the model replying with `fork`.
function world({ cwd = '/repo/sub', isRepo = true, fork = { isAnswered: true, text: HANDOFF }, noTrash = false, noGio = false }: World = {}) {
	const seen: Seen = { writes: [], runs: [], prompts: [] };
	const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' });
	const engine = {
		plugin: { root: '/plugins/handoff' },
		env: { get: async (name: string) => (name === 'HOME' ? '/Users/me' : undefined) },
		clock: { now: async () => new Date(2026, 10, 12, 9, 5).getTime() },
		session: {
			id: async () => 'a1b2c3d4e5f6',
			cwd: async () => cwd,
			messages: async () => [
				{ role: 'user', text: 'add a size trigger', toolUses: [] },
				{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Edit', input: { file_path: '/repo/sub/idle.sh' } }] },
			],
		},
		fs: {
			exists: async () => true,
			list: async (path: string) =>
				path === '/repo/.claude/handoff'
					? [
							{ name: '2026-11-12-0905-b.md', kind: 'file', size: 1 },
							{ name: 'keep.txt', kind: 'file', size: 1 },
							{ name: '2026-11-11-1200-a.md', kind: 'file', size: 1 },
						]
					: [],
			read: async (path: string) =>
				path === '/plugins/handoff/skills/handoff/SKILL.md'
					? SKILL
					: path.endsWith('-a.md')
						? '# Handoff: Older one\n**Status: 🟡 IN PROGRESS**'
						: path.endsWith('-b.md')
							? '## ✅ Complete: Newer one'
							: '',
			write: async (path: string, text: string) => {
				seen.writes.push({ path, text });
			},
		},
		process: {
			run: async (argv: readonly string[]) => {
				seen.runs.push(argv);
				const [cmd, , , sub] = argv;

				if (cmd === 'trash' && noTrash) {
					throw new Error('spawn trash ENOENT');
				}

				if (cmd === 'gio' && noGio) {
					throw new Error('spawn gio ENOENT');
				}

				if (cmd === 'git' && !isRepo) {
					return { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' };
				}

				if (cmd === 'git' && sub === 'rev-parse') {
					return ok('/repo\n');
				}

				return ok(cmd === 'git' ? 'handoff-size-trigger\n' : '');
			},
		},
		model: {
			fork: async ({ prompt }: { prompt: string }) => {
				seen.prompts.push(prompt);

				return fork;
			},
		},
	};

	return { $: engine as never, seen };
}

describe('writeHandoff', () => {
	test('saves the block, unfenced, under the git root', async () => {
		const { $, seen } = world();

		const result = await writeHandoff($, '');

		expect(result).toEqual({
			ok: true,
			path: '/repo/.claude/handoff/2026-11-12-0905-size-trigger.md',
			text: '# Handoff: Size Trigger\n\n**Status: 🟡 IN PROGRESS**',
		});
		expect(seen.writes).toEqual([
			{ path: '/repo/.claude/handoff/2026-11-12-0905-size-trigger.md', text: '# Handoff: Size Trigger\n\n**Status: 🟡 IN PROGRESS**\n' },
		]);
		expect(seen.runs).toContainEqual(['mkdir', '-p', '/repo/.claude/handoff']);
	});

	test('falls back to the working folder outside a repo, spaces intact', async () => {
		const { $, seen } = world({ cwd: '/p q/r', isRepo: false });

		const result = await writeHandoff($, '');

		expect(result).toEqual(expect.objectContaining({ ok: true, path: '/p q/r/.claude/handoff/2026-11-12-0905-size-trigger.md' }));
		expect(seen.runs).toContainEqual(['mkdir', '-p', '/p q/r/.claude/handoff']);
		expect(seen.runs).toContainEqual(['git', '-C', '/p q/r', 'rev-parse', '--show-toplevel']);
	});

	test('reports a failed model call and writes nothing', async () => {
		const { $, seen } = world({ fork: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' } });

		const result = (await writeHandoff($, '')) as { ok: boolean; reason: string };

		expect(result.ok).toBe(false);
		expect(result.reason).toContain('529');
		expect(seen.writes).toEqual([]);
	});

	test('says cancelled when the fork was interrupted', async () => {
		const { $, seen } = world({ fork: { isAnswered: false, reason: 'aborted' } });

		expect(await writeHandoff($, '')).toEqual({ ok: false, reason: 'cancelled' });
		expect(seen.writes).toEqual([]);
	});

	test('when asked, writes even a short session and never offers the model NOTHING', async () => {
		const { $, seen } = world();

		const result = await writeHandoff($, '', true);

		expect(result.ok).toBe(true);
		expect(seen.prompts[0] ?? '').not.toContain('NOTHING');
	});

	test('when asked in a session with nothing said, does not call the model', async () => {
		const { $, seen } = world();
		($ as unknown as { session: { messages: () => Promise<unknown[]> } }).session.messages = async () => [];

		expect(await writeHandoff($, '', true)).toEqual({ ok: false, reason: 'nothing to hand off yet' });
		expect(seen.prompts).toEqual([]);
	});

	test('has nothing to hand off when the model says NOTHING', async () => {
		const { $, seen } = world({ fork: { isAnswered: true, text: 'NOTHING' } });

		expect(await writeHandoff($, '')).toEqual({ ok: false, reason: 'nothing to hand off yet' });
		expect(seen.writes).toEqual([]);
	});

	test('gives the model the skill format, the edited file, the git state and the focus', async () => {
		const { $, seen } = world();

		await writeHandoff($, 'the idle part');

		const prompt = seen.prompts[0] ?? '';
		expect(prompt).toContain('## Output format');
		expect(prompt).toContain('/repo/sub/idle.sh');
		expect(prompt).toContain('handoff-size-trigger');
		expect(prompt).toContain('the idle part');
		expect(prompt).not.toContain('idle.sh words');
	});
});

describe('writeHandoff steps', () => {
	test('reports each step as it goes, with a detail for each', async () => {
		const { $ } = world();
		const seen: { i: number; status?: string; detail?: string }[] = [];

		await writeHandoff($, '', true, (i, change) => {
			seen.push({ i, status: change.status, detail: change.detail });
		});

		const done = seen.filter((step) => step.status === 'done');
		expect(done.map((step) => step.i)).toEqual([0, 1, 2, 3, 4]);
		expect(done[0]?.detail).toBe('2 messages');
		expect(done[1]?.detail).toBe('1 file');
		expect(done[2]?.detail).toBe('0 skills, 0 links');
		expect(done[3]?.detail).toMatch(/^\d+ s$/);
		expect(done[4]?.detail).toBe('.claude/handoff/2026-11-12-0905-size-trigger.md');
		expect(seen.findIndex((step) => step.i === 3 && step.status === 'run') < seen.findIndex((step) => step.i === 3 && step.status === 'done')).toBe(true);
	});

	test('marks the writing step failed when the model call fails', async () => {
		const { $ } = world({ fork: { isAnswered: false, reason: 'api-error', status: 529 } });
		const seen: { i: number; status?: string }[] = [];

		await writeHandoff($, '', true, (i, change) => {
			seen.push({ i, status: change.status });
		});

		expect(seen).toContainEqual({ i: 3, status: 'fail' });
		expect(seen.some((step) => step.i === 4)).toBe(false);
	});
});

describe('writeLog', () => {
	test("appends one line to the project's handoff.log, creating the folder", async () => {
		const { $, seen } = world();

		await writeLog($, 'start', 'typed · context 12k');

		expect(seen.runs).toContainEqual(['mkdir', '-p', '/repo/.claude/handoff']);
		expect(seen.writes.length).toBe(1);
		expect(seen.writes[0]?.path).toBe('/repo/.claude/handoff/handoff.log');
		expect(seen.writes[0]?.text).toMatch(/^2026-11-12 09:05:00 {2}\S+ {2}start {6}typed · context 12k\n$/);
	});
});

describe('readHandoffs', () => {
	test('lists the saved handoffs newest first, with title, status and time', async () => {
		const { $ } = world();

		const { dir, entries } = await readHandoffs($);

		expect(dir).toBe('/repo/.claude/handoff');
		expect(entries).toEqual([
			{ name: '2026-11-12-0905-b.md', title: 'Newer one', status: 'Complete', when: '2026-11-12 9:05 AM' },
			{ name: '2026-11-11-1200-a.md', title: 'Older one', status: 'In progress', when: '2026-11-11 12:00 PM' },
		]);
	});
});

describe('purge', () => {
	test('lists the saved handoffs under the git root', async () => {
		const { $ } = world();

		expect(await listHandoffs($)).toEqual({
			dir: '/repo/.claude/handoff',
			files: ['/repo/.claude/handoff/2026-11-11-1200-a.md', '/repo/.claude/handoff/2026-11-12-0905-b.md'],
		});
	});

	test('moves the files to the Trash with trash', async () => {
		const { $, seen } = world();

		expect(await trashFiles($, ['/repo/.claude/handoff/a.md', '/repo/.claude/handoff/b.md'])).toEqual({ ok: true, count: 2 });
		expect(seen.runs).toContainEqual(['trash', '/repo/.claude/handoff/a.md', '/repo/.claude/handoff/b.md']);
	});

	test('falls back to gio trash where there is no trash command', async () => {
		const { $, seen } = world({ noTrash: true });

		expect(await trashFiles($, ['/repo/.claude/handoff/a.md'])).toEqual({ ok: true, count: 1 });
		expect(seen.runs).toContainEqual(['gio', 'trash', '/repo/.claude/handoff/a.md']);
	});

	test('refuses rather than deleting when there is no Trash', async () => {
		const { $, seen } = world({ noTrash: true, noGio: true });

		const result = await trashFiles($, ['/repo/.claude/handoff/a.md']);

		expect(result.ok).toBe(false);
		expect(seen.runs.some((argv) => argv[0] === 'rm')).toBe(false);
	});

	test('skips files that are already gone', async () => {
		const { $, seen } = world();
		($ as unknown as { fs: { exists: (p: string) => Promise<boolean> } }).fs.exists = async (p) => !p.endsWith('gone.md');

		expect(await trashFiles($, ['/repo/.claude/handoff/a.md', '/repo/.claude/handoff/gone.md'])).toEqual({ ok: true, count: 1 });
		expect(seen.runs).toContainEqual(['trash', '/repo/.claude/handoff/a.md']);
	});
});
