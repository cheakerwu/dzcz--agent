export class BrowserActCommandBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserActCommandBlocked';
  }
}

export type BrowserActCommandRisk = 'read_only' | 'write';

const BLOCKED_INFRASTRUCTURE_COMMANDS: Array<[string, string]> = [
  ['browser', 'delete'],
  ['proxy', 'buy-request'],
  ['auth', 'clear'],
  ['cookies', 'clear'],
];

const DIRECT_WRITE_COMMANDS = new Set([
  'upload',
  'submit',
]);

const WRITE_ACTION_COMMANDS = new Set([
  'click',
  'fill',
  'type',
  'select',
  'press',
  'drag',
]);

const WRITE_KEYWORDS = [
  'save',
  'submit',
  'publish',
  'delete',
  'remove',
  'update',
  'modify',
  'confirm',
  'apply',
  'enable',
  'disable',
  '保存',
  '提交',
  '发布',
  '删除',
  '移除',
  '更新',
  '修改',
  '确认',
  '应用',
  '启用',
  '停用',
  '上架',
  '下架',
  '改价',
  '调价',
  '价格',
  '改电话',
  '电话',
  '营业时间',
  '活动',
  '模板',
];

export function isBrowserActCoreGuideCommand(args: string[]): boolean {
  return args[0] === 'get-skills' && args[1] === 'core';
}

function normalizedTokens(args: string[]): string[] {
  return args.map((arg) => arg.trim().toLowerCase()).filter(Boolean);
}

export function classifyBrowserActCommandRisk(args: string[]): BrowserActCommandRisk {
  if (!Array.isArray(args) || isBrowserActCoreGuideCommand(args)) {
    return 'read_only';
  }

  const tokens = normalizedTokens(args);
  if (tokens.some((token) => DIRECT_WRITE_COMMANDS.has(token))) {
    return 'write';
  }

  const joined = tokens.join(' ');
  const hasWriteKeyword = WRITE_KEYWORDS.some((keyword) => joined.includes(keyword.toLowerCase()));
  if (!hasWriteKeyword) {
    return 'read_only';
  }

  if (tokens.some((token) => WRITE_ACTION_COMMANDS.has(token))) {
    return 'write';
  }

  return 'read_only';
}

export function requiresBrowserActConfirmation(args: string[]): boolean {
  return classifyBrowserActCommandRisk(args) === 'write';
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
