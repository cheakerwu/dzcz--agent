/**
 * 加载 .env 文件后执行 electron-builder 打包
 * 用途：确保 after-sign.js 能读取到 APPLE_ID 等环境变量
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 加载 .env 文件
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    process.env[key] = value;
  }
  console.log('✅ 已加载 .env 环境变量');
} else {
  console.warn('⚠️  未找到 .env 文件，Apple 公证可能失败');
}

// 获取打包平台和架构参数（如 --mac --x64 / --mac --arm64）
const args = process.argv.slice(2);
const platform = args.length > 0 ? args.join(' ') : '--mac';

// 如果指定了单一架构，覆盖 target 中的 arch 配置
let archOverride = '';
if (args.includes('--x64') && !args.includes('--arm64')) {
  archOverride = ' --config.mac.target.0.arch=x64 --config.mac.target.1.arch=x64';
} else if (args.includes('--arm64') && !args.includes('--x64')) {
  archOverride = ' --config.mac.target.0.arch=arm64 --config.mac.target.1.arch=arm64';
}

// 执行构建和打包
const buildCmd = args.includes('--win')
  ? `node scripts/download-node-win.js && pnpm run build && electron-builder ${platform}${archOverride}`
  : `pnpm run build && electron-builder ${platform}${archOverride}`;

console.log(`\n🚀 开始打包: ${buildCmd}\n`);

execSync(buildCmd, { stdio: 'inherit', env: process.env });
