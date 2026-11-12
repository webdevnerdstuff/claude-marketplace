import { describe, expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import type { HandoffList } from '../types';

// The /handoff list pane: one row per saved handoff, newest first, each with its own buttons.

const LIST: HandoffList = {
	dir: '/repo/.claude/handoff',
	entries: [
		{ name: '2026-11-12-1409-b.md', title: 'Newer one', status: 'Complete', when: '2026-11-12 14:09' },
		{ name: '2026-11-11-1200-a.md', title: 'Older one', status: 'In progress', when: '2026-11-11 12:00' },
	],
	note: '',
};

function world(on: On, list: HandoffList | null, opts: { exists?: boolean; trashExit?: number; openExit?: number; files?: string[]; readError?: string } = {}) {
	const held = { list, copied: [] as string[], runs: [] as (readonly string[])[], writes: [] as { path: string; text: string }[] };

	on('state.get', ($, e) => ({ value: { value: (e as { key: string }).key === 'list' ? held.list : null } }) as never);
	on('state.set', ($, e) => {
		if ((e as { key: string }).key === 'list') {
			held.list = (e as { value: HandoffList | null }).value;
		}

		return { value: {} } as never;
	});
	on('fs.read', ($, e) => {
		if (opts.readError && (e as { path: string }).path.endsWith('.md')) {
			throw new Error(opts.readError);
		}

		return { value: '# Handoff: Newer one\nbody' } as never;
	});
	on('ui.copy', ($, e) => {
		held.copied.push((e as { text: string }).text);

		return { value: { isCopied: true } } as never;
	});
	on('process.run', ($, e) => {
		held.runs.push(e.argv);
		const isTrash = e.argv[0] === 'trash' || e.argv[0] === 'gio';

		return { value: { exitCode: isTrash ? (opts.trashExit ?? 0) : e.argv[0] === 'open' ? (opts.openExit ?? 0) : 0, stdout: e.argv[0] === 'git' ? '/repo\n' : '', stderr: '' } } as never;
	});
	on('fs.exists', () => ({ value: opts.exists ?? true }));
	on('fs.write', ($, e) => {
		held.writes.push(e as { path: string; text: string });

		return { value: undefined } as never;
	});
	on('session.id', () => ({ value: 'a1b2c3d4e5f6' }));
	on('session.cwd', () => ({ value: '/repo' }));
	on('fs.list', () => ({ value: (opts.files ?? []).map((name) => ({ name, kind: 'file' })) }) as never);
	mock.clock(on, { now: new Date(2026, 10, 12, 16, 30, 0).getTime() });

	return held;
}

const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
	$.ui.mount({
		plugin: 'handoff',
		surface,
		component: 'Pane',
		requestId: 'handoff-list',
		props: { title: 'Handoffs', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never,
	});

describe('the list pane', () => {
	for (const surface of ['terminal', 'desktop'] as const) {
		test(`${surface}: one row per handoff, newest first, each with Copy, Open, Start new chat and Delete`, async ($, on) => {
			world(on, LIST);

			const ui = await mount($, surface);
			const titles = (await ui.findAll({ type: 'Text', text: /^(Newer|Older) one$/ })).map((found) => (found as unknown as { text: string }).text);

			expect(titles).toEqual(['Newer one', 'Older one']);
			for (const name of ['2026-11-12-1409-b.md', '2026-11-11-1200-a.md']) {
				for (const action of ['copy', 'open', 'start', 'trash']) {
					expect(await ui.find({ key: `${action}:${name}` })).toBeDefined();
				}
			}
			expect(await ui.find({ type: 'Text', text: /2026-11-12 14:09 · Complete/ })).toBeDefined();
			expect(await ui.find({ key: 'refresh' })).toBeDefined();
		});

		test(`${surface}: the header wraps Refresh under its text in a narrow pane`, async ($, on) => {
			world(on, LIST);

			const ui = await mount($, surface);
			const header = (await ui.find({ key: 'list-header' })) as { props: Record<string, unknown> } | undefined;

			expect(header?.props.flexWrap).toBe('wrap');
			expect(header?.props.rowGap).toBe('xs');
		});

		test(`${surface}: a narrow pane wraps a row's buttons onto a new line instead of breaking one`, async ($, on) => {
			world(on, LIST);

			const ui = await mount($, surface);
			const row = (await ui.find({ key: 'buttons:2026-11-12-1409-b.md' })) as { props: Record<string, unknown> } | undefined;

			expect(row?.props.flexDirection).toBe('row');
			expect(row?.props.flexWrap).toBe('wrap');
			expect(row?.props.columnGap).toBe(1);
			// A step, not cells: the terminal draws xs as no row, desktop as its own small gap.
			expect(row?.props.rowGap).toBe('xs');
		});
	}

	test('Copy copies that file and says so', async ($, on) => {
		const held = world(on, LIST);

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'copy:2026-11-12-1409-b.md' });

		expect(held.copied).toEqual(['# Handoff: Newer one\nbody']);
		expect(held.list?.note).toContain('Copied');
	});

	test('Open and Start new chat act on their own row', async ($, on) => {
		const held = world(on, LIST);

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'open:2026-11-11-1200-a.md' });
		await ui.press({ key: 'start:2026-11-12-1409-b.md' });

		expect(held.runs[0]).toEqual(['open', '/repo/.claude/handoff/2026-11-11-1200-a.md']);
		expect(String(held.runs[1]?.[1])).toMatch(/^claude:\/\/code\/new\?q=.+&folder=%2Frepo$/);
	});

	test('Delete trashes that file, drops its row and says so', async ($, on) => {
		const held = world(on, LIST);

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'trash:2026-11-11-1200-a.md' });

		expect(held.runs.find((run) => run[0] === 'trash')).toEqual(['trash', '/repo/.claude/handoff/2026-11-11-1200-a.md']);
		expect(held.list?.entries.map((entry) => entry.name)).toEqual(['2026-11-12-1409-b.md']);
		expect(held.list?.note).toBe('Moved "Older one" to the Trash.');
		expect(held.list?.isFailure).toBe(false);
		const log = held.writes.find((write) => write.path.endsWith('handoff.log'));
		expect(log?.text).toMatch(/trashed\s+2026-11-11-1200-a\.md/);
	});

	test('Delete with no Trash command keeps the row and says why', async ($, on) => {
		const held = world(on, LIST, { trashExit: 127 });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'trash:2026-11-11-1200-a.md' });

		expect(held.list?.entries).toHaveLength(2);
		expect(held.list?.note.startsWith('Couldn\'t delete "Older one": ')).toBe(true);
		expect(held.list?.note).toContain('no Trash command');
		expect(held.list?.isFailure).toBe(true);
		const log = held.writes.find((write) => write.path.endsWith('handoff.log'));
		expect(log?.text).toMatch(/failed\s+delete 2026-11-11-1200-a\.md: .*no Trash command/);
	});

	test('Delete on a file already gone still drops its row', async ($, on) => {
		const held = world(on, LIST, { exists: false });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'trash:2026-11-11-1200-a.md' });

		expect(held.runs.some((run) => run[0] === 'trash')).toBe(false);
		expect(held.list?.entries.map((entry) => entry.name)).not.toContain('2026-11-11-1200-a.md');
		expect(held.list?.note).toBe('Moved "Older one" to the Trash.');
	});

	test('Deleting the last row shows the empty text', async ($, on) => {
		world(on, { ...LIST, entries: [LIST.entries[0]!] });

		const first = await mount($, 'desktop');
		await first.press({ key: 'trash:2026-11-12-1409-b.md' });
		await first.unmount();
		const ui = await mount($, 'desktop');

		expect(await ui.find({ type: 'Text', text: /No saved handoffs/ })).toBeDefined();
	});

	test('Two quick presses on Delete trash the file and log it once', async ($, on) => {
		const held = world(on, LIST);

		const ui = await mount($, 'desktop');
		await Promise.allSettled([ui.press({ key: 'trash:2026-11-11-1200-a.md' }), ui.press({ key: 'trash:2026-11-11-1200-a.md' })]);

		expect(held.runs.filter((run) => run[0] === 'trash')).toHaveLength(1);
		const logs = held.writes.filter((write) => write.path.endsWith('handoff.log'));
		expect(logs).toHaveLength(1);
		expect(held.list?.note).toBe('Moved "Older one" to the Trash.');
	});

	test('a failure note is red', async ($, on) => {
		world(on, { ...LIST, note: 'Something failed.', isFailure: true });

		const ui = await mount($, 'desktop');
		const note = (await ui.find({ type: 'Text', text: 'Something failed.' })) as { props: Record<string, unknown> } | undefined;

		expect(note?.props.color).toBe('#dc2626');
	});

	test('a success note is green', async ($, on) => {
		world(on, { ...LIST, note: 'All good.', isFailure: false });

		const ui = await mount($, 'desktop');
		const note = (await ui.find({ type: 'Text', text: 'All good.' })) as { props: Record<string, unknown> } | undefined;

		expect(note?.props.color).toBe('#16a34a');
	});

	test('Start new chat that does not open marks its note a failure', async ($, on) => {
		const held = world(on, LIST, { openExit: 1 });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'start:2026-11-12-1409-b.md' });

		expect(held.list?.note).toContain('did not open');
		expect(held.list?.isFailure).toBe(true);
	});

	test('Refresh reads the folder again and clears an old note', async ($, on) => {
		const held = world(on, { ...LIST, note: 'Old note.', isFailure: true }, { files: ['2026-11-12-1409-b.md', '2026-11-13-0900-c.md', 'handoff.log'] });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'refresh' });

		expect(held.list?.dir).toBe('/repo/.claude/handoff');
		expect(held.list?.entries.map((entry) => entry.name)).toEqual(['2026-11-13-0900-c.md', '2026-11-12-1409-b.md']);
		expect(held.list?.note).toBe('');
		expect(held.list?.isFailure).toBe(false);
	});

	test('an empty list still has Refresh, which finds new handoffs', async ($, on) => {
		const held = world(on, { ...LIST, entries: [] }, { files: ['2026-11-13-0900-c.md'] });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'refresh' });

		expect(held.list?.entries.map((entry) => entry.name)).toEqual(['2026-11-13-0900-c.md']);
	});

	test('a Copy that cannot read the file says why and logs it', async ($, on) => {
		const held = world(on, LIST, { readError: "EACCES: permission denied, open '/repo/.claude/handoff/2026-11-12-1409-b.md'" });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'copy:2026-11-12-1409-b.md' });

		// The kit rejects with its own message, not the stub's; shortReason's own tests cover the wording.
		expect(held.list?.note).toMatch(/^Couldn't read "Newer one": \S.*[^.]\.$/);
		expect(held.list?.isFailure).toBe(true);
		const log = held.writes.find((write) => write.path.endsWith('handoff.log'));
		expect(log?.text).toMatch(/failed\s+copy 2026-11-12-1409-b\.md: \S.*\n$/);
	});

	test('a Start new chat that does not open says why and logs it', async ($, on) => {
		const held = world(on, LIST, { openExit: 1 });

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'start:2026-11-12-1409-b.md' });

		expect(held.list?.note).toBe('The new chat did not open for "Newer one": open exited 1. Copy it instead.');
		const log = held.writes.find((write) => write.path.endsWith('handoff.log'));
		expect(log?.text).toMatch(/failed\s+start 2026-11-12-1409-b\.md: open exited 1\n$/);
	});

	test('a Copy that works logs nothing', async ($, on) => {
		const held = world(on, LIST);

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'copy:2026-11-12-1409-b.md' });

		expect(held.writes.filter((write) => write.path.endsWith('handoff.log'))).toHaveLength(0);
	});

	test('no list says there is nothing saved', async ($, on) => {
		world(on, { ...LIST, entries: [] });

		const ui = await mount($, 'desktop');

		expect(await ui.find({ type: 'Text', text: /No saved handoffs/ })).toBeDefined();
	});
});
