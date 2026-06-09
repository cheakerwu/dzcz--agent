/**
 * 登录页面
 * 
 * 仅在 Web 模式且设置了密码时显示
 * 风格：终端科幻风，与系统设置页面一致
 */

import React, { useState } from 'react';
import { api } from '../api';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password) {
      setError('请输入密码');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await api.login(password);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1f2e',
    }}>
      <div style={{
        background: '#242936',
        padding: '40px',
        borderRadius: '12px',
        border: '1px solid #2d3748',
        width: '100%',
        maxWidth: '380px',
      }}>
        {/* 标题 */}
        <h1 style={{
          fontSize: '22px',
          fontWeight: 600,
          color: '#d4dce8',
          marginBottom: '6px',
          textAlign: 'center',
          letterSpacing: '1px',
        }}>
          Local Agent Terminal
        </h1>
        <p style={{
          fontSize: '13px',
          color: '#8b9aaf',
          marginBottom: '28px',
          textAlign: 'center',
        }}>
          请输入访问密码
        </p>
        
        <form onSubmit={handleSubmit}>
          {/* 密码输入框 */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              disabled={loading}
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                color: '#d4dce8',
                background: '#1a1f2e',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = '#7aa2f7'}
              onBlur={(e) => e.target.style.borderColor = '#2d3748'}
            />
          </div>
          
          {/* 错误提示 */}
          {error && (
            <div style={{
              padding: '10px 12px',
              marginBottom: '16px',
              background: 'rgba(247, 118, 142, 0.1)',
              color: '#f7768e',
              borderRadius: '6px',
              fontSize: '13px',
              border: '1px solid rgba(247, 118, 142, 0.2)',
            }}>
              {error}
            </div>
          )}
          
          {/* 登录按钮 */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#fff',
              background: loading ? '#3b4252' : '#7aa2f7',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                (e.target as HTMLButtonElement).style.background = '#6a92e7';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                (e.target as HTMLButtonElement).style.background = '#7aa2f7';
              }
            }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
};
