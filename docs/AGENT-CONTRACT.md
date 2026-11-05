# mesh-lite-agent 契约与实现说明

> 状态：**已实现**（v1.0.0，`mesh-lite-agent` 独立包，`root/usr/bin/mesh-lite-agent`）。
> `rpcd` 侧 `agent_status` 已完成探测、协议校验与回退；巡检页已消费它的结构化数据。
> 与初版契约的差异集中在第 9 节，请以第 9 节为准。
> 目标：吸收 wifiroam 守护进程的**可观测性**，但不吸收它的控制面。

## 1. 为什么需要它

现在 AC 只能通过 SSH 逐台跑一段 shell 脚本、解析行式文本拿状态。代价是：

- 慢：`ssh_timeout × 节点数`，串行设计下 8 台 AP 一轮 80 秒起步。
- 脆：字段错位这类 bug 靠约定维持（Phase 1 已修一次，但仍靠字符串格式）。
- 无实时性：只能手点，没有事件。

wifiroam 用常驻 daemon + 自定义协议解决了这三点，代价是控制面进了网络、且明文 token 配对。
本契约只取第一段：**一个只读、不参与下发的观察者**。

## 2. 硬性边界

1. **只读**：agent 不写 `/etc/config/wireless`，不调 `uci set`，不跑 `wifi reload`。
2. **不参与纳管**：不提供配对、不下发凭据，纳管仍走 SSH。
3. **故障不影响主链路**：agent 挂了，一切退回 Phase 1 的 poll，功能不减。
4. **无凭据**：agent 不持有、不传输任何 AP 密码或网络密钥。

## 3. 形态

- 可执行文件：`/usr/bin/mesh-lite-agent`（ucode，依赖 `ucode-mod-ubus/uloop/fs/uci`）
- 服务名：`mesh-lite-agent`（procd，`/etc/init.d/mesh-lite-agent`）
- ubus 对象：`mesh-lite-agent`

## 4. 方法与数据契约

### 4.1 `status`

```json
{
  "ok": true,
  "protocol": 1,
  "version": "1.0.0",
  "hostname": "ap-01",
  "mac": "aa:bb:cc:dd:ee:ff",
  "ip": "192.168.1.21",
  "model": "Generic A53",
  "uptime": 86400,
  "config_ver": "12",
  "kvr": { "r": true, "k": true, "v": true, "seen": 2 },
  "clients_total": 14,
  "started_at": 1762300000
}
```

约定：

- `protocol` 为协议版本，AC 侧不认识就退回 poll。
- `config_ver` 读自 `/etc/mesh-lite.ver`，与 Phase 1 的版本标记同源，**不要另立一套**。
- `kvr` 必须是从 `hostapd get_config` 或 UCI 读**实际生效值**，不能复述模板。

### 4.2 `clients`

```json
{
  "ok": true,
  "ifaces": [ { "ifname": "phy1-ap0", "ssid": "Home", "band": "5g" } ],
  "clients": [
    {
      "mac": "11:22:33:44:55:66",
      "ip": "192.168.1.50",
      "hostname": "phone",
      "ifname": "phy1-ap0",
      "ssid": "Home",
      "band": "5g",
      "rssi": -58,
      "connected_time": 320,
      "tx_rate": 866.7,
      "rx_rate": 650.0,
      "rx_speed": 42.3,
      "tx_speed": 18.7
    }
  ]
}
```

数据来源（与 wifiroam 一致，已验证可行）：

| 字段 | 来源 |
|---|---|
| `mac/rssi/connected_time/tx_rate/rx_rate` | `hostapd.<if>.get_clients`（ubus） |
| `rx_speed/tx_speed` | `/proc/net/dev` 或站点字节计数两次采样差分（注意整数截断，用浮点） |
| `ip/hostname` | `/tmp/dhcp.leases` |
| `band` | `network.wireless status` 的 `config.band`，缺失时按频率推断 |

### 4.3 `hostapd_config`

```json
{ "ok": true, "ifaces": [ { "ifname": "phy1-ap0", "ieee80211r": "1", "mobility_domain": "a1b2", "ieee80211k": "1", "bss_transition": "1", "ft_over_ds": "1" } ] }
```

供 AC 做"期望 vs 实际"的权威比对，替代 `hostapd_cli get_config` 的文本解析。

## 5. 传输

### 5.1 v1（本阶段采用）：ubus over SSH

AC 侧（已实现探测）：

```sh
ssh <ap> "ubus call mesh-lite-agent status"
```

优点：零新增监听端口、复用既有 SSH 信任链、agent 不暴露网络面。
缺点：仍是 SSH，但**一次命令拿全部结构化数据**，比现在多轮文本采集快且不脆。

### 5.2 v2（可选，暂不实现）：直连

若将来需要秒级/事件推送，可加只读 TCP 通道，但必须满足：

- **不广播**（对比：wifiroam 用 UDP 50607 全网广播，含 mac/ip/name/model）。
- 认证用挑战应答，**token 不明文传输**（对比：wifiroam `join` 明文传 token）。
- 只读，无写方法。
- 默认关闭，需用户显式开启并指定 AC 地址。

## 6. AC 侧行为

`rpcd` 的 `agent_status` 已按下列逻辑落地：

```
agent_status(ip):
  成功且 protocol 匹配 → 用结构化数据
  失败 / 无 agent      → 返回 agent:0，前端退回 poll(ip)
```

前端约定：

- 有 agent：巡检页显示客户端数、信号、速率；版本比对直接用 `status.config_ver`。
- 无 agent：保持现状，不报错、不提示"缺少组件"，只在详情里标一句"未安装 agent（可选）"。

## 7. 与 wifiroam 的对应关系

| wifiroam | 本契约 |
|---|---|
| `wifiroamd.uc`（3896 行，含下发/访客/应用管控） | `mesh-lite-agent`（只读，预计 300–500 行） |
| UDP 50607 广播发现 | 无（纳管走 SSH 扫描） |
| TCP 50608 + libubus channel 双向 RPC | v1 只走 SSH 上的 `ubus call` |
| `auth/report_status/push_*` | 只有 `status/clients/hostapd_config` |
| token 明文加入 | 无加入流程 |
| `DAEMON_VERSION` 自愈 | `protocol` 字段协商，不匹配就回退 |

## 8. 验收标准（Phase 2 完成时）

1. `agent_status` 在装了 agent 的 AP 上返回 `ok:1, agent:1`，字段与 §4 一致。
2. 卸载 agent 后功能不退化（自动回退 poll）。
3. agent 崩溃/重启不影响主机无线与 AC 操作。
4. agent 不写任何 `uci` 配置（可用 `uci changes` 与 strace 验证）。
5. 单测覆盖：契约字段齐全、`config_ver` 与 `/etc/mesh-lite.ver` 一致、无写操作。

## 9. 实现说明（落地后的事实）

### 9.1 交付物

| 路径 | 说明 |
|---|---|
| `mesh-lite-agent/root/usr/bin/mesh-lite-agent` | ucode 守护进程，`#!/usr/bin/ucode`，约 380 行 |
| `mesh-lite-agent/root/etc/init.d/mesh-lite-agent` | procd 服务，`respawn 3600 5 5` |
| `mesh-lite-agent/root/etc/config/mesh-lite-agent` | `option enabled '1'`（装到 AP 才启动，AC 上可关） |
| `mesh-lite-agent/Makefile` | `PKGARCH:=all`，依赖 ucode + ubus/uloop/fs/uci 模块，**不依赖 LuCI/rpcd** |
| `tests/agent-test.sh` | 37 项静态契约测试 |

### 9.2 与初稿契约的差异

| 项 | 初稿 | 实际实现 | 原因 |
|---|---|---|---|
| `hostapd_config` 数据源 | `hostapd get_config`（ubus） | 读 `/etc/config/wireless` 的 `wifi-iface` | hostapd 的 ubus 对象没有稳定暴露 `get_config`；UCI 里是 netifd 实际应用后的落盘值，比模板可信。运行态核对仍由 AC 侧 `hostapd_cli` 负责 |
| `rx_speed` / `tx_speed` | 采集两次差分 | 相同，但采样点由 agent 内 5 秒 tick 维护 | 请求侧只读采样点，避免两次请求间隔过短把速率算飞 |
| `status.ifaces` | 未列 | 增加 `ifaces`（ifname/ssid/band/up） | AC 侧渲染客户端归属要用 |
| 协议校验 | 未提 | `protocol=1` 不匹配即判为不可用并回退 | 宁可退回文本巡检，也不猜字段含义 |

### 9.3 已知限制

- **真机未验证**：已在 WSL(Ubuntu 24.04) 用源码编译的 ucode + ubusd + 模拟 AP 跑通（见 9.6），
  但真实驱动下的 `iw station dump` / hostapd 字段差异仍需上机确认。
- 首次请求的 `rx_speed`/`tx_speed` 必为 `null`（需要至少两个采样点，约 5–10 秒后才有值）。
- `iw station dump` 依赖 `iw` 包；未装时速率字段为 `null`，其余字段不受影响。
- `mac` 优先取 `network.interface.lan` 的 `device`；无桥接时退回第一个带合法 MAC 的物理接口。
- 速率等数值是 JSON double，`866.7` 在序列化后可能显示为 `866.70000000000005`；
  这是 IEEE754 表示问题，消费端按需格式化（LuCI 侧用 `toFixed(1)`）。

### 9.4 如何验证只读

```sh
sh tests/agent-test.sh          # 禁止 UCI 写、wifi reload、写文件、密码、ssh
# 真机上：
uci changes                     # agent 运行前后应无新增
ubus call mesh-lite-agent status
```

### 9.5 AC 侧消费与巡检页明细

- rpcd 新增 `agent_clients`：校验 `protocol=1`，返回 `count` 与原始 `clients_json`；
  `agent_status` 与 `agent_clients` 都只在协议匹配时判为可用。
- 巡检页对每台 AP **并行**做三件事：`poll`（文本兜底）、`agent_status`、`agent_clients`；
  后两者失败一律降级为空结果，不影响巡检结论。
- 客户端明细表只渲染**信号与速率**（RSSI、协商 Tx/Rx、实时 Tx/Rx），按弱信号优先排序。
  **不做厂商/品牌识别**（不拉 OUI 库、不拉品牌图标），这是明确的范围约定。

### 9.6 本机运行时验证（WSL + 真实 ucode/ubusd）

仓库所在机器没有 ucode，因此这台 Windows 机器上用 WSL(Ubuntu 24.04) 从源码构建了完整运行时，
并用 `tests/agent-smoke.sh` 做端到端验证。

构建步骤（WSL 内以 root 执行，约 5 分钟）：

```sh
apt-get install -y libjson-c-dev

git clone --depth 1 https://github.com/openwrt/libubox  && cd libubox
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local -DBUILD_LUA=OFF && make -C build -j && make -C build install

git clone --depth 1 https://github.com/openwrt/uci && cd ../uci
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local -DBUILD_LUA=OFF && make -C build -j && make -C build install

git clone --depth 1 https://github.com/openwrt/ubus && cd ../ubus
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local && make -C build -j && make -C build install
# -> /usr/local/sbin/ubusd, /usr/local/bin/ubus

git clone --depth 1 https://github.com/jow-/ucode && cd ../ucode
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DUCI_SUPPORT=ON -DUBUS_SUPPORT=ON -DULOOP_SUPPORT=ON -DFS_SUPPORT=ON
make -C build -j && make -C build install
ldconfig
# -> /usr/local/bin/ucode + /usr/local/lib/ucode/{fs,ubus,uci,uloop,...}.so
```

运行：

```sh
cp mesh-lite-agent/root/usr/bin/mesh-lite-agent /root/mesh-lite-agent
sudo bash tests/agent-smoke.sh
```

测试会起 `ubusd`，用一个 mock 的 `network.wireless` / `hostapd.phy0-ap0` / `iw` / leases
喂数据，然后检查 15 项：

| 组 | 检查 |
|---|---|
| 发布 | ubus 对象 `mesh-lite-agent` 出现 |
| status | `protocol=1`、`config_ver` 与 `/etc/mesh-lite.ver` 一致、`clients_total`、`mac` 已规范化 |
| hostapd_config | `mobility_domain`、`ieee80211r`、接口与 UCI section 对应 |
| clients | RSSI、协商速率换算（866.7 Mbps）、leases 富化、MAC 统一小写、二次采样出实时速率 |
| 只读 | `/etc/config/wireless` 校验和前后一致 |

**2026-11-05 实测结果：15/15 通过。** 这一轮还发现并修掉两个真实缺陷：

1. MAC 大小写不一致 —— 原先用 `uc()` 把整串转大写，同一终端在不同来源下大小写不同；
   改为统一的 `maccolon()` 小写冒号格式。
2. `round_to` 用了整数除法，把 `866.7` 截成 `866`、`0.33` 截成 `0`；
   改成浮点除数（与代码里已写明的 ucode 整除陷阱同源）。

**仍未验证**：真实无线驱动下 `iw station dump` 与 hostapd `get_clients` 的字段差异。
