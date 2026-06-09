/**
 * 复制 Prompt 模板到 Web 服务器构建目录
 */

const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '../src/main/prompts/templates');
const targetDir = path.join(__dirname, '../dist-server/main/prompts/templates');

// 确保目标目录存在
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 复制所有 .md 文件
const files = fs.readdirSync(sourceDir);
let copiedCount = 0;

files.forEach(file => {
  if (file.endsWith('.md')) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    fs.copyFileSync(sourcePath, targetPath);
    copiedCount++;
  }
});

console.log(`✅ 已复制 ${copiedCount} 个 Prompt 模板到 dist-server/`);
