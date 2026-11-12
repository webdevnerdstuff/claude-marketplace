import { describe, expect, test } from 'claude-code/testing';

// The mod runs the idle timer, so the Stop hook must stand down in every session, including one that
// reloaded the mod mid-session (session.start doesn't run again then). Each message sets the flag.
describe('the idle stand-down flag', () => {
	test('a prompt sets HANDOFF_IDLE_MOD, so the Stop hook leaves the idle timer to the mod', async ($, on) => {
		const sets: { name: string; value?: string }[] = [];
		on('env.set', ($, e) => {
			sets.push(e as { name: string; value?: string });

			return { value: {} } as never;
		});
		on('prompt.submit', ($, e) => ({ text: (e as { text: string }).text }) as never);

		await $.prompt.submit({ text: 'keep going' } as never);

		expect(sets).toContainEqual({ name: 'HANDOFF_IDLE_MOD', value: '1' });
	});
});
