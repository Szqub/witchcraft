import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { AGENT_TABS, selectAgentCommands } from '../src/agents.js';
import { parseArgs } from '../bin/witchcraft.js';
import { resolveT3Cli, createT3Conversation, parseT3BridgeArgs } from '../src/t3code-cli.js';
import { createPasteAssembler, main as t3BridgeMain } from '../bin/t3code-session.js';
import { withWoWMcp } from '../src/mcp-launch.js';

test('Hermes and T3 Code are opt-in and never start in the default daemon', () => {
  assert.deepEqual(AGENT_TABS, ['claude', 'codex', 'copilot', 'hermes', 't3code']);
  assert.equal(selectAgentCommands().commands.hermes, undefined);
  assert.equal(selectAgentCommands().commands.t3code, undefined);
  const { options } = parseArgs(['run', '--with-hermes', '--with-t3code']);
  const chosen = selectAgentCommands({}, options);
  assert.deepEqual(chosen.commands.hermes, { file: 'hermes', args: ['--tui'] });
  assert.equal(chosen.commands.t3code.file, process.execPath);
  assert.ok(chosen.commands.t3code.args[0].endsWith('t3code-session.js'));
  assert.equal(selectAgentCommands({}, { only: 'hermes' }).commands.codex, null);
  assert.equal(selectAgentCommands({}, { only: 't3code' }).commands.claude, null);
  assert.equal(selectAgentCommands({}, { only: 't3code' }).commands.hermes, null);
  assert.equal(selectAgentCommands({ commands: { hermes: { file: 'custom-hermes', args: [] } } }, { withHermes: true }).commands.hermes.file, 'custom-hermes');
  assert.deepEqual(withWoWMcp('hermes', chosen.commands.hermes, { cachePath: '/cache' }), chosen.commands.hermes);
  assert.deepEqual(withWoWMcp('t3code', chosen.commands.t3code, { cachePath: '/cache' }), chosen.commands.t3code);
});

test('T3 Code CLI package resolution prevents shell invocation and bin traversal', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'witchcraft-t3-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'node_modules', 't3code-cli');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'bin.js'), '');
  const manifest = bin => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't3code-cli', bin }));
  manifest({ t3cli: 'dist/bin.js' });
  assert.deepEqual(resolveT3Cli({ folders: [folder], platform: 'win32', nodePath: 'node.exe', entry: undefined }), {
    file: 'node.exe', args: [path.join(root, 'dist', 'bin.js')],
  });
  manifest({ t3cli: '../outside.js' });
  assert.throws(() => resolveT3Cli({ folders: [folder], platform: 'win32', entry: undefined }), /Cannot find/u);
  assert.deepEqual(resolveT3Cli({ platform: 'linux', entry: undefined }), { file: 't3cli', args: [] });
  assert.deepEqual(parseT3BridgeArgs(['--thread', 'some-uuid'], {}), { threadId: 'some-uuid' });
  assert.throws(() => parseT3BridgeArgs(['--thread', 'x;rm'], {}), /Invalid/u);
});

test('T3 Code conversation is tied to an explicitly selected thread', async () => {
  const calls = [], messages = [];
  const session = createT3Conversation({ call: async (...args) => { calls.push(args); return 'Response from T3'; },
    output: { write: text => messages.push(text) } });
  await session.handle('Do not create a thread');
  assert.deepEqual(calls, []);
  await session.handle('/threads');
  assert.deepEqual(calls, [['list', []]]);
  await session.handle('/thread 1234-abcd');
  assert.equal(session.threadId, '1234-abcd');
  await session.handle('Explain my quest');
  assert.deepEqual(calls[1], ['ask', ['Explain my quest', '--thread', '1234-abcd']]);
  assert.ok(messages.some(item => item.includes('Response from T3')));
  await session.handle('/status');
  assert.deepEqual(calls[2], ['show', ['--thread', '1234-abcd']]);
  assert.equal(await session.handle('/exit'), 'exit');
});

test('T3 Code bridge preserves multiline bracketed-paste prompts', () => {
  const assemble = createPasteAssembler();
  assert.equal(assemble('one line'), 'one line');
  assert.equal(assemble('\x1b[200~first line'), null);
  assert.equal(assemble('second line\x1b[201~'), 'first line\nsecond line');
  assert.equal(assemble('\x1b[200~inline\x1b[201~'), 'inline');
});

test('T3 Code terminal bridge forwards prompts to the chosen thread without starting new ones', async () => {
  const input = new PassThrough(), chunks = [], calls = [];
  const output = { write: chunk => { chunks.push(chunk); } };
  const run = async (launch, command, args) => {
    calls.push({ launch, command, args });
    return command === 'ask' ? 'Approved response' : 'Thread list';
  };
  const complete = t3BridgeMain([], { launch: { file: 't3cli', args: [] }, input, output, run });
  input.end('/threads\n/thread 1234-abcd\nReview this pull request\n/exit\n');
  await complete;
  assert.deepEqual(calls.map(call => [call.command, call.args]), [
    ['list', []], ['ask', ['Review this pull request', '--thread', '1234-abcd']],
  ]);
  assert.match(chunks.join(''), /Approved response/u);
});
