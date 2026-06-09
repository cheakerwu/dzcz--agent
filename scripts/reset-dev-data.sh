#!/bin/bash

# DeepBot 开发数据重置脚本
# 用于模拟首次启动，删除所有配置和数据库

set -e

DEEPBOT_DIR="$HOME/.deepbot"

echo "🔄 重置 DeepBot 开发数据..."
echo ""

# 检查目录是否存在
if [ ! -d "$DEEPBOT_DIR" ]; then
  echo "✅ $DEEPBOT_DIR 不存在，无需重置"
  exit 0
fi

echo "📂 DeepBot 数据目录: $DEEPBOT_DIR"
echo ""

# 列出将要删除的文件
echo "将删除以下数据库文件:"
echo "  - system-config.db (系统配置、模型配置)"
echo "  - scheduled-tasks.db (定时任务)"
echo "  - skills.db (Skill 管理)"
echo ""

# 询问确认
read -p "确认删除？(y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ 已取消"
  exit 1
fi

# 删除数据库文件
echo ""
echo "🗑️  删除数据库文件..."

if [ -f "$DEEPBOT_DIR/system-config.db" ]; then
  rm "$DEEPBOT_DIR/system-config.db"
  echo "  ✅ 已删除 system-config.db"
fi

if [ -f "$DEEPBOT_DIR/scheduled-tasks.db" ]; then
  rm "$DEEPBOT_DIR/scheduled-tasks.db"
  echo "  ✅ 已删除 scheduled-tasks.db"
fi

if [ -f "$DEEPBOT_DIR/skills.db" ]; then
  rm "$DEEPBOT_DIR/skills.db"
  echo "  ✅ 已删除 skills.db"
fi

echo ""
echo "✅ 重置完成！"
echo ""
echo "💡 提示："
echo "  - 下次启动 DeepBot 将模拟首次使用"
echo "  - 需要重新配置大模型"
echo "  - 所有定时任务和 Skill 配置将丢失"
echo ""
