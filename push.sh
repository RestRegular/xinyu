#!/bin/bash
# push.sh - 一键 git push 脚本
# 用法: ./push.sh [commit message]
# 如果有未提交的更改，会先 commit 再 push
# 如果没有参数且没有更改，只执行 push

cd "$(dirname "$0")"

# 尝试从环境变量或 bashrc 读取 token
if [ -z "$GITHUB_TOKEN" ]; then
    GITHUB_TOKEN="$(grep '^export GITHUB_TOKEN=' ~/.bashrc 2>/dev/null | tail -1 | sed 's/^export GITHUB_TOKEN=//' | tr -d '"')"
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "错误: 未找到 GITHUB_TOKEN，请在 ~/.bashrc 中设置: export GITHUB_TOKEN=\"xxx\""
    exit 1
fi

REPO="RestRegular/xinyu"
AUTH_URL="https://RestRegular:${GITHUB_TOKEN}@github.com/${REPO}.git"
SAFE_URL="https://github.com/${REPO}.git"

# 检查是否有未提交的更改
if [ -n "$(git status --porcelain)" ]; then
    if [ -n "$1" ]; then
        MSG="$1"
    else
        MSG="update: $(date '+%Y-%m-%d %H:%M')"
    fi
    echo ">>> 检测到未提交的更改，执行 git add + commit"
    git add -A
    git commit -m "$MSG"
fi

# 先 pull rebase 避免冲突
echo ">>> git pull --rebase"
git remote set-url origin "$AUTH_URL"
git pull origin master --rebase 2>&1

# push
echo ">>> git push"
git push origin master 2>&1
PUSH_EXIT=$?

# 恢复安全 URL
git remote set-url origin "$SAFE_URL"

if [ $PUSH_EXIT -eq 0 ]; then
    echo ">>> 推送成功 ✓"
else
    echo ">>> 推送失败 ✗"
    exit 1
fi
