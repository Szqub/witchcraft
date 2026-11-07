import { fileURLToPath } from 'node:url';

// Append only: binding uses zero-based IDs, pixels use one-based IDs. Reordering
// existing entries would misroute input between older addons and daemons.
export const AGENT_TABS = Object.freeze(['claude', 'codex', 'copilot', 'hermes', 't3code']);
export const AGENT_TITLES = Object.freeze({
  claude: 'Claude', codex: 'Codex', copilot: 'Copilot', hermes: 'Hermes', t3code: 'T3 Code',
});

const t3Bridge = fileURLToPath(new URL('../bin/t3code-session.js', import.meta.url));

export function selectAgentCommands(config = {}, options = {}, child = []) {
  const initialTab = options.tab ?? options.only ?? 'claude';
  if (options.only && options.tab && options.only !== options.tab) throw new Error('--tab must match --only when one terminal is started');
  const commands = { claude: { file: 'claude', args: [] }, codex: { file: 'codex', args: [] }, ...config.commands };
  if ((options.withCopilot || options.only === 'copilot') && !commands.copilot) commands.copilot = { file: 'copilot', args: [] };
  if ((options.withHermes || options.only === 'hermes') && !commands.hermes) commands.hermes = { file: 'hermes', args: ['--tui'] };
  if ((options.withT3code || options.only === 't3code') && !commands.t3code) {
    commands.t3code = { file: process.execPath, args: [t3Bridge] };
  }
  if (options.only) for (const tab of AGENT_TABS) if (tab !== options.only) commands[tab] = null;
  if (child.length) commands[initialTab] = { file: child[0], args: child.slice(1) };
  if (options.tab && !commands[options.tab]) throw new Error(`--tab ${options.tab} names a terminal that is not started; use --only ${options.tab}, --with-${options.tab} or a configured commands.${options.tab} entry`);
  for (const entry of Object.values(commands)) {
    if (entry && (typeof entry.file !== 'string' || !Array.isArray(entry.args ?? []) || (entry.args ?? []).some(arg => typeof arg !== 'string'))) {
      throw new Error('Terminal commands require an executable file and an array of arguments');
    }
  }
  return { commands, initialTab };
}
