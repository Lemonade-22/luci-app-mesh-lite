#!/bin/sh
# po-test.sh
#
# 校验所有前端字符串都有翻译条目：新增 UI 文案忘记补 po 时，中文界面会掉回英文。
# 没有 python3 时跳过（本机开发环境与 CI 都有，OpenWrt 设备上不需要跑）。

set -u

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT="$SELF_DIR/.."

if command -v python3 >/dev/null 2>&1; then
	PY=python3
elif command -v python >/dev/null 2>&1; then
	PY=python
else
	echo "SKIP  python not available"
	exit 0
fi

FAIL=0
GLOB="$ROOT/luci-app-mesh-lite/htdocs/luci-static/resources/view/mesh-lite/*.js"

for po in \
	"$ROOT/luci-app-mesh-lite/po/zh_Hans/luci-app-mesh-lite.po" \
	"$ROOT/luci-app-mesh-lite/po/templates/luci-app-mesh-lite.pot"
do
	out="$("$PY" "$ROOT/Scripts/po-audit.py" "$po" "$GLOB")"
	missing="$(printf '%s\n' "$out" | sed -n 's/.*missing: \([0-9][0-9]*\)$/\1/p' | head -n1)"

	if [ "${missing:-1}" = "0" ]; then
		echo "PASS  $(basename "$po"): 所有前端字符串都有条目"
	else
		echo "FAIL  $(basename "$po"): 缺 ${missing:-?} 条"
		printf '%s\n' "$out" | grep 'MISS'
		FAIL=1
	fi
done

# 译文条目不应为空（空 msgstr 等于没翻译；pot 例外，它的 msgstr 本来为空）。
PO="$ROOT/luci-app-mesh-lite/po/zh_Hans/luci-app-mesh-lite.po"
empty="$(awk '/^msgid "/ { id=$0 } /^msgstr ""$/ { if (id != "msgid \"\"") n++ } END { print n+0 }' "$PO")"
if [ "$empty" -eq 0 ]; then
	echo "PASS  zh_Hans: 无空译文"
else
	echo "FAIL  zh_Hans: $empty 条 msgstr 为空"
	FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
	echo "全部通过"
else
	echo "存在失败项"
fi

exit "$FAIL"
