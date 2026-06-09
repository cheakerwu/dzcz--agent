/**
 * 身份验证中间件
 * 
 * 简单模式：单用户 + 密码保护
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthRequest, TokenPayload, LoginRequest, LoginResponse } from '../types';
import { getErrorMessage } from '../../shared/utils/error-handler';

// 从环境变量读取配置
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || 'deepbot-default-secret-change-in-production';
const JWT_EXPIRES_IN = '30d'; // Token 有效期 30 天

/**
 * 身份验证中间件
 * - 如果没有设置 ACCESS_PASSWORD，直接放行
 * - 如果设置了密码，验证 JWT Token
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 如果没有设置密码，直接放行（单用户模式）
  if (!ACCESS_PASSWORD) {
    (req as AuthRequest).userId = 'default';
    return next();
  }
  
  // 检查 Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: '需要身份验证' });
    return;
  }
  
  // 验证 Token
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    (req as AuthRequest).userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

/**
 * 生成 JWT Token
 */
export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 登录处理器
 */
export function loginHandler(req: Request, res: Response): void {
  try {
    const { password } = req.body as LoginRequest;
    
    // 如果没有设置密码，直接返回 Token
    if (!ACCESS_PASSWORD) {
      const token = generateToken('default');
      const response: LoginResponse = {
        token,
        userId: 'default',
        expiresIn: JWT_EXPIRES_IN
      };
      res.json(response);
      return;
    }
    
    // 验证密码
    if (password !== ACCESS_PASSWORD) {
      res.status(401).json({ error: '密码错误' });
      return;
    }
    
    // 生成 Token
    const token = generateToken('default');
    const response: LoginResponse = {
      token,
      userId: 'default',
      expiresIn: JWT_EXPIRES_IN
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
}
