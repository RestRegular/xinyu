#!/bin/bash
# push.sh - 一键 git push 脚本
# 用法: ./push.sh [commit message]
# 需要设置环境变量 GITHUB_TOKEN
# 如果有未提交的更改，会先 commit 再 push
# 如果没有参数且没有更改，只执行 push

cd "$(dirname "$0")"

TOKEN="${GITHUB_TOKEN:?请设置环境变量 GITHUB_TOKEN}"
REPO="RestRegular/xinyu"
AUTH_URL="https://RestRegular:${TOKEN}@github.com/${REPO}.git"
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
