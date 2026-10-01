#!/bin/bash
# 课堂互动平台 · 管理台（Mac 双击入口）
# 切到本文件所在目录 → 找 Node（vendor/node 便携版 → 系统 node；都没有或第一个数字 < 22 → 问一句，回车自动下载到 vendor/node）
#   → 依赖没装好则 npm install（失败换国内源 npmmirror 再试一次）→ npm run manage
#   便携 Node：国内镜像 → 官方，按同一来源的 SHASUMS256.txt 校验；不改系统、不要管理员权限、不写系统 PATH
#   EDU_LAUNCHER_DRY_RUN=1：找到 / 装好 Node 后打印版本就退出（实测用）
#   "装好了" = node_modules/.package-lock.json 在（npm 装完才写）且 better-sqlite3 的二进制在（二进制没到位就重装）
#   不写 .npmrc：国内源只在重试这一次用，境外用户不会被强制走镜像
#   管理台退出码 75（平台已更新，管理台更新规格 §4）→ 重新判断"装好了"再启动管理台，最多 3 次；
#   设 EDU_LAUNCHER=1：管理台据此知道由入口脚本启动（75 时不再打印"请重新运行 npm run manage"）
#   更新会覆盖本文件：bash 读的是打开时的旧文件（旧 inode），不受影响（.bat 另做了自我复制）
# 本窗口开着平台就开着；关闭本窗口即关闭管理台和平台
cd "$(dirname "$0")" || exit 1
printf '\033]0;课堂互动平台\007'
# 双击启动时 PATH 可能不含常见安装位置
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
export EDU_LAUNCHER=1

NODE_VERSION=24.21.0
NODE_TMP="vendor/node-download.tmp"
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

manual_node() {
  echo "请先安装 Node.js 22 或 24：https://nodejs.org/zh-cn"
  echo "国内下载更快：https://npmmirror.com/mirrors/node/ （进 v22 或 v24 开头的最新文件夹，下载 .pkg 安装包）"
  echo "安装完成后，再双击本文件。"
  pause_exit 1
}

# $1 能跑且 -v 的第一个数字 ≥ 22
node_ok() {
  local v
  v=$("$1" -v 2>/dev/null) || return 1
  v=${v#v}
  v=${v%%.*}
  [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 22 ]
}

use_vendor_node() {
  [ -x vendor/node/bin/node ] && node_ok vendor/node/bin/node || return 1
  export PATH="$PWD/vendor/node/bin:$PATH"
}

# 下载 → 校验（同一来源的 SHASUMS256.txt）→ 解压到 vendor/node；国内镜像不行换官方
install_node() {
  local plat file base want got first=1
  case "$(uname -m)" in
    arm64) plat=darwin-arm64 ;;
    *) plat=darwin-x64 ;;
  esac
  file="node-v$NODE_VERSION-$plat.tar.gz"
  mkdir -p vendor
  for base in "https://npmmirror.com/mirrors/node/v$NODE_VERSION" "https://nodejs.org/dist/v$NODE_VERSION"; do
    if [ "$first" = 1 ]; then echo "正在从国内镜像下载 Node.js…"; else echo "换官方地址再试一次…"; fi
    first=0
    rm -f "$NODE_TMP"
    if curl -fL --retry 2 -# -o "$NODE_TMP" "$base/$file"; then
      want=$(curl -fsL --retry 2 "$base/SHASUMS256.txt" | awk -v f="$file" '$2 == f { print $1 }')
      got=$(shasum -a 256 "$NODE_TMP" | awk '{ print $1 }')
      if [ -n "$want" ] && [ "$want" = "$got" ]; then
        echo "校验通过，正在解压…"
        rm -rf vendor/node
        mkdir -p vendor/node
        if tar -xzf "$NODE_TMP" -C vendor/node --strip-components=1; then
          rm -f "$NODE_TMP"
          return 0
        fi
        rm -rf vendor/node
      else
        echo "下载的文件校验没通过。"
      fi
    fi
    rm -f "$NODE_TMP"
  done
  return 1
}

# 上次下载中途失败留下的临时文件
rm -f "$NODE_TMP"

# 找 Node：便携版 → 系统的（第一个数字 ≥ 22）→ 问一句，自动装到 vendor/node
if ! use_vendor_node && ! { command -v node >/dev/null 2>&1 && node_ok node; }; then
  echo "这台电脑还没有平台要用的基础软件 Node.js（或版本太旧）。"
  echo "按回车自动下载安装（约 50 MB，装在平台文件夹里，不改动系统）；"
  echo "不想自动装就输入 n 回车，然后自己到 https://nodejs.org/zh-cn 安装后再双击本文件。"
  answer=""
  read -r answer
  case "$answer" in
    "" | y | Y) ;;
    *) manual_node ;;
  esac
  if ! install_node || ! use_vendor_node; then
    echo ""
    echo "下载失败。"
    manual_node
  fi
  vendor/node/bin/node -v
  echo "Node.js 已装到平台文件夹，以后双击本文件直接用"
fi

if [ "$EDU_LAUNCHER_DRY_RUN" = "1" ]; then
  node -v
  exit 0
fi

# 没装好就装（第一次使用，或平台更新后依赖有变化：更新会删掉 node_modules/.package-lock.json）
ensure_installed() {
  installed && return 0
  # better-sqlite3 装了但二进制没到位：删掉它，让 npm install 重新装并重新取二进制
  if [ -f node_modules/better-sqlite3/package.json ] && [ ! -f "$SQLITE_BIN" ]; then
    rm -rf node_modules/better-sqlite3
  fi
  if [ "$restarts" -gt 0 ]; then
    echo "平台已更新，正在重新安装依赖…"
  else
    echo "第一次使用，正在安装依赖（需要联网，约几分钟）…"
  fi
  if ! npm install; then
    echo ""
    echo "换国内源再试一次…"
    if ! npm_config_registry="$MIRROR_REGISTRY" npm_config_better_sqlite3_binary_host_mirror="$MIRROR_SQLITE" npm install; then
      echo ""
      echo "安装失败：请检查网络，或让同事把整个 node_modules 文件夹拷给你（放进本文件夹）后再双击本文件。"
      pause_exit 1
    fi
  fi
}

# 管理台以退出码 75 退出 = 平台刚更新完：重新判断"装好了"、再启动管理台；最多重启 3 次（防止反复 75）
restarts=0
while :; do
  ensure_installed
  npm run manage
  code=$?
  if [ "$code" -eq 75 ] && [ "$restarts" -lt 3 ]; then
    restarts=$((restarts + 1))
    echo ""
    echo "平台已更新，正在重新启动管理台…"
    continue
  fi
  break
done
if [ "$code" -ne 0 ]; then
  echo ""
  echo "管理台已退出（上面是出错信息）。"
  pause_exit "$code"
fi
