import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { TOOL_NAMES } from './tool-names';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { expandHomePath } from '../../infrastructure/utils/path-security';
import { SystemConfigStore } from '../../infrastructure/database/system-config-store';
import {
  isBrowserActCoreGuideCommand,
  requiresBrowserActConfirmation,
  truncateOutput,
  validateBrowserActArgs,
} from './browser-act-command';
import {
  type FeishuConfirmationExecutionBinding,
  type FeishuConfirmationStore,
  globalFeishuConfirmationStore,
} from '../connectors/feishu/confirmation-card';
import type { FeishuConfirmationAuditStore } from '../connectors/feishu/confirmation-audit-store';

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 900;
const NON_GUIDE_OUTPUT_LIMIT = 20_000;
const DEFAULT_BROWSER_ACT_ARTIFACT_DIR = join(homedir(), '.deepbot', 'generated-images');
const SUPPORTED_BROWSER_ACT_ARTIFACT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const EXECUTION_RESULT_PREVIEW_LIMIT = 4_000;

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
  confirmationPlanId: Type.Optional(Type.String({
    description: '飞书确认卡片返回的确认编号。保存、提交、发布、删除、改价、改电话等写入动作必须传入已确认的 planId。',
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

interface BrowserActArtifactImportResult {
  result: BrowserActRunResult;
  paths: string[];
  warnings: string[];
}

interface BrowserActArtifactImportOutcome {
  replacement: string;
  importedPath?: string;
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

function resolveBrowserActScreenshotDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'browseract', 'screenshots');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'browseract', 'screenshots');
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'browseract', 'screenshots');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPathInsideDir(filePath: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(filePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function resolveBrowserActArtifactImageDir(options: ToolCreateOptions): string {
  try {
    const configStore = options.configStore || SystemConfigStore.getInstance();
    const imageDir = configStore.getWorkspaceSettings()?.imageDir;
    if (typeof imageDir === 'string' && imageDir.trim()) {
      return resolve(expandHomePath(imageDir.trim()));
    }
  } catch {
    // Fall back to the default image directory if settings are unavailable during tests or startup.
  }
  return DEFAULT_BROWSER_ACT_ARTIFACT_DIR;
}

function createBrowserActScreenshotPathRegex(): RegExp {
  const screenshotDir = resolveBrowserActScreenshotDir();
  const variants = new Set([
    screenshotDir,
    screenshotDir.replace(/\\/g, '/'),
  ]);
  const prefixPattern = Array.from(variants).map(escapeRegex).join('|');
  return new RegExp(`(?:${prefixPattern})[/\\\\][^\\r\\n"'<>)]*?\\.(?:png|jpe?g|webp)`, 'gi');
}

function importBrowserActScreenshotArtifact(
  rawPath: string,
  imageDir: string,
  copiedPaths: Map<string, string>,
  warnings: string[],
): BrowserActArtifactImportOutcome | null {
  const sourcePath = resolve(rawPath);
  const screenshotDir = resolveBrowserActScreenshotDir();

  if (!isPathInsideDir(sourcePath, screenshotDir)) {
    return null;
  }

  const extension = extname(sourcePath).toLowerCase();
  if (!SUPPORTED_BROWSER_ACT_ARTIFACT_EXTENSIONS.has(extension)) {
    return null;
  }

  const cachedPath = copiedPaths.get(sourcePath);
  if (cachedPath) {
    return {
      replacement: cachedPath.replace(/\\/g, '/'),
      importedPath: cachedPath,
    };
  }

  try {
    const sourceStats = lstatSync(sourcePath);
    if (!sourceStats.isFile()) {
      warnings.push(`Skipped BrowserAct artifact ${basename(sourcePath)} because it is not a regular file.`);
      return { replacement: `[BrowserAct artifact unavailable: ${basename(sourcePath)}]` };
    }

    mkdirSync(imageDir, { recursive: true });
    const destinationPath = resolve(imageDir, `browseract-${basename(sourcePath)}`);
    if (!isPathInsideDir(destinationPath, imageDir)) {
      warnings.push(`Skipped BrowserAct artifact ${basename(sourcePath)} because the destination path is invalid.`);
      return { replacement: `[BrowserAct artifact unavailable: ${basename(sourcePath)}]` };
    }

    copyFileSync(sourcePath, destinationPath);
    copiedPaths.set(sourcePath, destinationPath);
    return {
      replacement: destinationPath.replace(/\\/g, '/'),
      importedPath: destinationPath,
    };
  } catch (error) {
    warnings.push(`Failed to import BrowserAct artifact ${basename(sourcePath)}: ${getErrorMessage(error)}`);
    return { replacement: `[BrowserAct artifact unavailable: ${basename(sourcePath)}]` };
  }
}

function importBrowserActArtifacts(
  result: BrowserActRunResult,
  imageDir: string,
): BrowserActArtifactImportResult {
  const copiedPaths = new Map<string, string>();
  const paths: string[] = [];
  const warnings: string[] = [];

  const rewriteText = (text: string): string => (
    text.replace(createBrowserActScreenshotPathRegex(), (rawPath) => {
      const outcome = importBrowserActScreenshotArtifact(rawPath, imageDir, copiedPaths, warnings);
      if (!outcome) {
        return rawPath;
      }
      if (outcome.importedPath && !paths.includes(outcome.importedPath)) {
        paths.push(outcome.importedPath);
      }
      return outcome.replacement;
    })
  );

  return {
    result: {
      ...result,
      stdout: rewriteText(result.stdout),
      stderr: rewriteText(result.stderr),
    },
    paths,
    warnings,
  };
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

function createBrowserActExecutionBinding(args: string[]): FeishuConfirmationExecutionBinding {
  return {
    toolName: TOOL_NAMES.BROWSER_ACT,
    signature: createHash('sha256')
      .update(JSON.stringify({ toolName: TOOL_NAMES.BROWSER_ACT, args }))
      .digest('hex'),
    summary: args.join(' '),
  };
}

function executionBindingMatches(
  actual: FeishuConfirmationExecutionBinding | undefined,
  expected: FeishuConfirmationExecutionBinding,
): boolean {
  return actual?.toolName === expected.toolName && actual.signature === expected.signature;
}

function getDefaultFeishuConfirmationAuditStore(): FeishuConfirmationAuditStore | undefined {
  try {
    const { SystemConfigStore } = require('../../infrastructure/database/system-config-store');
    const { FeishuConfirmationAuditStore } = require('../connectors/feishu/confirmation-audit-store');
    const store = new FeishuConfirmationAuditStore(SystemConfigStore.getInstance().getDb());
    store.ensureSchema();
    return store;
  } catch {
    return undefined;
  }
}

function previewExecutionOutput(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return truncateOutput(value, EXECUTION_RESULT_PREVIEW_LIMIT);
}

function validateBrowserActConfirmation(
  confirmationStore: FeishuConfirmationStore,
  args: string[],
  confirmationPlanId?: string,
) {
  const confirmationRequired = requiresBrowserActConfirmation(args);
  const requiredConfirmationBinding = confirmationRequired ? createBrowserActExecutionBinding(args) : undefined;
  if (!confirmationRequired) {
    return {
      confirmationRequired: false,
      confirmationStatus: undefined,
      requiredConfirmationBinding,
    };
  }

  if (!confirmationPlanId) {
    return {
      confirmationRequired: true,
      confirmationStatus: undefined,
      requiredConfirmationBinding,
      error: '该 BrowserAct 命令看起来会产生线上写入或副作用。请先调用 feishu_confirmation 发送飞书确认卡片，把本结果 details.requiredConfirmationBinding 原样作为 execution_binding 传入；用户确认后，把 confirmationPlanId 传给 browser_act 再执行。',
    };
  }

  const plan = confirmationStore.get(confirmationPlanId);
  if (!plan) {
    return {
      confirmationRequired: true,
      confirmationStatus: undefined,
      requiredConfirmationBinding,
      error: `未找到飞书确认计划：${confirmationPlanId}。请重新发送 feishu_confirmation 确认卡片。`,
    };
  }

  if (plan.status !== 'approved') {
    const statusText = plan.status === 'pending'
      ? '尚未确认，仍在等待确认'
      : plan.status === 'rejected'
        ? '已取消/拒绝'
        : plan.status;
    return {
      confirmationRequired: true,
      confirmationStatus: plan.status,
      requiredConfirmationBinding,
      error: `飞书确认计划 ${confirmationPlanId} ${statusText}，不能执行该 BrowserAct 写入动作。`,
    };
  }

  if (!executionBindingMatches(plan.executionBinding, requiredConfirmationBinding!)) {
    return {
      confirmationRequired: true,
      confirmationStatus: plan.status,
      requiredConfirmationBinding,
      confirmationBindingMatched: false,
      planExecutionBinding: plan.executionBinding,
      error: `飞书确认计划 ${confirmationPlanId} 的 executionBinding 与当前 BrowserAct 写入命令不匹配，请重新确认后再执行。`,
    };
  }

  return {
    confirmationRequired: true,
    confirmationStatus: plan.status,
    requiredConfirmationBinding,
    confirmationBindingMatched: true,
  };
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
    const confirmationStore: FeishuConfirmationStore =
      options.dependencies?.confirmationStore || globalFeishuConfirmationStore;
    const confirmationAuditStore: FeishuConfirmationAuditStore | undefined =
      options.dependencies?.confirmationAuditStore || getDefaultFeishuConfirmationAuditStore();

    return {
      name: TOOL_NAMES.BROWSER_ACT,
      label: 'BrowserAct 执行',
      description: `通过 BrowserAct CLI 执行浏览器自动化命令。

使用规则：
1. 每个 DeepBot 会话第一次调用必须是 args: ["get-skills", "core", "--skill-version", "2.0.2"]。
2. args 只传 BrowserAct 参数，不要包含 browser-act 二进制名称。
3. 生产任务只允许一个执行器控制一个账号浏览器；不要和内置 browser 工具混用同一个账号会话。
4. 涉及保存、提交、发布、删除、上下架、改价、改电话、应用模板等副作用动作前，必须先调用 feishu_confirmation 发送确认卡片，并把本工具返回的 details.requiredConfirmationBinding 原样作为 feishu_confirmation.execution_binding；用户确认后，把 confirmationPlanId 传给本工具。
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

          const confirmation = validateBrowserActConfirmation(confirmationStore, args, params?.confirmationPlanId);
          if (confirmation.error) {
            return {
              content: [
                {
                  type: 'text',
                  text: confirmation.error,
                },
              ],
              details: {
                success: false,
                command: args,
                confirmationRequired: confirmation.confirmationRequired,
                confirmationStatus: confirmation.confirmationStatus,
                requiredConfirmationBinding: confirmation.requiredConfirmationBinding,
                confirmationBindingMatched: confirmation.confirmationBindingMatched,
                planExecutionBinding: confirmation.planExecutionBinding,
              },
              isError: true,
            };
          }

          const timeoutSeconds = clampTimeoutSeconds(params?.timeoutSeconds);
          const result = await runBrowserAct(binary, args, options, timeoutSeconds, signal);
          const artifactImport = importBrowserActArtifacts(
            result,
            resolveBrowserActArtifactImageDir(options),
          );
          const success = result.exitCode === 0 && !result.timedOut && !result.aborted && !result.error;

          if (guideCommand && success) {
            coreGuideLoaded = true;
          }

          if (params?.confirmationPlanId && confirmation.confirmationRequired && confirmation.confirmationBindingMatched) {
            confirmationAuditStore?.recordExecutionResult(params.confirmationPlanId, {
              status: success ? 'completed' : 'failed',
              toolName: TOOL_NAMES.BROWSER_ACT,
              exitCode: result.exitCode,
              error: result.error,
              artifacts: artifactImport.paths,
              stdoutPreview: previewExecutionOutput(artifactImport.result.stdout),
              stderrPreview: previewExecutionOutput(artifactImport.result.stderr),
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: formatBrowserActResult(binary, args, artifactImport.result, guideCommand),
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
              confirmationRequired: confirmation.confirmationRequired,
              confirmationStatus: confirmation.confirmationStatus,
              confirmationPlanId: params?.confirmationPlanId,
              executionBinding: confirmation.requiredConfirmationBinding,
              confirmationBindingMatched: confirmation.confirmationBindingMatched,
              browserActArtifacts: artifactImport.paths,
              browserActArtifactWarnings: artifactImport.warnings,
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
