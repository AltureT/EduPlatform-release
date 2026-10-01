#!/bin/bash
# 入口脚本写排障文件（Mac；排障文件与 AI 排障规格 §1.3 §1.4 §2）。班迹工作台.command 出错时调用：
#   bash scripts/launcher-diag.sh <install|node|manage> "<一句话>" ["<详情>"]
#   install → 环节"安装依赖"（附最新一份 npm 调试日志 ~/.npm/_logs 的最后 80 行）
#   node    → 环节"启动入口"（找 Node：老师没选自动下载，或下载失败）
#   manage  → 环节"启动入口"（工作台退出码不是 0 / 75 / 76）
#   也接受直接写中文环节名（安装依赖 / 启动入口）
# 写到平台文件夹顶层 排障/<yyyy-MM-dd>-<HHmmss>-<环节>.md，只留最近 20 份（-反馈.md 不算不删）；
#   写完打印"排障文件已写到 排障/<文件名>，把它发给 AI 工具就能排查"。任何失败都不报错退出（排障不能把入口搞挂）。
# 脱敏：.env 敏感键（名字含 PASSWORD / KEY / TOKEN / SECRET）只写"（已填）/（空）"；附上的记录里这些值、t=<凭据>、Bearer …、sk-…（≥ 8 位）换成 ***
# 平台问题的反馈去向（排障手册）：https://github.com/AltureT/EduPlatform-release/issues 、https://gitee.com/alture/EduPlatform-release/issues

cd "$(dirname "$0")/.." 2>/dev/null || exit 0

STAGE_ARG="$1"
MESSAGE="${2:-（无）}"
DETAIL="${3:-}"

case "$STAGE_ARG" in
  install | 安装依赖) STAGE="安装依赖"; PHASE="npm install"; WITH_NPM=1 ;;
  node) STAGE="启动入口"; PHASE="找 Node"; WITH_NPM=0 ;;
  manage) STAGE="启动入口"; PHASE="工作台退出"; WITH_NPM=0 ;;
  *) STAGE="启动入口"; PHASE="入口脚本"; WITH_NPM=0 ;;
esac

NOW_FILE=$(date +%Y-%m-%d-%H%M%S)
NOW_TEXT=$(date '+%Y-%m-%d %H:%M:%S')
DIR="排障"
NAME="$NOW_FILE-$STAGE.md"

# awk 片段：去掉行尾 \r 与首尾空白；值被同一种引号（" ' `）包着就去掉引号（工作台 env-file.js 写含空格、#、引号的值时会加）
AWK_UNQ='function unq(v,  q) {
  sub(/\r$/, "", v); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
  q = substr(v, 1, 1)
  if (length(v) >= 2 && (q == "\"" || q == "'"'"'" || q == "`") && substr(v, length(v), 1) == q) v = substr(v, 2, length(v) - 2)
  return v
}'

# .env 里敏感键的值（每行一个，供脱敏）；短于 3 个字符的不做全局替换（免得把记录里所有同样的字符换掉，与 diagnosis.js 一致）
secret_values() {
  [ -f .env ] || return 0
  awk -F= "$AWK_UNQ"'
    /^[A-Za-z_][A-Za-z0-9_]*=/ { k = $1; v = unq(substr($0, length(k) + 2)); if (k ~ /PASSWORD|KEY|TOKEN|SECRET/ && length(v) >= 3) print v }' .env
}

# 标准输入 → 脱敏后的标准输出
redact() {
  local secrets
  secrets=$(secret_values)
  SECRETS="$secrets" awk '
    BEGIN { n = split(ENVIRON["SECRETS"], s, "\n") }
    {
      line = $0
      for (i = 1; i <= n; i++) {
        if (s[i] == "") continue
        out = ""
        while ((p = index(line, s[i])) > 0) { out = out substr(line, 1, p - 1) "***"; line = substr(line, p + length(s[i])) }
        line = out line
      }
      print line
    }' | sed -E \
      -e 's/([?&])t=[^&[:space:]]+/\1t=***/g' \
      -e 's/Bearer [A-Za-z0-9._~+\/=-]+/Bearer ***/g' \
      -e 's/sk-[A-Za-z0-9_-]{8,}/***/g'
}

env_line() {
  [ -f .env ] || { echo "（没有 .env）"; return; }
  awk -F= "$AWK_UNQ"'
    /^[A-Za-z_][A-Za-z0-9_]*=/ {
      k = $1; v = unq(substr($0, length(k) + 2))
      if (k ~ /PASSWORD|KEY|TOKEN|SECRET/) v = (length(v) > 0 ? "（已填）" : "（空）")
      out = out (out == "" ? "" : "；") k "=" v
    }
    END { print (out == "" ? "（空）" : out) }' .env
}

version_text() {
  if [ -f 版本.json ]; then
    local v
    v=$(sed -n -E 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' 版本.json | head -n 1)
    echo "${v:-未知}"
  else
    echo "开发仓库"
  fi
}

node_text() {
  local p v
  p=$(command -v node 2>/dev/null)
  if [ -z "$p" ]; then echo "Node 未找到"; return; fi
  v=$(node -v 2>/dev/null)
  case "$p" in
    "$PWD"/vendor/node/*) echo "Node ${v:-未知}（vendor/node 便携版）" ;;
    *) echo "Node ${v:-未知}（系统）" ;;
  esac
}

npm_text() {
  local v=""
  command -v npm >/dev/null 2>&1 && v=$(npm -v 2>/dev/null | tail -n 1)
  echo "npm ${v:-未知}"
}

folder_text() {
  local logical real note=""
  logical=$(pwd -L)
  real=$(pwd -P)
  case "$real" in /Volumes/* | //*) note="（网络盘或外接盘）" ;; esac
  case "$logical" in /Volumes/* | //*) note="（网络盘或外接盘）" ;; esac
  if [ "$real" = "$logical" ]; then real="同上"; fi
  echo "$logical；真实路径：$real$note"
}

disk_text() {
  local kb
  kb=$(df -k . 2>/dev/null | awk 'NR == 2 { print $4 }')
  if [[ "$kb" =~ ^[0-9]+$ ]]; then echo "$((kb / 1024)) MB"; else echo "未知"; fi
}

lesson_text() {
  local l=""
  [ -f .env ] && l=$(sed -n -E 's/^LESSON_CONFIG=(.*)$/\1/p' .env | tail -n 1)
  echo "${l:-（还没有课程）}"
}

latest_npm_log() {
  ls -t "$HOME"/.npm/_logs/*.log 2>/dev/null | head -n 1
}

section() {
  echo ""
  echo "### $1"
  echo ""
  echo '```'
  cat
  echo '```'
}

render() {
  echo "# 排障：$STAGE · $NOW_TEXT"
  echo ""
  echo "> 给 AI 工具：这是班迹工作台自动写的排障文件。请先读 docs/排障手册.md，按它判断是环境、课程还是平台问题，再处理。"
  echo ""
  echo "## 发生了什么"
  echo "- 环节：$STAGE（$PHASE）"
  echo "- 一句话：$MESSAGE"
  if [ -n "$DETAIL" ]; then
    echo "- 详情：$DETAIL" | redact
  else
    echo "- 详情：（无）"
  fi
  echo ""
  echo "## 环境"
  echo "- 班迹版本：$(version_text)；平台文件被改过：没查"
  echo "- 系统：$(uname -s) $(uname -r) $(uname -m)；$(node_text)；$(npm_text)"
  echo "- 平台文件夹：$(folder_text)"
  echo "- 磁盘可用：$(disk_text)"
  echo "- 当前课程：$(lesson_text)"
  echo "- .env：$(env_line)"
  echo "- 工作台：没启动（入口脚本写的）"
  echo ""
  echo "## 最近记录"
  if [ -f data/logs/launcher.log ]; then
    tail -n 60 data/logs/launcher.log | redact | section "入口脚本记录（data/logs/launcher.log 最后 60 行）"
  else
    echo "（还没有入口脚本记录）" | section "入口脚本记录（data/logs/launcher.log 最后 60 行）"
  fi
  if [ "$WITH_NPM" = 1 ]; then
    local npmlog
    npmlog=$(latest_npm_log)
    if [ -n "$npmlog" ]; then
      { echo "（$npmlog）"; tail -n 80 "$npmlog"; } | redact | section "npm 记录（最新一份 npm 调试日志的最后 80 行）"
    else
      echo "（没找到 npm 调试日志）" | section "npm 记录（最新一份 npm 调试日志的最后 80 行）"
    fi
  fi
}

# 只留最近 20 份（按文件名排序，-反馈.md 不算不删）
prune() {
  local list count
  list=$(ls -1 "$DIR" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-.+\.md$' | grep -v -- '-反馈\.md$' | sort)
  count=$(printf '%s\n' "$list" | grep -c .)
  if [ "$count" -gt 20 ]; then
    printf '%s\n' "$list" | head -n $((count - 20)) | while IFS= read -r f; do rm -f "$DIR/$f"; done
  fi
}

mkdir -p "$DIR" 2>/dev/null || exit 0
[ -d "$DIR" ] || exit 0
if render > "$DIR/$NAME.tmp" 2>/dev/null && mv -f "$DIR/$NAME.tmp" "$DIR/$NAME" 2>/dev/null; then
  prune
  echo ""
  echo "排障文件已写到 排障/$NAME，把它发给 AI 工具就能排查"
else
  rm -f "$DIR/$NAME.tmp" 2>/dev/null
fi
exit 0
