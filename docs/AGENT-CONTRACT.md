# mesh-lite-agent 契约（Phase 2 设计，尚未实现）

> 状态：已定契约，代码未写。`rpcd` 侧已有 `agent_status` 探测与回退。
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
