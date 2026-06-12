/**
 * 门店批量导入工具
 *
 * 提供从 Excel 批量导入门店的功能
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { createLogger } from '../../shared/utils/logger';
import * as XLSX from 'xlsx';
import { SystemConfigStore } from '../database/system-config-store';

const logger = createLogger('StoreImportTool');

/** 统一错误返回 */
function errResult(msg: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `❌ ${msg}: ${getErrorMessage(error)}` }],
    details: { success: false, error: getErrorMessage(error) },
    isError: true,
  };
}

interface StoreImportRow {
  name: string;
  brand?: string;
  city?: string;
  area?: string;
  aliases?: string;
  notes?: string;
}

// ==================== 工具插件 ====================

export const storeImportToolPlugin: ToolPlugin = {
  metadata: {
    id: 'store-import',
    name: '门店批量导入',
    description: '从 Excel 批量导入门店数据',
    version: '1.0.0',
    author: '点之出众',
    category: 'custom',
    tags: ['store', 'import', 'excel'],
  },

  create(options: ToolCreateOptions) {
    // ========== 批量导入门店 ==========
    const importStoresTool: AgentTool = {
      name: 'store_import',
      label: '批量导入门店',
      description: '从 Excel 文件批量导入门店数据。Excel 文件应包含以下列：name（门店名称）、brand（品牌）、city（城市）、area（区域）、aliases（别名，多个用逗号分隔）、notes（备注）。',
      parameters: Type.Object({
        file_path: Type.String({
          description: 'Excel 文件路径',
        }),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { file_path } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          // 读取 Excel 文件
          const workbook = XLSX.readFile(file_path);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json<StoreImportRow>(worksheet);

          if (data.length === 0) {
            return errResult('Excel 文件为空', new Error('Excel 文件中没有数据'));
          }

          // 验证数据格式
          const requiredColumns = ['name'];
          const firstRow = data[0];
          for (const col of requiredColumns) {
            if (!(col in firstRow)) {
              return errResult('Excel 格式错误', new Error(`缺少必填列: ${col}`));
            }
          }

          // 批量导入
          const timestamp = Date.now();
          const results = {
            total: data.length,
            success: 0,
            failed: 0,
            errors: [] as string[],
          };

          const insertStmt = dbInstance.prepare(`
            INSERT INTO stores (id, name, brand, city, area, aliases, status, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
              const id = `store_${(timestamp + i).toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
              const aliases = row.aliases ? row.aliases.split(',').map(a => a.trim()).filter(a => a) : [];

              insertStmt.run(
                id,
                row.name.trim(),
                row.brand || null,
                row.city || null,
                row.area || null,
                JSON.stringify(aliases),
                'operating',
                row.notes || null,
                timestamp + i,
                timestamp + i
              );

              results.success++;
            } catch (error) {
              results.failed++;
              results.errors.push(`第 ${i + 2} 行: ${getErrorMessage(error)}`);
            }
          }

          logger.info(`批量导入完成: 成功 ${results.success}, 失败 ${results.failed}`);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 批量导入完成\n总数: ${results.total}\n成功: ${results.success}\n失败: ${results.failed}${results.errors.length > 0 ? '\n\n错误详情:\n' + results.errors.join('\n') : ''}`,
            }],
            details: {
              success: true,
              results,
            },
          };
        } catch (error) {
          logger.error('批量导入门店失败:', error);
          return errResult('批量导入门店失败', error);
        }
      },
    };

    // ========== 导出门店数据 ==========
    const exportStoresTool: AgentTool = {
      name: 'store_export',
      label: '导出门店数据',
      description: '导出所有门店数据到 Excel 文件。',
      parameters: Type.Object({
        output_path: Type.Optional(Type.String({
          description: '输出文件路径（可选，默认为 stores_export.xlsx）',
        })),
      }),

      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        const { output_path } = args;

        try {
          const configStore = SystemConfigStore.getInstance();
          const dbInstance = configStore.getDb();

          // 查询所有门店
          const rows = dbInstance.prepare(`
            SELECT * FROM stores WHERE status = 'operating' ORDER BY name
          `).all() as any[];

          // 转换为 Excel 格式
          const data = rows.map(row => ({
            name: row.name,
            brand: row.brand || '',
            city: row.city || '',
            area: row.area || '',
            aliases: JSON.parse(row.aliases || '[]').join(', '),
            notes: row.notes || '',
            created_at: new Date(row.created_at).toLocaleString('zh-CN'),
          }));

          // 创建工作簿
          const workbook = XLSX.utils.book_new();
          const worksheet = XLSX.utils.json_to_sheet(data);

          // 设置列宽
          worksheet['!cols'] = [
            { wch: 30 }, // name
            { wch: 15 }, // brand
            { wch: 10 }, // city
            { wch: 10 }, // area
            { wch: 30 }, // aliases
            { wch: 30 }, // notes
            { wch: 20 }, // created_at
          ];

          XLSX.utils.book_append_sheet(workbook, worksheet, '门店数据');

          // 保存文件
          const outputPath = output_path || 'stores_export.xlsx';
          XLSX.writeFile(workbook, outputPath);

          logger.info(`导出门店数据成功: ${outputPath}`);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 导出成功\n文件路径: ${outputPath}\n门店数量: ${data.length}`,
            }],
            details: {
              success: true,
              outputPath,
              count: data.length,
            },
          };
        } catch (error) {
          logger.error('导出门店数据失败:', error);
          return errResult('导出门店数据失败', error);
        }
      },
    };

    return [importStoresTool, exportStoresTool];
  },
};
