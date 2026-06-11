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
  if (!hasContent(memoryContent)) {
    return [];
  }

  const lines = [
    '## 核心记忆',
    '',
    '**重要提示**：以下是旧版 Tab/Markdown 记忆。核心记忆主要用于个人偏好、交互习惯和错误总结：',
    '- 使用用户的称呼和你的名字',
    '- 遵循用户的运营习惯和工作偏好',
    '- 避免重复之前的错误',
  ];

  if (options.hasAdminMemoryContext) {
    lines.push(
      '- 如果核心记忆与运营记忆控制平面冲突，以运营记忆控制平面为准',
      '- 不要把核心记忆里的门店关系、员工权限、业务事实或浏览器登录态当作权威来源'
    );
  } else {
    lines.push(
      '- 记住门店信息、菜品数据、供应商信息等业务知识',
      '- 体现你对用户门店和运营情况的了解'
    );
  }

  lines.push('', memoryContent.trim(), '');
  return lines;
}

export function buildAdminMemorySection(adminMemoryContext: string | undefined): string[] {
  if (!hasContent(adminMemoryContext)) {
    return [];
  }

  return [
    '## 运营记忆控制平面',
    '',
    '**范围约束**：以下内容来自管理员维护的结构化门店、群聊、员工、记忆和浏览器登录态引用。只在当前会话和绑定门店范围内使用：',
    '**优先级**：业务事实、门店关系、员工权限和浏览器登录态引用以本节为准；如果旧核心记忆与本节冲突，以本节为准。',
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
    '当前处于 Fast 模式：已跳过详细工具指引和 Agent 指令，仅保留核心记忆、运营记忆控制平面和工作提示词。工具仍然可用。',
    '',
    ...buildCoreMemorySection(input.memoryContent, { hasAdminMemoryContext }),
    ...buildAdminMemorySection(input.adminMemoryContext),
  ];

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
