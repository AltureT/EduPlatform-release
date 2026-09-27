#!/bin/bash
# 课堂互动平台 · 管理台（Mac 双击入口）
# 切到本文件所在目录 → 检查 node → 依赖没装好则 npm install（失败换国内源 npmmirror 再试一次）→ npm run manage
#   "装好了" = node_modules/.package-lock.json 在（npm 装完才写）且 better-sqlite3 的二进制在（二进制没到位就重装）
#   不写 .npmrc：国内源只在重试这一次用，境外用户不会被强制走镜像
# 本窗口开着平台就开着；关闭本窗口即关闭管理台和平台
cd "$(dirname "$0")" || exit 1
printf '\033]0;课堂互动平台\007'
# 双击启动时 PATH 可能不含常见安装位置
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

MIRROR_REGISTRY="https://registry.npmmirror.com"
MIRROR_SQLITE="https://registry.npmmirror.com/-/binary/better-sqlite3"
SQLITE_BIN="node_modules/better-sqlite3/build/Release/better_sqlite3.node"

pause_exit() {
  echo ""
  read -n 1 -s -r -p "按任意键关闭本窗口…"
  echo ""
  exit "${1:-1}"
}

installed() {
  [ -f node_modules/.package-lock.json ] && [ -f "$SQLITE_BIN" ]
}

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 或 24：https://nodejs.org/zh-cn"
  echo "国内下载更快：https://npmmirror.com/mirrors/node/ （进 v22 或 v24 开头的最新文件夹，下载 .pkg 安装包）"
  echo "安装完成后，再双击本文件。"
  pause_exit 1
fi

if ! installed; then
  # better-sqlite3 装了但二进制没到位：删掉它，让 npm install 重新装并重新取二进制
  if [ -f node_modules/better-sqlite3/package.json ] && [ ! -f "$SQLITE_BIN" ]; then
    rm -rf node_modules/better-sqlite3
  fi
  echo "第一次使用，正在安装依赖（需要联网，约几分钟）…"
  if ! npm install; then
    echo ""
    echo "换国内源再试一次…"
    if ! npm_config_registry="$MIRROR_REGISTRY" npm_config_better_sqlite3_binary_host_mirror="$MIRROR_SQLITE" npm install; then
      echo ""
      echo "安装失败：请检查网络，或让同事把整个 node_modules 文件夹拷给你（放进本文件夹）后再双击本文件。"
      pause_exit 1
    fi
  fi
fi

npm run manage
code=$?
if [ "$code" -ne 0 ]; then
  echo ""
  echo "管理台已退出（上面是出错信息）。"
  pause_exit "$code"
fi
