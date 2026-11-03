include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-mesh-lite
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_PO_VERSION:=0.1.0

LUCI_TITLE:=Mesh Lite - OpenWrt AC/AP unified Wi-Fi configuration
LUCI_DESCRIPTION:=统一配置 802.11k/v/r、FT 参数与 SSID，提供 AC/AP 角色、凭据阶梯与节点巡检。
LUCI_DEPENDS:=+luci-base +rpcd +dropbear
LUCI_PKGARCH:=all
LUCI_MAINTAINER:=Lemonade-22
LUCI_URL:=https://github.com/Lemonade-22/luci-app-mesh-lite

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Lemonade-22

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
