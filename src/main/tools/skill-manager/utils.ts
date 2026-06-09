/**
 * Skill Manager 工具函数
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SkillMetadata } from './types';
import { isFile, safeReadFile, isDirectory } from '../../../shared/utils/fs-utils';

/**
 * 从仓库名称提取 Skill 名称
 * 
 * 例如：
 * - deepbot-skill-pdf-editor → pdf-editor
 * - pdf-editor → pdf-editor
 */
export function extractSkillName(repoName: string): string {
  const prefix = 'deepbot-skill-';
  if (repoName.startsWith(prefix)) {
    return repoName.slice(prefix.length);
  }
  return repoName;
}

/**
 * 解析 SKILL.md 元数据
 */
export function parseSkillMetadata(skillDir: string): SkillMetadata {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  
  if (!isFile(skillMdPath)) {
    throw new Error('SKILL.md 文件不存在');
  }
  
  const content = safeReadFile(skillMdPath);
  
  // 解析 YAML frontmatter（兼容 \r\n 换行和各种格式）
  const frontmatterMatch = content.match(/^---\s*[\r\n]+([\s\S]+?)[\r\n]+---/);
  if (!frontmatterMatch) {
    throw new Error('SKILL.md 缺少 YAML frontmatter');
  }
  
  const frontmatter = frontmatterMatch[1];
  
  // 简单的 YAML 解析（支持多行值：如果某行不含 ":"，拼接到上一个 key 的值）
  const metadata: SkillMetadata = {
    name: '',
    description: '',
  };
  
  const lines = frontmatter.split(/\r?\n/);
  let lastKey = '';
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0 && /^[a-zA-Z_]/.test(line.trim())) {
      // 新的 key: value 行
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      lastKey = key;
      
      if (key === 'name') {
        metadata.name = value.replace(/^["']|["']$/g, '');
      } else if (key === 'description') {
        metadata.description = value.replace(/^["']|["']$/g, '');
      } else if (key === 'version') {
        metadata.version = value;
      } else if (key === 'author') {
        metadata.author = value;
      } else if (key === 'repository') {
        metadata.repository = value;
      } else if (key === 'tags') {
        const tagsMatch = value.match(/\[(.*?)\]/);
        if (tagsMatch) {
          metadata.tags = tagsMatch[1].split(',').map((t: string) => t.trim());
        }
      }
    } else if (lastKey === 'description' && line.trim()) {
      // 多行 description，拼接到已有值
      metadata.description += ' ' + line.trim().replace(/["']$/g, '');
    }
  }
  
  if (!metadata.name || !metadata.description) {
    throw new Error('SKILL.md 缺少必需字段: name 或 description');
  }
  
  return metadata;
}

/**
 * 扫描目录，返回文件列表
 */
export function scanDirectory(dir: string): string[] {
  if (!isDirectory(dir)) {
    return [];
  }
  
  return fs.readdirSync(dir);
}
