/**
 * Skill 管理路由
 * 
 * 提供 Skill 的列表、搜索、安装、卸载、信息查询等功能
 */

import { Router } from 'express';
import type { GatewayAdapter } from '../gateway-adapter';

export function createSkillsRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  // Skill 管理（统一入口）
  router.post('/', async (req, res) => {
    try {
      const request = req.body;
      
      if (!request || !request.action) {
        return res.status(400).json({ 
          success: false, 
          error: '缺少 action 参数' 
        });
      }
      
      const result = await gatewayAdapter.skillManager(request);
      res.json(result);
    } catch (error) {
      console.error('Skill 管理操作失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : '操作失败' 
      });
    }
  });

  // Skill 导入上传（Docker 模式用）
  router.post('/import', async (req, res) => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      // 从 request body 读取 base64 编码的 zip 数据
      const { zipData, fileName } = req.body;
      if (!zipData) {
        return res.status(400).json({ success: false, error: '缺少 zipData 参数' });
      }

      // 保存到临时文件
      const tmpPath = path.join(os.tmpdir(), `deepbot-skill-import-${Date.now()}-${fileName || 'import.zip'}`);
      const buffer = Buffer.from(zipData, 'base64');
      fs.writeFileSync(tmpPath, buffer);

      try {
        const result = await gatewayAdapter.skillManager({ action: 'import', zipPath: tmpPath });
        res.json(result);
      } finally {
        // 清理临时文件
        try { fs.unlinkSync(tmpPath); } catch { /* 忽略 */ }
      }
    } catch (error) {
      console.error('Skill 导入失败:', error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : '导入失败' });
    }
  });

  // Skill 导出下载（Docker 模式用）
  router.get('/download', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        return res.status(400).json({ success: false, error: '缺少 path 参数' });
      }
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      // 安全检查：只允许下载临时目录中的 zip 文件
      const normalizedPath = path.normalize(filePath);
      if (!normalizedPath.startsWith(os.tmpdir()) || !normalizedPath.endsWith('.zip')) {
        return res.status(403).json({ success: false, error: '无权访问该文件' });
      }
      if (!fs.existsSync(normalizedPath)) {
        return res.status(404).json({ success: false, error: '文件不存在' });
      }
      res.download(normalizedPath, path.basename(normalizedPath), (err) => {
        if (!err) {
          try { fs.unlinkSync(normalizedPath); } catch { /* 忽略 */ }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: '下载失败' });
    }
  });
  
  return router;
}
