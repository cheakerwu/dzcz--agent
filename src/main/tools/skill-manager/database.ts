/**
 * Skill Manager 数据库操作
 */

import * as path from 'path';
import * as fs from 'fs';
import Database from '../../../shared/utils/sqlite-adapter';
import { SKILLS_DB_PATH, getSkillsDir } from './constants';
import { ensureDirectoryExists } from '../../../shared/utils/fs-utils';

/**
 * 初始化 Skill 数据库
 */
export function initDatabase(): Database.Database {
  // 确保目录存在
  const dbDir = path.dirname(SKILLS_DB_PATH);
  ensureDirectoryExists(dbDir);
  
  // 打开数据库
  const db = new Database(SKILLS_DB_PATH);
  
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      version TEXT NOT NULL,
      enabled BOOLEAN DEFAULT 1,
      installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME,
      usage_count INTEGER DEFAULT 0,
      repository TEXT,
      metadata TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  `);
  
  // 启动时清理：删除数据库中有记录但文件系统不存在的残留条目
  cleanOrphanedRecords(db);
  
  return db;
}

/**
 * 清理数据库中的残留记录（文件系统已不存在的 Skill）
 */
function cleanOrphanedRecords(db: Database.Database): void {
  try {
    const skillsDir = getSkillsDir();
    const rows = db.prepare('SELECT name FROM skills').all() as { name: string }[];
    
    for (const row of rows) {
      const skillMdPath = path.join(skillsDir, row.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        db.prepare('DELETE FROM skills WHERE name = ?').run(row.name);
        console.warn(`[Skill Manager] 🗑️ 清理残留记录: ${row.name}（文件不存在）`);
      }
    }
  } catch (error) {
    // 清理失败不影响正常使用
    console.warn('[Skill Manager] ⚠️ 清理残留记录时出错:', error);
  }
}
