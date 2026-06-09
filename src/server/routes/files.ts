/**
 * 文件管理路由
 * 
 * 提供文件上传、读取、删除等功能
 */

import { Router } from 'express';
import type { GatewayAdapter } from '../gateway-adapter';

export function createFilesRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  // 上传文件
  router.post('/upload', async (req, res) => {
    try {
      const { fileName, dataUrl, fileSize, fileType } = req.body;
      
      if (!fileName || !dataUrl) {
        return res.status(400).json({ 
          success: false, 
          error: '缺少必要参数' 
        });
      }
      
      const result = await gatewayAdapter.uploadFile(fileName, dataUrl, fileSize, fileType);
      res.json(result);
    } catch (error) {
      console.error('上传文件失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : '上传失败' 
      });
    }
  });
  
  // 上传图片
  router.post('/upload-image', async (req, res) => {
    try {
      const { fileName, dataUrl, fileSize } = req.body;
      
      if (!fileName || !dataUrl) {
        return res.status(400).json({ 
          success: false, 
          error: '缺少必要参数' 
        });
      }
      
      const result = await gatewayAdapter.uploadImage(fileName, dataUrl, fileSize);
      res.json(result);
    } catch (error) {
      console.error('上传图片失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : '上传失败' 
      });
    }
  });
  
  // 读取图片
  router.get('/read-image', async (req, res) => {
    try {
      const { path } = req.query;
      
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: '缺少文件路径' 
        });
      }
      
      const result = await gatewayAdapter.readImage(path);
      res.json(result);
    } catch (error) {
      console.error('读取图片失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : '读取失败' 
      });
    }
  });
  
  // 删除临时文件
  router.delete('/temp', async (req, res) => {
    try {
      const { path } = req.query;
      
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: '缺少文件路径' 
        });
      }
      
      const result = await gatewayAdapter.deleteTempFile(path);
      res.json(result);
    } catch (error) {
      console.error('删除临时文件失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : '删除失败' 
      });
    }
  });
  
  return router;
}
