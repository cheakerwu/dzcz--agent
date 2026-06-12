export type FeishuTaskProgressStatus =
  | 'queued'
  | 'running'
  | 'waiting_confirmation'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface FeishuExecutionStepLike {
  status?: string;
  toolLabel?: string;
  toolName?: string;
}

export interface FeishuTaskProgressSummary {
  statusText: string;
  completedStepCount: number;
  runningStepNames: string[];
  recentStepNames: string[];
}

export interface FeishuTaskProgressCardInput {
  taskTitle: string;
  status: FeishuTaskProgressStatus;
  statusText?: string;
  elapsedMs?: number;
  completedStepCount?: number;
  runningStepNames?: string[];
  recentStepNames?: string[];
  tabId?: string;
}

const STATUS_META: Record<FeishuTaskProgressStatus, { title: string; template: string }> = {
  queued: { title: '任务已接收', template: 'wathet' },
  running: { title: '任务执行中', template: 'blue' },
  waiting_confirmation: { title: '等待确认', template: 'orange' },
  completed: { title: '任务完成', template: 'green' },
  failed: { title: '任务失败', template: 'red' },
  stopped: { title: '任务已停止', template: 'grey' },
};

function stepName(step: FeishuExecutionStepLike): string {
  return step.toolLabel || step.toolName || '未知步骤';
}

export function formatFeishuElapsedTime(ms = 0): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} 秒`;
  }

  if (seconds === 0) {
    return `${minutes} 分钟`;
  }

  return `${minutes} 分 ${seconds} 秒`;
}

export function sanitizeFeishuTaskTitle(title: string, maxLength = 80): string {
  const compact = String(title || '')
    .replace(/^@\S+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) {
    return '飞书任务';
  }

  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

export function summarizeFeishuTaskProgress(input: {
  streamingContent?: string;
  steps?: FeishuExecutionStepLike[];
}): FeishuTaskProgressSummary {
  const steps = input.steps || [];
  const completedSteps = steps.filter((step) => step.status === 'success' || step.status === 'error');
  const runningSteps = steps.filter((step) => step.status === 'running');
  const runningStepNames = runningSteps.map(stepName);
  const recentStepNames = completedSteps.slice(-3).map(stepName);

  let statusText = '';
  if (runningStepNames.length > 0) {
    statusText = `正在执行：${runningStepNames.join('、')}`;
  } else if (input.streamingContent?.trim()) {
    statusText = 'AI 正在整理输出内容';
  } else if (steps.length > 0) {
    statusText = '正在等待下一步执行';
  } else {
    statusText = '正在等待 AI 响应';
  }

  return {
    statusText,
    completedStepCount: completedSteps.length,
    runningStepNames,
    recentStepNames,
  };
}

function buildStepContent(input: FeishuTaskProgressCardInput): string {
  const lines: string[] = [];

  if (typeof input.completedStepCount === 'number') {
    lines.push(`已完成 ${input.completedStepCount} 个步骤`);
  }

  if (input.runningStepNames && input.runningStepNames.length > 0) {
    lines.push(`正在执行：${input.runningStepNames.join('、')}`);
  }

  if (input.recentStepNames && input.recentStepNames.length > 0) {
    lines.push(`最近完成：${input.recentStepNames.join('、')}`);
  }

  return lines.length > 0 ? lines.join('\n') : '正在准备任务上下文';
}

function buildActions(input: FeishuTaskProgressCardInput): any[] {
  if (input.status !== 'queued' && input.status !== 'running' && input.status !== 'waiting_confirmation') {
    return [];
  }

  const actionValues = {
    tab_id: input.tabId,
    task_title: sanitizeFeishuTaskTitle(input.taskTitle),
  };

  return [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '查看进度' },
      type: 'default',
      value: { ...actionValues, action: 'feishu_task_progress_status' },
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '停止任务' },
      type: 'danger',
      value: { ...actionValues, action: 'feishu_task_progress_stop' },
    },
  ];
}

export function buildFeishuTaskProgressCard(input: FeishuTaskProgressCardInput): Record<string, any> {
  const meta = STATUS_META[input.status];
  const taskTitle = sanitizeFeishuTaskTitle(input.taskTitle);
  const statusText = input.statusText || '正在处理';
  const elapsed = formatFeishuElapsedTime(input.elapsedMs || 0);
  const actions = buildActions(input);

  const elements: any[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**任务：** ${taskTitle}\n**状态：** ${statusText}\n**耗时：** ${elapsed}`,
      },
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: buildStepContent(input),
      },
    },
  ];

  if (actions.length > 0) {
    elements.push({
      tag: 'action',
      actions,
    });
  }

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: '状态会自动刷新。需要人工介入时，系统会继续在当前会话提示。',
      },
    ],
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: meta.title },
      template: meta.template,
    },
    elements,
  };
}
