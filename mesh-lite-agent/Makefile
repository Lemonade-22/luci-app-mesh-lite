#
# mesh-lite-agent - optional read-only status agent for luci-app-mesh-lite
#
# 只读观察者：不写 UCI、不重载无线、不持有任何密码。装到 AP 上后，
# AC 的巡检页可以用 `ubus call mesh-lite-agent status` 一次拿到结构化状态，
# 不必再跑多轮 SSH 文本采集。不装也完全不影响 AC 的功能。
#

include $(TOPDIR)/rules.mk

PKG_NAME:=mesh-lite-agent
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/mesh-lite-agent
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Read-only status agent for luci-app-mesh-lite
  URL:=https://github.com/Lemonade-22/luci-app-mesh-lite
  DEPENDS:=+ucode +ucode-mod-ubus +ucode-mod-uloop +ucode-mod-fs +ucode-mod-uci
  PKGARCH:=all
endef

define Package/mesh-lite-agent/description
  Optional read-only observer that exposes Wi-Fi clients, per-interface hostapd
  configuration and the applied config version over ubus. It never writes
  configuration, never reloads radios and never handles credentials; it exists
  only so the AC can read AP state without parsing SSH text output.
endef

define Build/Compile
endef

define Package/mesh-lite-agent/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./root/usr/bin/mesh-lite-agent $(1)/usr/bin/mesh-lite-agent
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/mesh-lite-agent $(1)/etc/init.d/mesh-lite-agent
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/mesh-lite-agent $(1)/etc/config/mesh-lite-agent
endef

$(eval $(call BuildPackage,mesh-lite-agent))
