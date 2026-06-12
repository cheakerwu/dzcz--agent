export class BrowserActCommandBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserActCommandBlocked';
  }
}

const BLOCKED_INFRASTRUCTURE_COMMANDS: Array<[string, string]> = [
  ['browser', 'delete'],
  ['proxy', 'buy-request'],
  ['auth', 'clear'],
  ['cookies', 'clear'],
];

export function isBrowserActCoreGuideCommand(args: string[]): boolean {
  return args[0] === 'get-skills' && args[1] === 'core';
}

export function validateBrowserActArgs(args: string[]): void {
  if (!Array.isArray(args) || args.length === 0) {
    throw new BrowserActCommandBlocked('BrowserAct args must be a non-empty string array');
  }

  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0) {
      throw new BrowserActCommandBlocked('BrowserAct args must contain non-empty strings only');
    }
    if (arg.includes('\0')) {
      throw new BrowserActCommandBlocked('BrowserAct args must not contain null bytes');
    }
  }

  const first = args[0];
  if (first === 'browser-act' || first.endsWith('/browser-act')) {
    throw new BrowserActCommandBlocked('Pass BrowserAct arguments only; do not include the browser-act binary name');
  }

  for (const [command, subcommand] of BLOCKED_INFRASTRUCTURE_COMMANDS) {
    for (let index = 0; index < args.length - 1; index += 1) {
      if (args[index] === command && args[index + 1] === subcommand) {
        throw new BrowserActCommandBlocked(`blocked BrowserAct infrastructure command: ${command} ${subcommand}`);
      }
    }
  }
}

export function truncateOutput(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...<truncated ${value.length - maxChars} chars>`;
}
