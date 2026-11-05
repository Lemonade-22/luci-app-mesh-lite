# luci-app-mesh-lite

[![Build ipk and apk](https://github.com/Lemonade-22/luci-app-mesh-lite/actions/workflows/build.yml/badge.svg)](https://github.com/Lemonade-22/luci-app-mesh-lite/actions/workflows/build.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

LuCI application that turns a plain OpenWrt box into a small **AC + AP** controller:
one place to define SSID, security and roaming parameters, push them to stock OpenWrt APs,
and read back what the APs actually run.

It deliberately does **not** implement EasyMesh/Multi-AP. It uses the standard
802.11k / 802.11v / 802.11r support that `hostapd` already provides, and adds the
configuration glue that OpenWrt lacks.

> **Status: pre-release.** All five pages and the rpcd backend are implemented and covered by
> 56 local unit tests, but nothing has been validated on real hardware yet. See
> [STATUS.md](STATUS.md) for the current state.

---

## Features

- **Five LuCI pages** — Quick Setup, Overview, Configuration Profile, Nodes, Inspect.
- **One template for the whole network** — SSID, password, encryption, beacon, 2.4G/5G channel,
  tx power and bandwidth, 802.11r/k/v, FT-over-DS, locally generated PMK.
- **Mobility domain derived from the SSID** (djb2, low 16 bits), so every AP computes the same
  value without the operator having to understand what a mobility domain is. Manual override
  available.
- **Quick Setup wizard** — fill in SSID and password only; every advanced value has an automatic
  default and can be overridden. It writes the template, it never pushes on its own.
- **Credential ladder for AP onboarding** — existing key → per-node stored credential →
  common default credentials (`root` with empty password, `root`, `password`, `admin`, …) →
  one unified password for all nodes. `sshpass` is only needed for the password steps.
- **Split apply button** — *Apply to template and restart AP radios* by default; hover the arrow
  to also apply on this device (useful when the AC also has radios).
- **Serial inspection** — reads each AP over SSH one at a time (never in parallel), compares the
  actual configuration with the template, and highlights differences. Designed for small
  4×A53 boxes.
- **SSH key management** — one-click ed25519 key generation (dropbear-compatible), optional
  `from="LAN"` restriction, optional disabling of password login on an AP.
- **Architecture independent** — LuCI JS + JSON + one POSIX shell rpcd plugin. `Architecture: all`.
- **Bilingual** — English is the source language; install `luci-i18n-mesh-lite-zh-cn` for the Chinese UI.
- **Optional read-only agent** — install `mesh-lite-agent` on an AP and inspection returns structured
  state (clients, RSSI, rates, config version) in one call instead of parsing SSH text. No agent?
  Everything falls back to the SSH poll, unchanged. The agent never writes configuration and
  never handles credentials.

---

## Requirements

| Item | Notes |
| --- | --- |
| OpenWrt 21.02 or newer | LuCI client-side JS views are required (19.07 and older are not supported) |
| `luci-base`, `rpcd`, `dropbear` | Pulled in as package dependencies |
| **full wpad** | `wpad-openssl` / `wpad-wolfssl` / `wpad-mbedtls`. The default `wpad-basic` has no 802.11r; the Overview page detects this and reports it |
| `sshpass` (optional) | Needed to automate the first password-based authorization |
| `timeout` (optional) | Used to cap SSH calls; without it a dead AP can block the request |
| `mesh-lite-agent` (optional) | Install on APs you want to observe in structured form. Pulls in `ucode`; not needed for the core workflow |
| firewall | Works with both fw3 and fw4 — the app installs **no firewall rules** |

---

## Installation

### Prebuilt packages (GitHub Releases)

Every push to `main` builds both formats and publishes its own release
(tag `v<version>-r<release>-<UTC date>-run<number>`).

| File | Target |
| --- | --- |
| `luci-app-mesh-lite_*_all.ipk` | OpenWrt 24.10 and older (opkg) |
| `luci-i18n-mesh-lite-zh-cn_*_all.ipk` | Chinese UI (opkg) |
| `luci-app-mesh-lite-*.apk` | OpenWrt snapshot / 25.x (apk) |
| `luci-i18n-mesh-lite-zh-cn-*.apk` | Chinese UI (apk) |
| `mesh-lite-agent_*_all.ipk` / `mesh-lite-agent-*.apk` | Optional agent, install **on APs** |

All packages are `Architecture: all` — one file serves every device.

```sh
# opkg (24.10 and older)
opkg install luci-app-mesh-lite_*_all.ipk
opkg install luci-i18n-mesh-lite-zh-cn_*_all.ipk  # optional, Chinese UI

# apk (snapshot / 25.x); the SDK signing key is not published, hence --allow-untrusted
apk add --allow-untrusted luci-app-mesh-lite-*.apk
apk add --allow-untrusted luci-i18n-mesh-lite-zh-cn-*.apk
```

### Optional agent on APs

The AC works without it. Install it on an AP only if you want inspection to return
structured state (client list with signal and rates, applied config version):

```sh
# opkg
opkg install mesh-lite-agent_*_all.ipk

# apk
apk add --allow-untrusted mesh-lite-agent-*.apk

/etc/init.d/mesh-lite-agent enable
/etc/init.d/mesh-lite-agent start
ubus call mesh-lite-agent status     # sanity check
```

The agent is read-only: it never writes UCI, never reloads radios and never handles
credentials. Uninstall it and the AC silently falls back to the SSH text poll.

### From source

```sh
cp -r luci-app-mesh-lite openwrt/package/
cp -r mesh-lite-agent openwrt/package/        # optional
cd openwrt
make menuconfig          # LuCI → Applications → luci-app-mesh-lite
make package/luci-app-mesh-lite/compile V=s
make package/mesh-lite-agent/compile V=s      # optional
```

Reload LuCI after installing; the menu appears under **Network → Mesh Lite**.

---

## Quick start

1. **Overview** — choose the role (`AC`, `AP`, `Standalone`), check that a full `wpad` is
   installed, and press **Generate SSH key**.
2. **Nodes** — scan the LAN (or add IPs manually), then **Authorize** each AP. The ladder tries
   the key, then common default credentials, then asks for a password. **Take over all nodes**
   applies one password to every node.
3. **Quick Setup** — fill in SSID and password. Advanced fields show what will be generated
   (mobility domain, 802.11r per band, 802.11k/v, FT-over-DS, beacon) and can be overridden.
   This step only writes the template.
4. **Configuration Profile** — review, then **Apply to template and restart AP radios**.
   Hover the arrow for *Apply to template and restart local and AP radios* when this device
   also broadcasts Wi-Fi.
5. **Inspect** — read every AP back, one by one, and check the expected-vs-actual table.

---

## How it works

```
AC (OpenWrt)                                   AP (stock OpenWrt)
────────────                                   ──────────────────
LuCI pages ── ubus ── rpcd plugin              dropbear + authorized_keys
                          │                         │
                          ├── uci  /etc/config/mesh_lite    (template)
                          ├── uci  /etc/config/wireless    (local radios)
                          └── ssh ────────────────────────► sh -s (base64 script)
                                     │                        uci set …; wifi reload
                                     └── poll ─────────────► uci show wireless / iwinfo
```

- The AP needs **nothing installed** — only SSH reachability and the AC public key.
- Both directions use the same SSH channel: `apply_nodes` pushes the template, `poll` reads it
  back. Values are base64-encoded before being embedded in the remote script, so quotes, spaces
  and backslashes in an SSID or password cannot break it.
- 802.11r is enabled on 5 GHz by default and left off on 2.4 GHz (it tends to flap there).
- The template never touches channel, tx power or bandwidth unless you fill those fields in.

---

## Compatibility

| Dimension | Support |
| --- | --- |
| Architecture | all (`Architecture: all`, no compiled code) |
| OpenWrt 21.02–24.10 | ipk (opkg) |
| OpenWrt snapshot / 25.x | apk |
| ImmortalWrt / LEDE | follows their opkg/apk format |
| Firewall | fw3 and fw4 (no rules installed) |
| LuCI 19.07 and older | not supported |

---

## Notes & limitations

- **No EasyMesh / Multi-AP.** Configuration is centralized, but this is not an interoperable
  EasyMesh controller; you cannot mix it with vendor EasyMesh gear.
- **No agent on the AP.** Configuration is pulled over SSH, so the AP must keep dropbear enabled.
- **Opening an AP's LuCI cannot auto-login.** Cross-origin restrictions prevent it; the Nodes page
  opens the page in a new tab and keeps the credentials next to it.
- **`harden` disables SSH password login on the AP.** Only use it after confirming key login
  works, otherwise you can lock yourself out.
- **SSH calls are capped** by `ssh_timeout` (default 10 s). A batch over many offline nodes can
  still take `10 s × nodes`.
- **Not yet validated on hardware.** LuCI rendering, real `hostapd` read-back and SSH
  authorization all still need a device pass.

---

## Development

```sh
# local checks (no OpenWrt device needed)
sh -n luci-app-mesh-lite/root/usr/libexec/rpcd/mesh-lite
bash -n Scripts/ci-build.sh
sh tests/helpers-test.sh        # 72 unit tests with command stubs
sh tests/agent-test.sh          # 37 static contract checks for the optional agent
sh tests/po-test.sh             # every UI string has a translation entry

# build both formats locally with the official OpenWrt SDK
bash Scripts/ci-build.sh ipk   https://downloads.openwrt.org/releases/24.10.0/targets/x86/64/
bash Scripts/ci-build.sh apk   https://downloads.openwrt.org/snapshots/targets/x86/64/
```

```
.
├── DESIGN.md                     architecture, credential ladder, interfaces, milestones
├── STATUS.md                     current state, verification, known risks
├── Scripts/ci-build.sh           SDK build script (ipk/apk)
├── luci-app-mesh-lite/           the package
│   ├── root/                     UCI, menu, ACL, rpcd plugin
│   ├── htdocs/…/mesh-lite/       five LuCI views
│   └── po/                       Chinese translation + template
└── tests/                        unit tests and command stubs
```

---

## License

Apache-2.0. See [LICENSE](LICENSE).
