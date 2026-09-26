#!/bin/bash
# 课堂互动平台 · 管理台（Mac 双击入口）
# 切到本文件所在目录 → 检查 node → 缺 node_modules 则 npm install → npm run manage
# 本窗口开着平台就开着；关闭本窗口即关闭管理台和平台
cd "$(dirname "$0")" || exit 1
printf '\033]0;课堂互动平台\007'
# 双击启动时 PATH 可能不含常见安装位置
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

pause_exit() {
  echo ""
  read -n 1 -s -r -p "按任意键关闭本窗口…"
  echo ""
  exit "${1:-1}"
}

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 或 24：https://nodejs.org/zh-cn"
  echo "安装完成后，再双击本文件。"
  pause_exit 1
fi

if [ ! -d node_modules ]; then
  echo "第一次使用，正在安装依赖（需要联网，约几分钟）…"
  if ! npm install; then
    echo ""
    echo "安装失败，请检查网络后重新双击本文件。"
    pause_exit 1
  fi
fi

npm run manage
code=$?
if [ "$code" -ne 0 ]; then
  echo ""
  echo "管理台已退出（上面是出错信息）。"
  pause_exit "$code"
fi
