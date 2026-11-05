# 融合 Phase 1：把 wifiroam 的收敛与上报能力接进 mesh-lite

> 分支：`fusion/phase1`
> 日期：2026-11-05
> 前置：`组网插件-vs-mesh-lite-对比分析.md`（wifiroam 0.1.0-r32 逆向对比）

## 1. 这一阶段做了什么、不做什么

**做**（以 mesh-lite 为骨架，吸收对方的长处，同时先把自己已核实的缺陷修掉）：

1. 修复 6 类已核实缺陷（巡检字段错位、远端 `hidden` 硬编码、下发吞错、`sshpass` 明文进 `ps`、`secret_lookup` 死代码、`harden` 时序）。
2. 移动域（MD）单一来源化，消除三个页面各读一份、各算一份的问题。
3. 引入 `config_ver` 收敛协议：下发带版本、回执带结果、AP 侧留版本标记、巡检做期望/实际比对。
4. 定义可选 agent 的只读契约，并让 `rpcd` 具备"有 agent 用 agent、没有就退回 poll"的能力。

**不做**（留给后续阶段）：

- 不实现守护进程（Phase 2 才写 `mesh-lite-agent`，本文只定契约）。
- 不做 steering（主动引导终端漫游）。wifiroam 用 `bss_transition_request` 主动踢人，这与 mesh-lite「不做 steering」的设计边界冲突，需要单独决策。
- 不搬访客网络、应用管控、无线回程。这些是对方的产品化能力，与"极简 AC"定位冲突，属可选模块。
- 不跟随对方的 MD 算法。

## 2. 与 wifiroam 的取舍

| 对方能力 | 本阶段处理 | 理由 |
|---|---|---|
| `config_ver` 单调版本 + 逐台回执 | **采纳** | 这是 mesh-lite 最大的可靠性缺口：旧实现远端脚本恒 `exit 0`，commit/reload 失败也报成功 |
| 通信状态看门狗 | 部分采纳 | 用 `ver` 比对实现"是否收敛"，不做常驻心跳（无守护进程就没有心跳可言） |
| MD 由 `sha256("md:"+ssid)` 派生 | **不采纳**，改为「AC 计算一次、显式下发」 | 两个算法混用会让同一网络出现两个 MD，FT 直接失效。统一为：MD 只在 AC 上产生，AP 侧只落盘不推导 |
| daemon 上报客户端/信号 | 只取"上报"部分 | 对方 daemon 同时承担下发，等于把控制面放进网络；我们只吸收可观测性 |
| token 配对（明文 TCP 传 token） | 不采纳 | 对方 `join` 明文传 token，同 LAN 嗅探即可接管。agent 契约改用"不广播、不带外网可达"的只读通道 |
| 每 AP 独立访客子网 | 暂不采纳 | 属于产品化能力，非收敛必需 |

## 3. 后端变更（`root/usr/libexec/rpcd/mesh-lite`）

### 3.1 巡检协议（这次最实质的修复）

`build_poll_payload` 的 BSS 行从 10 个字段扩到 **12 个**，与 `parse_poll_output` 的 `read` 变量数严格一致：

```
BSS|name|dev|mode|ssid|enc|r|md|k|v|hidden|haskey|ds
```

新增行：

```
VER|<远端 /etc/mesh-lite.ver 内容>
AGENT|0|1
```

修复效果：

- 旧版 12 段 vs 11 个变量，末位变量吞掉剩余，`key` **从未输出**、`hidden` 变成 `"0|1"`；
  前端 `badKey` 因此恒真 → **只要加密不是 none，巡检永远报差异**。现在 `key`/`hidden`/`ds` 都能正确读出。
- 版本号独立落在 `/etc/mesh-lite.ver`，**不要求 AP 装任何包**，也不污染远端 UCI。

### 3.2 下发脚本

- `hidden` 不再硬编码 `'0'`，改为从 `mesh_lite.profile.hidden` 走 base64 下发。
- 结尾由无条件的 `exit 0` 改为：

  ```sh
  uci commit wireless || { echo "MESHLITE_ERR|uci commit wireless failed"; exit 11; }
  echo "$ver" > /etc/mesh-lite.ver
  wifi reload || { echo "MESHLITE_ERR|wifi reload failed"; exit 12; }
  echo "MESHLITE_OK"
  ```

- `apply_nodes` 捕获远端 stdout，按哨兵判定成功/失败，并把真实失败原因带回前端
  （旧版一律 `2>/dev/null` + `>/dev/null`，只剩一句 `apply failed`）。

### 3.3 SSH 层

| 项 | 旧 | 新 |
|---|---|---|
| 密码传递 | `sshpass -p "$pass"`（`ps` 可见） | `SSHPASS=... sshpass -e`（只在本进程环境里） |
| 主机密钥 | 恒 `ssh -y`（不校验） | 默认仍 `-y`；`general.ssh_strict_hostkey=1` 时可关掉，配合已记录的 known_hosts |
| 超时兜底 | 无 `timeout` 命令时裸执行，可能永久挂起 | 后台 + 逐秒检查 + 到点 kill，返回 124 |
| 已存凭据 | `secret_lookup` 定义了但**全仓库无调用**，密码存了不用 | 新增 `ssh_cred_run`：密钥失败 → 用已存凭据 → 仍失败带上具体原因 |

### 3.4 新增接口

| 方法 | 参数 | 说明 |
|---|---|---|
| `agent_status` | `ip` | 若 AP 上有 `mesh-lite-agent`，直接取结构化状态；没有返回 `agent:0` |
| `apply_wireless` | `ver` | 检查 `wifi reload` 返回码；成功时本机也写 `/etc/mesh-lite.ver` |
| `apply_nodes` | `md`, `ver` | 逐台回执 + 版本；全部成功才推进 `general.config_ver` |

`status` 增加 `config_ver`、`md_auto`、`ssh_strict_hostkey`、`applied_ver`。

### 3.5 清理

删掉了 `do_auth_*` 那组 "not implemented (M2)" 占位函数——它们在 shell 语义下被后面的真实实现覆盖，
属于永不执行的死代码，但会误导阅读。

## 4. 前端变更

### 4.1 MD 单一来源

新增共享模块 `htdocs/luci-static/resources/mesh-lite/common.js`：

- `deriveMd(ssid)`：djb2 取低 16 位（算法不变，保持老网络兼容）
- `overrideMd()` / `mdIsExplicit()`：只在 `general.md_auto=0` 且值合法时生效
- `effectiveMd(ssid)`：覆盖值 → 派生值
- `nextConfigVer()` / `currentConfigVer()`

三处复制粘贴的 `deriveMd` 全部删除（wizard / profile / inspect），读取来源统一到 `general.*`。
向导页不再提供 MD 输入框（避免两个页面各写一份互相覆盖），权威值只在「配置模板」页设置。

迁移：`90-mesh-lite` 会把旧的 `wizard.mobility_domain` 搬到 `general.mobility_domain`
并置 `md_auto=0`，然后删掉旧键。

### 4.2 应用流程版本化

- 一次用户动作只推进一个版本号：`beginApply()` 在 `applyLocalAndRemote` 里先取号，本机与远端共用。
- 版本号只有在**所有 AP 都成功**后才落盘（`apply_nodes` 里判定），避免部分失败把期望版本抬高到 AP 追不上。
- 失败通知现在会列出具体哪台、什么原因。

### 4.3 巡检页

新增一行收敛核对：

```
Config version: <期望> · AP 报 <实际>     # 不一致标红并计入差异
```

## 5. 数据模型变化（`/etc/config/mesh_lite`）

```diff
 config settings 'general'
+	option config_ver '0'
+	option ssh_strict_hostkey '0'
@@ config wizard 'wizard'
-	option mobility_domain ''
```

## 6. 验证

```sh
sh -n luci-app-mesh-lite/root/usr/libexec/rpcd/mesh-lite
sh tests/helpers-test.sh      # 72 项通过 / 0 失败（原 56 项）
```

新增覆盖：12 字段解析（key/hidden/ds/ver/agent）、`hidden` 走 base64、版本号替换、成功/失败哨兵、
版本标记写入、`sshpass -e`、密码不进命令行、已存凭据兜底。

**仍未做的验证**（与主项目现状一致）：真机上的 LuCI 渲染、真实 hostapd 回读、真实 SSH 下发与 SSH 收包。

## 7. 下一步

| 阶段 | 内容 |
|---|---|
| Phase 2 | 实现 `mesh-lite-agent`（ucode，只读），按 `docs/AGENT-CONTRACT.md`；`agent_status` 从桩变成可用 |
| Phase 2.5 | 巡检页显示客户端/信号/速率（agent 在线时）；AP 离线时自动退回 poll |
| Phase 3 | 可选模块评估：访客网络、应用管控、BTM 引导（需先改设计边界） |
| 常规 | 真机验证、po 补新增 msgid、README/STATUS 同步 |
