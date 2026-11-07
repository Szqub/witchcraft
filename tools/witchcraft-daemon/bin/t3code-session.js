#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createT3Conversation, parseT3BridgeArgs, resolveT3Cli } from '../src/t3code-cli.js';

function runT3Cli(launch, subcommand, args) {
  return new Promise((resolve, reject) => {
    execFile(launch.file, [...launch.args, subcommand, ...args], {
      cwd: process.cwd(), windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 10 * 60 * 1000,
      encoding: 'utf8', shell: false,
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim().slice(0, 2000)));
      resolve(stdout.trim());
    });
  });
}

/** Collect bracketed-paste lines as one multi-line game prompt. */
export function createPasteAssembler() {
  let pending = null;
  return line => {
    if (pending === null) {
      if (!line.startsWith('\x1b[200~')) return line;
      pending = [];
      line = line.slice(6);
    }
    const end = line.indexOf('\x1b[201~');
    if (end < 0) {
      pending.push(line);
      if (pending.join('\n').length > 8192) pending = null;
      return null;
    }
    pending.push(line.slice(0, end));
    const combined = pending.join('\n');
    pending = null;
    return combined;
  };
}

export async function main(args = process.argv.slice(2), adapters = {}) {
  const launch = adapters.launch ?? resolveT3Cli();
  const options = parseT3BridgeArgs(args);
  const output = adapters.output ?? process.stdout, input = adapters.input ?? process.stdin;
  const channel = new PassThrough();
  // The in-game Interrupt key sends Ctrl+C. Ignore it here so a terminal
  // control character never tears down the T3 server-side agent thread.
  const forward = data => channel.write(Buffer.from(data).toString('utf8').replaceAll('\x03', ''));
  input.on('data', forward);
  const readline = createInterface({ input: channel, crlfDelay: Infinity, terminal: false });
  const conversation = createT3Conversation({ threadId: options.threadId, output,
    call: (command, argv) => (adapters.run ?? runT3Cli)(launch, command, argv) });
  const paste = createPasteAssembler();
  output.write('WITCHCRAFT / T3 CODE\r\n');
  output.write('Connected to t3cli. Use /threads and /thread ID to select a running conversation.\r\n');
  output.write('T3> ');
  try {
    for await (const line of readline) {
      const prompt = paste(line);
      if (prompt === null) continue;
      try {
        const action = await conversation.handle(prompt);
        if (action === 'exit') break;
      } catch (error) { output.write(`T3 Code error: ${error.message}\r\n`); }
      output.write('T3> ');
    }
  } finally {
    readline.close(); channel.end(); input.off('data', forward); input.pause();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
