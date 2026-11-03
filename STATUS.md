# Mesh Lite 阶段性总结

> 版本：v0.1.0（开发中）
> 最后更新：2026-11-04
> 状态：M1 / M2 / M2.1 / M3 / M4 / M5 已完成并通过本地校验，**尚未在真机验证**

---

## 一、项目定位

用 OpenWrt 自己做 AC + AP 组网，绕开所有厂商私有协议：

- **不做** EasyMesh/Multi-AP 互操作，不碰 1905.1、WSC；
- **只做** LuCI 配置便利化 + 标准 802.11k/v/r；
- 全部基于 OpenWrt 现有组件（hostapd、rpcd、dropbear、uci），无守护进程、无编译产物。

---

## 二、已完成内容

### 2.1 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 包骨架、UCI、菜单/ACL、rpcd 基础方法、总览页 | ✅ |
| M2 | 配置模板页、hostapd 参数生成、应用与回读验证 | ✅ |
| M2.1 | 一键配置向导、射频读数、分体式应用按钮、本机无线读取 | ✅ |
| M3 | 节点页、凭据阶梯、secrets 管理、AP 下发 | ✅ |
| M4 | 巡检页、串行拉取、期望/实际差异对比 | ✅ |
| M5 | 中文翻译包、profile 导入、加固（关密码登录） | ✅ |

### 2.2 五个页面

| 页面 | 作用 |
|---|---|
| **一键配置**（Quick Setup） | 只填 SSID/密码；高级项留空即自动；**只生成模板，不下发** |
| **总览**（Overview） | 角色、运行环境检查（wpad/sshpass/fw3/fw4）、SSH 密钥生成 |
| **配置模板**（Configuration Profile） | 模板编辑、射频与漫游参数、本机无线读取、**分体式应用按钮**、导出 profile |
| **节点**（Nodes） | 节点列表、局域网扫描、探测/授权/巡检/打开后台、一键接管 |
| **巡检**（Inspect） | 串行逐台拉取 AP 实际配置，与模板对比并标红差异 |

### 2.3 后端接口（rpcd，14 个）

| 分类 | 方法 |
|---|---|
| 状态 | `status`、`radio_info`、`verify_wireless` |
| 设备发现 | `discover` |
| 密钥 | `genkey`、`getkey` |
| 凭据 | `auth_probe`、`auth_push`、`auth_verify`、`auth_forget` |
| 应用 | `apply_wireless`、`apply_nodes` |
| 巡检 | `poll` |

### 2.4 构建与分发

- `LUCI_PKGARCH:=all`，无编译产物，单包支持 x86/aarch64/arm/mips/mipsel；
- CI 双矩阵：24.10 SDK 出 `.ipk`，snapshot SDK 出 `.apk`；
- 每次构建单独发 Release，含两种格式与安装说明；
- 兼容 fw3/fw4（不安装任何防火墙规则）。

---

## 三、关键设计决策

1. **不做 EasyMesh**：协议栈成本远超收益，且与厂商设备不互通；用"统一配置 + 标准 k/v/r"覆盖 90% 家庭场景。
2. **一键配置只写模板**：下发由配置模板页的两个按钮显式触发，避免"改了个表单就断网"。
3. **分体式应用按钮**：主按钮只重启 AP 无线；悬停展开才同时重启本机无线。
4. **2.4G 默认不开 802.11r**：社区经验是 2.4G 开 r 容易抖动。
5. **移动域由 SSID 派生**（djb2 哈希取低 16 位）：同 SSID 必同 MD，不需要用户理解 MD 是什么。
6. **信道/功率/带宽不写**：由驱动与现有配置决定，向导只读展示当前值。
7. **凭据阶梯**：密钥可用 → 单台覆盖 → 默认凭据 → 统一凭据；顺序固定，接口可单独调用。
8. **下发脚本用 base64 传值**：SSID/密码里的引号、空格、反斜杠不会破坏远端脚本。
9. **安全底线**：私钥 0600 且永不回显、密码不进 UCI、覆盖凭据单独 0600 文件、公钥可选 `from=` 限制。

---

## 四、验证情况

### 已完成（本地，无设备）

| 项 | 结果 |
|---|---|
| rpcd 脚本 `sh -n` | 通过 |
| CI 脚本 `bash -n` | 通过 |
| 菜单 / ACL JSON 解析 | 通过 |
| 四个 JS 页面括号平衡 | 0 / 0 / 0 |
| 单元测试 | **56 项通过 / 0 失败** |
| CI 双格式构建 | ✅ 首次运行通过：ipk（24.10 SDK）与 apk（snapshot SDK）均构建成功 |

单元测试覆盖：密钥解析、包管理器探测、wpad 判定、防火墙检测、射频读数、hostapd 回读、密钥生成、secrets 增删改、下发脚本语法与内容、缺少 MD 的报错。

测试用 5 个命令桩（dropbearkey / opkg / wifi / hostapd_cli / uci / iwinfo）加一个最小 jshn 实现，不需要 OpenWrt 设备。

### 尚未验证

- LuCI 在浏览器里的实际渲染与交互（悬停展开、`window.prompt` 取密码、批量接管进度）；
- 真实 hostapd 的 `get_config` 输出格式（不同 wpad 版本可能有差异）；
- `iwinfo` 输出格式（部分平台无 Tx-Power 行）；
- SSH 到真实 AP 的授权与下发（需要 sshpass 与真机）；
- 任何真机行为。

---

## 五、已知限制与风险

| 风险 | 影响 | 现状 |
|---|---|---|
| `wpad-basic` 不支持 802.11r | 开了也不生效 | 总览页检测并标红 |
| 跨源限制 | 无法在 AC 页面自动登录 AP 后台 | 只能新开标签页 |
| SSH 超时 | AP 离线时命令会挂住 | 已用 `timeout` 包裹，默认 10 秒，可在 `ssh_timeout` 调整 |
| 依赖 sshpass | 未安装时无法自动授权 | 页面提示手工放公钥 |
| 巡检需逐台 SSH | 台数多时一轮较慢 | 串行设计 + `ssh_timeout` 可控，符合小主机场景 |
| 中文翻译 | 英文为源语言，中文需装 `luci-i18n-mesh-lite-zh-cn` | 已提供 246 条完整翻译 |
| 未经真机 | 存在未知兼容问题 | 需上机验证 |

---

## 六、下一步

| 阶段 | 内容 |
|---|---|
| **待办** | 真机验证（LuCI 交互、hostapd 回读、SSH 授权与下发）、CI 首次构建、发布 |

---

## 七、常用命令

```sh
# 本地校验
sh -n ac/luci-app-mesh-lite/root/usr/libexec/rpcd/mesh-lite
bash -n ac/Scripts/ci-build.sh
sh ac/tests/helpers-test.sh

# 构建（OpenWrt 源码树内）
cp -r ac/luci-app-mesh-lite openwrt/package/
cd openwrt && make menuconfig   # LuCI → Applications → luci-app-mesh-lite
make package/luci-app-mesh-lite/compile V=s
```

---

## 八、文件清单（26 个，约 240 KB）

| 路径 | 作用 |
|---|---|
| `DESIGN.md` | 设计方案 |
| `README.md` | 项目说明与平台兼容矩阵 |
| `STATUS.md` | 本文件 |
| `LICENSE` | Apache-2.0 |
| `.gitattributes` | 统一 LF |
| `.github/workflows/build.yml` | 双格式 CI |
| `Scripts/ci-build.sh` | SDK 构建脚本 |
| `luci-app-mesh-lite/Makefile` | 包定义 |
| `luci-app-mesh-lite/README.md` | 包说明 |
| `root/etc/config/mesh_lite` | UCI 配置（settings/profile/wizard） |
| `root/etc/uci-defaults/90-mesh-lite` | 首次启动建目录 |
| `root/usr/share/luci/menu.d/*.json` | 菜单（含节点页） |
| `root/usr/share/rpcd/acl.d/*.json` | 权限 |
| `root/usr/libexec/rpcd/mesh-lite` | rpcd 后端（719 行） |
| `htdocs/.../mesh-lite/wizard.js` | 一键配置页 |
| `htdocs/.../mesh-lite/overview.js` | 总览页 |
| `htdocs/.../mesh-lite/profile.js` | 配置模板页 |
| `htdocs/.../mesh-lite/nodes.js` | 节点页 |
| `htdocs/.../mesh-lite/inspect.js` | 巡检页 |
| `po/zh_Hans/luci-app-mesh-lite.po` | 中文翻译（246 条） |
| `po/templates/luci-app-mesh-lite.pot` | 翻译模板 |
| `tests/helpers-test.sh` | 单元测试（56 项） |
| `tests/stub/*` | 5 个命令桩 + jshn 桩 |

代码量：JS 约 1439 行，shell 约 1059 行。
