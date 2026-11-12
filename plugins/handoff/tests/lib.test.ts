import { describe, expect, test } from 'claude-code/testing';
import type { SessionMessage } from 'claude-code';

import {
	PURGE,
	shortReason,
	newChatUrl,
	appendLog,
	logLine,
	STEP_LABELS,
	ringLoader,
	bar,
	freshSteps,
	writeProgress,
	idleTimerEnv,
	LIST,
	describeHandoff,
	listTable,
	scriptArgs,
	chatBlock,
	hasWork,
	SETTING,
	handoffFiles,
	armFrom,
	SNOOZE_MIN,
	armCheck,
	compactPoint,
	sizeThreshold,
	factsBlock,
	fileName,
	forkPrompt,
	gatherFacts,
	parseConf,
	sizeSettings,
	slugFrom,
	unfence,
} from '../hooks/lib';

// A transcript message: only the fields the helpers read.
const said = (role: 'user' | 'assistant', text: string, uses: { tool: string; input: Record<string, unknown> }[] = []) =>
	({ role, text, toolUses: uses }) as unknown as SessionMessage;

const SKILL = `---
name: handoff
---

# Session Handoff

## Arguments

Run \`idle.sh set <argument>\`.

## Before writing

1. Review the whole session.
2. The handoff covers this session's work only.
3. If the session has no real work to hand off (nothing was asked beyond the \`/handoff\` itself, or only a quick question), don't write a handoff.
4. If the work is in a git repo and you have a shell, run only read-only commands: \`git branch --show-current\`.
5. Create exactly one file, the handoff, and nothing else.
6. Decide the status of the work, judged against the Goal.

## Output format

Reply with a single fenced block.

## Completion summary format

Use this when complete.

## Writing rules

- Self-contained.
`;

describe('size settings', () => {
	test('default to 80% of the compaction point and ask', () => {
		expect(sizeSettings(parseConf(''))).toEqual({ at: { percent: 80 }, mode: 'ask' });
	});

	test('read a percentage of the compaction point', () => {
		expect(sizeSettings(parseConf('size_at=70%')).at).toEqual({ percent: 70 });
		expect(sizeSettings(parseConf('size_at=50%')).at).toEqual({ percent: 50 });
		expect(sizeSettings(parseConf('size_at=95%')).at).toEqual({ percent: 95 });
	});

	test('a percentage out of range, or an old auto, reads as the default', () => {
		expect(sizeSettings(parseConf('size_at=40%')).at).toEqual({ percent: 80 });
		expect(sizeSettings(parseConf('size_at=96%')).at).toEqual({ percent: 80 });
		expect(sizeSettings(parseConf('size_at=auto')).at).toEqual({ percent: 80 });
	});

	test('read a fixed threshold in thousands and the mode', () => {
		expect(sizeSettings(parseConf('size_at=120\nsize_mode=auto\n'))).toEqual({ at: { tokens: 120_000 }, mode: 'auto' });
	});

	test('an old fixed 250 stays fixed', () => {
		expect(sizeSettings(parseConf('size_at=250')).at).toEqual({ tokens: 250_000 });
	});

	test('off turns the trigger off', () => {
		expect(sizeSettings(parseConf('size_at=off')).at).toBe(null);
	});

	test('the last line for a key wins', () => {
		expect(sizeSettings(parseConf('size_at=1\nsize_at=300')).at).toEqual({ tokens: 300_000 });
	});

	test('a broken value falls back to the default', () => {
		expect(sizeSettings(parseConf('size_at=lots\nsize_mode=maybe'))).toEqual({ at: { percent: 80 }, mode: 'ask' });
	});
});

describe('compactPoint', () => {
	test('is the auto-compact threshold when auto-compact is on', () => {
		expect(compactPoint({ window: 1_000_000, breakdown: { autoCompactThreshold: 967_000, isAutoCompactEnabled: true } })).toBe(967_000);
	});

	test('is the window when auto-compact is off or unknown', () => {
		expect(compactPoint({ window: 1_000_000, breakdown: { autoCompactThreshold: 967_000, isAutoCompactEnabled: false } })).toBe(1_000_000);
		expect(compactPoint({ window: 200_000 })).toBe(200_000);
	});

	test('is null with no window', () => {
		expect(compactPoint({})).toBe(null);
		expect(compactPoint({ window: 0 })).toBe(null);
	});
});

describe('sizeThreshold', () => {
	test('a percentage is that share of the compaction point', () => {
		expect(sizeThreshold({ percent: 80 }, 967_000)).toBe(773_600);
		expect(sizeThreshold({ percent: 80 }, 167_000)).toBe(133_600);
		expect(sizeThreshold({ percent: 70 }, 1_000_000)).toBe(700_000);
	});

	test('a fixed threshold is used as set', () => {
		expect(sizeThreshold({ tokens: 120_000 }, 967_000)).toBe(120_000);
	});
});

describe('armCheck', () => {
	test('stays quiet below the threshold', () => {
		expect(armCheck(773_600, 700_000, 773_600, 967_000)).toEqual({ fire: false, armedAt: 773_600 });
	});

	test('fires once on crossing, then waits half the room left before compaction', () => {
		expect(armCheck(773_600, 780_000, 773_600, 967_000)).toEqual({ fire: true, armedAt: 873_500 });
		expect(armCheck(873_500, 800_000, 773_600, 967_000)).toEqual({ fire: false, armedAt: 873_500 });
		expect(armCheck(873_500, 880_000, 773_600, 967_000)).toEqual({ fire: true, armedAt: 923_500 });
	});

	test('waits at least SNOOZE_MIN close to compaction', () => {
		expect(SNOOZE_MIN).toBe(10_000);
		expect(armCheck(160_000, 162_000, 133_600, 167_000)).toEqual({ fire: true, armedAt: 172_000 });
		expect(armCheck(160_000, 170_000, 133_600, 167_000)).toEqual({ fire: true, armedAt: 180_000 });
	});

	test('a new threshold replaces an armed point stored for the old one', () => {
		expect(armFrom({ at: 250_000, armedAt: 250_000 }, 100_000)).toBe(100_000);
		expect(armFrom({ at: 250_000, armedAt: 352_000 }, 300_000)).toBe(300_000);
		expect(armCheck(armFrom({ at: 250_000, armedAt: 250_000 }, 100_000), 120_000, 100_000, 167_000).fire).toBe(true);
	});

	test('the armed point stays while the threshold is unchanged', () => {
		expect(armFrom({ at: 250_000, armedAt: 352_000 }, 250_000)).toBe(352_000);
	});

	test('nothing stored, cleared, or an old number, starts at the threshold', () => {
		expect(armFrom(undefined, 250_000)).toBe(250_000);
		expect(armFrom(null, 250_000)).toBe(250_000);
		expect(armFrom(352_000, 250_000)).toBe(250_000);
	});

	test('re-arms at the threshold after a compaction', () => {
		expect(armCheck(873_500, 120_000, 773_600, 967_000)).toEqual({ fire: false, armedAt: 773_600 });
	});
});

describe('gatherFacts', () => {
	const keepAll = () => false;

	test('ranks edited files above read ones and counts paths in commands', () => {
		const facts = gatherFacts(
			[
				said('assistant', '', [
					{ tool: 'Read', input: { file_path: '/a/y.ts' } },
					{ tool: 'Edit', input: { file_path: '/a/x.ts' } },
					{ tool: 'Bash', input: { command: 'cat /a/z.md' } },
				]),
			],
			keepAll,
		);
		expect(facts.files).toEqual(['/a/x.ts', '/a/y.ts', '/a/z.md']);
	});

	test('drops scratch and transcript paths, and what skip says to', () => {
		const facts = gatherFacts(
			[
				said('assistant', '', [
					{ tool: 'Read', input: { file_path: '/tmp/q' } },
					{ tool: 'Read', input: { file_path: '/private/tmp/r' } },
					{ tool: 'Read', input: { file_path: '/Users/me/.claude/projects/p/s.jsonl' } },
					{ tool: 'Read', input: { file_path: '/Users/me/x/tool-results/t.txt' } },
					{ tool: 'Read', input: { file_path: '/scratch/w.md' } },
					{ tool: 'Read', input: { file_path: '/keep/me.ts' } },
				]),
			],
			(p) => p.startsWith('/scratch/'),
		);
		expect(facts.files).toEqual(['/keep/me.ts']);
	});

	test('keeps at most 30 files', () => {
		const uses = Array.from({ length: 40 }, (_, i) => ({ tool: 'Read', input: { file_path: `/f/${i}.ts` } }));
		expect(gatherFacts([said('assistant', '', uses)], keepAll).files.length).toBe(30);
	});

	test('names skills and MCP servers', () => {
		const facts = gatherFacts(
			[
				said('assistant', '', [
					{ tool: 'Skill', input: { skill: 'gac:gac' } },
					{ tool: 'mcp__vuetify-mcp__get_x', input: {} },
				]),
			],
			keepAll,
		);
		expect(facts.skills).toEqual(['/gac:gac', 'MCP vuetify-mcp']);
	});

	test('collects links, minus local ones and trailing punctuation', () => {
		const facts = gatherFacts(
			[said('user', 'see https://github.com/o/r/pull/7. and http://localhost:3000 and https://example.com/x')],
			keepAll,
		);
		expect(facts.links).toEqual(['https://github.com/o/r/pull/7']);
	});
});

describe('factsBlock', () => {
	test('says none found for each empty list', () => {
		const block = factsBlock({ files: [], skills: [], links: [], git: '' }, (p) => p);
		expect(block).toContain('Check them against what you remember');
		expect(block.split('- none found').length - 1).toBe(4);
	});

	test('lists files through tilde', () => {
		const block = factsBlock({ files: ['/Users/me/a.ts'], skills: [], links: [], git: 'main' }, (p) => p.replace('/Users/me', '~'));
		expect(block).toContain('- ~/a.ts');
		expect(block).toContain('main');
	});
});

describe('forkPrompt', () => {
	test('carries the format and rules, not the settings', () => {
		const prompt = forkPrompt(SKILL, '', 'FACTS-HERE', '/p');
		expect(prompt).toContain('## Output format');
		expect(prompt).toContain('## Writing rules');
		expect(prompt).toContain('/p');
		expect(prompt).toContain('NOTHING');
		expect(prompt).toContain('FACTS-HERE');
		expect(prompt).not.toContain('## Arguments');
		expect(prompt).not.toContain('idle.sh');
		expect(prompt).not.toContain('name: handoff');
	});

	test('keeps the status and scope rules, drops the shell and file steps', () => {
		const prompt = forkPrompt(SKILL, '', '', '/p');
		expect(prompt).toContain('Decide the status of the work');
		expect(prompt).toContain('Review the whole session');
		expect(prompt).not.toContain('git branch --show-current');
		expect(prompt).not.toContain('Create exactly one file');
	});

	test('when the owner asked, it always writes one: no NOTHING escape, no quick-question rule', () => {
		const prompt = forkPrompt(SKILL, '', '', '/p', true);
		expect(prompt).not.toContain('NOTHING');
		expect(prompt).not.toContain('no real work to hand off');
		expect(prompt).toContain('always write one');
	});

	test('an automatic handoff keeps the quick-question rule', () => {
		const prompt = forkPrompt(SKILL, '', '', '/p');
		expect(prompt).toContain('NOTHING');
		expect(prompt).toContain('no real work to hand off');
	});

	test('tells the writer the plugin saves the file', () => {
		expect(forkPrompt(SKILL, '', '', '/p')).toContain('Leave out the "Saved to" line');
	});

	test('names the focus when given', () => {
		expect(forkPrompt(SKILL, 'auth migration', '', '/p')).toContain('auth migration');
	});
});

describe('unfence', () => {
	test('takes the body of a four-backtick block', () => {
		expect(unfence('````markdown\n# Handoff: A\nx\n````')).toBe('# Handoff: A\nx');
	});

	test('ignores prose around the block and keeps inner fences', () => {
		expect(unfence('Here it is:\n````markdown\n# Handoff: A\n```sh\nls\n```\n````\nNote: unverified.')).toBe(
			'# Handoff: A\n```sh\nls\n```',
		);
	});

	test('takes a three-backtick block', () => {
		expect(unfence('```md\n# Handoff: B\n```')).toBe('# Handoff: B');
	});

	test('keeps an unfenced reply whole, inner code blocks and all', () => {
		expect(unfence('# Handoff: X\n```sh\nls\n```\nmore')).toBe('# Handoff: X\n```sh\nls\n```\nmore');
	});

	test('keeps what came of a block that never closed', () => {
		expect(unfence('````markdown\n# Handoff: Y\n```sh\nls\n```\ncut off')).toBe('# Handoff: Y\n```sh\nls\n```\ncut off');
	});

	test('keeps an unfenced reply as it is', () => {
		expect(unfence('  # Handoff: C\nbody  ')).toBe('# Handoff: C\nbody');
	});

	test('has nothing for NOTHING or an empty reply', () => {
		expect(unfence('NOTHING')).toBe(null);
		expect(unfence('  ')).toBe(null);
	});
});

describe('hasWork', () => {
	test('a session with a question in it has something to hand off', () => {
		expect(hasWork([said('user', 'math for later 5-6 2-56'), said('assistant', '5 − 6 = −1')])).toBe(true);
	});

	test('only the /handoff command itself, or nothing, is no work', () => {
		expect(hasWork([])).toBe(false);
		expect(hasWork([said('user', '<command-name>/handoff:handoff</command-name>'), said('user', '  ')])).toBe(false);
	});
});

describe('chatBlock', () => {
	test('names the file first, then the handoff in a copyable four-backtick block', () => {
		expect(chatBlock('# Handoff: X\n```sh\nls\n```', '.claude/handoff/a.md')).toBe(
			'Saved to .claude/handoff/a.md\n\n````markdown\n# Handoff: X\n```sh\nls\n```\n````',
		);
	});

	test('never opens with the fence: the app puts "handoff: " before the first line', () => {
		const shown = `handoff: ${chatBlock('# Handoff: X', 'f.md')}`;
		expect(shown.split('\n').some((line) => line === '````markdown')).toBe(true);
	});

	test('uses a longer fence when the handoff holds a four-backtick one', () => {
		expect(chatBlock('a\n````\nb\n````', 'f.md')).toContain('\n`````markdown\n');
	});
});

describe('file naming', () => {
	test('slugs the handoff title', () => {
		expect(slugFrom('# Handoff: Fix the Auth / Login!')).toBe('fix-the-auth-login');
	});

	test('slugs the completion title', () => {
		expect(slugFrom('## ✅ Complete: Ship 1.2')).toBe('ship-1-2');
	});

	test('falls back to session', () => {
		expect(slugFrom('no title here')).toBe('session');
	});

	test('keeps long slugs to 48 characters with no trailing dash', () => {
		const slug = slugFrom(`# Handoff: ${'word '.repeat(20)}`);
		expect(slug.length <= 48).toBe(true);
		expect(slug.endsWith('-')).toBe(false);
	});

	test('stamps the name in local time', () => {
		expect(fileName(new Date(2026, 10, 12, 9, 5).getTime(), '# Handoff: X')).toBe('2026-11-12-0905-x.md');
	});
});

describe('the log', () => {
	test('one line: local time, short session id, padded event, then the details', () => {
		expect(logLine(new Date(2026, 10, 12, 15, 42, 7).getTime(), 'a1b2c3d4e5f6', 'start', 'size-auto · context 252k')).toBe(
			'2026-11-12 15:42:07  a1b2c3d4  start      size-auto · context 252k',
		);
	});

	test('appends a line, newest last, and keeps only the last 500', () => {
		expect(appendLog('', 'one')).toBe('one\n');
		expect(appendLog('one\n', 'two')).toBe('one\ntwo\n');
		const full = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n') + '\n';
		const kept = appendLog(full, 'new').trimEnd().split('\n');
		expect(kept.length).toBe(500);
		expect(kept[0]).toBe('line 1');
		expect(kept[499]).toBe('new');
	});
});

describe('purge', () => {
	test('the word is purge alone, and cleanup is no longer it', () => {
		expect(PURGE.test('purge')).toBe(true);
		expect(PURGE.test('purge the auth code')).toBe(false);
		expect(PURGE.test('cleanup')).toBe(false);
		expect(SETTING.test('purge')).toBe(false);
	});

	test('picks only markdown files, oldest first by name', () => {
		expect(
			handoffFiles([
				{ name: '2026-11-12-0905-b.md', kind: 'file' },
				{ name: 'notes.txt', kind: 'file' },
				{ name: 'old', kind: 'dir' },
				{ name: '2026-11-11-1200-a.md', kind: 'file' },
				{ name: 'link.md', kind: 'other' },
			]),
		).toEqual(['2026-11-11-1200-a.md', '2026-11-12-0905-b.md']);
	});
});

describe('steps', () => {
	test('five steps, all waiting at the start', () => {
		expect(STEP_LABELS).toEqual(['Read the session', 'Find the files', 'Gather skills & links', 'Write the handoff', 'Save it']);
		expect(freshSteps().every((step) => step.status === 'wait' && step.progress === 0 && step.detail === '')).toBe(true);
	});

	test('the loader is a fading ring: eight dots, a bright one leading round', () => {
		const svg = ringLoader('#d97757');
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg.match(/<circle /g)?.length).toBe(8);
		expect(svg.match(/<animate attributeName="opacity"/g)?.length).toBe(8);
		expect(svg).toContain('fill="#d97757"');
		expect(svg).toContain('repeatCount="indefinite"');
	});

	test('a bar fills in proportion, clamped to its width', () => {
		expect(bar(0.5, 24)).toEqual({ on: '━'.repeat(12), off: '━'.repeat(12) });
		expect(bar(2, 4)).toEqual({ on: '━━━━', off: '' });
		expect(bar(-1, 4)).toEqual({ on: '', off: '━━━━' });
	});

	test('the writing bar creeps toward full but never reaches it before the reply', () => {
		expect(writeProgress(0)).toBe(0);
		expect(writeProgress(20_000) > writeProgress(5_000)).toBe(true);
		expect(writeProgress(10 * 60_000)).toBe(0.95);
	});
});

describe('idleTimerEnv', () => {
	test("marks the timer as the mod's own, so the Stop hook's stand-down doesn't stop it", () => {
		expect(idleTimerEnv(undefined)).toEqual({ HANDOFF_IDLE_FROM_MOD: '1' });
	});

	test('counts from the end of the last reply when it is known', () => {
		expect(idleTimerEnv(1794500000)).toEqual({ HANDOFF_IDLE_FROM_MOD: '1', HANDOFF_IDLE_SINCE: '1794500000' });
	});
});

describe('scriptArgs', () => {
	test('h and help both show the help', () => {
		expect(scriptArgs('h')).toEqual(['help']);
		expect(scriptArgs('help')).toEqual(['help']);
	});

	test('settings and status show the settings; everything else is set', () => {
		expect(scriptArgs('settings')).toEqual(['status']);
		expect(scriptArgs('status')).toEqual(['status']);
		expect(scriptArgs('at 250k')).toEqual(['set', 'at', '250k']);
	});

	test('a number ending in k is the size threshold; a plain number is still idle minutes', () => {
		expect(scriptArgs('250k')).toEqual(['set', 'at', '250k']);
		expect(scriptArgs('2k')).toEqual(['set', 'at', '2k']);
		expect(scriptArgs('70%')).toEqual(['set', 'at', '70%']);
		expect(scriptArgs('5m')).toEqual(['set', '5m']);
		expect(scriptArgs('20')).toEqual(['set', '20']);
	});
});

describe('list', () => {
	test('the word is list alone, and it is not a setting', () => {
		expect(LIST.test('list')).toBe(true);
		expect(LIST.test('list the auth work')).toBe(false);
		expect(SETTING.test('list')).toBe(false);
	});

	test('reads the title, status and save time of a handoff', () => {
		expect(describeHandoff('2026-11-12-1409-x.md', '# Handoff: Size trigger\n\n**Status: 🟡 IN PROGRESS**\n')).toEqual({
			name: '2026-11-12-1409-x.md',
			title: 'Size trigger',
			status: 'In progress',
			when: '2026-11-12 14:09',
		});
	});

	test('knows blocked and complete handoffs', () => {
		expect(describeHandoff('2026-11-12-1409-x.md', '# Handoff: A\n**Status: ⛔ BLOCKED: waiting on access**').status).toBe('Blocked');
		expect(describeHandoff('2026-11-12-1409-x.md', '## ✅ Complete: Ship it\n').status).toBe('Complete');
		expect(describeHandoff('2026-11-12-1409-x.md', '## ✅ Complete: Ship it\n').title).toBe('Ship it');
	});

	test('falls back to the file name for a file it does not recognise', () => {
		expect(describeHandoff('notes.md', 'just text')).toEqual({ name: 'notes.md', title: 'notes.md', status: '', when: '' });
	});

	test('the chat table never opens on its first line, where the app puts "handoff: "', () => {
		const text = listTable([{ name: 'a.md', title: 'A | pipe', status: 'Complete', when: '2026-11-12 14:09' }]);
		const lines = text.split('\n');
		expect(lines[0]?.startsWith('|')).toBe(false);
		expect(lines).toContain('| 2026-11-12 14:09 | A \\| pipe | Complete | `a.md` |');
	});
});

describe('SETTING', () => {
	test('matches the settings words', () => {
		for (const word of ['at 250k', 'at 300', 'at off', 'at 70%', '70%', '5m', '120m', 'size auto', 'size ask', 'awake on', 'sleep off', '20', 'help', 'h', 'status', 'reset', 'default', '250k', '2k']) {
			expect(SETTING.test(word)).toBe(true);
		}
	});

	test('leaves focus text alone', () => {
		for (const word of ['at the auth migration', 'size of the cache', '"on"', 'the auth migration', 'at auto', '70% done', '5 minutes', '5mins']) {
			expect(SETTING.test(word)).toBe(false);
		}
	});
});

describe('shortReason', () => {
	test('drops the path and full stop from a file error', () => {
		expect(shortReason(new Error("EACCES: permission denied, open '/repo/.claude/handoff/a.md'"))).toBe('EACCES: permission denied');
	});

	test('takes a plain string, trimmed, without its full stop', () => {
		expect(shortReason(' there is no Trash command here (trash or gio), so nothing was deleted.\n')).toBe('there is no Trash command here (trash or gio), so nothing was deleted');
	});

	test("turns the engine's file error into a plain reason with its code", () => {
		const real = 'handoff: $.fs.read(/Users/me/repo/.claude/handoff/2026-11-12-2359-fail-test.md) failed: EACCES';
		expect(shortReason(new Error(real))).toBe('permission denied (EACCES)');
		expect(shortReason(new Error('handoff: $.fs.read(/repo/a.md) failed: ENOENT'))).toBe('no such file (ENOENT)');
		expect(shortReason(new Error('handoff: $.fs.read(/repo/a.md) failed: EIO'))).toBe('EIO');
	});

	test('is empty for an empty message', () => {
		expect(shortReason('')).toBe('');
	});
});

describe('newChatUrl', () => {
	test('opens the new chat in the project the handoff was saved in', () => {
		expect(newChatUrl('Pick up here.', '/Users/me/my repo/.claude/handoff/2026-11-12-1730-a.md')).toBe('claude://code/new?q=Pick%20up%20here.&folder=%2FUsers%2Fme%2Fmy%20repo');
	});

	test('leaves the folder out when the path is not a saved handoff', () => {
		expect(newChatUrl('Pick up here.', '')).toBe('claude://code/new?q=Pick%20up%20here.');
	});
});
