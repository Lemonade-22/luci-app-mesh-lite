'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'mesh-lite',
	method: 'status',
	expect: {}
});

var callGenKey = rpc.declare({
	object: 'mesh-lite',
	method: 'genkey',
	expect: {}
});

function statusRow(label, ok, text) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td', 'style': 'width:30%;white-space:nowrap' }, label),
		E('td', { 'class': 'td' }, [
			E('span', {
				'style': 'display:inline-block;width:8px;height:8px;border-radius:50%;' +
					'margin-right:6px;vertical-align:middle;background:' + (ok ? '#2e7d32' : '#c62828')
			}),
			text
		])
	]);
}

function renderStatusPanel(status) {
	var wpad = status.wpad || '';
	var full = status.full_wpad === true;
	var sshpass = status.sshpass === true;
	var hasKey = status.key_exists === true;

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, _('运行环境检查')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('项目')),
				E('th', { 'class': 'th' }, _('状态'))
			]),
			statusRow(_('Wi-Fi 驱动包（wpad）'), full, wpad ? wpad : _('未检测到')),
			statusRow(_('802.11r 支持'), full,
				full ? _('可用') : _('不可用：需要满血 wpad（wpad-openssl / wpad-wolfssl / wpad-mbedtls）')),
			statusRow(_('sshpass（首次授权自动化）'), sshpass,
				sshpass ? _('已安装') : _('未安装，首次授权将退化为手动输入密码')),
			statusRow(_('SSH 密钥'), hasKey,
				hasKey ? (status.fingerprint || _('已生成')) : _('未生成')),
			statusRow(_('本机角色'), true, status.role || _('未设置')),
			statusRow(_('LAN 地址'), true, status.lan_ip || '-'),
			statusRow(_('防火墙'), true,
				status.firewall === 'fw4' ? 'fw4（nftables）'
					: (status.firewall === 'fw3' ? 'fw3（iptables）'
						: (status.firewall || _('未知'))))
		])
	]);
}

function renderKeyPanel(status) {
	var exists = status.key_exists === true;

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, _('SSH 密钥')),
		E('p', { 'class': 'cbi-section-descr' }, exists
			? _('已生成 ed25519 密钥。指纹：%s').format(status.fingerprint || '-')
			: _('尚未生成密钥。生成后可用于免密登录各 AP。')),
		exists ? E('pre', {
			'style': 'white-space:pre-wrap;word-break:break-all;background:#f7f7f7;' +
				'padding:8px;border-radius:4px;font-size:12px'
		}, status.pubkey || '') : '',
		E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': function(ev) {
				ev.preventDefault();

				if (exists && !confirm(_('密钥已存在。重新生成会使已授权的 AP 全部失效，确定继续？')))
					return;

				var btn = ev.currentTarget;
				btn.disabled = true;

				return callGenKey().then(function(res) {
					if (!res || res.ok !== true) {
						ui.addNotification(null, E('p', {},
							_('生成失败：%s').format((res && res.error) || _('未知错误'))), 'danger');
						btn.disabled = false;
						return;
					}

					ui.addNotification(null, E('p', {},
						_('密钥已就绪：%s').format(res.fingerprint || '')), 'info');
					window.setTimeout(function() { window.location.reload(); }, 800);
				}).catch(function(err) {
					ui.addNotification(null, E('p', {},
						_('调用失败：%s').format(err)), 'danger');
					btn.disabled = false;
				});
			}
		}, exists ? _('重新生成密钥') : _('一键生成 SSH 密钥'))
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('mesh_lite'),
			callStatus().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var status = data[1] || {};

		var m = new form.Map('mesh_lite', _('Mesh Lite'),
			_('统一配置本机的 AC/AP 角色与 802.11k/v/r 参数。修改后点击“保存并应用”。'));

		var s = m.section(form.TypedSection, 'settings', _('角色与漫游'));
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.ListValue, 'role', _('本机角色'),
			_('AC 负责统一配置与巡检；AP 只接受配置；独立模式不参与组网。'));
		o.value('standalone', _('独立（单机）'));
		o.value('controller', _('AC（控制器）'));
		o.value('agent', _('AP（接入点）'));
		o.default = 'standalone';
		o.rmempty = false;

		o = s.option(form.Flag, 'enable_r', _('启用 802.11r（FT）'),
			_('需要满血 wpad；建议只在 5G 开启，2.4G 开 r 容易抖动。'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'enable_k', _('启用 802.11k（邻居报告）'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'enable_v', _('启用 802.11v（BSS 转换管理）'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'md_auto', _('自动生成移动域（MD）'),
			_('开启后由 SSID 派生固定值，保证全屋一致。'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'mobility_domain', _('移动域（MD）'),
			_('4 位十六进制，例如 a1b2。全屋必须一致。'));
		o.placeholder = 'a1b2';
		o.depends('md_auto', '0');
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (!/^[0-9a-fA-F]{4}$/.test(value))
				return _('移动域必须是 4 位十六进制，例如 a1b2');
			return true;
		};

		o = s.option(form.Flag, 'ft_over_ds', _('允许 FT over DS'));
		o.default = '1';

		o = s.option(form.Flag, 'ft_psk_generate_local', _('本地生成 PMK（FT-PSK）'),
			_('家庭 PSK 场景推荐开启，无需配置 R0KH/R1KH。'));
		o.default = '1';

		o = s.option(form.Flag, 'restrict_key_source', _('公钥限制来源网段'),
			_('写入 AP 时为公钥附加 from="LAN 网段" 限制。'));
		o.default = '0';

		o = s.option(form.Value, 'poll_interval', _('巡检间隔（秒）'),
			_('AC 通过 SSH 拉取各 AP 状态的周期。'));
		o.datatype = 'uinteger';
		o.default = '30';

		o = s.option(form.Value, 'ssh_timeout', _('SSH 超时（秒）'),
			_('AP 离线时，单次 SSH 操作的最长等待时间。默认 10 秒。'));
		o.datatype = 'uinteger';
		o.default = '10';

		return m.render().then(function(node) {
			node.appendChild(renderStatusPanel(status));
			node.appendChild(renderKeyPanel(status));
			return node;
		});
	}
});
