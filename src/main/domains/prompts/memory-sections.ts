interface CoreMemorySectionOptions {
  hasAdminMemoryContext?: boolean;
}

export interface FastModeSystemPromptInput {
  agentName: string;
  userName: string;
  memoryContent?: string;
  adminMemoryContext?: string;
}

function hasContent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildCoreMemorySection(
  memoryContent: string | undefined,
  options: CoreMemorySectionOptions = {}
): string[] {
  void memoryContent;
  void options;
  return [];
}

export function buildAdminMemorySection(adminMemoryContext: string | undefined): string[] {
  if (!hasContent(adminMemoryContext)) {
    return [];
  }

  return [
    '## 运营上下文',
    '',
    '**范围约束**：以下内容来自结构化企业、群聊、个人记忆，以及受控浏览器登录态能力引用。只在当前会话、发送者和绑定门店范围内使用。',
    '**优先级**：业务事实、门店关系、员工权限和浏览器登录态引用以本节为准；旧 Markdown 记忆不是运行时事实来源。',
    '',
    adminMemoryContext.trim(),
    '',
  ];
}

export function buildFastModeSystemPrompt(input: FastModeSystemPromptInput): string {
  const hasAdminMemoryContext = hasContent(input.adminMemoryContext);
  const lines = [
    '## 身份信息',
    '',
    `你的名字: ${input.agentName}`,
    `用户称呼: ${input.userName}`,
    '',
    '## 模式',
    '',
    '当前处于 Fast 模式：已跳过详细工具指引和 Agent 指令，仅保留结构化运营上下文和工作提示词。工具仍然可用。',
    '',
    ...buildCoreMemorySection(input.memoryContent, { hasAdminMemoryContext }),
    ...buildAdminMemorySection(input.adminMemoryContext),
  ];

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
