import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractRemoteAssistUrl, parseBrowserActBrowserList, parseBrowserActProfileList } from './browser-act-parser';
import {
  getLoginVerifier,
  type BrowserActLoginVerificationResult,
} from './browser-act-login-verifiers';

export type RiskAccountClass = 'standard' | 'sensitive' | 'high_risk' | 'critical';

export interface BrowserActRunner {
  run(args: string[], timeoutSeconds?: number): Promise<string>;
}

export class SpawnBrowserActRunner implements BrowserActRunner {
  constructor(private readonly workspaceDir: string, private readonly binary = resolveBrowserActBinary()) {}

  run(args: string[], timeoutSeconds = 120): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        cwd: this.workspaceDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`browser-act timed out after ${timeoutSeconds}s: ${args.join(' ')}`));
      }, timeoutSeconds * 1000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`browser-act failed (${code}): ${stderr || stdout}`));
      });
    });
  }
}

function resolveBrowserActBinary(): string {
  const configured = process.env.BROWSER_ACT_BIN?.trim();
  if (configured) return configured;

  const local = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'browser-act.cmd' : 'browser-act');
  return existsSync(local) ? local : 'browser-act';
}

export function classifyRiskAccount(input: {
  platform: string;
  canChangePrice?: boolean;
  canPublishMenu?: boolean;
  canChangeStoreStatus?: boolean;
  canAccessSettlement?: boolean;
  canManageRefunds?: boolean;
  canChangeBankOrInvoice?: boolean;
  canDeleteAssets?: boolean;
  storeCount?: number;
}): RiskAccountClass {
  if (input.canChangeBankOrInvoice || input.canDeleteAssets) return 'critical';
  if (input.canChangePrice || input.canPublishMenu || input.canChangeStoreStatus || input.canManageRefunds) {
    return 'high_risk';
  }
  if (input.canAccessSettlement || (input.storeCount ?? 0) > 1) return 'sensitive';
  return 'standard';
}

export class BrowserActControlService {
  private readonly runner: BrowserActRunner;

  constructor(options: { workspaceDir: string; runner?: BrowserActRunner }) {
    this.runner = options.runner || new SpawnBrowserActRunner(options.workspaceDir);
  }

  async listBrowsers() {
    return parseBrowserActBrowserList(await this.runner.run(['browser', 'list']));
  }

  async listProfiles() {
    return parseBrowserActProfileList(await this.runner.run(['browser', 'list-profiles']));
  }

  async openBrowserForLogin(input: { sessionName: string; browserId: string; url: string }): Promise<void> {
    await this.runner.run(['--session', input.sessionName, 'browser', 'open', input.browserId, input.url], 180);
  }

  async createRemoteAssist(input: { sessionName: string; objective: string }): Promise<string> {
    const output = await this.runner.run(
      ['--session', input.sessionName, 'remote-assist', '--objective', input.objective],
      120,
    );
    return extractRemoteAssistUrl(output);
  }

  async verifyLogin(input: { sessionName: string; platform: string }): Promise<BrowserActLoginVerificationResult> {
    const verifier = getLoginVerifier(input.platform);
    if (!verifier) {
      return {
        healthy: false,
        evidence: [],
        reason: `暂不支持 ${input.platform} 的自动登录态校验`,
      };
    }

    const [url, title, text] = await Promise.all([
      this.runner.run(['--session', input.sessionName, 'eval', 'location.href'], 30),
      this.runner.run(['--session', input.sessionName, 'get', 'title'], 30),
      this.runner.run(['--session', input.sessionName, 'get', 'markdown'], 60),
    ]);

    return verifier({
      url: cleanBrowserActScalar(url),
      title: cleanBrowserActScalar(title),
      text: text.trim(),
    });
  }

  async closeSession(sessionName: string): Promise<void> {
    await this.runner.run(['session', 'close', sessionName], 60);
  }
}

function cleanBrowserActScalar(output: string): string {
  const trimmed = output.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
