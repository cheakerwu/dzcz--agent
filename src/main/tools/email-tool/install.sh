#!/bin/bash

# 邮件工具依赖安装脚本

set -e

TOOL_DIR="$HOME/.deepbot/tools/email-tool"

echo "📧 安装邮件工具依赖..."
echo ""

# 创建目录
echo "1️⃣ 创建工具目录: $TOOL_DIR"
mkdir -p "$TOOL_DIR"

# 进入目录
cd "$TOOL_DIR"

# 检查包管理器
if command -v pnpm &> /dev/null; then
    echo "2️⃣ 使用 pnpm 安装依赖..."
    
    # 初始化 package.json（如果不存在）
    if [ ! -f "package.json" ]; then
        echo '{"name":"email-tool","version":"1.0.0","private":true}' > package.json
    fi
    
    # 安装 nodemailer
    pnpm add nodemailer
    
elif command -v npm &> /dev/null; then
    echo "2️⃣ 使用 npm 安装依赖..."
    
    # 初始化 package.json（如果不存在）
    if [ ! -f "package.json" ]; then
        npm init -y
    fi
    
    # 安装 nodemailer
    npm install nodemailer
    
else
    echo "❌ 错误: 未找到 npm 或 pnpm"
    echo "请先安装 Node.js 和包管理器"
    exit 1
fi

echo ""
echo "✅ 依赖安装完成！"
echo ""
echo "下一步："
echo "  1. 复制配置示例: cp config.example.json config.json"
echo "  2. 编辑配置文件: vim config.json"
echo "  3. 在 Local Agent Terminal 中使用邮件工具"
echo ""
