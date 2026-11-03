# AC — OpenWrt AC/AP 组网工具

本目录存放"用 OpenWrt 自己做 AC + AP 统一配置"这一方案的文档与代码。

## 这是什么

一个 LuCI 应用（`luci-app-mesh-lite`），目标是：

- 在一个界面里选择 **AC / AP 角色**；
- 统一配置 **SSID / 密钥 / 加密 / 信道 / 功率 / Beacon**；
- 正确打开 **802.11k / 802.11v / 802.11r（FT）** 并保证 **mobility_domain 全屋一致**；
- 用 **凭据阶梯**（预置密钥 → 默认凭据 → 统一凭据 → 单台覆盖）批量接管 AP；
- AC 通过 SSH 巡检各 AP 的**期望配置 vs 实际运行态**；
- 节点列表支持**点击直达** AP 后台 / 复制凭据 / SSH 终端。

**它不做什么**：不实现 EasyMesh / Multi-AP 协议，不做毫秒级上报，不做自动 steering，不碰 802.11s。

## 目录

```
ac/
├── DESIGN.md                     设计方案（架构、凭据阶梯、接口、里程碑）
├── STATUS.md                     阶段性总结（进度、验证、风险、下一步）
├── README.md                     本文件
└── luci-app-mesh-lite/           LuCI 应用
    ├── Makefile
    ├── root/                     安装到设备的文件
    │   ├── etc/config/mesh_lite           UCI 配置
    │   ├── etc/uci-defaults/90-mesh-lite  首次启动建目录
    │   ├── usr/share/luci/menu.d/         菜单
    │   ├── usr/share/rpcd/acl.d/          权限
    │   └── usr/libexec/rpcd/mesh-lite     rpcd 后端（shell）
    └── htdocs/luci-static/resources/view/mesh-lite/
        └── overview.js            总览页
```

## 当前进度

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 包骨架、UCI、菜单/ACL、rpcd（status/discover/genkey/getkey）、总览页 | ✅ 已完成（未上机验证） |
| M2 | 配置模板页、生成 hostapd 参数、本地应用与回读 | ✅ 已完成（未上机） |
| M2.1 | 一键配置向导、射频读数、分体式应用按钮、本机无线读取 | ✅ 已完成（26 项单测通过） |
| M3 | 节点页、凭据阶梯、secrets 管理、AP 下发、SSH 超时保护 | ✅ 已完成（45 项单测通过） |
| M4 | 巡检页（串行拉取 + 期望/实际差异对比） | ✅ 已完成（55 项单测通过） |
| M5 | 英文翻译包、profile 导入、加固（关密码登录） | ✅ 已完成（56 项单测通过） |
| M3 | 节点页、凭据阶梯（probe/push/verify/forget）、secrets | ⬜ |
| M4 | 巡检页（SSH 拉取 + 差异对比）、点击直达 | ⬜ |
| M5 | 中文文案、导入导出、加固选项 | ⬜ |

## 构建

把 `luci-app-mesh-lite` 放进 OpenWrt 源码的 `package/` 下：

```sh
cp -r ac/luci-app-mesh-lite openwrt/package/
cd openwrt
make menuconfig          # LuCI -> Applications -> luci-app-mesh-lite
make package/luci-app-mesh-lite/compile V=s
```

依赖：`luci-base`、`rpcd`、`dropbear`；**802.11r 还需要满血 wpad**（`wpad-openssl` / `wpad-wolfssl` / `wpad-mbedtls`），否则总览页会标红。

英文界面需要额外安装翻译包：`opkg install luci-i18n-mesh-lite-en`（apk 环境用 `apk add --allow-untrusted luci-i18n-mesh-lite-en-*.apk`）。

## 平台与格式兼容

| 维度 | 支持情况 | 说明 |
|---|---|---|
| OpenWrt 21.02 / 22.03 / 23.05 | ✅ ipk（opkg） | LuCI 客户端 JS 视图 + POSIX shell 插件 |
| OpenWrt 24.10 | ✅ ipk | CI 用 24.10 SDK 构建 |
| OpenWrt snapshot / 25.x | ✅ apk | CI 用 snapshot SDK 构建，安装需 `--allow-untrusted` |
| ImmortalWrt / LEDE | ✅ 视版本 | 跟随其 opkg / apk 体系 |
| 架构 | ✅ 全部 | `Architecture: all`，无编译产物 |
| 防火墙 | ✅ fw3 / fw4 | **不安装任何防火墙规则**，只在 LAN 内用 SSH，天然兼容 fw4 |

**说明**

- 插件只包含 LuCI JS/JSON、一个 POSIX sh 的 rpcd 脚本和 UCI 配置，没有 C 代码、没有内核模块，因此一个包通吃 x86 / aarch64 / arm / mips / mipsel。
- 双格式不是"一份包两种格式"，而是 CI 用两个 SDK 各构建一次：24.10 SDK 产出 `.ipk`，snapshot SDK 产出 `.apk`。
- fw3/fw4 只影响系统内的防火墙实现；本插件不动防火墙，也不需要放行端口。若将来要跨 zone 管理，应通过 UCI `firewall` 配置（fw4 读取同一份配置），而不是写 iptables 规则。
- LuCI 19.07 及更早使用 Lua 控制器，本插件不支持。

## 本地静态检查

```sh
sh -n ac/luci-app-mesh-lite/root/usr/libexec/rpcd/mesh-lite
sh -n ac/luci-app-mesh-lite/root/etc/uci-defaults/90-mesh-lite
sh ac/tests/helpers-test.sh          # rpcd 纯 shell 逻辑的单元测试
```

JSON 文件（菜单、ACL）可用任意 JSON 解析器校验，例如：

```sh
python3 -m json.tool ac/luci-app-mesh-lite/root/usr/share/luci/menu.d/*.json
python3 -m json.tool ac/luci-app-mesh-lite/root/usr/share/rpcd/acl.d/*.json
```

提交前确认两个脚本有可执行位：

```sh
chmod +x ac/luci-app-mesh-lite/root/usr/libexec/rpcd/mesh-lite
chmod +x ac/luci-app-mesh-lite/root/etc/uci-defaults/90-mesh-lite
```

## 上机验证清单（M1）

1. 安装后菜单出现 "网络 → Mesh Lite"；
2. 总览页能显示 wpad 变体、是否满血、sshpass、角色、LAN IP；
3. 点【一键生成 SSH 密钥】后出现公钥与指纹，刷新后仍在；
4. 修改角色并保存，`uci get mesh_lite.general.role` 能读到。

## 已知限制

- 跨源限制导致"打开 AP 后台后自动登录"做不到，只能复制凭据或用 ttyd 终端。
- 不同驱动的 `iwinfo` 字段有差异，巡检页需要做字段兼容（M4）。
- `dropbear` 与 `openssh` 的 `authorized_keys` 路径不同，M3 需同时兼容。

## 许可证

Apache-2.0（与作者既有 `luci-app-static-gw` 保持一致）。
