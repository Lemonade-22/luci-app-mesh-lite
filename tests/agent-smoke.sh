#!/bin/bash
# agent-smoke.sh
#
# mesh-lite-agent 的运行时冒烟测试：在真实 ucode + ubusd 上启动 agent，
# 用一个"假 AP"（mock network.wireless / hostapd.get_clients / iw / dhcp.leases）
# 验证契约字段与只读性。
#
# 前置（Linux 或 WSL，需 root）：
#   - 源码编译的 ucode（含 ubus/uloop/fs/uci 模块）位于 /usr/local/bin/ucode
#   - ubusd 位于 /usr/local/sbin/ubusd
#   - agent 脚本位于 /root/mesh-lite-agent
#   构建步骤见 docs/AGENT-CONTRACT.md 9.6。
#
# 用法： sudo bash tests/agent-smoke.sh

set -uo pipefail
FAIL=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAIL=1; }

# ---------- fake AP environment ----------
mkdir -p /var/run/ubus /etc/config /usr/bin
cat > /etc/config/wireless <<'UCI'
config wifi-device 'radio0'
	option band '5g'
	option channel '36'
	option htmode 'VHT80'

config wifi-iface 'default_radio0'
	option device 'radio0'
	option mode 'ap'
	option ssid 'Home'
	option encryption 'psk2'
	option key 'secret123'
	option ieee80211r '1'
	option mobility_domain 'a1b2'
	option ieee80211k '1'
	option bss_transition '1'
	option ft_over_ds '1'
	option ft_psk_generate_local '1'
UCI
cat > /tmp/dhcp.leases <<'L'
1700000000 11:22:33:44:55:66 192.168.1.50 phone.lan *
1700000001 aa:bb:cc:dd:ee:ff 192.168.1.77 laptop.lan *
L
cat > /usr/bin/iw <<'IW'
#!/bin/sh
n=$(cat /tmp/iw-tick 2>/dev/null || echo 0)
n=$((n + 1)); echo "$n" > /tmp/iw-tick
case "$1" in
dev)
	echo "Station 11:22:33:44:55:66 (on phy0-ap0)"
	echo "	rx bytes: $((1000000 + n * 125000))"
	echo "	tx bytes: $((2000000 + n * 50000))"
	echo "Station aa:bb:cc:dd:ee:ff (on phy0-ap0)"
	echo "	rx bytes: $((50000 + n * 1000))"
	echo "	tx bytes: $((80000 + n * 2000))"
	;;
esac
IW
chmod +x /usr/bin/iw

# 假 AP：mock 掉 netifd / hostapd 的 ubus 对象，让 agent 走真实调用路径。
cat > /root/mock-ap.uc <<'MOCK'
#!/usr/bin/ucode
'use strict';
import * as ubus from "ubus";
import * as uloop from "uloop";

let conn = ubus.connect();
if (!conn) { printf("mock: ubus connect failed\n"); exit(1); }

const CLIENTS = {
	"11:22:33:44:55:66": { signal: -58, connected_time: 320, freq: 5180,
	                       rate: { tx: 86670000, rx: 65000000 } },
	"aa:bb:cc:dd:ee:ff": { signal: -74, connected_time: 90, freq: 5180,
	                       rate: { tx: 43330000, rx: 13000000 } }
};

conn.publish("network.wireless", {
	status: { args: {}, call: function() {
		return { "radio0": {
			config: { band: "5g" },
			interfaces: [ { ifname: "phy0-ap0", section: "default_radio0",
			                config: { ssid: "Home", disabled: false } } ]
		} };
	} }
});

conn.publish("network.interface.lan", {
	status: { args: {}, call: function() {
		return { device: "no-such-if", up: true,
		         "ipv4-address": [ { address: "192.168.1.1", mask: 24 } ] };
	} }
});

conn.publish("hostapd.phy0-ap0", {
	get_clients: { args: {}, call: function() { return { clients: CLIENTS, freq: 5180 }; } }
});

uloop.init();
uloop.run();
MOCK
chmod +x /root/mock-ap.uc

# 收敛标记：AC 下发后会写这个文件，agent 必须原样读出来
echo 7 > /etc/mesh-lite.ver

# 只读性基线
BEFORE="$(md5sum /etc/config/wireless | awk '{print $1}')"

pkill -f 'ubusd|mock-ap|mesh-lite-agent' >/dev/null 2>&1 || true
sleep 0.3
/usr/local/sbin/ubusd >/tmp/ubusd.log 2>&1 &
sleep 1
/usr/local/bin/ucode /root/mock-ap.uc >/tmp/mock.log 2>&1 &
sleep 1
/usr/local/bin/ucode /root/mesh-lite-agent >/tmp/agent.log 2>&1 &
sleep 2

echo "== 1. ubus object published =="
ubus list 2>/dev/null | grep -qx 'mesh-lite-agent' && ok "对象 mesh-lite-agent 已发布" || bad "对象未发布"

echo "== 2. status =="
S="$(ubus call mesh-lite-agent status 2>&1)"
echo "$S" | grep -q '"protocol": 1' && ok "protocol=1" || bad "protocol 缺失"
echo "$S" | grep -q '"config_ver": "7"' && ok "config_ver 与 /etc/mesh-lite.ver 一致" || bad "config_ver 不对"
echo "$S" | grep -q '"clients_total": 2' && ok "clients_total=2" || bad "clients_total 不对"
echo "$S" | grep -q '"mac": "[0-9a-f][0-9a-f]:' && ok "mac 已规范化" || bad "mac 异常"

echo "== 3. hostapd_config =="
H="$(ubus call mesh-lite-agent hostapd_config 2>&1)"
echo "$H" | grep -q '"mobility_domain": "a1b2"' && ok "读出 mobility_domain" || bad "移动域缺失"
echo "$H" | grep -q '"ieee80211r": "1"' && ok "读出 ieee80211r" || bad "11r 缺失"
echo "$H" | grep -q '"section": "default_radio0"' && ok "接口与 UCI section 对应" || bad "section 未匹配"

echo "== 4. clients (second sample) =="
sleep 6
C="$(ubus call mesh-lite-agent clients 2>&1)"
echo "$C" | grep -q '"rssi": -58' && ok "信号强度" || bad "信号缺失"
echo "$C" | grep -q '"tx_rate": 866.7' && ok "协商速率换算正确" || bad "协商速率不对"
echo "$C" | grep -q '"hostname": "phone.lan"' && ok "leases 主机名富化" || bad "主机名缺失"
echo "$C" | grep -q '"mac": "aa:bb:cc:dd:ee:ff"' && ok "MAC 统一小写" || bad "MAC 大小写不一致"
SPEED="$(echo "$C" | grep -o '"rx_speed": [0-9.]*' | head -1 | awk '{print $2}')"
if [ -n "${SPEED:-}" ] && [ "${SPEED%.*}" -ge 0 ] && [ "$SPEED" != "null" ]; then
	ok "实时速率已采样 ($SPEED Mbps)"
else
	bad "实时速率为空"
fi

echo "== 5. read-only =="
AFTER="$(md5sum /etc/config/wireless | awk '{print $1}')"
[ "$BEFORE" = "$AFTER" ] && ok "/etc/config/wireless 未被修改" || bad "agent 改写了配置"

pkill -f 'mock-ap|mesh-lite-agent' >/dev/null 2>&1 || true

echo
[ "$FAIL" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$FAIL"
