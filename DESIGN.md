# Mesh Lite 设计方案

> 状态：设计定稿，M1 开始实现
> 最后更新：2026-11-04
> 适用范围：OpenWrt / ImmortalWrt（23.05 及以后，opkg 与 apk 两种包管理器均考虑）

---

## 1. 背景

目标是"用 OpenWrt 自己做 AC + AP 组网，统一管理 Wi-Fi 配置、开启 802.11k/v/r"。

一路上排除了三条看似可行、实际代价过高的路线：

| 路线 | 结论 |
|---|---|
| 逆向 TP-Link AC100 固件、取出 AC 组件 | 放弃。AC100 是 MIPS 大端 + 原厂私有 AC 栈，且易展 1.0 机型本来就不能被 AC 有线纳管 |
| 照搬 zte-mesh 思路做 ZTE 控制器 | 放弃。要重写 IEEE 1905.1 + Multi-AP + WSC，3–6 人月，且绑定中兴私有准入 |
| 集客 AP 固件 + 开源软 AC | 放弃。私有协议、MD 不可配、跨平台掉速、微 AC 最多 16 台 |
| **华为 H6/Q7 等消费级 Mesh** | 放弃。H6 只到 k/v 不支持 r，且全家桶封闭 |

最终方案：**不做任何厂商协议，只用 OpenWrt 原生的 hostapd 802.11k/v/r，把"配置"这件事做便利。**

---

## 2. 目标与非目标

### 2.1 目标

1. 在一个 LuCI 界面里完成 **AC / AP 角色**选择与切换。
2. 统一配置 **SSID、密钥、加密、信道、功率、Beacon**，并**正确打开 802.11k/v/r 与 FT 参数**。
3. 保证全屋 **mobility_domain（MD）等关键参数一致**，并在界面上做一致性校验。
4. 提供 **凭据阶梯**：自动接管已刷同一固件的 AP（T0 预置密钥 → T1 默认/统一账号密码），失败的单独处理。
5. 提供 **节点巡检**：AC 通过 SSH 拉取各 AP 的实际配置与运行态，并排显示"期望 vs 实际"。
6. 节点列表支持 **点击 IP 直达** AP 管理页 / 复制凭据 / SSH 终端。
7. 全部基于 OpenWrt 现有组件，**不实现任何无线协议、不写守护进程、不改驱动**。

### 2.2 非目标（明确不做）

| 不做 | 原因 |
|---|---|
| EasyMesh / Multi-AP 互操作 | 需要 1905.1 + WSC + Multi-AP 全套，属于 daemon 级工程 |
| 毫秒级实时上报 | 采集开销与网络放大不划算；用 SSH 轮询 + 事件替代 |
| 自动 steering / BTM 踢人 | 需要自研决策与执行，且大量终端不响应 BTM |
| 握手速度选优 | 不可同时测量、样本稀疏，只适合做健康度展示（后续可选） |
| 802.11s 无线回程 | 已决定舍弃；默认推有线回程 |

---

## 3. 架构

```
┌───────────────────────────── AC（可选无线）─────────────────────────────┐
│  LuCI 前端 (JS)                                                          │
│   ├── overview.js   角色 / 依赖检查 / SSH 密钥                           │
│   ├── profile.js    统一配置模板 → 生成本机 wireless → wifi reload        │
│   ├── nodes.js      节点列表 / 凭据阶梯 / 点击直达                        │
│   └── inspect.js    巡检：SSH 拉取各 AP 配置与运行态，做差异对比          │
│                                                                          │
│  rpcd 插件 /usr/libexec/rpcd/mesh-lite（shell，约 150 行）                │
│   ├── status / discover / getkey / genkey                                │
│   ├── auth_probe / auth_push / auth_verify / auth_forget                  │
│   └── poll（ssh 抓取远端 uci + iwinfo 输出）                              │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ SSH（公钥优先，密码仅首次）
┌──────────────────────────────────▼───────────────────────────────────────┐
│  AP（OpenWrt + 满血 wpad）                                                │
│   hostapd：ieee80211r / ieee80211k / bss_transition / mobility_domain     │
│   dropbear：authorized_keys（AC 公钥）                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**分工原则**：LuCI 只做"读、写 UCI、调 rpcd"；rpcd 只做"系统命令编排"；无线行为全部交给 hostapd。

---

## 4. 角色模型

| 角色 | 含义 | 行为 |
|---|---|---|
| `standalone` | 独立单机 | 只应用本机配置，不参与组网管理 |
| `controller` | AC | 生成配置模板、管理节点、巡检；本机可无无线 |
| `agent` | AP | 应用下发/导入的配置；对外提供 LuCI 供 AC 巡检 |

角色存于 `/etc/config/mesh_lite` 的 `settings.role`，切换只影响菜单可见性与动作，不影响已生效的无线配置。

---

## 5. 配置模型与 hostapd 映射

### 5.1 UCI（`/etc/config/mesh_lite`）

```
config settings 'general'
    option role 'standalone'
    option md_auto '1'
    option mobility_domain ''
    option enable_r '1'
    option enable_k '1'
    option enable_v '1'
    option ft_over_ds '1'
    option ft_psk_generate_local '1'
    option restrict_key_source '0'
    option ssh_timeout '10'
    option poll_interval '30'
    option secrets_path '/etc/mesh-lite/secrets'

config profile 'profile'
    option ssid ''
    option key ''
    option encryption 'psk2'
    option hidden '0'
    option channel_2g 'auto'
    option channel_5g 'auto'
    option txpower_2g ''
    option txpower_5g ''
    option beacon '100'
    option enable_r_2g '0'
    option enable_r_5g '1'

config wizard 'wizard'          # 空字符串 = 自动
    option mobility_domain ''
    option enable_r_5g ''
    option enable_r_2g ''
    option enable_k ''
    option enable_v ''
    option ft_over_ds ''
    option ft_psk_generate_local ''
    option beacon ''

config node 'ap1'
    option ip '192.168.1.21'
    option name 'ap-01'
    option auth_state 'unknown'      # unknown|key_ok|override|default|unified|failed
    option cred_mode 'auto'          # auto|default|unified|override
```

### 5.2 hostapd 参数映射（写入 `/etc/config/wireless` 的 `wifi-iface`）

| UCI 选项 | 值 | 作用 |
|---|---|---|
| `ieee80211r` | 1 | 开启 FT（802.11r） |
| `mobility_domain` | 4 位十六进制 | 移动域，**全屋必须一致** |
| `ft_over_ds` | 1 | 允许经 DS 的 FT |
| `ft_psk_generate_local` | 1 | 本地生成 PMK-R0/R1，免配 R0KH/R1KH |
| `ieee80211k` | 1 | 邻居报告 |
| `bss_transition` | 1 | 802.11v BSS 转换管理 |
| `time_advertisement` | 2 | 广播时间信息（配合 11v） |
| `time_zone` | 如 `CST-8` | 时区，配合时间广播 |

**规则**：
- 2.4G 默认**不开** `ieee80211r`（社区经验：2.4G 开 r 容易抖动），5G 开。
- `md_auto=1` 时由 SSID 派生固定 MD（同 SSID 必得同值），否则用用户填写值。
- 应用后必须 `wifi reload`，再用 `hostapd_cli -i <if> get_config` 回读确认。

---

## 6. 凭据阶梯（核心自动化逻辑）

对每台 AP 独立执行，顺序固定：

```
1. 密钥可用？            → SSH 用 /etc/dropbear/id_ed25519 成功 → KEY_OK
2. 该 AP 有单独覆盖？    → 用 secrets 里的覆盖凭据 → 成功则写公钥 → KEY_OK
3. 试同批默认凭据列表    → root:"" / root:root / root:password / root:admin / admin:admin
4. 试用户填的统一凭据    → 成功则写公钥 → KEY_OK
5. 全失败                → failed，标红，可单台重试
```

实现上，节点页的【授权】按钮会自动先跑第 3 步（`auth_push mode=default`），命中就直接完成；没命中才弹密码框走第 2 步。【一键接管全部节点】走第 4 步，用同一个密码依次尝试所有节点。

**注意**：单独覆盖排第二，优先于"猜默认"，否则用户手工设置的凭据会被默认值抢跑。

**默认凭据风控**：每台最多 5 次、每次间隔 1–2 秒、并发 ≤ 2。dropbear 无锁死机制，但避免对商业固件 AP 造成登录封禁。

**失败状态必须可见**：UI 要能区分"密码错 / 不可达 / 拒绝连接"，而不是笼统一个红点。

---

## 7. 数据存储

| 数据 | 位置 | 权限 | 说明 |
|---|---|---|---|
| 用户配置 | `/etc/config/mesh_lite` | 644 | UCI，不含任何密码 |
| 覆盖凭据 | `/etc/mesh-lite/secrets` | **600** | 每行 `ip<TAB>user<TAB>pass`，仅 root 可读 |
| AC 私钥 | `/etc/dropbear/id_ed25519` | 600 | dropbear 生成 |
| AC 公钥 | `/etc/dropbear/id_ed25519.pub`（导出用） | 644 | 实际以 `dropbearkey -y` 输出为准 |
| AP 授权 | AP 的 `/etc/dropbear/authorized_keys` | 600 | 追加 AC 公钥 |

**密码只在内存中用于当次操作，不写 UCI。** `secrets` 文件由用户明确选择"记住"时才写。

---

## 8. rpcd 接口

| 方法 | 参数 | 返回 | 阶段 |
|---|---|---|---|
| `status` | — | 角色、LAN IP、wpad 变体、是否满血、sshpass、密钥状态与指纹、无线接口 | M1 |
| `discover` | — | 发现的设备列表（IP/hostname/MAC） | M1 |
| `genkey` | — | 生成 ed25519 密钥，返回公钥与指纹 | M1 |
| `getkey` | — | 只读返回公钥与指纹 | M1 |
| `auth_probe` | ip | 探测该 IP 可用哪种认证方式 | M2 |
| `auth_push` | ip, mode, user, pass | 按指定方式写入公钥 | M2 |
| `auth_verify` | ip | 用密钥验证连通性，返回 hostname | M2 |
| `auth_forget` | ip | 清除该 AP 的覆盖凭据 | M2 |
| `poll` | ip | 通过 SSH 拉取远端 `uci show wireless` + `iwinfo` | M3 |

**设计约束**：三档认证接口全部保留、可单独调用；"一键接管"只是它们的编排，不另设专用接口。

---

## 9. 页面设计

```
网络 → Mesh Lite
  ├── 一键配置   只填 SSID/密码，其余自动生成
  ├── 总览       角色、依赖检查、SSH 密钥
  ├── 配置模板   SSID/密钥/射频/FT 参数 → 生成本机 wireless
  ├── 节点       节点列表、凭据阶梯、点击直达
  └── 巡检       期望 vs 实际对比、差异高亮
```

**一键配置页（Quick Setup）**：

只要求用户填 SSID、密码、加密方式。其余项**可覆盖、留空即自动**：

| 项 | 留空时的自动值 |
|---|---|
| 移动域（MD） | 由 SSID 做 djb2 哈希取低 16 位，同 SSID 必同值 |
| 802.11r（5G） | 开启 |
| 802.11r（2.4G） | 关闭 |
| 802.11k / 802.11v | 均开启 |
| FT over DS / 本地生成 PMK | 均开启 |
| Beacon | 100 ms |
| 信道 / 功率 / 带宽 | **不改动**，保持驱动与现有配置；页面只读取并展示当前值 |

覆盖项存于 `/etc/config/mesh_lite` 的 `wizard` 段（空字符串 = 自动），页面提供【恢复全自动】一键清空。

**本页只写模板，不下发、不重载无线。** 实际生效由“配置模板”页的分体按钮完成：

- 【应用到模板并重启 AP 无线】→ 保存模板 + 下发到已纳管 AP；
- 【应用到模板并重启本机和 AP 无线】→ 额外把模板写进本机 wireless 并 `wifi reload`。

**总览页**：角色下拉、802.11k/v/r 开关、MD 设置、依赖检查（wpad 是否满血、sshpass 是否存在）、密钥状态与【一键生成 SSH 密钥】。

**配置模板页**：
- 无线模板：SSID/PSK/加密、隐藏、Beacon；射频信道/功率/带宽（留空表示不修改）。
- 漫游：5G/2.4G 分别控制 802.11r，以及 802.11k/v、MD（自动派生或手填）、FT over DS、本地生成 PMK。
- **本机无线信息**：读取并展示本机（可能只当 AC，也可能同时是 AP）的 UCI 配置与 hostapd 运行态，便于确认模板是否落盘。
- **应用按钮（分体式）**：
  - 主按钮【应用到模板并重启 AP 无线】：保存模板 + 下发到已纳管的 AP；
  - 悬停展开下箭头显示【应用到模板并重启本机和 AP 无线】：额外把模板应用到本机无线。
- 另有【导出配置】生成 profile.json。

**节点页**：表格（IP、名称、认证状态、最后巡检时间）；操作列：【巡检】【授权】【打开后台】【复制凭据】【SSH】；批量按钮【一键接管选中的 AP】。

**巡检页**：

- 通过 SSH **逐台串行**读取（上一台返回后才发下一台），面向 A53×4 这类小主机，避免并发开销；
- AP 侧只执行一段只读采集脚本（`uci show wireless` + `iwinfo`），输出 `|` 分隔的行式数据，不依赖 `jsonfilter`；
- AC 侧解析成设备/BSS 数组，与当前模板逐项对比：SSID、加密、802.11r、MD、802.11k、802.11v、是否有密码；
- 差异单元格标红，底部汇总“一致 / 有差异 / 不可达”台数；
- 结果只存页面内存，刷新即清空，不落盘。

**巡检页**：每台 AP 的期望配置与实际配置并排，差异标红；显示实际通道、功率、客户端数。

---

## 10. 点击直达的现实边界

| 能力 | 可行性 | 做法 |
|---|---|---|
| 新标签打开 AP 的 LuCI | ✅ | 链接 `http://<ip>/cgi-bin/luci` |
| 复制账号/密码 | ✅ | 按钮写入剪贴板 |
| SSH 终端 | ✅（需 ttyd） | 跳转 AC 上的 ttyd，预置 `ssh root@<ip>` |
| **打开后自动登录** | ❌ | 跨源，浏览器同源策略不允许读写 AP 的 cookie；任何"自动登录"都需中间人代理或改 AP 固件 |

---

## 11. 安全与风控

1. `secrets` 文件 0600，不进入任何导出/备份；UI 提供【清除】。
2. 私钥永不回显，只显示公钥与指纹。
3. 公钥建议加 `from="192.168.1.0/24"` 限制来源（页面可选项）。
4. 授权完成后可选关闭 AP 的密码登录（默认不勾，防止自锁）。
5. 默认凭据猜测有次数上限，避免触发对端封禁。
6. 统一密码是最大风险点，UI 常驻提示。

---

## 12. 依赖与平台

| 依赖 | 用途 | 必需 |
|---|---|---|
| `luci-base` | LuCI 运行时 | 是 |
| `rpcd` | 插件宿主 | 是 |
| `dropbear` | SSH 服务端 + 客户端 | 是 |
| **满血 wpad**（`wpad-openssl` / `wpad-wolfssl` / `wpad-mbedtls`） | 802.11r 支持 | 是（否则 r 不生效） |
| `sshpass` | 首次密码授权自动化 | 否（缺失时退化为手动） |
| `ttyd` | 内置 SSH 终端 | 否 |

**注意**：OpenWrt 默认的 `wpad-basic` 是精简版，**不支持 802.11r**。总览页必须检测并提示。

### 12.1 平台与打包格式

| 维度 | 支持 | 说明 |
|---|---|---|
| 架构 | 全部（`Architecture: all`） | 只有 JS/JSON/PO/POSIX sh，无编译产物 |
| OpenWrt 21.02–24.10 | ipk（opkg） | 用 24.10 SDK 构建 |
| OpenWrt snapshot / 25.x | apk | 用 snapshot SDK 构建 |
| 防火墙 | fw3 与 fw4 | 不安装规则、不放行端口，天然兼容 |
| LuCI | 21.02+（客户端 JS 视图） | 19.07 的 Lua 控制器不支持 |

**双格式的做法**：CI 矩阵用两个 SDK 各构建一次（不是做格式转换），产物都是 `all` 架构。apk 由 SDK 签名，设备默认不信任，安装需要 `--allow-untrusted`。

---

## 13. 里程碑与工期

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1** | 包骨架 + UCI + 菜单/ACL + rpcd（status/discover/genkey/getkey）+ 总览页 | ✅ 已完成 |
| M2 | 配置模板页 + 生成 hostapd 参数 + 本地应用与回读验证 | ✅ 已完成（代码与单测，未上机） |
| M2.1 | 一键配置向导 + 射频读数 + 分体式应用按钮 + 本机无线读取 | ✅ 已完成（26 项单测，未上机） |
| M3 | 节点页 + 凭据阶梯 + secrets + AP 下发 + SSH 超时 | ✅ 已完成（45 项单测，未上机） |
| M4 | 巡检页（串行 SSH 拉取 + 期望/实际差异） | ✅ 已完成（55 项单测，未上机） |
| M5 | i18n（英文翻译包）、profile 导入、加固（关密码登录） | ✅ 已完成（56 项单测，未上机） |
| M3 | 节点页 + 凭据阶梯（probe/push/verify/forget）+ secrets 管理 | 待做 |
| M4 | 巡检页（SSH 轮询 + 差异对比）+ 直达动作 | 待做 |
| M5 | 中文文案、导出/导入 profile、加固选项 | 待做 |

估算：M1 1 天，M2 1–2 天，M3 2 天，M4 1–2 天，M5 1 天。

---

## 14. 国际化

源码文案以**中文为源语言**（msgid 即中文），英文通过 `po/en/luci-app-mesh-lite.po` 提供，构建时由 `luci.mk` 产出 `luci-i18n-mesh-lite-en` 包。

- 这样避免为 i18n 重写全部 JS，改动风险最小；
- 中文用户看到源码原文，英文用户安装翻译包即可；
- `po/templates/luci-app-mesh-lite.pot` 供后续用 `xgettext` 更新。

覆盖率：246 条唯一字符串全部有英文翻译。

---

## 15. 已知限制与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 不同驱动 `iwinfo` 字段不一致 | 巡检显示异常 | 字段兼容映射，先支持 mt76/ath79/mtk |
| `wpad-basic` 未替换 | 开了 r 也不生效 | 总览页强提示 + 回读校验 |
| 跨源无法自动登录 AP | "一键直达"体验打折 | 复制凭据 + ttyd 终端兜底 |
| 统一密码泄露 | 全网 AP 可被登录 | 首次后建议关密码登录 |
| 首次连接主机密钥确认 | 自动化卡住 | dropbear 客户端用 `-y` |
| 固件升级/重置丢密钥 | 授权失效 | 巡检显示不一致，提示重新授权 |

---

## 15. 参考事实（来自前期调研）

- OpenWrt 自带 wpad 为精简版，802.11r 需满血 wpad（社区共识）。
- 2.4G 开 802.11r 容易抖动，建议只 5G 开。
- `ft_psk_generate_local` 可免配 R0KH/R1KH，适合家庭 PSK 场景。
- 集客/华为等消费级方案均不能跨品牌互通 802.11r，MD 不可配是主因。
- 微 AC 类方案存在台数与同步限制，不适合作为本项目的参照。
