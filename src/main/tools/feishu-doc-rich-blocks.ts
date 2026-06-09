/**
 * 飞书文档丰富格式块工具
 *
 * 将 Markdown/HTML 内容转换为飞书文档块并插入到文档中。
 *
 * 转换流程：
 *   1. 调用飞书 Markdown 转换 API 获取文档块数据
 *   2. 清洗块数据（去除只读属性、过滤不支持的块类型）
 *   3. 调用创建嵌套块 API（descendant）批量插入到目标文档
 *   4. 如有图片块，额外上传图片素材并更新 Image Block
 *
 * 参考文档：
 * - 转换 API: POST /open-apis/docx/v1/documents/blocks/convert
 * - 嵌套块 API: POST /open-apis/docx/v1/documents/:id/blocks/:id/descendant
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { TOOL_NAMES } from './tool-names';
import { createLogger } from '../../shared/utils/logger';

const logger = createLogger('FeishuDocRichBlocks');

// ==================== 内部工具函数 ====================

/**
 * 获取 tenant_access_token
 * 用于直接调用 REST API（SDK 未封装的接口）
 */
async function getTenantAccessToken(client: any, configStore: any): Promise<string> {
  const connectorConfig = configStore.getConnectorConfig('feishu');
  const tokenRes = await client.auth.tenantAccessToken.internal({
    data: {
      app_id: connectorConfig.config.appId,
      app_secret: connectorConfig.config.appSecret,
    },
  });
  const token = (tokenRes as any)?.tenant_access_token;
  if (!token) throw new Error('获取 tenant_access_token 失败');
  return token;
}

/**
 * 清洗块数据，使其符合 descendant API 要求
 * - 去除表格块中的 merge_info、cells（只读属性）
 * - 将 children_id 重命名为 children（兼容字段名错误）
 * - 去除文本块的 style 字段（descendant API 不接受）
 * - 修正 heading 块：如果用了 text 字段而不是 heading1-9，自动转换
 * - 修正简写格式：如果文本块用了 {content:"..."} 而不是 {elements:[{text_run:{content:"..."}}]}，自动转换
 */
function cleanBlocksForDescendantApi(blocks: any[]): any[] {
  // block_type 到内容字段名的映射
  const BLOCK_TYPE_TO_KEY: Record<number, string> = {
    2: 'text',
    3: 'heading1', 4: 'heading2', 5: 'heading3', 6: 'heading4', 7: 'heading5',
    8: 'heading6', 9: 'heading7', 10: 'heading8', 11: 'heading9',
    12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo',
  };

  // 所有文本类块的字段名
  const TEXT_BLOCK_KEYS = Object.values(BLOCK_TYPE_TO_KEY);

  const result = blocks.map(block => {
    const cleaned = { ...block };

    // 将 children_id 重命名为 children
    if (cleaned.children_id && !cleaned.children) {
      cleaned.children = cleaned.children_id;
    }
    delete cleaned.children_id;

    // 确保 children 存在
    if (!cleaned.children) {
      cleaned.children = [];
    }

    // 清理表格块的只读属性
    if (cleaned.table) {
      cleaned.table = { ...cleaned.table };
      delete cleaned.table.cells;
      if (cleaned.table.property) {
        cleaned.table.property = { ...cleaned.table.property };
        delete cleaned.table.property.merge_info;
        delete cleaned.table.property.column_width;
        delete cleaned.table.property.header_row;
        delete cleaned.table.property.header_column;
      }
    }

    // 去除只读字段
    delete cleaned.parent_id;
    delete cleaned.revision_id;

    // 修正字段名：Agent 可能用错误的字段名
    const expectedKey = BLOCK_TYPE_TO_KEY[cleaned.block_type];
    if (expectedKey) {
      // 情况1: heading 块用了 text 字段
      if (expectedKey !== 'text' && cleaned.text && !cleaned[expectedKey]) {
        cleaned[expectedKey] = cleaned.text;
        delete cleaned.text;
      }
      // 情况2: heading 块用了通用 heading 字段（而非 heading1/heading2/...）
      if (expectedKey !== 'text' && cleaned.heading && !cleaned[expectedKey]) {
        cleaned[expectedKey] = cleaned.heading;
        delete cleaned.heading;
      }
    }

    // 修正内容结构：将各种非标准格式统一为飞书要求的 {elements:[{text_run:{content:"..."}}]}
    for (const key of TEXT_BLOCK_KEYS) {
      if (!cleaned[key]) continue;
      const val = cleaned[key];

      // 情况1: {content:"..."} → 标准格式
      if (!val.elements && typeof val.content === 'string') {
        cleaned[key] = {
          elements: [{ text_run: { content: val.content } }],
        };
      }
      // 情况2: {text:"..."} → 标准格式（Agent 用 text 代替 content）
      else if (!val.elements && typeof val.text === 'string') {
        cleaned[key] = {
          elements: [{ text_run: { content: val.text } }],
        };
      }
      // 情况3: {text:[{text:"..."}]} → 标准格式（Agent 用了错误的数组结构）
      else if (!val.elements && Array.isArray(val.text)) {
        cleaned[key] = {
          elements: val.text.map((item: any) => ({
            text_run: { content: typeof item === 'string' ? item : (item.text || item.content || '') },
          })),
        };
      }
    }

    // 去除文本块的 style 字段（descendant API 不接受块级 style，但保留 text_element_style）
    // 同时清理 text_element_style 中值为 false 的字段（只保留有效样式）
    for (const key of TEXT_BLOCK_KEYS) {
      if (cleaned[key]) {
        cleaned[key] = { ...cleaned[key] };
        delete cleaned[key].style;

        if (cleaned[key].elements) {
          cleaned[key].elements = cleaned[key].elements.map((el: any) => {
            if (!el.text_run?.text_element_style) return el;
            // 只保留值为 true 或有实际值的样式属性
            const style = el.text_run.text_element_style;
            const cleanedStyle: Record<string, any> = {};
            for (const [k, v] of Object.entries(style)) {
              if (v === true || (k === 'link' && v) || (typeof v === 'number' && v !== 0)) {
                cleanedStyle[k] = v;
              }
            }
            if (Object.keys(cleanedStyle).length === 0) {
              const { text_element_style, ...rest } = el.text_run;
              return { ...el, text_run: rest };
            }
            return { ...el, text_run: { ...el.text_run, text_element_style: cleanedStyle } };
          });
        }
      }
    }

    return cleaned;
  });

  // 第二遍：给空的 TableCell(32) 块补充空 Text 子块
  // 飞书要求 TableCell 必须包含至少一个子块
  const extraBlocks: any[] = [];
  for (const block of result) {
    if (block.block_type === 32 && !block.table_cell) {
      block.table_cell = {};
    }

    const needsChild = block.block_type === 32
      && (!block.children || block.children.length === 0);
    if (needsChild) {
      const childId = `${block.block_id}_empty_text`;
      block.children = [childId];
      extraBlocks.push({
        block_id: childId,
        block_type: 2,
        text: { elements: [{ text_run: { content: '' } }] },
        children: [],
      });
    }
  }

  return [...result, ...extraBlocks];
}

/**
 * 调用飞书 Markdown/HTML 转文档块 API
 *
 * @param token - tenant_access_token
 * @param content - Markdown 或 HTML 内容
 * @param contentType - 内容类型：'markdown' 或 'html'
 * @returns 转换后的块数据（first_level_block_ids, blocks, block_id_to_image_urls）
 */
async function convertContentToBlocks(
  token: string,
  content: string,
  contentType: 'markdown' | 'html' = 'markdown'
): Promise<{
  firstLevelBlockIds: string[];
  blocks: any[];
  imageUrls: Array<{ block_id: string; image_url: string }>;
}> {
  const response = await fetch(
    'https://open.feishu.cn/open-apis/docx/v1/documents/blocks/convert',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ content_type: contentType, content }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Markdown 转换 API 失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json() as any;
  if (result.code !== 0) {
    throw new Error(`Markdown 转换 API 错误: ${result.msg} (code: ${result.code})`);
  }

  const data = result.data;
  return {
    firstLevelBlockIds: data.first_level_block_ids || [],
    blocks: data.blocks || [],
    imageUrls: data.block_id_to_image_urls || [],
  };
}

/**
 * 调用飞书创建嵌套块 API（descendant 接口）
 * 支持一次性创建有父子关系的复杂块结构
 *
 * @param token - tenant_access_token
 * @param documentId - 文档 ID
 * @param blockId - 父块 ID（通常为 document_id，即文档根块）
 * @param childrenIds - 顶层子块 ID 列表
 * @param descendants - 所有块数据（含嵌套关系）
 * @param index - 插入位置（-1 表示末尾，0 表示开头）
 */
async function createDescendantBlocks(
  token: string,
  documentId: string,
  blockId: string,
  childrenIds: string[],
  descendants: any[],
  index: number = -1
): Promise<any> {
  const requestBody = {
    children_id: childrenIds,
    descendants,
    index,
  };

  // 调试日志
  logger.info(`descendant API 请求: document=${documentId}, block=${blockId}, children_id=${childrenIds.length}个, descendants=${descendants.length}个`);

  const response = await fetch(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}/descendant?document_revision_id=-1`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`创建嵌套块 API 失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json() as any;
  if (result.code !== 0) {
    throw new Error(`创建嵌套块 API 错误: ${result.msg} (code: ${result.code})`);
  }

  return result.data;
}

/**
 * 上传图片素材到飞书 Image Block
 * Markdown 中的图片转换后需要额外上传
 */
async function uploadImageToBlock(
  token: string,
  documentId: string,
  blockId: string,
  imageUrl: string
): Promise<void> {
  // 1. 下载图片
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) {
    throw new Error(`下载图片失败: ${imageUrl}`);
  }
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

  // 2. 上传图片素材到 Image Block
  const FormData = (await import('form-data')).default;
  const formData = new FormData();
  formData.append('image', imgBuffer, { filename: 'image.png', contentType: 'image/png' });

  const uploadRes = await fetch(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}/upload_media?parent_type=docx_image`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...formData.getHeaders(),
      },
      body: formData as any,
    }
  );

  if (!uploadRes.ok) {
    logger.warn(`上传图片素材失败 (block: ${blockId}): HTTP ${uploadRes.status}`);
    return;
  }

  const uploadResult = await uploadRes.json() as any;
  if (uploadResult.code !== 0) {
    logger.warn(`上传图片素材 API 错误 (block: ${blockId}): ${uploadResult.msg}`);
    return;
  }

  const fileToken = uploadResult.data?.file_token;
  if (!fileToken) {
    logger.warn(`上传图片素材未返回 file_token (block: ${blockId})`);
    return;
  }

  // 3. 更新 Image Block，设置图片素材 ID
  const updateRes = await fetch(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}?document_revision_id=-1`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        replace_image: { token: fileToken },
      }),
    }
  );

  if (!updateRes.ok) {
    logger.warn(`更新 Image Block 失败 (block: ${blockId}): HTTP ${updateRes.status}`);
  }
}

// ==================== 导出工具创建函数 ====================

/**
 * 创建飞书丰富格式文档块工具
 *
 * @param getLarkClient - 获取飞书 Client 的函数
 * @param getConfigStore - 获取 configStore 的函数
 * @param docUrl - 生成文档链接的函数
 * @param errResult - 统一错误返回函数
 * @param checkAbort - 检查 abort 信号函数
 */
export function createRichBlockTools(
  getLarkClient: () => Promise<any>,
  getConfigStore: () => any,
  docUrl: (id: string) => string,
  errResult: (msg: string, error: unknown) => any,
  checkAbort: (signal?: AbortSignal) => void
): AgentTool[] {
  return [

    // ── 插入丰富格式块（Markdown/HTML → 文档块）──────────────
    {
      name: TOOL_NAMES.FEISHU_DOC_INSERT_RICH_BLOCKS,
      label: '插入丰富格式内容到飞书文档',
      description: `将 Markdown 或 HTML 格式的内容转换为飞书文档块并插入到文档中。
支持的格式：文本（加粗/斜体/删除线/行内代码/超链接）、一到九级标题、无序列表、有序列表、代码块、引用、待办事项、图片、表格。
注意：
- 表格中的 merge_info 会自动去除
- 图片会自动上传（需要图片 URL 可访问）
- 单次最多插入 1000 个块，超过时会自动分批
- 插入位置 index: 0=文档开头, -1=文档末尾`,
      parameters: Type.Object({
        document_id: Type.String({ description: '文档 ID' }),
        content: Type.String({ description: 'Markdown 或 HTML 格式的内容' }),
        content_type: Type.Optional(Type.Union([
          Type.Literal('markdown'),
          Type.Literal('html'),
        ], { description: '内容类型，默认 markdown', default: 'markdown' })),
        index: Type.Optional(Type.Number({ description: '插入位置，0=开头，-1=末尾（默认）', default: -1 })),
        parent_block_id: Type.Optional(Type.String({ description: '父块 ID，不填则默认使用 document_id（文档根块）' })),
      }),
      execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
        try {
          checkAbort(signal);
          const client = await getLarkClient();
          const configStore = getConfigStore();
          const token = await getTenantAccessToken(client, configStore);

          const contentType = args.content_type || 'markdown';
          const parentBlockId = args.parent_block_id || args.document_id;
          const index = args.index ?? -1;

          logger.info(`插入丰富格式块: ${args.document_id}, 类型: ${contentType}, 内容长度: ${args.content.length}`);

          // 1. 转换 Markdown/HTML 为文档块
          const converted = await convertContentToBlocks(token, args.content, contentType);
          logger.info(`转换完成: ${converted.blocks.length} 个块, ${converted.firstLevelBlockIds.length} 个顶层块, ${converted.imageUrls.length} 个图片`);

          if (converted.blocks.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '⚠️ 转换后没有生成任何块，请检查内容格式' }],
              details: { success: false },
            };
          }

          // 2. 清洗块数据（去除 merge_info、cells 等只读属性）
          const cleanedBlocks = cleanBlocksForDescendantApi(converted.blocks);

          // 3. 构建 descendants 数据（包含 block_id、block_type、children 和内容字段）
          // 过滤掉 Page 根块（block_type=1）和其他不支持的块类型
          const SUPPORTED_BLOCK_TYPES = new Set([
            2, 3, 4, 5, 6, 7, 8, 9, 10, 11, // text, heading1-9
            12, 13, 14, 15, 17,               // bullet, ordered, code, quote, todo
            31, 32, 34, 35,                   // table, table_cell, grid, grid_column
            // 注意：image(27) 不在此列表中，因为转换 API 返回的图片块 token 为空，
            // descendant API 不接受空 token，图片需要后续单独上传处理
            // 注意：callout(22) 不在此列表中，因为转换 API 返回的 Callout 块是空壳，
            // 缺少必要属性（background_color 等），会导致 invalid param 错误
          ]);

          const filteredBlocks = cleanedBlocks.filter(block => SUPPORTED_BLOCK_TYPES.has(block.block_type));
          const filteredBlockIds = new Set(filteredBlocks.map((b: any) => b.block_id));
          // 不应出现在顶层的块类型（它们只能作为其他块的子块）
          const NON_TOP_LEVEL_TYPES = new Set([32, 35]); // table_cell, grid_column
          const filteredFirstLevelIds = converted.firstLevelBlockIds.filter((id: string) => {
            if (!filteredBlockIds.has(id)) return false;
            const block = filteredBlocks.find((b: any) => b.block_id === id);
            return block && !NON_TOP_LEVEL_TYPES.has(block.block_type);
          });

          const descendants = filteredBlocks.map(block => {
            const desc: any = {
              block_id: block.block_id,
              block_type: block.block_type,
              children: (block.children || []).filter((cid: string) => filteredBlockIds.has(cid)),
            };
            // 复制块类型对应的内容字段
            const contentKeys = [
              'text', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5',
              'heading6', 'heading7', 'heading8', 'heading9',
              'bullet', 'ordered', 'code', 'quote', 'todo', 'callout',
              'table', 'table_cell', 'image', 'grid', 'grid_column',
            ];
            for (const key of contentKeys) {
              if (block[key] !== undefined) {
                desc[key] = block[key];
              }
            }
            return desc;
          });

          logger.info(`构建 descendants: ${descendants.length} 个块, 顶层: ${filteredFirstLevelIds.length}`);

          // 4. 校验引用完整性：过滤孤儿块，确保每个 descendant 要么在 children_id 中，要么被某个块的 children 引用
          const topLevelSet = new Set(filteredFirstLevelIds);
          const referencedByChildren = new Set<string>();
          for (const d of descendants) {
            for (const cid of (d.children || [])) {
              referencedByChildren.add(cid);
            }
          }
          const validDescendants = descendants.filter(d =>
            topLevelSet.has(d.block_id) || referencedByChildren.has(d.block_id)
          );
          // 同时清理 children 中引用了不存在块的 ID
          const validBlockIds = new Set(validDescendants.map((d: any) => d.block_id));
          for (const d of validDescendants) {
            if (d.children) {
              d.children = d.children.filter((cid: string) => validBlockIds.has(cid));
            }
          }

          if (validDescendants.length !== descendants.length) {
            logger.warn(`过滤了 ${descendants.length - validDescendants.length} 个孤儿块`);
          }

          // 5. 插入块到文档（统一使用 descendant API）
          let insertedCount = 0;
          const BATCH_SIZE = 1000;

          if (validDescendants.length <= BATCH_SIZE) {
            await createDescendantBlocks(
              token, args.document_id, parentBlockId,
              filteredFirstLevelIds, validDescendants, index
            );
            insertedCount = validDescendants.length;
          } else {
            // 分批插入（按顶层块分组）
            let currentBatchIds: string[] = [];
            let currentBatchDescs: any[] = [];
            let currentBatchSize = 0;

            const collectDescendants = (blockId: string): any[] => {
              const desc = validDescendants.find(d => d.block_id === blockId);
              if (!desc) return [];
              const result = [desc];
              for (const childId of (desc.children || [])) {
                result.push(...collectDescendants(childId));
              }
              return result;
            };

            for (const topId of filteredFirstLevelIds) {
              const topGroup = collectDescendants(topId);

              if (currentBatchSize + topGroup.length > BATCH_SIZE && currentBatchIds.length > 0) {
                await createDescendantBlocks(
                  token, args.document_id, parentBlockId,
                  currentBatchIds, currentBatchDescs, index
                );
                insertedCount += currentBatchDescs.length;
                currentBatchIds = [];
                currentBatchDescs = [];
                currentBatchSize = 0;
              }

              currentBatchIds.push(topId);
              currentBatchDescs.push(...topGroup);
              currentBatchSize += topGroup.length;
            }

            if (currentBatchIds.length > 0) {
              await createDescendantBlocks(
                token, args.document_id, parentBlockId,
                currentBatchIds, currentBatchDescs, index
              );
              insertedCount += currentBatchDescs.length;
            }
          }

          // 6. 处理图片上传（如果有）
          let imageCount = 0;
          if (converted.imageUrls.length > 0) {
            for (const imgInfo of converted.imageUrls) {
              try {
                checkAbort(signal);
                await uploadImageToBlock(token, args.document_id, imgInfo.block_id, imgInfo.image_url);
                imageCount++;
                logger.info(`图片上传成功: ${imgInfo.block_id}`);
              } catch (imgError) {
                logger.warn(`图片上传失败 (${imgInfo.block_id}): ${getErrorMessage(imgError)}`);
              }
            }
          }

          const imgMsg = imageCount > 0 ? `\n图片: ${imageCount}/${converted.imageUrls.length} 张上传成功` : '';
          return {
            content: [{
              type: 'text' as const,
              text: `✅ 丰富格式内容已插入文档\n插入块数: ${insertedCount}${imgMsg}\n链接: ${docUrl(args.document_id)}`,
            }],
            details: {
              document_id: args.document_id,
              blocks_inserted: insertedCount,
              images_uploaded: imageCount,
              url: docUrl(args.document_id),
            },
          };
        } catch (error) {
          logger.error('插入丰富格式块失败:', error);
          return errResult('插入丰富格式块失败', error);
        }
      },
    },

  ];
}
