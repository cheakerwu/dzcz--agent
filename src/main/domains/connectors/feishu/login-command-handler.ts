import type { FeishuIncomingMessage } from '../../../../types/connector';

export type LoginCommand =
  | { kind: 'start'; platform: string; storeName: string }
  | { kind: 'done'; requestCode: string }
  | { kind: 'cancel'; requestCode: string }
  | { kind: 'status'; requestCode: string };

export interface LoginRequestStartResult {
  requestCode: string;
  expiresAt: number;
  remoteAssistUrl: string;
}

export interface FeishuLoginCommandHandlerDeps {
  sendMessage(input: {
    conversationId: string;
    content: string;
    _receiveIdType?: 'chat_id' | 'open_id';
  }): Promise<void>;
  startLogin?(input: {
    platform: string;
    storeName: string;
    requesterUserId: string;
    requesterOpenId?: string;
    requesterName?: string;
    conversationId: string;
    conversationType: 'p2p' | 'group';
  }): Promise<LoginRequestStartResult>;
  completeLogin?(input: { requestCode: string; requesterUserId: string; requesterOpenId?: string }): Promise<string>;
  cancelLogin?(input: { requestCode: string; requesterUserId: string; requesterOpenId?: string }): Promise<string>;
  getLoginStatus?(input: { requestCode: string; requesterUserId: string; requesterOpenId?: string }): Promise<string>;
}

export function parseLoginCommand(text: string): LoginCommand | null {
  const trimmed = text.trim();
  const start = trimmed.match(/^\/login\s+(\S+)\s+(.+)$/);
  if (start) return { kind: 'start', platform: start[1], storeName: start[2].trim() };

  const done = trimmed.match(/^\/login-done\s+(\S+)$/);
  if (done) return { kind: 'done', requestCode: done[1] };

  const cancel = trimmed.match(/^\/login-cancel\s+(\S+)$/);
  if (cancel) return { kind: 'cancel', requestCode: cancel[1] };

  const status = trimmed.match(/^\/login-status\s+(\S+)$/);
  if (status) return { kind: 'status', requestCode: status[1] };

  return null;
}

export function formatLoginRequestPrivateMessage(input: {
  platform: string;
  storeName: string;
  expiresAt: number;
  remoteAssistUrl: string;
  requestCode?: string;
}): string {
  return [
    `你正在为 ${input.storeName} 绑定 ${input.platform} 登录态。`,
    '这个远程协助链接只发给你本人，请不要转发到群聊或其他人。',
    '登录请求 10 分钟后过期。',
    input.requestCode ? `登录码：${input.requestCode}` : undefined,
    `远程协助链接：${input.remoteAssistUrl}`,
    '完成登录后回复 /login-done <登录码>。',
  ].filter(Boolean).join('\n');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractOpenId(message: FeishuIncomingMessage): string | undefined {
  const openId = message.raw?.sender?.sender_id?.open_id;
  return typeof openId === 'string' && openId.length > 0 ? openId : undefined;
}

export class FeishuLoginCommandHandler {
  constructor(private readonly deps: FeishuLoginCommandHandlerDeps) {}

  async handle(command: LoginCommand, message: FeishuIncomingMessage): Promise<boolean> {
    const openId = extractOpenId(message);
    const privateTarget = openId || (message.conversation.type === 'p2p' ? message.conversation.id : message.sender.id);
    const receiveIdType: 'chat_id' | 'open_id' = openId ? 'open_id' : 'chat_id';

    if (command.kind === 'start') {
      if (!this.deps.startLogin) {
        await this.deps.sendMessage({
          conversationId: privateTarget,
          _receiveIdType: receiveIdType,
          content: '登录控制面尚未接入，请稍后再试。',
        });
        return true;
      }

      let login: LoginRequestStartResult;
      try {
        login = await this.deps.startLogin({
          platform: command.platform,
          storeName: command.storeName,
          requesterUserId: message.sender.id,
          requesterOpenId: openId,
          requesterName: message.sender.name,
          conversationId: message.conversation.id,
          conversationType: message.conversation.type,
        });
      } catch (error) {
        await this.deps.sendMessage({
          conversationId: privateTarget,
          _receiveIdType: receiveIdType,
          content: `登录请求创建失败：${formatError(error)}`,
        });
        return true;
      }
      await this.deps.sendMessage({
        conversationId: privateTarget,
        _receiveIdType: receiveIdType,
        content: formatLoginRequestPrivateMessage({
          platform: command.platform,
          storeName: command.storeName,
          expiresAt: login.expiresAt,
          remoteAssistUrl: login.remoteAssistUrl,
          requestCode: login.requestCode,
        }),
      });
      return true;
    }

    if (command.kind === 'done' && this.deps.completeLogin) {
      const content = await this.runSafely(() => this.deps.completeLogin!({
        requestCode: command.requestCode,
        requesterUserId: message.sender.id,
        requesterOpenId: openId,
      }));
      await this.deps.sendMessage({ conversationId: privateTarget, _receiveIdType: receiveIdType, content });
      return true;
    }

    if (command.kind === 'cancel' && this.deps.cancelLogin) {
      const content = await this.runSafely(() => this.deps.cancelLogin!({
        requestCode: command.requestCode,
        requesterUserId: message.sender.id,
        requesterOpenId: openId,
      }));
      await this.deps.sendMessage({ conversationId: privateTarget, _receiveIdType: receiveIdType, content });
      return true;
    }

    if (command.kind === 'status' && this.deps.getLoginStatus) {
      const content = await this.runSafely(() => this.deps.getLoginStatus!({
        requestCode: command.requestCode,
        requesterUserId: message.sender.id,
        requesterOpenId: openId,
      }));
      await this.deps.sendMessage({ conversationId: privateTarget, _receiveIdType: receiveIdType, content });
      return true;
    }

    await this.deps.sendMessage({
      conversationId: privateTarget,
      _receiveIdType: receiveIdType,
      content: `已收到登录请求指令：${command.kind} ${command.requestCode}`,
    });
    return true;
  }

  private async runSafely(action: () => Promise<string>): Promise<string> {
    try {
      return await action();
    } catch (error) {
      return `登录请求处理失败：${formatError(error)}`;
    }
  }
}
