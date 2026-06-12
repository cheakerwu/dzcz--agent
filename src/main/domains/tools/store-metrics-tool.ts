import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolCreateOptions, ToolPlugin } from './registry/tool-interface';
import { AnalyticsDatabase } from '../analytics/analytics-database';
import { MetricService } from '../analytics/metric-service';
import { getErrorMessage } from '../../../shared/utils/error-handler';

function analyticsPath(): string {
  const dir = join(homedir(), '.deepbot');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'store-ops.duckdb');
}

function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

export const storeMetricsToolPlugin: ToolPlugin = {
  metadata: {
    id: 'store-metrics',
    name: '门店经营指标',
    description: '查询门店经营数据指标，供 LLM 工具编排使用。',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['store', 'metrics', 'rpa', 'report'],
  },

  create(_options: ToolCreateOptions): AgentTool[] {
    const tool: AgentTool = {
      name: 'store_metrics',
      label: '门店经营指标',
      description: 'LLM 在回答营业额、订单数、客单价、商品排行、评价摘要等事实性经营数据时必须使用本工具；不要从记忆或聊天历史中编造数字。',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('daily_summary'),
          Type.Literal('product_ranking'),
          Type.Literal('review_summary'),
          Type.Literal('compare_periods'),
        ]),
        store_ids: Type.Array(Type.String(), { description: '系统内部门店 ID 列表' }),
        start_date: Type.String({ description: '开始日期 YYYY-MM-DD' }),
        end_date: Type.String({ description: '结束日期 YYYY-MM-DD' }),
        platform: Type.Optional(Type.String({ description: '平台，如 meituan/eleme/unknown' })),
        limit: Type.Optional(Type.Number({ description: '排行数量，默认 10' })),
        previous_start_date: Type.Optional(Type.String({ description: '对比期开始日期 YYYY-MM-DD' })),
        previous_end_date: Type.Optional(Type.String({ description: '对比期结束日期 YYYY-MM-DD' })),
      }),
      execute: async (_toolCallId: string, args: any) => {
        const analytics = await AnalyticsDatabase.open(analyticsPath());
        try {
          await analytics.ensureSchema();
          const service = new MetricService(analytics);
          const query = {
            storeIds: args.store_ids,
            startDate: args.start_date,
            endDate: args.end_date,
            platform: args.platform,
          };

          let data: unknown;
          if (args.action === 'daily_summary') {
            data = await service.getDailySummary(query);
          } else if (args.action === 'product_ranking') {
            data = await service.getProductRanking({ ...query, limit: args.limit });
          } else if (args.action === 'review_summary') {
            data = await service.getReviewSummary(query);
          } else if (args.action === 'compare_periods') {
            if (!args.previous_start_date || !args.previous_end_date) {
              throw new Error('previous_start_date and previous_end_date are required for compare_periods');
            }
            data = await service.comparePeriods({
              current: query,
              previous: {
                storeIds: args.store_ids,
                startDate: args.previous_start_date,
                endDate: args.previous_end_date,
                platform: args.platform,
              },
            });
          } else {
            throw new Error(`Unsupported action: ${args.action}`);
          }

          return {
            content: [{ type: 'text' as const, text: '✅ 门店指标查询完成' }],
            details: { success: true, action: args.action, data },
          };
        } catch (error) {
          return errResult('门店指标查询失败', error);
        } finally {
          await analytics.close();
        }
      },
    };

    return [tool];
  },
};
