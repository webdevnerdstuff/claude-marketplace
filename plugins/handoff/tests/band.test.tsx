import { describe, expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import type { Panel } from '../types';

// The band above the prompt, drawn from the panel in $.state, on the terminal and the desktop.

const SURFACES = ['terminal', 'desktop'] as const;

const STEPS: Panel['steps'] = [
	{ label: 'Read the session', detail: '932 messages', status: 'done', progress: 1 },
	{ label: 'Find the files', detail: '24 files', status: 'done', progress: 1 },
	{ label: 'Gather skills & links', detail: '9 skills, 0 links', status: 'done', progress: 1 },
	{ label: 'Write the handoff', detail: '12 s', status: 'run', progress: 0.3 },
	{ label: 'Save it', detail: '', status: 'wait', progress: 0 },
];

const panelOf = (phase: Panel['phase'], extra: Partial<Panel> = {}): Panel => ({
	phase,
	steps: [],
	tick: 0,
	words: 1387,
	tokens: 252_000,
	file: '.claude/handoff/2026-11-12-0905-size-trigger.md',
	path: '/repo/.claude/handoff/2026-11-12-0905-size-trigger.md',
	text: '# Handoff: Size Trigger',
	error: '',
	note: '',
	...extra,
});

// The panel the plugin reads and writes, held here so a test can seed it and read it back.
function world(on: On, panel: Panel | null) {
	const held = { panel };

	// The engine's own band beneath the plugin's, as a plain marker. (In the desktop app it is
	// usually empty: the usage strip above the band is the app's own, so the band's spacing must
	// not depend on anything being drawn here.)
	on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
		const { Text } = $.ui.resolve(e);

		return <Text>engine band</Text>;
	});
	on('state.get', () => ({ value: { value: held.panel } }) as never);
	on('state.set', ($, e) => {
		held.panel = (e as { value: Panel | null }).value;

		return { value: {} } as never;
	});

	return held;
}

const mount = ($: Engine, surface: (typeof SURFACES)[number], isWorking = false, maxRows = 20) =>
	$.ui.mount({
		plugin: 'handoff',
		surface,
		component: 'AbovePrompt',
		// The band's own props; scroll and view, which it never reads, are left to the kit.
		props: { hasSurvey: false, isWorking, maxRows, bodyColumns: 100 } as never,
	});

describe('the band', () => {
	for (const surface of SURFACES) {
		test(`${surface}: the offer names the context size and asks`, async ($, on) => {
			world(on, panelOf('offer'));

			const ui = await mount($, surface);

			expect(await ui.find({ type: 'Text', text: /252k/ })).toBeDefined();
			expect(await ui.find({ key: 'write' })).toBeDefined();
			expect(await ui.find({ key: 'later' })).toBeDefined();
		});

		test(`${surface}: the offer waits out a running turn`, async ($, on) => {
			world(on, panelOf('offer'));

			const ui = await mount($, surface, true);

			expect(await ui.find({ key: 'write' })).toBeUndefined();
		});

		test(`${surface}: a saved handoff offers its buttons and names the file`, async ($, on) => {
			world(on, panelOf('ready'));

			const ui = await mount($, surface);

			for (const key of ['copy', 'start', 'open', 'close']) {
				expect(await ui.find({ key })).toBeDefined();
			}
			expect(await ui.find({ type: 'Text', text: /\.claude\/handoff\// })).toBeDefined();
		});

		test(`${surface}: a failed handoff shows why and offers Try again`, async ($, on) => {
			world(on, panelOf('failed', { error: 'The handoff did not finish: the model call failed (api-error 529)' }));

			const ui = await mount($, surface);

			expect(await ui.find({ key: 'retry' })).toBeDefined();
			expect(await ui.find({ type: 'Text', text: /api-error 529/ })).toBeDefined();
		});

		test(`${surface}: purge asks before deleting, naming the count`, async ($, on) => {
			world(on, panelOf('purge', { files: ['/repo/.claude/handoff/a.md', '/repo/.claude/handoff/b.md'] }));

			const ui = await mount($, surface);

			expect(await ui.find({ type: 'Text', text: /2 saved handoffs/ })).toBeDefined();
			expect(await ui.find({ key: 'trash' })).toBeDefined();
			expect(await ui.find({ key: 'close' })).toBeDefined();
		});

		test(`${surface}: while writing, every step shows with its mark, label and detail`, async ($, on) => {
			world(on, panelOf('working', { steps: STEPS, tick: 3 }));

			const ui = await mount($, surface);

			expect(await ui.find({ type: 'Text', text: /^Handing off…$/ })).toBeDefined();
			for (const step of STEPS) {
				expect(await ui.find({ type: 'Text', text: new RegExp(`^${step.label}$`) })).toBeDefined();
			}
			for (const mark of ['✓', '○']) {
				expect(await ui.find({ type: 'Text', text: mark })).toBeDefined();
			}
			const title = (await ui.find({ type: 'Text', text: /^Handing off…$/ })) as { props: Record<string, unknown> } | undefined;
			expect(title?.props.color).toBe('#d97757');

			if (surface === 'desktop') {
				// The app draws the running step's loader as an animated graphic: the fading ring.
				const ring = (await ui.find({ type: 'Svg' })) as { props: Record<string, unknown> } | undefined;
				expect(ring?.props.isInteractive).toBe(true);
				expect(String(ring?.props.source)).toContain('<animate');
				expect(ring?.props.alt).toBe('Working');
			} else {
				// The terminal can't draw graphics: a plain orange dot.
				const dot = (await ui.find({ type: 'Text', text: '•' })) as { props: Record<string, unknown> } | undefined;
				expect(dot?.props.color).toBe('#d97757');
			}
			expect(await ui.find({ type: 'Text', text: /^932 messages$/ })).toBeDefined();
			expect(await ui.find({ type: 'Text', text: /^12 s$/ })).toBeDefined();
		});

		test(`${surface}: a saved handoff has a bold title with its word count, and its file in the Save row`, async ($, on) => {
			const done = STEPS.map((step) => ({ ...step, status: 'done' as const, progress: 1 }));
			done[4] = { ...done[4]!, detail: '.claude/handoff/2026-11-12-1409-b.md' };
			world(on, panelOf('ready', { steps: done }));

			const ui = await mount($, surface, false, 30);
			const title = (await ui.find({ type: 'Text', text: /Handoff saved · 1,387 words/ })) as { props: Record<string, unknown> } | undefined;

			expect(title?.props.bold).toBe(true);
			// The file is too long to sit after a bar: it gets a line of its own under the list.
			expect(await ui.find({ type: 'Text', text: /^\.claude\/handoff\/2026-11-12-1409-b\.md$/ })).toBeUndefined();
			const saved = (await ui.find({ type: 'Text', text: /^Saved to \.claude\/handoff\/2026-11-12-0905-size-trigger\.md$/ })) as
				| { props: Record<string, unknown> }
				| undefined;
			expect(saved?.props.wrap).toBe('truncate-middle');
		});

		test(`${surface}: while writing, the title stands alone: no block-character figure`, async ($, on) => {
			world(on, panelOf('working', { steps: STEPS, tick: 1 }));

			const ui = await mount($, surface, false, 30);

			expect(await ui.find({ type: 'Text', text: /^Handing off…$/ })).toBeDefined();
			expect(await ui.find({ type: 'Text', text: /▐▛███▜▌|▗▟█████▙▖|▝▜█████▛▘/ })).toBeUndefined();
		});

		test(`${surface}: the steps are their own block, a line apart from the title and the saved line`, async ($, on) => {
			world(on, panelOf('ready', { steps: STEPS.map((step) => ({ ...step, status: 'done', progress: 1 })) }));

			const ui = await mount($, surface);
			const band = (await ui.find({ key: 'handoff-band' })) as { props: Record<string, unknown> } | undefined;

			expect(await ui.find({ key: 'handoff-steps' })).toBeDefined();
			expect(band?.props.gap).toBe(1);
			expect(await ui.find({ type: 'Text', text: /^Save it$/ })).toBeDefined();
		});

		test(`${surface}: a short band while writing keeps every step in view`, async ($, on) => {
			world(on, panelOf('working', { steps: STEPS, tick: 1 }));

			const ui = await mount($, surface, false, 8);

			expect(await ui.find({ type: 'Text', text: /^Save it$/ })).toBeDefined();
		});

		test(`${surface}: a saved handoff in a short band keeps its buttons in view`, async ($, on) => {
			world(on, panelOf('ready', { steps: STEPS.map((step) => ({ ...step, status: 'done', progress: 1 })) }));

			const ui = await mount($, surface, false, 8);

			expect(await ui.find({ key: 'copy' })).toBeDefined();
			if (surface === 'terminal') {
				// The terminal cuts a band off at its rows: the steps fold into one line there.
				expect(await ui.find({ key: 'handoff-steps' })).toBeUndefined();
				expect(await ui.find({ type: 'Text', text: /932 messages · 24 files · 9 skills, 0 links · written in 12 s/ })).toBeDefined();
			} else {
				// The app grows the band to fit: the full list always stays.
				expect(await ui.find({ key: 'handoff-steps' })).toBeDefined();
			}
		});

		test(`${surface}: the band keeps a line of space above it`, async ($, on) => {
			world(on, panelOf('ready'));

			const ui = await mount($, surface);
			const band = (await ui.find({ key: 'handoff-band' })) as { props: Record<string, unknown> } | undefined;

			expect(band?.props.marginTop).toBe(1);
		});

		test(`${surface}: a note sits a line below the buttons`, async ($, on) => {
			world(on, panelOf('ready', { note: 'Copied. Paste it as the first message of a new session.' }));

			const ui = await mount($, surface);
			const band = (await ui.find({ key: 'handoff-band' })) as { props: Record<string, unknown> } | undefined;

			expect(await ui.find({ type: 'Text', text: /^Copied\./ })).toBeDefined();
			expect(band?.props.gap).toBe(1);
		});

		for (const phase of ['ready', 'failed'] as const) {
			test(`${surface}: ${phase}: a line of space between the message and its buttons`, async ($, on) => {
				world(on, panelOf(phase, { error: 'The handoff did not finish: x' }));

				const ui = await mount($, surface);
				const body = (await ui.find({ key: `handoff-${phase}` })) as { props: Record<string, unknown> } | undefined;

				expect(body?.props.gap).toBe(1);
			});
		}

		test(`${surface}: Not now clears the band`, async ($, on) => {
			const held = world(on, panelOf('offer'));

			const ui = await mount($, surface);
			await ui.press({ key: 'later' });

			expect(held.panel).toBe(null);
		});
	}

	test('no panel draws nothing of ours', async ($, on) => {
		world(on, null);

		const ui = await mount($, 'desktop');

		expect(await ui.find({ key: 'write' })).toBeUndefined();
		expect(await ui.find({ key: 'copy' })).toBeUndefined();
	});

	test('Delete moves the listed files to the Trash and clears the band', async ($, on) => {
		const held = world(on, panelOf('purge', { files: ['/repo/.claude/handoff/a.md'] }));
		const runs: (readonly string[])[] = [];
		on('fs.exists', () => ({ value: true }));
		on('process.run', ($, e) => {
			runs.push(e.argv);

			return { value: { exitCode: 0, stdout: '', stderr: '' } } as never;
		});
		on('ui.toast', () => ({ value: undefined }) as never);

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'trash' });

		expect(runs).toContainEqual(['trash', '/repo/.claude/handoff/a.md']);
		expect(held.panel).toBe(null);
	});

	test('New session opens the session and adds no note when it works', async ($, on) => {
		const held = world(on, panelOf('ready', { note: 'Copied. Paste it as the first message of a new session.' }));
		const runs: (readonly string[])[] = [];
		on('process.run', ($, e) => {
			runs.push(e.argv);

			return { value: { exitCode: 0, stdout: '', stderr: '' } } as never;
		});

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'start' });

		expect(runs[0]?.[0]).toBe('open');
		// The project the handoff was saved in, so the new session opens there and not in the app's default folder.
		expect(String(runs[0]?.[1])).toMatch(/^claude:\/\/code\/new\?q=.+&folder=%2Frepo$/);
		expect(held.panel?.note).toBe('');
	});

	test('New session says so when the session does not open', async ($, on) => {
		const held = world(on, panelOf('ready'));
		on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'no handler' } }) as never);

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'start' });

		expect(held.panel?.note).toContain('did not open');
	});

	test('Not now is logged, with the session, to the project handoff.log', async ($, on) => {
		world(on, panelOf('offer'));
		const writes: { path: string; text: string }[] = [];
		mock.clock(on, { now: new Date(2026, 10, 12, 15, 42, 7).getTime() });
		on('session.id', () => ({ value: 'a1b2c3d4e5f6' }));
		on('session.cwd', () => ({ value: '/repo' }));
		on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo\n', stderr: '' } }) as never);
		on('fs.exists', () => ({ value: false }));
		on('fs.read', () => ({ value: '' }) as never);
		on('fs.write', ($, e) => {
			writes.push(e as { path: string; text: string });

			return { value: undefined } as never;
		});

		const ui = await mount($, 'desktop');
		await ui.press({ key: 'later' });

		expect(writes.at(-1)?.path).toBe('/repo/.claude/handoff/handoff.log');
		expect(writes.at(-1)?.text).toContain('2026-11-12 15:42:07  a1b2c3d4  not-now    size offer at 252k');
	});
});
