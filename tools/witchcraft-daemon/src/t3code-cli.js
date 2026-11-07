import fs from 'node:fs';
import path from 'node:path';

/**
 * npm-installed T3 Code CLI is a .cmd shim on Windows. We deliberately run its
 * JavaScript entrypoint with Node, never a shell with a game-originated prompt.
 */
export function resolveT3Cli({
  folders = (process.env.PATH ?? '').split(path.delimiter),
  nodePath = process.execPath, platform = process.platform,
  entry = process.env.T3CLI_ENTRY,
} = {}) {
  if (entry !== undefined) {
    if (!path.isAbsolute(entry) || !/\.m?js$/iu.test(entry) || !fs.statSync(entry, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('T3CLI_ENTRY must name an existing absolute .js or .mjs file');
    }
    return { file: nodePath, args: [entry] };
  }
  if (platform !== 'win32') return { file: 't3cli', args: [] };
  for (const folder of folders) {
    if (!path.isAbsolute(folder)) continue;
    const root = path.join(folder, 'node_modules', 't3code-cli');
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (manifest.name !== 't3code-cli' || typeof manifest.bin?.t3cli !== 'string') continue;
      const entrypoint = path.resolve(root, manifest.bin.t3cli);
      const relative = path.relative(root, entrypoint);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.m?js$/iu.test(entrypoint)) continue;
      if (fs.statSync(entrypoint).isFile()) return { file: nodePath, args: [entrypoint] };
    } catch { /* Not a global npm installation at this absolute PATH directory. */ }
  }
  throw new Error('Cannot find the t3cli npm entrypoint. Install: npm install -g t3code-cli, or set T3CLI_ENTRY.');
}

export function parseT3BridgeArgs(args, env = process.env) {
  let threadId = env.T3CODE_THREAD_ID ?? '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--thread' && args[i + 1]) threadId = args[++i];
    else throw new Error(`Unknown T3 Code bridge option: ${args[i]}`);
  }
  if (threadId && (!/^[A-Za-z0-9._:-]{1,128}$/u.test(threadId))) throw new Error('Invalid T3 Code thread ID');
  return { threadId };
}

/** An explicit thread avoids accidentally creating and archiving a new conversation per turn. */
export function createT3Conversation({ threadId = '', call, output }) {
  const write = message => output.write(`${message}\r\n`);
  return {
    get threadId() { return threadId; },
    async handle(value) {
      const message = value.trim();
      if (!message) return;
      if (message === '/help') {
        write('Commands: /threads, /thread ID, /status, /help, /exit. Other text sends a T3 Code turn.');
        return;
      }
      if (message === '/threads') {
        const result = await call('list', []);
        write(result || 'No threads returned by T3 Code.');
        return;
      }
      if (message.startsWith('/thread ')) {
        const chosen = message.slice(8).trim();
        if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(chosen)) throw new Error('Invalid T3 Code thread ID');
        threadId = chosen;
        write(`Active T3 Code thread: ${threadId}`);
        return;
      }
      if (message === '/status') {
        if (!threadId) { write('No thread selected. Use /threads, then /thread ID.'); return; }
        write((await call('show', ['--thread', threadId])) || 'No thread details available.');
        return;
      }
      if (message === '/exit') return 'exit';
      if (!threadId) {
        write('Choose an existing T3 Code thread first: /threads, then /thread ID.');
        return;
      }
      // t3cli ask waits for one response and prints assistant text. A specified
      // thread remains active and keeps its conversation context.
      const answer = await call('ask', [value, '--thread', threadId]);
      write(answer || '(T3 Code returned no assistant text)');
    },
  };
}
