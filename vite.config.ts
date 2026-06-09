import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isWeb = mode === 'web';
  
  return {
    plugins: [
      react(),
      // 🔥 根据模式选择不同的入口文件
      {
        name: 'html-transform',
        transformIndexHtml(html) {
          if (isWeb) {
            // Web 模式：使用 main-web.tsx
            return html.replace(
              '/src/renderer/main.tsx',
              '/src/renderer/main-web.tsx'
            );
          }
          return html;
        },
      },
    ],
    root: '.',
    
    // Web 模式：使用绝对路径 /
    // Electron 模式：使用相对路径 ./
    base: isWeb ? '/' : './',
    
    build: {
      // Web 模式：输出到 dist-web/
      // Electron 模式：输出到 dist/
      outDir: isWeb ? 'dist-web' : 'dist',
      emptyOutDir: true,
      rollupOptions: isWeb ? {
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
      } : undefined,
    },
    
    server: {
      // Web 模式：端口 5174
      // Electron 模式：端口 5173
      port: isWeb ? 5174 : 5173,
    },
    
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    
    // Web 模式：定义环境变量
    define: isWeb ? {
      'process.env.IS_WEB': JSON.stringify(true),
    } : {},
  };
});

