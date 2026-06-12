export type FeishuConfirmationRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type FeishuConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type FeishuConfirmationExecutionStatus = 'completed' | 'failed';

export interface FeishuConfirmationExecutionBinding {
  toolName: string;
  signature: string;
  summary?: string;
}

export interface FeishuConfirmationPlanInput {
  planId: string;
  title: string;
  summary: string;
  riskLevel: FeishuConfirmationRiskLevel;
  requesterId?: string;
  requesterName?: string;
  conversationId?: string;
  messageId?: string;
  details?: Record<string, any>;
  executionBinding?: FeishuConfirmationExecutionBinding;
  createdAt?: number;
  expiresAt?: number;
}

export interface FeishuConfirmationPlan extends FeishuConfirmationPlanInput {
  status: FeishuConfirmationStatus;
  createdAt: number;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: number;
  rejectedById?: string;
  rejectedByName?: string;
  rejectedAt?: number;
  executionStatus?: FeishuConfirmationExecutionStatus;
  executionToolName?: string;
  executionExitCode?: number | null;
  executionError?: string;
  executionArtifacts?: string[];
  executionStdoutPreview?: string;
  executionStderrPreview?: string;
  executedAt?: number;
}

export interface FeishuConfirmationDecisionInput {
  operatorId: string;
  operatorName?: string;
  decidedAt?: number;
}

const RISK_META: Record<FeishuConfirmationRiskLevel, { label: string; template: string; warning: string }> = {
  low: {
    label: '低风险',
    template: 'blue',
    warning: '该操作风险较低，但仍需要确认后继续。',
  },
  medium: {
    label: '中风险',
    template: 'orange',
    warning: '该操作会影响运营配置，请确认信息无误。',
  },
  high: {
    label: '高风险',
    template: 'red',
    warning: '该操作可能影响线上门店信息或客户体验，请谨慎确认。',
  },
  critical: {
    label: '敏感操作',
    template: 'red',
    warning: '该操作影响范围较大，建议由管理员确认后再继续。',
  },
};

let planSeq = 0;
let defaultAuditStore: (FeishuConfirmationAuditSink & { ensureSchema: () => void }) | null | undefined;
let defaultAuditStoreWarningShown = false;

export function createConfirmationPlanId(prefix = 'confirm'): string {
  planSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${planSeq.toString(36)}`;
}

export function summarizeConfirmationDetails(details: Record<string, any> = {}): string {
  const entries = Object.entries(details);
  if (entries.length === 0) {
    return '无补充详情';
  }

  return entries
    .map(([key, value]) => {
      let formatted = value;
      if (typeof value === 'boolean') {
        formatted = value ? '是' : '否';
      } else if (value === null || value === undefined || value === '') {
        formatted = '未填写';
      } else if (typeof value === 'object') {
        formatted = JSON.stringify(value);
      }
      return `${key}：${formatted}`;
    })
    .join('\n');
}

export function buildFeishuConfirmationCard(input: FeishuConfirmationPlanInput): Record<string, any> {
  const risk = RISK_META[input.riskLevel] || RISK_META.medium;
  const requester = input.requesterName || input.requesterId || '未记录';
  const detailText = summarizeConfirmationDetails(input.details);

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: input.title || '操作确认' },
      template: risk.template,
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**风险等级：** ${risk.label}\n**发起人：** ${requester}\n**确认编号：** ${input.planId}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**操作摘要：**\n${input.summary}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**操作详情：**\n${detailText}`,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: risk.warning,
          },
        ],
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '确认执行' },
            type: 'primary',
            value: {
              action: 'feishu_confirmation_approve',
              plan_id: input.planId,
            },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '取消' },
            type: 'danger',
            value: {
              action: 'feishu_confirmation_reject',
              plan_id: input.planId,
            },
          },
        ],
      },
    ],
  };
}

function formatDecisionTime(timestamp?: number): string {
  if (!timestamp) {
    return '未记录';
  }
  return new Date(timestamp).toLocaleString('zh-CN');
}

export function buildFeishuConfirmationTerminalCard(input: FeishuConfirmationPlan): Record<string, any> {
  const detailText = summarizeConfirmationDetails(input.details);
  const requester = input.requesterName || input.requesterId || '未记录';
  const approved = input.status === 'approved';
  const rejected = input.status === 'rejected';
  const title = approved ? '操作已确认' : rejected ? '操作已取消' : '确认已结束';
  const template = approved ? 'green' : rejected ? 'grey' : 'orange';
  const operator = approved
    ? input.approvedByName || input.approvedById || '未记录'
    : input.rejectedByName || input.rejectedById || '未记录';
  const decidedAt = approved ? input.approvedAt : input.rejectedAt;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template,
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**原操作：** ${input.title}\n**确认编号：** ${input.planId}\n**发起人：** ${requester}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**处理人：** ${operator}\n**处理时间：** ${formatDecisionTime(decidedAt)}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**操作摘要：**\n${input.summary}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**操作详情：**\n${detailText}`,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: approved ? '该操作已获得确认，系统将继续执行。' : '该操作已被取消，不会继续执行。',
          },
        ],
      },
    ],
  };
}

export interface FeishuConfirmationStore {
  create(input: FeishuConfirmationPlanInput): FeishuConfirmationPlan;
  get(planId: string): FeishuConfirmationPlan | undefined;
  approve(planId: string, input: FeishuConfirmationDecisionInput): FeishuConfirmationPlan;
  reject(planId: string, input: FeishuConfirmationDecisionInput): FeishuConfirmationPlan;
  list(): FeishuConfirmationPlan[];
}

export interface FeishuConfirmationAuditSink {
  create(input: FeishuConfirmationPlanInput, status?: FeishuConfirmationStatus): FeishuConfirmationPlan;
  approve(plan: FeishuConfirmationPlan, input: FeishuConfirmationDecisionInput): FeishuConfirmationPlan;
  reject(plan: FeishuConfirmationPlan, input: FeishuConfirmationDecisionInput): FeishuConfirmationPlan;
}

function getDefaultFeishuConfirmationAuditStore(): FeishuConfirmationAuditSink | undefined {
  if (defaultAuditStore !== undefined) {
    return defaultAuditStore || undefined;
  }

  try {
    const { SystemConfigStore } = require('../../../infrastructure/database/system-config-store');
    const { FeishuConfirmationAuditStore } = require('./confirmation-audit-store');
    const auditStore = new FeishuConfirmationAuditStore(SystemConfigStore.getInstance().getDb());
    auditStore.ensureSchema();
    defaultAuditStore = auditStore;
  } catch (error) {
    defaultAuditStore = null;
    if (!defaultAuditStoreWarningShown) {
      defaultAuditStoreWarningShown = true;
      console.warn('[FeishuConfirmation] 审计存储初始化失败，将使用内存确认状态:', error);
    }
  }

  return defaultAuditStore || undefined;
}

export function createFeishuConfirmationStore(options: {
  auditStore?: FeishuConfirmationAuditSink;
} = {}): FeishuConfirmationStore {
  const plans = new Map<string, FeishuConfirmationPlan>();
  const auditStore = options.auditStore || getDefaultFeishuConfirmationAuditStore();

  function getExisting(planId: string): FeishuConfirmationPlan {
    const plan = plans.get(planId);
    if (!plan) {
      throw new Error(`确认计划不存在: ${planId}`);
    }
    return plan;
  }

  return {
    create(input) {
      if (plans.has(input.planId)) {
        throw new Error(`确认计划已存在: ${input.planId}`);
      }

      const now = input.createdAt || Date.now();
      const plan: FeishuConfirmationPlan = {
        ...input,
        status: 'pending',
        createdAt: now,
      };
      plans.set(plan.planId, plan);
      auditStore?.create(input, plan.status);
      return plan;
    },

    get(planId) {
      return plans.get(planId);
    },

    approve(planId, input) {
      const plan = getExisting(planId);
      if (plan.status !== 'pending') {
        return plan;
      }

      const updated: FeishuConfirmationPlan = {
        ...plan,
        status: 'approved',
        approvedById: input.operatorId,
        approvedByName: input.operatorName,
        approvedAt: input.decidedAt || Date.now(),
      };
      plans.set(planId, updated);
      auditStore?.approve(updated, input);
      return updated;
    },

    reject(planId, input) {
      const plan = getExisting(planId);
      if (plan.status !== 'pending') {
        return plan;
      }

      const updated: FeishuConfirmationPlan = {
        ...plan,
        status: 'rejected',
        rejectedById: input.operatorId,
        rejectedByName: input.operatorName,
        rejectedAt: input.decidedAt || Date.now(),
      };
      plans.set(planId, updated);
      auditStore?.reject(updated, input);
      return updated;
    },

    list() {
      return Array.from(plans.values());
    },
  };
}

export const globalFeishuConfirmationStore = createFeishuConfirmationStore();
