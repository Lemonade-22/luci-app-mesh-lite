import io
import os

PO = 'luci-app-mesh-lite/po/zh_Hans/luci-app-mesh-lite.po'
POT = 'luci-app-mesh-lite/po/templates/luci-app-mesh-lite.pot'

TRANS = {
    '"Apply to template" only saves the template; "restart AP radios" pushes it to managed APs.':
        '"应用模板"只保存模板；"重启 AP 无线"才会下发到纳管的 AP。',
    '"Take over all" tries the same password on every node in turn; failures are highlighted.':
        '"一键接管全部"会用同一密码依次尝试每台节点；失败项会高亮显示。',
    'Add a from="LAN subnet" restriction to the public key when writing it to an AP.':
        '写入 AP 时给公钥加上 from="LAN 网段" 限制。',
    'Agent returned unparsable client data.':
        '代理返回的客户端数据无法解析。',
    'Client':
        '客户端',
    'Clients (%d)':
        '客户端（%d）',
    'Config version: %s (in sync)':
        '配置版本：%s（一致）',
    'Config version: expected %s, AP reports %s (out of sync)':
        '配置版本：期望 %s，AP 报告 %s（不一致）',
    'Live Tx/Rx':
        '实时 发/收',
    'No wireless clients reported by the agent.':
        '代理未报告任何无线客户端。',
    'Nothing is pushed automatically. Go to the Configuration Profile page and use "Apply to template and restart AP radios" or the split-button alternative.':
        '不会自动下发。请到「配置模板」页使用「应用到模板并重启 AP 无线」，或使用分体按钮的另一种方式。',
    'Rate Tx/Rx':
        '速率 发/收',
    'Signal':
        '信号',
    'Template saved and pushed to %d AP(s), config version %s.':
        '模板已保存并推送到 %d 台 AP，配置版本 %s。',
    'WPA password must be at least 8 characters; use encryption "none" for an open network.':
        'WPA 密码至少 8 个字符；开放网络请把加密方式设为「无」。',
    'mesh-lite-agent: %s client(s), config version %s':
        'mesh-lite-agent：%s 个客户端，配置版本 %s',
    'wifi reload failed':
        '无线重载失败',
}


def esc(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def load_ids(path):
    ids = set()
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('msgid "') and line.endswith('"'):
            ids.add(line[7:-1].replace('\\"', '"').replace('\\\\', '\\'))
    return ids


def append(path, entries):
    with open(path, 'a', encoding='utf-8', newline='') as f:
        for msgid, msgstr in entries:
            f.write('\nmsgid "%s"\nmsgstr "%s"\n' % (esc(msgid), esc(msgstr)))


def main():
    have = load_ids(PO)
    need = [(m, TRANS[m]) for m in TRANS if m not in have]
    # 补进 zh_Hans（带译文）与 pot（空 msgstr，作为新键登记）
    append(PO, need)
    pot_have = load_ids(POT)
    missing_pot = [(m, '') for m, _ in need if m not in pot_have]
    append(POT, missing_pot)
    print('appended to po: %d, to pot: %d' % (len(need), len(missing_pot)))


if __name__ == '__main__':
    main()
