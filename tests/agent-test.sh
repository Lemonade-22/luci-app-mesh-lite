#!/bin/sh
# agent-test.sh
#
# mesh-lite-agent 的静态契约测试。
#
# 说明：仓库里没有 ucode 运行时，无法在本机执行守护进程，因此这里校验的是
# 契约里「可以静态证明」的部分：
#   - 只读：源码中不出现任何 UCI 写操作 / 无线重载 / 文件写入
#   - 无凭据：不出现密码、不调用 ssh
#   - 接口与常量：三个 ubus 方法、protocol、版本标记路径
#   - 打包：init 脚本语法、procd 配置、UCI 默认项、依赖不含 LuCI
#
# 用法：sh tests/agent-test.sh

set -u

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT="$SELF_DIR/.."
AGENT="$ROOT/mesh-lite-agent/root/usr/bin/mesh-lite-agent"
INIT="$ROOT/mesh-lite-agent/root/etc/init.d/mesh-lite-agent"
CONF="$ROOT/mesh-lite-agent/root/etc/config/mesh-lite-agent"
MK="$ROOT/mesh-lite-agent/Makefile"

FAIL=0

check() {
	local desc="$1" expect="$2" got="$3"

	if [ "$expect" = "$got" ]; then
		echo "PASS  $desc"
	else
		echo "FAIL  $desc"
		echo "      expected: $expect"
		echo "      actual  : $got"
		FAIL=1
	fi
}

contains() {
	local desc="$1" needle="$2" haystack="$3"

	case "$haystack" in
		*"$needle"*) echo "PASS  $desc" ;;
		*)
			echo "FAIL  $desc"
			echo "      missing: $needle"
			FAIL=1
			;;
	esac
}

forbids() {
	local desc="$1" needle="$2" haystack="$3"

	case "$haystack" in
		*"$needle"*)
			echo "FAIL  $desc"
			echo "      forbidden pattern present: $needle"
			FAIL=1
			;;
		*) echo "PASS  $desc" ;;
	esac
}

check "agent: 文件存在" "1" "$([ -f "$AGENT" ] && echo 1 || echo 0)"
check "init: 文件存在" "1" "$([ -f "$INIT" ] && echo 1 || echo 0)"
check "config: 文件存在" "1" "$([ -f "$CONF" ] && echo 1 || echo 0)"

SRC="$(cat "$AGENT")"

# ------------------------------------------------------------ 基本形态 ----
contains "agent: ucode shebang" "#!/usr/bin/ucode" "$(head -n1 "$AGENT")"
contains "agent: 声明 ubus 对象" 'publish("mesh-lite-agent"' "$SRC"
contains "agent: status 方法" "status:" "$SRC"
contains "agent: clients 方法" "clients:" "$SRC"
contains "agent: hostapd_config 方法" "hostapd_config:" "$SRC"
contains "agent: 协议版本常量" "const PROTOCOL = 1;" "$SRC"
contains "agent: 版本标记同源" 'const VER_FILE = "/etc/mesh-lite.ver";' "$SRC"
contains "agent: 声明只读约束" "read-only" "$SRC"

# ---------------------------------------------------------------- 只读 ----
forbids "agent: 不写 UCI（set）" "uci set" "$SRC"
forbids "agent: 不写 UCI（commit）" "uci commit" "$SRC"
forbids "agent: 不写 UCI（delete）" "uci delete" "$SRC"
forbids "agent: 不调用 cursor 写方法" "c.set(" "$SRC"
forbids "agent: 不调用 cursor 提交" "c.commit(" "$SRC"
forbids "agent: 不重载无线" "wifi reload" "$SRC"
forbids "agent: 不调用 hostapd_cli 写操作" "hostapd_cli" "$SRC"
forbids "agent: 不写文件" "writefile" "$SRC"
forbids "agent: 不改接口状态" "ip link set" "$SRC"
forbids "agent: 不调 ubus 写方法" "bss_transition_request" "$SRC"

# -------------------------------------------------------------- 无凭据 ----
# 注意：ft_psk_generate_local 是 hostapd 的配置项名，属于要读的公开配置，
# 因此这里禁止的是「凭据值」与「密钥字段」，而不是 psk 这个子串。
forbids "agent: 不含 password 字样" "password" "$SRC"
forbids "agent: 不含 WPA 口令值" "wpa-psk" "$SRC"
forbids "agent: 不读取密钥字段" '\.key' "$SRC"
forbids "agent: 不调用 ssh" "ssh " "$SRC"
forbids "agent: 不含 dropbear" "dropbear" "$SRC"

# ---------------------------------------------------------------- 打包 ----
sh -n "$INIT" 2>/dev/null
check "init: 语法有效" "0" "$?"
contains "init: 使用 procd" "procd_open_instance" "$(cat "$INIT")"
contains "init: 默认随包启动" "command /usr/bin/mesh-lite-agent" "$(cat "$INIT")"
check "init: 语法检查不报错" "0" "$(sh -n "$INIT" >/dev/null 2>&1; echo $?)"

contains "config: 默认启用" "option enabled '1'" "$(cat "$CONF")"

MKSRC="$(cat "$MK")"
contains "Makefile: 声明 ucode 依赖" "DEPENDS:=+ucode" "$MKSRC"
contains "Makefile: 声明 ubus 模块" "ucode-mod-ubus" "$MKSRC"
contains "Makefile: 架构无关" "PKGARCH:=all" "$MKSRC"
forbids "Makefile: 不依赖 LuCI" "luci-base" "$MKSRC"
forbids "Makefile: 不依赖 rpcd" "+rpcd" "$MKSRC"

# --------------------------------------------------------- 大括号平衡 ----
OPEN=$(printf '%s' "$SRC" | tr -cd '{' | wc -c | tr -d ' ')
CLOSE=$(printf '%s' "$SRC" | tr -cd '}' | wc -c | tr -d ' ')
check "agent: 大括号平衡" "$OPEN" "$CLOSE"

if [ "$FAIL" -eq 0 ]; then
	echo "全部通过"
else
	echo "存在失败项"
fi

exit "$FAIL"
