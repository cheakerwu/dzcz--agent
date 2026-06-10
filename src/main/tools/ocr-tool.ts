/**
 * OCR 文字识别工具
 *
 * 基于 EasyOCR 或 Tesseract 实现图片/PDF 文字提取，支持中文
 * 参考科吉 Agent 的 OCR 工具实现，适配点之出众 ToolPlugin 接口
 *
 * 依赖安装：
 *   pip install easyocr        (推荐，支持中文，无需额外系统安装)
 *   pip install pytesseract    (需额外安装 Tesseract-OCR 系统程序)
 *   pip install pypdfium2      (PDF OCR 需要)
 */

import { Type } from '@sinclair/typebox';
import { existsSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { TOOL_NAMES } from './tool-names';
import { getErrorMessage } from '../../shared/utils/error-handler';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import type { AgentTool } from '@mariozechner/pi-agent-core';

// 支持的图片格式
const SUPPORTED_IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp',
]);

// OCR 引擎检测结果缓存
let cachedEngine: { name: string; available: boolean } | null = null;

/**
 * 检测可用的 OCR 引擎
 */
async function detectOcrEngine(): Promise<{ name: string; available: boolean }> {
  if (cachedEngine) return cachedEngine;

  // 优先检测 easyocr
  try {
    await runPython('import easyocr; print("ok")', 10);
    cachedEngine = { name: 'easyocr', available: true };
    console.log('[OCR] 检测到 easyocr 引擎');
    return cachedEngine;
  } catch {
    // easyocr 不可用
  }

  // 检测 pytesseract
  try {
    await runPython('import pytesseract; pytesseract.get_tesseract_version(); print("ok")', 10);
    cachedEngine = { name: 'tesseract', available: true };
    console.log('[OCR] 检测到 pytesseract 引擎');
    return cachedEngine;
  } catch {
    // tesseract 不可用
  }

  cachedEngine = { name: 'none', available: false };
  console.warn('[OCR] 未检测到可用的 OCR 引擎');
  return cachedEngine;
}

/**
 * 执行 Python 代码并返回输出
 */
function runPython(code: string, timeoutSeconds: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-c', code], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Python 执行超时 (${timeoutSeconds}s)`));
    }, timeoutSeconds * 1000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || stdout || `Python 退出码 ${code}`));
      }
    });
  });
}

/**
 * 通过 Python 子进程执行 OCR
 */
async function performOcr(
  filePath: string,
  engine: string,
  lang: string,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<string> {
  // 转义路径中的反斜杠（Windows）
  const escapedPath = filePath.replace(/\\/g, '\\\\');

  const code = engine === 'easyocr'
    ? `
import easyocr
import sys
reader = easyocr.Reader(${lang.includes('ch') ? "['ch_sim', 'en']" : "['en']"}, gpu=False, verbose=False)
results = reader.readtext(r'${escapedPath}')
for bbox, text, conf in results:
    print(text)
`
    : `
import pytesseract
from PIL import Image
img = Image.open(r'${escapedPath}')
lang_map = {'ch_sim': 'chi_sim+eng', 'eng': 'eng'}
text = pytesseract.image_to_string(img, lang='${lang === 'ch_sim+eng' ? 'chi_sim+eng' : 'eng'}')
print(text.strip() if text.strip() else '未识别到文字')
`;

  if (signal?.aborted) {
    throw new Error('操作被取消');
  }

  return runPython(code, timeoutSeconds);
}

/**
 * 通过 Python 子进程执行 PDF OCR
 */
async function performPdfOcr(
  filePath: string,
  engine: string,
  lang: string,
  pages: string,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<string> {
  const escapedPath = filePath.replace(/\\/g, '\\\\');

  const code = `
import pypdfium2 as pdfium
import tempfile, os

pdf = pdfium.PdfDocument(r'${escapedPath}')
total = len(pdf)
pages_str = '${pages}'
if pages_str:
    parts = []
    for p in pages_str.split(','):
        p = p.strip()
        if '-' in p:
            a, b = p.split('-', 1)
            parts.extend(range(int(a), int(b)+1))
        else:
            parts.append(int(p))
    page_nums = [p for p in parts if 1 <= p <= total]
else:
    page_nums = list(range(1, total+1))

${engine === 'easyocr' ? `
import easyocr
reader = easyocr.Reader(${lang.includes('ch') ? "['ch_sim', 'en']" : "['en']"}, gpu=False, verbose=False)
` : `
import pytesseract
from PIL import Image
`}

results = []
for pn in page_nums:
    page = pdf[pn - 1]
    bitmap = page.render(scale=2)
    pil_img = bitmap.to_pil()
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        tmp = f.name
        pil_img.save(tmp, format='PNG')
    try:
${engine === 'easyocr' ? `
        texts = [t for _, t, _ in reader.readtext(tmp)]
        results.append(f"── 第 {pn}/{total} 页 ──\\n" + "\\n".join(texts))
` : `
        text = pytesseract.image_to_string(Image.open(tmp), lang='${lang === 'ch_sim+eng' ? 'chi_sim+eng' : 'eng'}')
        results.append(f"── 第 {pn}/{total} 页 ──\\n" + (text.strip() or '未识别到文字'))
`}
    finally:
        os.unlink(tmp)

print("\\n\\n".join(results))
`;

  if (signal?.aborted) {
    throw new Error('操作被取消');
  }

  return runPython(code, timeoutSeconds);
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ============================================================
// OCR 工具插件
// ============================================================

export const ocrToolPlugin: ToolPlugin = {
  metadata: {
    id: 'ocr',
    name: 'OCR 文字识别',
    description: '识别图片/PDF 中的文字，支持中文和英文',
    version: '1.0.0',
    category: 'ai',
    tags: ['ocr', 'image', 'pdf', 'text-recognition'],
  },

  create: (options: ToolCreateOptions): AgentTool[] => {
    // OCR 图片工具
    const ocrImageTool: AgentTool = {
      name: 'ocr_image',
      label: 'OCR 图片识别',
      description: '识别图片中的文字（OCR），支持中文和英文，支持 PNG/JPG/BMP/TIFF/WEBP 格式',
      parameters: Type.Object({
        path: Type.String({
          description: '图片文件完整路径',
        }),
        lang: Type.Optional(Type.String({
          description: '识别语言：ch_sim+eng（中文+英文，默认）、eng（仅英文）',
        })),
      }),

      execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
        const { path, lang = 'ch_sim+eng' } = params as { path: string; lang?: string };

        try {
          // 检查文件
          if (!existsSync(path)) {
            return {
              content: [{ type: 'text' as const, text: `❌ 文件不存在: ${path}` }],
              details: { success: false, error: '文件不存在' },
              isError: true,
            };
          }

          const ext = extname(path).toLowerCase();
          if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
            return {
              content: [{ type: 'text' as const, text: `❌ 不支持的图片格式: ${ext}。支持: ${[...SUPPORTED_IMAGE_EXTS].join(', ')}` }],
              details: { success: false, error: '格式不支持' },
              isError: true,
            };
          }

          // 检测引擎
          const engine = await detectOcrEngine();
          if (!engine.available) {
            return {
              content: [{
                type: 'text' as const,
                text: '❌ 未安装 OCR 引擎。请安装:\n  pip install easyocr（推荐）\n  或 pip install pytesseract',
              }],
              details: { success: false, error: '无可用 OCR 引擎' },
              isError: true,
            };
          }

          // 执行 OCR
          if (signal?.aborted) throw new Error('操作被取消');

          const text = await performOcr(path, engine.name, lang, 60, signal);
          const size = existsSync(path) ? formatSize(require('node:fs').statSync(path).size) : '未知';

          return {
            content: [{
              type: 'text' as const,
              text: `📄 OCR 识别结果\n文件: ${basename(path)} (${size})\n引擎: ${engine.name} | 语言: ${lang}\n${'─'.repeat(40)}\n${text || '未识别到文字'}`,
            }],
            details: {
              success: true,
              engine: engine.name,
              language: lang,
              charCount: text.length,
            },
          };
        } catch (error) {
          const msg = getErrorMessage(error);
          return {
            content: [{ type: 'text' as const, text: `❌ OCR 识别失败: ${msg}` }],
            details: { success: false, error: msg },
            isError: true,
          };
        }
      },
    };

    // OCR PDF 工具
    const ocrPdfTool: AgentTool = {
      name: 'ocr_pdf',
      label: 'OCR PDF 识别',
      description: '对 PDF 文件进行 OCR 文字识别（将 PDF 页面转为图片后识别文字）',
      parameters: Type.Object({
        path: Type.String({
          description: 'PDF 文件完整路径',
        }),
        lang: Type.Optional(Type.String({
          description: '识别语言：ch_sim+eng（默认）、eng',
        })),
        pages: Type.Optional(Type.String({
          description: '页码范围，如 "1-5" 或 "1,3,5"，默认全部',
        })),
      }),

      execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
        const { path, lang = 'ch_sim+eng', pages = '' } = params as {
          path: string; lang?: string; pages?: string;
        };

        try {
          if (!existsSync(path)) {
            return {
              content: [{ type: 'text' as const, text: `❌ 文件不存在: ${path}` }],
              details: { success: false, error: '文件不存在' },
              isError: true,
            };
          }

          if (extname(path).toLowerCase() !== '.pdf') {
            return {
              content: [{ type: 'text' as const, text: '❌ 仅支持 PDF 文件' }],
              details: { success: false, error: '格式不支持' },
              isError: true,
            };
          }

          const engine = await detectOcrEngine();
          if (!engine.available) {
            return {
              content: [{ type: 'text' as const, text: '❌ 未安装 OCR 引擎（easyocr 或 pytesseract）' }],
              details: { success: false, error: '无可用 OCR 引擎' },
              isError: true,
            };
          }

          // 检查 pypdfium2
          try {
            await runPython('import pypdfium2', 5);
          } catch {
            return {
              content: [{ type: 'text' as const, text: '❌ PDF OCR 需要 pypdfium2 库: pip install pypdfium2' }],
              details: { success: false, error: '缺少 pypdfium2' },
              isError: true,
            };
          }

          if (signal?.aborted) throw new Error('操作被取消');

          const text = await performPdfOcr(path, engine.name, lang, pages, 300, signal);

          return {
            content: [{
              type: 'text' as const,
              text: `📄 PDF OCR 识别完成\n文件: ${basename(path)}\n引擎: ${engine.name} | 语言: ${lang}\n${'═'.repeat(40)}\n${text || '未识别到文字'}`,
            }],
            details: {
              success: true,
              engine: engine.name,
              language: lang,
            },
          };
        } catch (error) {
          const msg = getErrorMessage(error);
          return {
            content: [{ type: 'text' as const, text: `❌ PDF OCR 失败: ${msg}` }],
            details: { success: false, error: msg },
            isError: true,
          };
        }
      },
    };

    return [ocrImageTool, ocrPdfTool];
  },
};

export default ocrToolPlugin;
