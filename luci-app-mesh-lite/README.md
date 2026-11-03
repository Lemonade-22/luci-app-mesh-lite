# luci-app-mesh-lite

OpenWrt AC/AP 统一 Wi-Fi 配置工具：角色切换、802.11k/v/r 与 FT 参数、凭据阶梯、节点巡检。

## 功能（规划）

- **总览**：角色、运行环境检查（wpad/sshpass/密钥）、一键生成 SSH 密钥
- **配置模板**：SSID/密钥/射频/FT 参数 → 生成本机 wireless 配置
- **节点**：AP 列表、凭据阶梯（预置密钥 → 默认 → 统一 → 单台覆盖）、点击直达
- **巡检**：SSH 拉取各 AP 的期望与实际配置，差异高亮

## 依赖

`luci-base`、`rpcd`、`dropbear`；802.11r 需要满血 wpad（`wpad-openssl` / `wpad-wolfssl` / `wpad-mbedtls`）。`sshpass` 可选，用于首次密码授权自动化。

## 安装

```sh
opkg install luci-app-mesh-lite_*.ipk
# 或 24.10+：
apk add --allow-untrusted luci-app-mesh-lite-*.apk
```

安装后重新登录 LuCI，菜单在 **网络 → Mesh Lite**。

## 配置

- UCI：`/etc/config/mesh_lite`
- 覆盖凭据：`/etc/mesh-lite/secrets`（0600，每行 `ip<TAB>user<TAB>pass`）
- SSH 私钥：`/etc/dropbear/id_ed25519`（0600）

## 设计文档

见仓库上级目录的 `DESIGN.md`。

## 许可

Apache-2.0
