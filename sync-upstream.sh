#!/bin/bash

# 同步上游 2FAuth 仓库的更新脚本
# upstream: https://github.com/Bubka/2FAuth.git (只读)
# origin: git@github-personal:ProblemFactory/2FAuth.git (你的 fork)

set -e  # 遇到错误时退出

echo "🔄 从上游仓库同步最新代码到你的 fork..."

# 检查是否有未提交的更改
if ! git diff --quiet HEAD; then
    echo "❌ 有未提交的更改，请先提交或暂存"
    git status
    exit 1
fi

# 确保在 master 分支
echo "📍 切换到 master 分支"
git checkout master

# 获取上游更新
echo "📥 获取上游更新"
git fetch upstream

# 检查是否有新的提交
UPSTREAM_COMMITS=$(git rev-list --count HEAD..upstream/master)
if [ "$UPSTREAM_COMMITS" -eq 0 ]; then
    echo "✅ 已经是最新版本，无需更新"
    exit 0
fi

echo "📦 发现 $UPSTREAM_COMMITS 个新提交"

# 尝试自动合并
echo "🔀 正在合并上游更新"
if git merge upstream/master --no-edit; then
    echo "✅ 自动合并成功"
    
    # 重新构建前端资源
    echo "🔨 重新构建前端资源"
    npm run build
    
    # 如果构建产生了变化，提交它们
    if ! git diff --quiet HEAD; then
        git add public/build/
        git commit -m "Rebuild assets after upstream merge

🤖 Generated with Claude Code"
    fi
    
    # 推送到你的 fork
    echo "📤 推送到你的 fork (origin)"
    git push origin master
    
    echo "🎉 同步完成！GitHub Actions 将自动构建新的 Docker 镜像"
    echo "📦 镜像地址: ghcr.io/problemfactory/2fauth:latest"
    
else
    echo "⚠️  自动合并失败，存在冲突"
    echo "请手动解决冲突后运行："
    echo "  git add <文件>"
    echo "  git commit"
    echo "  git push origin master"
    exit 1
fi