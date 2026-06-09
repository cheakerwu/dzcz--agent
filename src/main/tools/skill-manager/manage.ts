/**
 * Skill Manager 管理功能（列表、卸载、详情）
 */

import * as path from 'path';
import * as fs from 'fs';
import type Database from '../../../shared/utils/sqlite-adapter';
import type { InstalledSkill, SkillInfo } from './types';
import { getAllSkillPaths, getDefaultSkillPath } from '../../config/skill-paths';
import { parseSkillMetadata, scanDirectory } from './utils';
import { isDirectory, isFile, safeReadFile, safeRemove, ensureDirectoryExists } from '../../../shared/utils/fs-utils';
import { safeJsonParse } from '../../../shared/utils/json-utils';

/**
 * 列出已安装的 Skill
 */
export function listInstalledSkills(
  db: Database.Database,
  filter?: { enabled?: boolean }
): InstalledSkill[] {
  // 从所有配置的路径扫描 Skills
  const allPaths = getAllSkillPaths();
  const allSkills: InstalledSkill[] = [];
  
  for (const skillPath of allPaths) {
    if (!isDirectory(skillPath)) {
      console.warn(`[Skill Manager] 路径不存在: ${skillPath}`);
      continue;
    }
    
    try {
      const dirs = fs.readdirSync(skillPath);
      
      for (const dir of dirs) {
        const fullPath = path.join(skillPath, dir);
        const stat = fs.statSync(fullPath);
        
        if (!stat.isDirectory()) {
          continue;
        }
        
        // 检查是否有 SKILL.md
        const skillMdPath = path.join(fullPath, 'SKILL.md');
        if (!isFile(skillMdPath)) {
          continue;
        }
        
        // 从数据库获取信息（如果存在）
        const row = db.prepare('SELECT * FROM skills WHERE name = ?').get(dir) as any;
        
        if (row) {
          // 数据库中有记录
          const meta = safeJsonParse<any>(row.metadata, {});
          allSkills.push({
            name: row.name,
            version: row.version,
            enabled: Boolean(row.enabled),
            installedAt: new Date(row.installed_at),
            lastUsed: row.last_used ? new Date(row.last_used) : undefined,
            usageCount: row.usage_count,
            repository: row.repository,
            description: meta.description || '',
          });
        } else {
          // 数据库中没有记录，创建新记录
          try {
            const metadata = parseSkillMetadata(fullPath);
            
            const stmt = db.prepare(`
              INSERT INTO skills (name, version, enabled, repository, metadata)
              VALUES (?, ?, 1, ?, ?)
            `);
            
            stmt.run(
              dir,
              metadata.version || '1.0.0',
              metadata.repository || '',
              JSON.stringify(metadata)
            );
            
            allSkills.push({
              name: dir,
              version: metadata.version || '1.0.0',
              enabled: true,
              installedAt: new Date(),
              usageCount: 0,
              repository: metadata.repository || '',
              description: metadata.description || '',
            });
            
            console.log(`[Skill Manager] 自动注册 Skill: ${dir}`);
          } catch (error) {
            // SKILL.md 无效，仍然列出但标记为异常
            const reason = error instanceof Error ? error.message : '未知错误';
            console.warn(`[Skill Manager] ⚠️ Skill 异常: ${dir}（${reason}）`);
            allSkills.push({
              name: dir,
              version: '?',
              enabled: false,
              installedAt: new Date(),
              usageCount: 0,
              repository: '',
              description: '',
              invalid: true,
              invalidReason: reason,
            });
          }
        }
      }
    } catch (error) {
      console.error(`[Skill Manager] 扫描路径失败: ${skillPath}`, error);
    }
  }
  
  // 应用过滤条件
  let filteredSkills = allSkills;
  
  if (filter?.enabled !== undefined) {
    filteredSkills = allSkills.filter(s => s.enabled === filter.enabled);
  }
  
  // 按使用次数和安装时间排序
  filteredSkills.sort((a, b) => {
    if (a.usageCount !== b.usageCount) {
      return b.usageCount - a.usageCount;
    }
    return b.installedAt.getTime() - a.installedAt.getTime();
  });
  
  return filteredSkills;
}

/**
 * 卸载 Skill
 */
export function uninstallSkill(name: string, db: Database.Database): void {
  // 1. 从数据库删除
  const stmt = db.prepare('DELETE FROM skills WHERE name = ?');
  const result = stmt.run(name);
  
  if (result.changes === 0) {
    throw new Error(`Skill "${name}" 不存在`);
  }
  
  // 2. 删除文件
  // 从所有路径中查找 Skill
  const allPaths = getAllSkillPaths();
  let skillDir: string | null = null;
  
  for (const basePath of allPaths) {
    const candidatePath = path.join(basePath, name);
    if (fs.existsSync(candidatePath)) {
      skillDir = candidatePath;
      break;
    }
  }
  
  if (skillDir) {
    safeRemove(skillDir);
  }
  
  console.info(`[Skill Manager] ✅ Skill 已卸载: ${name}`);
}

/**
 * 获取 Skill 的 .env 文件内容
 */
export function getSkillEnv(name: string): string {
  const allPaths = getAllSkillPaths();
  for (const basePath of allPaths) {
    const envPath = path.join(basePath, name, '.env');
    if (isFile(envPath)) {
      return safeReadFile(envPath, '');
    }
  }
  return '';
}

/**
 * 保存 Skill 的 .env 文件
 */
export function setSkillEnv(name: string, envContent: string): void {
  const allPaths = getAllSkillPaths();
  let skillDir: string | null = null;
  
  for (const basePath of allPaths) {
    const candidatePath = path.join(basePath, name);
    if (isDirectory(candidatePath)) {
      skillDir = candidatePath;
      break;
    }
  }
  
  if (!skillDir) {
    throw new Error(`Skill "${name}" 的目录不存在`);
  }
  
  const envPath = path.join(skillDir, '.env');
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.info(`[Skill Manager] ✅ Skill "${name}" 环境变量已保存: ${envPath}`);
}

/**
 * 读取所有已安装 Skill 的 .env 文件，合并为环境变量 Map
 */
export function getAllSkillEnvVars(): Map<string, string> {
  const allEnv = new Map<string, string>();
  const allPaths = getAllSkillPaths();
  
  for (const basePath of allPaths) {
    if (!isDirectory(basePath)) continue;
    
    try {
      const dirs = fs.readdirSync(basePath);
      for (const dir of dirs) {
        const envPath = path.join(basePath, dir, '.env');
        if (!isFile(envPath)) continue;
        
        const content = safeReadFile(envPath, '');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          // 支持 KEY=VALUE 和 export KEY=VALUE 格式
          const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=["']?([^"']*)["']?$/);
          if (match) {
            const [, key, value] = match;
            if (key && value !== undefined) {
              allEnv.set(key, value);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[Skill Manager] 读取 Skill 环境变量失败: ${basePath}`, error);
    }
  }
  
  return allEnv;
}


export function getSkillInfo(name: string, db: Database.Database): SkillInfo {
  // 1. 从数据库获取基本信息
  const row = db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as any;
  
  if (!row) {
    throw new Error(`Skill "${name}" 不存在`);
  }
  
  const metadata = safeJsonParse<any>(row.metadata, {});
  
  // 2. 读取 README
  // 从所有路径中查找 Skill
  const allPaths = getAllSkillPaths();
  let skillDir: string | null = null;
  
  for (const basePath of allPaths) {
    const candidatePath = path.join(basePath, name);
    if (isDirectory(candidatePath)) {
      skillDir = candidatePath;
      break;
    }
  }
  
  if (!skillDir) {
    throw new Error(`Skill "${name}" 的文件不存在`);
  }
  
  const readmePath = path.join(skillDir, 'SKILL.md');
  const readme = safeReadFile(readmePath, '无说明');
  
  // 3. 扫描文件
  const files = {
    scripts: scanDirectory(path.join(skillDir, 'scripts')),
    references: scanDirectory(path.join(skillDir, 'references')),
    assets: scanDirectory(path.join(skillDir, 'assets')),
  };
  
  return {
    name: row.name,
    description: metadata.description,
    version: row.version,
    author: metadata.author || 'unknown',
    repository: row.repository,
    installPath: skillDir,
    readme,
    requires: {
      tools: metadata.requires?.tools || [],
      dependencies: metadata.requires?.dependencies || [],
    },
    files,
  };
}

/**
 * 导出 Skill 为 zip 压缩包
 * 
 * @param names - 要导出的 Skill 名称列表
 * @returns zip 文件的路径
 */
export async function exportSkills(names: string[], savePath?: string): Promise<string> {
  const { execSync } = require('child_process');
  const os = require('os');

  if (names.length === 0) {
    throw new Error('No skills selected for export');
  }

  // 查找每个 skill 的目录
  const allPaths = getAllSkillPaths();
  const skillDirs: Array<{ name: string; dir: string }> = [];

  for (const name of names) {
    let found = false;
    for (const basePath of allPaths) {
      const candidatePath = path.join(basePath, name);
      if (isDirectory(candidatePath) && isFile(path.join(candidatePath, 'SKILL.md'))) {
        skillDirs.push({ name, dir: candidatePath });
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`Skill "${name}" 不存在`);
    }
  }

  // 创建临时目录
  const tmpDir = path.join(os.tmpdir(), `deepbot-skill-export-${Date.now()}`);
  ensureDirectoryExists(tmpDir);

  // 复制 skill 目录到临时目录
  for (const { name, dir } of skillDirs) {
    const destDir = path.join(tmpDir, name);
    copyDirRecursive(dir, destDir);
  }

  // 打包为 zip
  const zipName = names.length === 1 ? `${names[0]}.zip` : `skills-export-${Date.now()}.zip`;
  const zipPath = path.join(os.tmpdir(), zipName);

  // 使用系统 zip 命令（跨平台兼容）
  try {
    if (process.platform === 'win32') {
      // Windows: 使用 PowerShell
      execSync(`powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${zipPath}' -Force"`, { timeout: 30000 });
    } else {
      // macOS/Linux: 使用 zip 命令
      execSync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { timeout: 30000 });
    }
  } catch (error) {
    // 清理临时目录
    safeRemove(tmpDir);
    throw new Error(`打包失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 清理临时目录
  safeRemove(tmpDir);

  // 如果指定了保存路径，移动 zip 文件
  let finalPath = zipPath;
  if (savePath) {
    fs.copyFileSync(zipPath, savePath);
    fs.unlinkSync(zipPath);
    finalPath = savePath;
  }

  console.log(`[Skill Manager] ✅ 已导出 ${names.length} 个 Skill: ${finalPath}`);
  return finalPath;
}

/**
 * 递归复制目录
 */
function copyDirRecursive(src: string, dest: string): void {
  ensureDirectoryExists(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // 跳过 node_modules 和 __pycache__
      if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 导入 Skill（从 zip 文件解压并安装）
 * 
 * @param zipPath - zip 文件路径
 * @param db - 数据库实例
 * @returns 导入结果
 */
export async function importSkills(zipPath: string, db: Database.Database): Promise<{ imported: string[]; skipped: string[]; errors: string[] }> {
  const os = require('os');
  const AdmZip = (await import('adm-zip')).default;

  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // 1. 解压到临时目录
  const tmpDir = path.join(os.tmpdir(), `deepbot-skill-import-${Date.now()}`);
  ensureDirectoryExists(tmpDir);

  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tmpDir, true);

    // 2. 扫描解压后的目录，查找包含 SKILL.md 的子目录
    const entries = fs.readdirSync(tmpDir);
    
    // 判断结构：可能是单个 skill（根目录直接有 SKILL.md）或多个 skill（每个子目录有 SKILL.md）
    const skillDirs: Array<{ name: string; dir: string }> = [];

    if (isFile(path.join(tmpDir, 'SKILL.md'))) {
      // 根目录就是一个 skill，用 zip 文件名作为 skill 名
      const zipBaseName = path.basename(zipPath, '.zip');
      skillDirs.push({ name: zipBaseName, dir: tmpDir });
    } else {
      // 扫描子目录
      for (const entry of entries) {
        const entryPath = path.join(tmpDir, entry);
        if (isDirectory(entryPath) && isFile(path.join(entryPath, 'SKILL.md'))) {
          skillDirs.push({ name: entry, dir: entryPath });
        }
      }
    }

    if (skillDirs.length === 0) {
      throw new Error('zip 中未找到有效的 Skill（缺少 SKILL.md 文件）');
    }

    // 3. 逐个安装
    const SKILLS_DIR = getDefaultSkillPath();
    ensureDirectoryExists(SKILLS_DIR);

    for (const { name, dir } of skillDirs) {
      try {
        const targetDir = path.join(SKILLS_DIR, name);

        // 检查是否已安装
        if (isDirectory(targetDir) && isFile(path.join(targetDir, 'SKILL.md'))) {
          skipped.push(name);
          continue;
        }

        // 复制到 skill 目录
        copyDirRecursive(dir, targetDir);

        // 解析 SKILL.md 元数据
        const metadata = parseSkillMetadata(targetDir);

        // 写入数据库（如果已有记录先删除）
        db.prepare('DELETE FROM skills WHERE name = ?').run(name);
        db.prepare(`
          INSERT INTO skills (name, version, enabled, repository, metadata)
          VALUES (?, ?, 1, ?, ?)
        `).run(
          name,
          metadata.version || '1.0.0',
          'local-import',
          JSON.stringify(metadata)
        );

        imported.push(name);
        console.log(`[Skill Manager] ✅ 导入成功: ${name}`);
      } catch (error) {
        const msg = `${name}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        console.error(`[Skill Manager] ❌ 导入失败: ${msg}`);
      }
    }
  } finally {
    // 清理临时目录
    safeRemove(tmpDir);
  }

  console.log(`[Skill Manager] 导入完成: ${imported.length} 成功, ${skipped.length} 跳过, ${errors.length} 失败`);
  return { imported, skipped, errors };
}
