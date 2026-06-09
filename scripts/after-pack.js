/**
 * electron-builder afterPack 钩子
 * 打包完成、签名之前执行
 * 
 * 1. 修复 asar 中 constructor 目录名 bug
 * 2. 清理不需要的跨平台二进制文件（减小包体积）
 * 3. 创建 node 包装脚本（macOS）
 */

const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  const platform = context.electronPlatformName;
  const appPath = context.appOutDir + '/' + context.packager.appInfo.productFilename + '.app';
  const resourcesDir = platform === 'darwin'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');

  // ========== 修复和优化 asar ==========
  const asarPath = path.join(resourcesDir, 'app.asar');
  let asarTmpDir = null; // 保留临时目录供 Windows 提取依赖用
  if (fs.existsSync(asarPath)) {
    asarTmpDir = await fixAndOptimizeAsar(asarPath, platform);
  }

  // ========== 清理 unpacked 中的跨平台文件 ==========
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
  if (fs.existsSync(unpackedDir)) {
    cleanCrossPlatformFiles(unpackedDir, platform);
    
    // 修复 agent-browser 二进制执行权限（asarUnpack 后可能丢失）
    const abBinDir = path.join(unpackedDir, 'node_modules', 'agent-browser', 'bin');
    if (fs.existsSync(abBinDir)) {
      for (const file of fs.readdirSync(abBinDir)) {
        if (!file.endsWith('.js')) {
          const filePath = path.join(abBinDir, file);
          try {
            fs.chmodSync(filePath, 0o755);
          } catch (e) {
            // 忽略（Windows 上 chmod 可能不生效）
          }
        }
      }
      console.log('   ✅ 已修复 agent-browser 二进制执行权限');
    }
  }

  // ========== Windows: 从 asar 临时目录提取 agent-browser 依赖到 unpacked ==========
  if (platform === 'win32' && asarTmpDir) {
    const unpackedDirWin = path.join(resourcesDir, 'app.asar.unpacked');
    extractAgentBrowserDeps(asarTmpDir, unpackedDirWin);
  }
  
  // 清理 asar 临时目录
  if (asarTmpDir && fs.existsSync(asarTmpDir)) {
    fs.rmSync(asarTmpDir, { recursive: true, force: true });
  }

  // ========== macOS: 创建 node 包装脚本 ==========
  if (platform !== 'darwin') {
    return;
  }

  const appDir = path.join(resourcesDir, 'app');
  const nodeWrapperDir = fs.existsSync(appDir) ? appDir : resourcesDir;
  const nodeWrapperPath = path.join(nodeWrapperDir, 'node');

  console.log('\n🔗 签名前创建 node 包装脚本...');

  if (fs.existsSync(nodeWrapperPath)) {
    fs.unlinkSync(nodeWrapperPath);
  }

  const productName = context.packager.appInfo.productFilename;
  const relPath = fs.existsSync(appDir) ? '../../MacOS' : '../MacOS';
  const wrapperScript = `#!/bin/bash
# Node.js wrapper for agent-browser
export ELECTRON_RUN_AS_NODE=1
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
ELECTRON_PATH="$SCRIPT_DIR/${relPath}/${productName}"
exec "$ELECTRON_PATH" "$@"
`;

  fs.writeFileSync(nodeWrapperPath, wrapperScript, { mode: 0o755 });
  console.log('✅ node 包装脚本创建成功（将被纳入签名）\n');
};

/**
 * 修复和优化 asar 包
 * @returns {string|null} 临时目录路径（供后续步骤复用），调用方负责清理
 */
async function fixAndOptimizeAsar(asarPath, platform) {
  try {
    const asar = require('@electron/asar');
    const tmpDir = asarPath + '.tmp';

    console.log('\n🔧 优化 asar 包...');
    asar.extractAll(asarPath, tmpDir);

    let modified = false;

    // 1. 修复 constructor 目录名 bug
    const sourceBase = path.join(process.cwd(), 'node_modules', '@sinclair', 'typebox', 'build');
    const fixes = [
      { dir: path.join(tmpDir, 'node_modules', '@sinclair', 'typebox', 'build', 'cjs', 'type', 'constructor'), src: path.join(sourceBase, 'cjs', 'type', 'constructor'), label: 'CJS' },
      { dir: path.join(tmpDir, 'node_modules', '@sinclair', 'typebox', 'build', 'esm', 'type', 'constructor'), src: path.join(sourceBase, 'esm', 'type', 'constructor'), label: 'ESM' },
    ];

    for (const fix of fixes) {
      if (!fs.existsSync(fix.dir) && fs.existsSync(fix.src)) {
        fs.cpSync(fix.src, fix.dir, { recursive: true });
        console.log(`   ✅ 已补回 ${fix.label} constructor 目录`);
        modified = true;
      }
    }

    // 2. 清理跨平台二进制文件
    const cleaned = cleanCrossPlatformFiles(tmpDir, platform);
    if (cleaned > 0) modified = true;

    if (modified) {
      await asar.createPackage(tmpDir, asarPath);
      console.log('✅ asar 已重新打包（优化完成）\n');
    } else {
      console.log('✅ asar 无需修改\n');
    }

    // 返回临时目录，由调用方决定何时清理
    return tmpDir;
  } catch (error) {
    console.error('⚠️ 优化 asar 失败:', error.message);
    return null;
  }
}

/**
 * 清理不需要的跨平台二进制文件
 */
function cleanCrossPlatformFiles(baseDir, platform) {
  let cleaned = 0;

  // 根据平台确定要保留和删除的目录
  const platformKeep = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux';

  // koffi: 删除其他平台的二进制
  const koffiDir = path.join(baseDir, 'node_modules', 'koffi', 'build', 'koffi');
  if (fs.existsSync(koffiDir)) {
    for (const dir of fs.readdirSync(koffiDir)) {
      if (!dir.startsWith(platformKeep) && !dir.startsWith('musl')) {
        fs.rmSync(path.join(koffiDir, dir), { recursive: true, force: true });
        cleaned++;
      }
    }
    // musl 只在 linux 需要
    if (platform !== 'linux') {
      for (const dir of fs.readdirSync(koffiDir)) {
        if (dir.startsWith('musl')) {
          fs.rmSync(path.join(koffiDir, dir), { recursive: true, force: true });
          cleaned++;
        }
      }
    }
  }

  // lzma-native: 删除其他平台的 prebuilds
  const lzmaDir = path.join(baseDir, 'node_modules', 'lzma-native', 'prebuilds');
  if (fs.existsSync(lzmaDir)) {
    for (const dir of fs.readdirSync(lzmaDir)) {
      if (!dir.startsWith(platformKeep)) {
        fs.rmSync(path.join(lzmaDir, dir), { recursive: true, force: true });
        cleaned++;
      }
    }
  }

  // agent-browser: 删除其他平台的可执行文件
  const abBinDir = path.join(baseDir, 'node_modules', 'agent-browser', 'bin');
  if (fs.existsSync(abBinDir)) {
    for (const file of fs.readdirSync(abBinDir)) {
      // 保留 .js 文件和当前平台的二进制
      if (file.endsWith('.js')) continue;
      if (file.includes(platformKeep)) continue;
      fs.rmSync(path.join(abBinDir, file), { force: true });
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`   🗑️ 清理了 ${cleaned} 个跨平台文件`);
  }

  return cleaned;
}


/**
 * Windows: 从已解压的 asar 临时目录提取 agent-browser 依赖树到 unpacked 目录
 * 
 * node.exe 无法读取 asar 内的文件，需要把 daemon 运行所需的
 * 完整依赖树提取到 app.asar.unpacked 目录。
 * 
 * @param {string} asarTmpDir - fixAndOptimizeAsar 返回的已解压临时目录
 * @param {string} unpackedDir - app.asar.unpacked 目录
 */
function extractAgentBrowserDeps(asarTmpDir, unpackedDir) {
  console.log('\n📦 Windows: 提取 agent-browser 依赖树...');
  
  const topNm = path.join(asarTmpDir, 'node_modules');
  const nodeModulesDst = path.join(unpackedDir, 'node_modules');
  
  if (!fs.existsSync(topNm)) {
    console.log('   ⚠️ node_modules 不存在，跳过');
    return;
  }
  
  // 动态收集 agent-browser 的完整依赖树
  const depsToExtract = new Set();
  
  function resolvePackage(name, fromDir) {
    let dir = fromDir;
    while (true) {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
  
  function getTopLevelPkgName(absPath) {
    const rel = path.relative(topNm, absPath);
    if (rel.startsWith('..')) return null;
    const parts = rel.split(path.sep);
    if (parts[0].startsWith('@')) {
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    }
    return parts[0] || null;
  }
  
  function resolveDeps(pkgDir) {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return;
    
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')); }
    catch { return; }
    
    for (const dep of Object.keys(pkg.dependencies || {})) {
      const resolved = resolvePackage(dep, pkgDir);
      if (!resolved) continue;
      
      const topPkg = getTopLevelPkgName(resolved);
      if (topPkg && !depsToExtract.has(topPkg)) {
        depsToExtract.add(topPkg);
        resolveDeps(resolved);
      }
    }
    
    // 扫描嵌套 node_modules
    const nestedNm = path.join(pkgDir, 'node_modules');
    if (fs.existsSync(nestedNm)) {
      scanNestedNm(nestedNm);
    }
  }
  
  function scanNestedNm(nmDir) {
    let entries;
    try { entries = fs.readdirSync(nmDir); } catch { return; }
    
    for (const entry of entries) {
      if (entry === '.bin') continue;
      const fullPath = path.join(nmDir, entry);
      
      if (entry.startsWith('@')) {
        try {
          for (const sub of fs.readdirSync(fullPath)) {
            if (fs.existsSync(path.join(fullPath, sub, 'package.json'))) {
              resolveDeps(path.join(fullPath, sub));
            }
          }
        } catch {}
      } else if (fs.existsSync(path.join(fullPath, 'package.json'))) {
        resolveDeps(fullPath);
      }
    }
  }
  
  // 从 agent-browser 开始递归
  const abDir = path.join(topNm, 'agent-browser');
  depsToExtract.add('agent-browser');
  resolveDeps(abDir);
  
  // 复制到 unpacked 目录
  let copied = 0;
  for (const dep of depsToExtract) {
    const srcDir = path.join(topNm, dep);
    const dstDir = path.join(nodeModulesDst, dep);
    
    if (!fs.existsSync(srcDir)) continue;
    if (fs.existsSync(dstDir)) continue;
    
    fs.mkdirSync(path.dirname(dstDir), { recursive: true });
    fs.cpSync(srcDir, dstDir, { recursive: true });
    copied++;
  }
  
  console.log(`   ✅ 提取了 ${copied} 个依赖包（共 ${depsToExtract.size} 个）`);
}
