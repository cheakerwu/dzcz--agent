import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { TOOL_NAMES } from './tool-names';
import { getErrorMessage } from '../../shared/utils/error-handler';
import {
  isBrowserActCoreGuideCommand,
  truncateOutput,
  validateBrowserActArgs,
} from './browser-act-command';

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 900;
const NON_GUIDE_OUTPUT_LIMIT = 20_000;

const BrowserActToolSchema = Type.Object({
  args: Type.Array(Type.String({
    description: 'BrowserAct CLI argument. Do not include the browser-act binary name.',
  }), {
    minItems: 1,
    description: 'BrowserAct CLI arguments excluding the browser-act binary. First call must be ["get-skills", "core", "--skill-version", "2.0.2"].',
  }),
  timeoutSeconds: Type.Optional(Type.Number({
    minimum: 1,
    maximum: MAX_TIMEOUT_SECONDS,
    description: `Command timeout in seconds. Default ${DEFAULT_TIMEOUT_SECONDS}, max ${MAX_TIMEOUT_SECONDS}.`,
  })),
});

interface BrowserActRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  error?: string;
}

function clampTimeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  return Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.floor(value)));
}

function resolveBrowserActBinary(): string {
  const configured = process.env.BROWSER_ACT_BIN?.trim();
  if (configured) {
    return configured;
  }

  const userLocalBinary = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'browser-act.cmd' : 'browser-act');
  if (existsSync(userLocalBinary)) {
    return userLocalBinary;
  }

  return 'browser-act';
}

function runBrowserAct(
  binary: string,
  args: string[],
  options: ToolCreateOptions,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<BrowserActRunResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: options.workspaceDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const finish = (result: Omit<BrowserActRunResult, 'stdout' | 'stderr' | 'timedOut' | 'aborted'>) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener('abort', onAbort);
      resolve({
        ...result,
        stdout,
        stderr,
        timedOut,
        aborted,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 1500).unref();
    }, timeoutSeconds * 1000);

    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finish({
        exitCode: null,
        error: getErrorMessage(error),
      });
    });

    child.on('close', (code) => {
      finish({
        exitCode: code,
      });
    });
  });
}

function formatBrowserActResult(
  binary: string,
  args: string[],
  result: BrowserActRunResult,
  guideCommand: boolean,
): string {
  const stdout = guideCommand ? result.stdout : truncateOutput(result.stdout, NON_GUIDE_OUTPUT_LIMIT);
  const stderr = guideCommand ? result.stderr : truncateOutput(result.stderr, NON_GUIDE_OUTPUT_LIMIT);
  const lines = [
    `Command: ${binary} ${args.join(' ')}`,
    `Exit code: ${result.exitCode ?? 'spawn_error'}`,
  ];

  if (result.timedOut) {
    lines.push('Timed out: true');
  }
  if (result.aborted) {
    lines.push('Aborted: true');
  }
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }
  if (stdout) {
    lines.push('', 'STDOUT:', stdout);
  }
  if (stderr) {
    lines.push('', 'STDERR:', stderr);
  }

  return lines.join('\n');
}

export const browserActToolPlugin: ToolPlugin = {
  metadata: {
    id: 'browser-act',
    name: 'BrowserAct',
    description: '通过 BrowserAct CLI 控制隔离浏览器，用于飞书入口下的商家后台自动化任务。',
    version: '0.1.0',
    author: 'Local Agent Contributors',
    category: 'system',
    tags: ['browser', 'automation', 'browser-act', 'feishu'],
    requiresConfig: false,
  },

  create: (options: ToolCreateOptions) => {
    const binary = resolveBrowserActBinary();
    let coreGuideLoaded = false;

    return {
      name: TOOL_NAMES.BROWSER_ACT,
      label: 'BrowserAct 执行',
      description: `通过 BrowserAct CLI 执行浏览器自动化命令。

使用规则：
1. 每个 DeepBot 会话第一次调用必须是 args: ["get-skills", "core", "--skill-version", "2.0.2"]。
2. args 只传 BrowserAct 参数，不要包含 browser-act 二进制名称。
3. 生产任务只允许一个执行器控制一个账号浏览器；不要和内置 browser 工具混用同一个账号会话。
4. 涉及保存、提交、发布、删除、上下架、改价、改电话、应用模板等副作用动作前，必须先向用户展示当前页面截图和计划动作并等待确认。
5. 工具会阻断 browser delete、proxy buy-request、auth clear、cookies clear 等基础设施破坏命令。

配置：可用 BROWSER_ACT_BIN 指定 BrowserAct 二进制路径；未配置时优先尝试 ~/.local/bin/browser-act，最后使用 PATH 中的 browser-act。`,
      parameters: BrowserActToolSchema,

      execute: async (_toolCallId: string, params: any, signal?: AbortSignal) => {
        const args = params?.args as string[];
        const guideCommand = Array.isArray(args) && isBrowserActCoreGuideCommand(args);

        try {
          validateBrowserActArgs(args);

          if (!guideCommand && !coreGuideLoaded) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'BrowserAct core guide is not loaded for this DeepBot session. First call this tool with args: ["get-skills", "core", "--skill-version", "2.0.2"].',
                },
              ],
              details: {
                success: false,
                guideRequired: true,
              },
              isError: true,
            };
          }

          const timeoutSeconds = clampTimeoutSeconds(params?.timeoutSeconds);
          const result = await runBrowserAct(binary, args, options, timeoutSeconds, signal);
          const success = result.exitCode === 0 && !result.timedOut && !result.aborted && !result.error;

          if (guideCommand && success) {
            coreGuideLoaded = true;
          }

          return {
            content: [
              {
                type: 'text',
                text: formatBrowserActResult(binary, args, result, guideCommand),
              },
            ],
            details: {
              success,
              guideLoaded: coreGuideLoaded,
              command: args,
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              aborted: result.aborted,
              error: result.error,
            },
            isError: !success,
          };
        } catch (error) {
          const message = getErrorMessage(error);
          return {
            content: [
              {
                type: 'text',
                text: `BrowserAct command rejected: ${message}`,
              },
            ],
            details: {
              success: false,
              command: args,
              error: message,
            },
            isError: true,
          };
        }
      },
    };
  },
};
