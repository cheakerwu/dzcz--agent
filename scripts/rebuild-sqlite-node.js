/**
 * 将 better-sqlite3 重新编译为系统 Node.js 版本
 * 用于 web server 模式（非 Electron）
 */

const { execSync } = require('child_process');
const path = require('path');

const sqliteDir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');

console.log(`🔨 为 Node.js ${process.version} 重新编译 better-sqlite3...`);

try {
  execSync('node-gyp rebuild', {
    cwd: sqliteDir,
    stdio: 'inherit',
  });
  console.log('✅ 编译完成');
} catch (err) {
  console.error('❌ 编译失败:', err.message);
  process.exit(1);
}
