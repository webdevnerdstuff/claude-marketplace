import { describe, expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

import type { Panel } from '../types';

// A compaction of the main conversation answers the size offer and re-arms the trigger.

const OFFER: Panel = { phase: 'offer', tokens: 252_000, steps: [], tick: 0, words: 0, file: '', path: '', text: '', error: '', note: '' };

function world(on: On, panel: Panel | null) {
	const held = { panel, store: {} as Record<string, unknown> };

	mock.env(on, { HOME: '/Users/me' });
	on('store.set', ($, e) => {
		held.store[(e as { key: string }).key] = (e as { value: unknown }).value;

		return { value: undefined } as never;
	});
	on('session.id', () => ({ value: 'sess-1' }));
	on('fs.exists', () => ({ value: false }));
	on('state.get', () => ({ value: { value: held.panel } }) as never);
	on('state.set', ($, e) => {
		held.panel = (e as { value: Panel | null }).value;

		return { value: {} } as never;
	});
	// The engine's own compaction beneath the plugin.
	on('session.compact', () => ({ messages: [SUMMARY] }) as never);

	return held;
}

const SUMMARY = { role: 'user', text: 'Summary of the conversation so far.', toolUses: [] };

const compact = (trigger: 'manual' | 'precompute', agentId?: string) => ({ trigger, messages: [SUMMARY], ...(agentId ? { agentId } : {}) }) as never;

describe('after a compaction', () => {
	test('the offer goes and the trigger re-arms at the threshold', async ($, on) => {
		const held = world(on, OFFER);

		await $.session.compact(compact('manual'));

		expect(held.panel).toBe(null);
		expect(held.store['arm:sess-1']).toEqual(null);
	});

	test('a saved handoff band stays', async ($, on) => {
		const held = world(on, { ...OFFER, phase: 'ready', text: 'x' });

		await $.session.compact(compact('manual'));

		expect(held.panel?.phase).toBe('ready');
	});

	test('a compaction worked out ahead of time changes nothing', async ($, on) => {
		const held = world(on, OFFER);

		await $.session.compact(compact('precompute'));

		expect(held.panel?.phase).toBe('offer');
	});

	test("a subagent's compaction changes nothing", async ($, on) => {
		const held = world(on, OFFER);

		await $.session.compact(compact('manual', 'agent-1'));

		expect(held.panel?.phase).toBe('offer');
	});
});
