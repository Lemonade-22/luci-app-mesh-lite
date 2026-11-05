#!/bin/sh
# helpers-test.sh
#
# 本地测试：不依赖 OpenWrt 设备。
# 覆盖 rpcd 插件的纯 shell 逻辑：密钥解析、包管理器探测、wpad 判定、
# 无线运行态回读、密钥生成。
#
# 用法：sh tests/helpers-test.sh

set -u

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
PLUGIN="$SELF_DIR/../luci-app-mesh-lite/root/usr/libexec/rpcd/mesh-lite"
JSHN_STUB="$SELF_DIR/stub/jshn.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

mkdir -p "$TMP/bin" "$TMP/dropbear" "$TMP/hostapd"
KEYFILE="$TMP/dropbear/id_ed25519"
: > "$KEYFILE"
: > "$TMP/hostapd/wlan0"
: > "$TMP/hostapd/wlan1"

# ---- 命令桩 ----
cat > "$TMP/bin/dropbearkey" <<'STUB'
#!/bin/sh
case "$1" in
	-y)
		echo "Public key portion is:"
		echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYONLY root@test"
		echo "Fingerprint: SHA256:abcdefghijklmnop"
		;;
	-t)
		# dropbearkey -t ed25519 -f <file>
		touch "$4"
		;;
esac
STUB

cat > "$TMP/bin/opkg" <<'STUB'
#!/bin/sh
[ "$1" = "list-installed" ] || exit 1
cat <<'LIST'
wpad-openssl - 2024.01
dropbear - 2022.83
sshpass - 1.09
LIST
STUB

cat > "$TMP/bin/wifi" <<'STUB'
#!/bin/sh
exit 0
STUB

cat > "$TMP/bin/timeout" <<'STUB'
#!/bin/sh
echo "$1" >> "$TEST_TMP/timeout.log"
shift
exec "$@"
STUB

cat > "$TMP/bin/ssh" <<'STUB'
#!/bin/sh
echo "ssh-called" > "$TEST_TMP/ssh.log"
[ "${TEST_FAIL_SSH:-0}" = "1" ] && exit 1
echo "stub-host"
exit 0
STUB

cat > "$TMP/bin/sshpass" <<'STUB'
#!/bin/sh
# 记录参数与环境变量，用于验证密码没有出现在命令行里。
echo "$*" > "$TEST_TMP/sshpass-args.log"
printf '%s' "${SSHPASS:-}" > "$TEST_TMP/sshpass-env.log"
echo "pass-host"
exit 0
STUB

cp "$SELF_DIR/stub/hostapd_cli" "$TMP/bin/hostapd_cli"
cp "$SELF_DIR/stub/uci" "$TMP/bin/uci"
cp "$SELF_DIR/stub/iwinfo" "$TMP/bin/iwinfo"

chmod +x "$TMP/bin/dropbearkey" "$TMP/bin/opkg" "$TMP/bin/wifi" \
	"$TMP/bin/hostapd_cli" "$TMP/bin/uci" "$TMP/bin/iwinfo" \
	"$TMP/bin/timeout" "$TMP/bin/ssh" "$TMP/bin/sshpass"

PATH="$TMP/bin:$PATH"
export PATH
MESH_LITE_KEY="$KEYFILE"
MESH_LITE_JSHN="$JSHN_STUB"
MESH_LITE_HOSTAPD_DIR="$TMP/hostapd"
MESH_LITE_SECRETS_DIR="$TMP/secrets"
MESH_LITE_LIB_ONLY=1
TEST_TMP="$TMP"
export MESH_LITE_KEY MESH_LITE_JSHN MESH_LITE_HOSTAPD_DIR MESH_LITE_SECRETS_DIR MESH_LITE_LIB_ONLY TEST_TMP

# shellcheck disable=SC1090
. "$PLUGIN"

FAIL=0

check() {
	desc="$1"; expect="$2"; got="$3"
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
	desc="$1"; needle="$2"; haystack="$3"
	case "$haystack" in
		*"$needle"*) echo "PASS  $desc" ;;
		*)
			echo "FAIL  $desc"
			echo "      missing: $needle"
			echo "      in     : $haystack"
			FAIL=1
			;;
	esac
}

# ---------------------------------------------------------------- helpers ----
check "key_pub 提取公钥行" \
	"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYONLY root@test" \
	"$(key_pub)"

check "key_fp 提取指纹" "SHA256:abcdefghijklmnop" "$(key_fp)"

PKG_CACHE=$(pkg_raw)
check "pkg_cache 收集已安装包" "3" "$(printf '%s\n' "$PKG_CACHE" | wc -l | tr -d ' ')"

check "wpad_list 列出 wpad 包" "wpad-openssl " "$(wpad_list)"

has_full_wpad && R=1 || R=0
check "has_full_wpad 识别满血 wpad" "1" "$R"

has_pkg sshpass && R=1 || R=0
check "has_pkg 识别 sshpass" "1" "$R"

has_pkg wpad-basic && R=1 || R=0
check "has_pkg 对未安装包返回假" "0" "$R"

detect_firewall >/dev/null 2>&1
check "detect_firewall 有返回值" "1" "$([ -n "$(detect_firewall)" ] && echo 1 || echo 0)"

# ------------------------------------------------------------- 射频信息 ----
RADIO="$(do_radio_info)"
contains "radio_info: 2.4G 当前功率" '"cur_txpower":"20"' "$RADIO"
contains "radio_info: 5G 当前信道" '"cur_channel":"36"' "$RADIO"
contains "radio_info: 5G 当前功率" '"cur_txpower":"23"' "$RADIO"
contains "radio_info: 未配置功率" '"uci_txpower":""' "$RADIO"
check "radio_info: 射频数量" "2" "$(printf '%s' "$RADIO" | grep -o '"name"' | wc -l | tr -d ' ')"

# ------------------------------------------------------------- 无线回读 ----
VERIFY="$(do_verify_wireless)"
contains "verify: 读到 wlan0" '"ifname":"wlan0"' "$VERIFY"
contains "verify: 读到 SSID" '"ssid":"Home"' "$VERIFY"
contains "verify: 读到移动域" '"md":"a1b2"' "$VERIFY"
contains "verify: 802.11r 状态" '"r":"1"' "$VERIFY"
contains "verify: wlan1 未开 r" '"r":"0"' "$VERIFY"
check "verify: 接口数量" "2" "$(printf '%s' "$VERIFY" | grep -o '"ifname"' | wc -l | tr -d ' ')"

# --------------------------------------------------------------- 密钥生成 ---
rm -f "$KEYFILE"
GEN1="$(do_genkey)"
contains "genkey: 首次生成 ok" '"ok":true' "$GEN1"
contains "genkey: 首次 created=true" '"created":true' "$GEN1"
contains "genkey: 返回公钥" 'ssh-ed25519' "$GEN1"
check "genkey: 私钥文件已创建" "1" "$([ -f "$KEYFILE" ] && echo 1 || echo 0)"

GEN2="$(do_genkey)"
contains "genkey: 二次调用 created=false" '"created":false' "$GEN2"

# --------------------------------------------------------------- 凭据存储 ---
SECRETS_FILE="$MESH_LITE_SECRETS_DIR/secrets"

secret_store 192.168.1.21 root 'pw1'
check "secret_store 写入" "$(printf 'root\tpw1')" "$(secret_lookup 192.168.1.21)"

secret_store 192.168.1.21 root 'pw2'
check "secret_store 覆盖同 IP" "$(printf 'root\tpw2')" "$(secret_lookup 192.168.1.21)"
check "secret_store 不产生重复行" "1" "$(grep -c '192.168.1.21' "$SECRETS_FILE")"

secret_store 192.168.1.22 admin 'pw3'
check "secret_store 支持多台" "2" "$(grep -c . "$SECRETS_FILE")"

secret_remove 192.168.1.21
check "secret_remove 删除条目" "" "$(secret_lookup 192.168.1.21)"
check "secret_remove 保留其他条目" "1" "$(grep -c . "$SECRETS_FILE")"

PROBE="$(do_auth_probe)"
contains "auth_probe: 缺 IP 时报错" '"missing ip"' "$PROBE"

PUSH="$(do_auth_push)"
contains "auth_push: 缺 IP 时报错" '"missing ip"' "$PUSH"

VERIFY="$(do_auth_verify)"
contains "auth_verify: 缺 IP 时返回失败" '"ok":false' "$VERIFY"

FORGET="$(do_auth_forget)"
contains "auth_forget: 空 IP 也返回成功" '"ok":true' "$FORGET"

HARDEN="$(do_harden)"
contains "harden: 缺 IP 时报错" '"missing ip"' "$HARDEN"

# ------------------------------------------------------------- SSH 超时 ----
SSH_OUT="$(ssh_key_run 192.168.1.21 root true)"
check "ssh_key_run 返回远端输出" "stub-host" "$SSH_OUT"
check "ssh 被调用" "1" "$([ -f "$TMP/ssh.log" ] && echo 1 || echo 0)"
check "timeout 使用默认 10 秒" "10" "$(head -n1 "$TMP/timeout.log" 2>/dev/null)"

# ------------------------------------------------------- SSH 凭据兜底 ----
check "ssh_cred_run: 密钥可用时直连" "stub-host" "$(ssh_cred_run 192.168.1.21 root true)"

secret_store 192.168.1.30 root 'pw9'
check "ssh_cred_run: 密钥失败时用已存凭据" "pass-host" \
	"$(TEST_FAIL_SSH=1 ssh_cred_run 192.168.1.30 root true)"

contains "sshpass: 走 -e 而不是 -p" "-e ssh" "$(cat "$TMP/sshpass-args.log" 2>/dev/null)"
check "sshpass: 命令行不含明文密码" "0" \
	"$(grep -c 'pw9' "$TMP/sshpass-args.log" 2>/dev/null || true)"
check "sshpass: 密码经环境变量传递" "pw9" "$(cat "$TMP/sshpass-env.log" 2>/dev/null)"

# --------------------------------------------------------------- 下发脚本 ---
PAYLOAD="$(build_apply_payload 'a1b2' 3)"

printf '%s' "$PAYLOAD" | sh -n 2>/dev/null
check "payload: 语法有效" "0" "$?"

contains "payload: MD 走 base64" "md=\$(echo 'YTFiMg==' | base64 -d)" "$PAYLOAD"
contains "payload: 版本号已替换" "ver='3'" "$PAYLOAD"
contains "payload: hidden 走 base64 而非硬编码" "hidden=\$(echo 'MA==' | base64 -d)" "$PAYLOAD"
contains "payload: 不再固定写 hidden=0" "uci set wireless.\$s.hidden=\"" "$PAYLOAD"
contains "payload: 成功哨兵" "MESHLITE_OK" "$PAYLOAD"
contains "payload: 失败可回报" "MESHLITE_ERR" "$PAYLOAD"
contains "payload: 写版本标记" "/etc/mesh-lite.ver" "$PAYLOAD"
contains "payload: 2.4G 不开 802.11r" "r2='0'" "$PAYLOAD"
contains "payload: 5G 开 802.11r" "r5='1'" "$PAYLOAD"
contains "payload: 遍历 AP 接口" "=wifi-iface" "$PAYLOAD"
contains "payload: 提交并重载" "uci commit wireless" "$PAYLOAD"

# --------------------------------------------------------------- 巡检采集 ---
POLL_PAYLOAD="$(build_poll_payload)"

printf '%s' "$POLL_PAYLOAD" | sh -n 2>/dev/null
check "poll payload: 语法有效" "0" "$?"

POLL_OUT="$(printf '%s' "$POLL_PAYLOAD" | sh 2>/dev/null)"
contains "poll: 含 HOST 行" "HOST|" "$POLL_OUT"
contains "poll: 含 DEV 行" "DEV|radio0|2g|" "$POLL_OUT"
contains "poll: 含 BSS 行" "BSS|default_radio0|radio0|ap|" "$POLL_OUT"
contains "poll: BSS 含移动域" "|a1b2|" "$POLL_OUT"

SAMPLE="$TMP/poll-sample.txt"
cat > "$SAMPLE" <<'S'
HOST|ap-01
UPTIME|100
VER|7
AGENT|0
DEV|radio0|2g|6|6|20|HT20
BSS|default_radio0|radio0|ap|Home|psk2|1|a1b2|1|1|0|1|1
S
PARSED="$(parse_poll_output "$SAMPLE" 192.168.1.21)"
contains "parse: 主机名" '"hostname":"ap-01"' "$PARSED"
contains "parse: 接口 SSID" '"ssid":"Home"' "$PARSED"
contains "parse: 移动域" '"md":"a1b2"' "$PARSED"
contains "parse: 射频当前信道" '"cur_channel":"6"' "$PARSED"
contains "parse: 密码字段不再丢失" '"key":"1"' "$PARSED"
contains "parse: hidden 不再错位" '"hidden":"0"' "$PARSED"
contains "parse: FT over DS 字段" '"ds":"1"' "$PARSED"
contains "parse: 远端版本号" '"ver":"7"' "$PARSED"
contains "parse: 代理在线标记" '"agent":false' "$PARSED"
check "parse: BSS 数量" "1" "$(printf '%s' "$PARSED" | grep -o '"name"' | wc -l | tr -d ' ')"

# --------------------------------------------------------------- 应用无线 ---
APPLY="$(do_apply_wireless)"
contains "apply_wireless: 返回 ok" '"ok":true' "$APPLY"

NODES="$(do_apply_nodes)"
contains "apply_nodes: 缺 MD 时报错" '"missing mobility_domain"' "$NODES"

if [ "$FAIL" -eq 0 ]; then
	echo "全部通过"
else
	echo "存在失败项"
fi

exit "$FAIL"
