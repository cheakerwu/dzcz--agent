/**
 * electron-builder afterSign 钩子
 * node 包装脚本已在 after-pack.js 中创建（签名前），无需额外操作
 * 公证由 electron-builder 内置 notarize 处理（package.json 中配置）
 */

exports.default = async function(_context) {
  // node 包装脚本在 afterPack 阶段已创建并纳入签名
  // 公证由内置 notarize 在签名后自动处理
  // 此处无需额外操作
};
