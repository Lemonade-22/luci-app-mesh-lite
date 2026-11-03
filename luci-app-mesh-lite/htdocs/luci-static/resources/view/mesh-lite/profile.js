'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var callApplyWireless = rpc.declare({
	object: 'mesh-lite',
	method: 'apply_wireless',
	expect: {}
});

var callVerifyWireless = rpc.declare({
	object: 'mesh-lite',
	method: 'verify_wireless',
	expect: {}
});

/* 由 SSID 派生 4 位十六进制移动域，保证同 SSID 的设备得到同一个值。 */
function deriveMd(ssid) {
	var h = 5381;

	for (var i = 0; i < ssid.length; i++)
		h = ((h << 5) + h + ssid.charCodeAt(i)) >>> 0;

	return ('000' + (h & 0xffff).toString(16)).slice(-4);
}

function bandOf(iface) {
	var band = null;

	if (iface.device) {
		band = uci.get('wireless', iface.device, 'band');

		if (!band) {
			var ch = parseInt(uci.get('wireless', iface.device, 'channel'), 10);
			if (!isNaN(ch))
				band = (ch <= 14) ? '2g' : '5g';
		}
	}

	return band || 'unknown';
}

function apInterfaces() {
	return uci.sections('wireless', 'wifi-iface').filter(function(s) {
		return s.mode === 'ap';
	});
}

function renderVerifyTable(result) {
	if (!result || result.ok !== true) {
		return E('p', { 'class': 'cbi-section-descr' },
			_('无法回读运行态：%s').format((result && result.error) || _('未知原因')));
	}

	var ifaces = result.ifaces || [];

	if (!ifaces.length)
		return E('p', { 'class': 'cbi-section-descr' },
			_('没有读到 hostapd 接口。请确认已安装满血 wpad 且无线已启动。'));

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('接口')),
		E('th', { 'class': 'th' }, _('SSID')),
		E('th', { 'class': 'th' }, _('信道')),
		E('th', { 'class': 'th' }, _('802.11r')),
		E('th', { 'class': 'th' }, _('MD')),
		E('th', { 'class': 'th' }, _('802.11k')),
		E('th', { 'class': 'th' }, _('802.11v')),
		E('th', { 'class': 'th' }, _('FT over DS'))
	])];

	ifaces.forEach(function(i) {
		var rOn = (i.r === '1');
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, i.ifname || '-'),
			E('td', { 'class': 'td' }, i.ssid || '-'),
			E('td', { 'class': 'td' }, i.channel || '-'),
			E('td', { 'class': 'td', 'style': 'color:' + (rOn ? '#2e7d32' : '#c62828') },
				rOn ? _('已启用') : _('未启用')),
			E('td', { 'class': 'td' }, i.md || '-'),
			E('td', { 'class': 'td' }, i.k === '1' ? _('已启用') : _('未启用')),
			E('td', { 'class': 'td' }, i.v === '1' ? _('已启用') : _('未启用')),
			E('td', { 'class': 'td' }, i.ds === '1' ? _('是') : _('否'))
		]));
	});

	return E('table', { 'class': 'table' }, rows);
}

var callApplyNodes = rpc.declare({
	object: 'mesh-lite',
	method: 'apply_nodes',
	params: [ 'md' ],
	expect: {}
});

/* 本机（可能是 AC，也可能同时是 AP）的无线配置，直接来自 UCI。 */
function renderLocalConfigTable() {
	var ifaces = uci.sections('wireless', 'wifi-iface');

	if (!ifaces.length)
		return E('p', { 'class': 'cbi-section-descr' },
			_('本机没有无线接口配置。若这台设备只当 AC，这是正常的。'));

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('接口')),
		E('th', { 'class': 'th' }, _('设备')),
		E('th', { 'class': 'th' }, _('频段')),
		E('th', { 'class': 'th' }, _('模式')),
		E('th', { 'class': 'th' }, _('SSID')),
		E('th', { 'class': 'th' }, _('加密')),
		E('th', { 'class': 'th' }, _('802.11r')),
		E('th', { 'class': 'th' }, _('MD')),
		E('th', { 'class': 'th' }, _('11k')),
		E('th', { 'class': 'th' }, _('11v'))
	])];

	ifaces.forEach(function(s) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, s['.name']),
			E('td', { 'class': 'td' }, s.device || '-'),
			E('td', { 'class': 'td' }, bandOf(s)),
			E('td', { 'class': 'td' }, s.mode || '-'),
			E('td', { 'class': 'td' }, s.ssid || '-'),
			E('td', { 'class': 'td' }, s.encryption || '-'),
			E('td', { 'class': 'td' }, s.ieee80211r === '1' ? _('已启用') : _('未启用')),
			E('td', { 'class': 'td' }, s.mobility_domain || '-'),
			E('td', { 'class': 'td' }, s.ieee80211k === '1' ? _('是') : _('否')),
			E('td', { 'class': 'td' }, s.bss_transition === '1' ? _('是') : _('否'))
		]));
	});

	return E('table', { 'class': 'table' }, rows);
}

function paintLocal(box, verify) {
	if (!box)
		return;

	box.innerHTML = '';
	box.appendChild(renderLocalConfigTable());
	box.appendChild(E('h4', { 'style': 'margin-top:12px' }, _('运行态（hostapd 回读）')));
	box.appendChild(renderVerifyTable(verify));
}

/* 主按钮 + 悬停下拉的第二动作。 */
function renderSplitButton(v) {
	var menu;

	var hide = function() {
		if (menu)
			menu.style.display = 'none';
	};

	menu = E('div', {
		'style': 'position:absolute;top:100%;left:0;margin-top:4px;background:#fff;' +
			'border:1px solid rgba(0,0,0,.15);border-radius:4px;z-index:1000;min-width:300px;' +
			'box-shadow:0 4px 12px rgba(0,0,0,.15);display:none'
	}, [
		E('button', {
			'class': 'btn cbi-button',
			'style': 'display:block;width:100%;text-align:left;border:0;background:transparent;' +
				'padding:8px 12px;white-space:nowrap',
			'click': function(ev) {
				ev.preventDefault();
				hide();
				v.applyLocalAndRemote();
			}
		}, _('应用到模板并重启本机和 AP 无线'))
	]);

	return E('div', {
		'style': 'position:relative;display:inline-flex;align-items:stretch',
		'mouseenter': function() { menu.style.display = 'block'; },
		'mouseleave': hide
	}, [
		E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': function(ev) {
				ev.preventDefault();
				v.applyRemoteOnly();
			}
		}, _('应用到模板并重启 AP 无线')),
		E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'style': 'padding-left:8px;padding-right:8px;border-left:1px solid rgba(255,255,255,.35)',
			'title': _('更多应用方式'),
			'click': function(ev) {
				ev.preventDefault();
				menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
			}
		}, '\u25be'),
		menu
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wireless'),
			uci.load('mesh_lite'),
			callVerifyWireless().catch(function() { return { ok: false }; })
		]);
	},

	persistTemplate: function() {
		return Promise.resolve(this.map.save());
	},

	applyRemoteOnly: function() {
		var self = this;

		return this.persistTemplate().then(function() {
			var nodes = uci.sections('mesh_lite', 'node');

			if (!nodes.length) {
				ui.addNotification(null, E('p', {},
					_('模板已保存。尚未配置 AP 节点，跳过下发（请先在“节点”页添加）。')), 'warning');
				return;
			}

			var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();
			var mdAuto = uci.get('mesh_lite', 'general', 'md_auto') !== '0';
			var md = mdAuto ? deriveMd(ssid) : (uci.get('mesh_lite', 'general', 'mobility_domain') || '');

			return callApplyNodes(md).then(function(res) {
				if (!res || res.ok !== true)
					ui.addNotification(null, E('p', {},
						_('模板已保存，但 AP 下发未成功：%s').format((res && res.error) || _('未知原因'))), 'warning');
				else
					ui.addNotification(null, E('p', {},
						_('模板已保存并下发到 %d 台 AP。').format(res.count || 0)), 'info');
			});
		});
	},

	applyLocalAndRemote: function() {
		var self = this;

		return this.persistTemplate().then(function() {
			return self.writeLocalWireless();
		}).then(function(ok) {
			if (ok === false)
				return;
			return self.applyRemoteOnly();
		});
	},

	writeLocalWireless: function() {
		var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();
		var key = uci.get('mesh_lite', 'profile', 'key') || '';
		var enc = uci.get('mesh_lite', 'profile', 'encryption') || 'psk2';
		var hidden = uci.get('mesh_lite', 'profile', 'hidden') === '1';
		var beacon = uci.get('mesh_lite', 'profile', 'beacon') || '100';

		var mdAuto = uci.get('mesh_lite', 'general', 'md_auto') !== '0';
		var md = mdAuto ? deriveMd(ssid) : (uci.get('mesh_lite', 'general', 'mobility_domain') || '');
		var r2g = uci.get('mesh_lite', 'profile', 'enable_r_2g') === '1';
		var r5g = uci.get('mesh_lite', 'profile', 'enable_r_5g') !== '0';
		var kOn = uci.get('mesh_lite', 'general', 'enable_k') !== '0';
		var vOn = uci.get('mesh_lite', 'general', 'enable_v') !== '0';
		var ftDs = uci.get('mesh_lite', 'general', 'ft_over_ds') !== '0';
		var ftLocal = uci.get('mesh_lite', 'general', 'ft_psk_generate_local') !== '0';

		if (!ssid) {
			ui.addNotification(null, E('p', {}, _('SSID 不能为空。')), 'danger');
			return Promise.resolve(false);
		}

		if (enc !== 'none' && key.length < 8) {
			ui.addNotification(null, E('p', {}, _('WPA 密码至少 8 位；开放网络请把加密方式设为 none。')), 'danger');
			return Promise.resolve(false);
		}

		if (!mdAuto && !/^[0-9a-fA-F]{4}$/.test(md)) {
			ui.addNotification(null, E('p', {}, _('移动域必须是 4 位十六进制，例如 a1b2。')), 'danger');
			return Promise.resolve(false);
		}

		var ifaces = apInterfaces();

		if (!ifaces.length) {
			ui.addNotification(null, E('p', {}, _('没有可应用的 AP 接口。')), 'danger');
			return Promise.resolve(false);
		}

		ifaces.forEach(function(s) {
			var band = bandOf(s);
			var withR = (band === '2g') ? r2g : (band === '5g' ? r5g : r5g);

			uci.set('wireless', s['.name'], 'ssid', ssid);
			uci.set('wireless', s['.name'], 'hidden', hidden ? '1' : '0');
			uci.set('wireless', s['.name'], 'beacon_int', beacon);

			if (enc === 'none') {
				uci.set('wireless', s['.name'], 'encryption', 'none');
				uci.unset('wireless', s['.name'], 'key');
			}
			else {
				uci.set('wireless', s['.name'], 'encryption', enc);
				uci.set('wireless', s['.name'], 'key', key);
			}

			if (withR) {
				uci.set('wireless', s['.name'], 'ieee80211r', '1');
				uci.set('wireless', s['.name'], 'mobility_domain', md);
				uci.set('wireless', s['.name'], 'ft_over_ds', ftDs ? '1' : '0');
				uci.set('wireless', s['.name'], 'ft_psk_generate_local', ftLocal ? '1' : '0');
			}
			else {
				uci.unset('wireless', s['.name'], 'ieee80211r');
				uci.unset('wireless', s['.name'], 'mobility_domain');
				uci.unset('wireless', s['.name'], 'ft_over_ds');
				uci.unset('wireless', s['.name'], 'ft_psk_generate_local');
			}

			uci.set('wireless', s['.name'], 'ieee80211k', kOn ? '1' : '0');
			uci.set('wireless', s['.name'], 'bss_transition', vOn ? '1' : '0');
			uci.set('wireless', s['.name'], 'time_advertisement', vOn ? '2' : '0');
			uci.set('wireless', s['.name'], 'time_zone', 'CST-8');
		});

		/* 射频参数写到对应的 wifi-device */
		var seenDev = {};

		ifaces.forEach(function(s) {
			var dev = s.device;
			if (!dev || seenDev[dev])
				return;

			seenDev[dev] = true;

			var band = bandOf(s);
			var suffix = (band === '2g') ? '2g' : '5g';
			var ch = uci.get('mesh_lite', 'profile', 'channel_' + suffix);
			var tp = uci.get('mesh_lite', 'profile', 'txpower_' + suffix);
			var bw = uci.get('mesh_lite', 'profile', 'bw_' + suffix);

			if (ch && ch !== 'auto')
				uci.set('wireless', dev, 'channel', ch);
			if (tp !== null && tp !== '')
				uci.set('wireless', dev, 'txpower', tp);
			if (bw && bw !== 'auto')
				uci.set('wireless', dev, 'htmode', bw);
		});

		var ta = document.getElementById('mesh-lite-local');

		if (ta)
			ta.innerHTML = '<em>' + _('正在重载无线并回读…') + '</em>';

		return uci.save().then(function() {
			return callApplyWireless();
		}).then(function() {
			return new Promise(function(resolve) { window.setTimeout(resolve, 5000); });
		}).then(function() {
			return callVerifyWireless();
		}).then(function(res) {
			paintLocal(ta, res);
			ui.addNotification(null, E('p', {}, _('配置已写入并重载本机无线。')), 'info');
			return true;
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('应用失败：%s').format(err)), 'danger');
			return false;
		});
	},

	refreshLocal: function(ev) {
		ev.preventDefault();

		var box = document.getElementById('mesh-lite-local');

		if (box)
			box.innerHTML = '<em>' + _('读取中…') + '</em>';

		return callVerifyWireless().then(function(res) {
			paintLocal(box, res);
		});
	},

	exportProfile: function(ev) {
		ev.preventDefault();

		var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();
		var mdAuto = uci.get('mesh_lite', 'general', 'md_auto') !== '0';
		var md = mdAuto ? deriveMd(ssid) : uci.get('mesh_lite', 'general', 'mobility_domain');

		var profile = {
			version: 1,
			ssid: ssid,
			key: uci.get('mesh_lite', 'profile', 'key') || '',
			encryption: uci.get('mesh_lite', 'profile', 'encryption') || 'psk2',
			hidden: uci.get('mesh_lite', 'profile', 'hidden') === '1',
			beacon: uci.get('mesh_lite', 'profile', 'beacon') || '100',
			mobility_domain: md,
			ieee80211r: true,
			ieee80211k: uci.get('mesh_lite', 'general', 'enable_k') !== '0',
			ieee80211v: uci.get('mesh_lite', 'general', 'enable_v') !== '0',
			ft_over_ds: uci.get('mesh_lite', 'general', 'ft_over_ds') !== '0',
			ft_psk_generate_local: uci.get('mesh_lite', 'general', 'ft_psk_generate_local') !== '0'
		};

		ui.showModal(_('导出配置'), [
			E('p', { 'class': 'cbi-section-descr' },
				_('把下面内容保存为 profile.json，可在其他 AP 上导入。注意：包含 Wi-Fi 密码。')),
			E('textarea', {
				'rows': 14,
				'style': 'width:100%;font-family:monospace;font-size:12px',
				'readonly': 'readonly'
			}, JSON.stringify(profile, null, 2)),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': function() {
						navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
						ui.addNotification(null, E('p', {}, _('已复制到剪贴板（若浏览器允许）。')), 'info');
					}
				}, _('复制')),
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': ui.hideModal
				}, _('关闭'))
			])
		]);
	},

	importProfile: function(ev) {
		ev.preventDefault();

		var self = this;
		var ta = E('textarea', {
			'rows': 12,
			'style': 'width:100%;font-family:monospace;font-size:12px',
			'placeholder': _('粘贴 profile.json 内容')
		});
		var file = E('input', { 'type': 'file', 'accept': '.json,application/json' });

		file.addEventListener('change', function() {
			var f = file.files && file.files[0];

			if (!f)
				return;

			var reader = new FileReader();

			reader.onload = function() {
				ta.value = String(reader.result || '');
			};
			reader.readAsText(f);
		});

		ui.showModal(_('导入配置'), [
			E('p', { 'class': 'cbi-section-descr' },
				_('粘贴或选择 profile.json 后点击“导入”。只写入模板，不会自动下发。')),
			E('p', {}, [ file ]),
			ta,
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function(ev2) {
						ev2.preventDefault();

						var data;

						try {
							data = JSON.parse(ta.value || '');
						}
						catch (e) {
							ui.addNotification(null, E('p', {},
								_('JSON 解析失败：%s').format(e)), 'danger');
							return;
						}

						self.applyImport(data).then(function() {
							ui.hideModal();
						});
					}
				}, _('导入')),
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': ui.hideModal
				}, _('取消'))
			])
		]);
	},

	applyImport: function(data) {
		if (!data || typeof data !== 'object') {
			ui.addNotification(null, E('p', {}, _('导入内容不是有效的配置对象。')), 'danger');
			return Promise.resolve();
		}

		if (typeof data.ssid === 'string' && data.ssid)
			uci.set('mesh_lite', 'profile', 'ssid', data.ssid);
		if (typeof data.key === 'string')
			uci.set('mesh_lite', 'profile', 'key', data.key);
		if (typeof data.encryption === 'string')
			uci.set('mesh_lite', 'profile', 'encryption', data.encryption);
		if (typeof data.hidden === 'boolean')
			uci.set('mesh_lite', 'profile', 'hidden', data.hidden ? '1' : '0');
		if (data.beacon != null && /^[0-9]+$/.test(String(data.beacon)))
			uci.set('mesh_lite', 'profile', 'beacon', String(data.beacon));
		if (typeof data.mobility_domain === 'string' && /^[0-9a-fA-F]{4}$/.test(data.mobility_domain)) {
			uci.set('mesh_lite', 'general', 'md_auto', '0');
			uci.set('mesh_lite', 'general', 'mobility_domain', data.mobility_domain.toLowerCase());
		}
		if (typeof data.ieee80211k === 'boolean')
			uci.set('mesh_lite', 'general', 'enable_k', data.ieee80211k ? '1' : '0');
		if (typeof data.ieee80211v === 'boolean')
			uci.set('mesh_lite', 'general', 'enable_v', data.ieee80211v ? '1' : '0');
		if (typeof data.ft_over_ds === 'boolean')
			uci.set('mesh_lite', 'general', 'ft_over_ds', data.ft_over_ds ? '1' : '0');
		if (typeof data.ft_psk_generate_local === 'boolean')
			uci.set('mesh_lite', 'general', 'ft_psk_generate_local', data.ft_psk_generate_local ? '1' : '0');

		return uci.save().then(function() {
			ui.addNotification(null, E('p', {}, _('配置已导入到模板。')), 'info');
			window.location.reload();
		});
	},

	render: function(data) {
		var verify = data[2] || {};

		var m = new form.Map('mesh_lite', _('配置模板'),
			_('这里定义一套全屋统一的 Wi-Fi 与漫游参数。应用后写入本机所有 AP 接口，并重载无线。'));

		var s = m.section(form.TypedSection, 'profile', _('无线模板'));
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.Value, 'ssid', _('SSID'));
		o.rmempty = false;
		o.placeholder = 'Home';

		o = s.option(form.Value, 'key', _('密码'),
			_('开放网络请把加密方式设为 none。'));
		o.password = true;

		o = s.option(form.ListValue, 'encryption', _('加密方式'));
		o.value('psk2', 'WPA2-PSK (CCMP)');
		o.value('psk-mixed', 'WPA/WPA2-PSK 混合');
		o.value('sae', 'WPA3-SAE');
		o.value('sae-mixed', 'WPA2/WPA3 混合');
		o.value('none', _('开放（无密码）'));

		o = s.option(form.Flag, 'hidden', _('隐藏 SSID'));
		o.default = '0';

		o = s.option(form.Value, 'beacon', _('Beacon 间隔（ms）'));
		o.datatype = 'uinteger';
		o.default = '100';

		o = s.option(form.Value, 'channel_2g', _('2.4G 信道'),
			_('留空表示不修改；auto 表示自动。'));
		o.placeholder = _('auto 或 1-13');

		o = s.option(form.Value, 'channel_5g', _('5G 信道'),
			_('留空表示不修改；auto 表示自动。'));
		o.placeholder = _('auto 或 36-165');

		o = s.option(form.Value, 'txpower_2g', _('2.4G 功率（dBm）'));
		o.datatype = 'uinteger';

		o = s.option(form.Value, 'txpower_5g', _('5G 功率（dBm）'));
		o.datatype = 'uinteger';

		o = s.option(form.ListValue, 'bw_2g', _('2.4G 带宽'));
		o.value('', _('不修改'));
		o.value('HT20', 'HT20');
		o.value('HT40', 'HT40');

		o = s.option(form.ListValue, 'bw_5g', _('5G 带宽'));
		o.value('', _('不修改'));
		o.value('VHT80', 'VHT80');
		o.value('VHT160', 'VHT160');

		o = s.option(form.Flag, 'enable_r_5g', _('5G 开启 802.11r'));
		o.default = '1';

		o = s.option(form.Flag, 'enable_r_2g', _('2.4G 开启 802.11r'),
			_('不建议：2.4G 开 r 容易抖动。'));
		o.default = '0';

		var ft = m.section(form.TypedSection, 'settings', _('漫游参数（802.11k/v 与 FT）'));
		ft.anonymous = true;
		ft.addremove = false;

		o = ft.option(form.Flag, 'enable_k', _('启用 802.11k'));
		o.default = '1';

		o = ft.option(form.Flag, 'enable_v', _('启用 802.11v'));
		o.default = '1';

		o = ft.option(form.Flag, 'md_auto', _('自动生成移动域'));
		o.default = '1';

		o = ft.option(form.Value, 'mobility_domain', _('移动域（MD）'));
		o.placeholder = 'a1b2';
		o.depends('md_auto', '0');
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (!/^[0-9a-fA-F]{4}$/.test(value))
				return _('移动域必须是 4 位十六进制，例如 a1b2');
			return true;
		};

		o = ft.option(form.Flag, 'ft_over_ds', _('FT over DS'));
		o.default = '1';

		o = ft.option(form.Flag, 'ft_psk_generate_local', _('本地生成 PMK（FT-PSK）'));
		o.default = '1';

		/* 自定义的“应用”按钮需要先保存表单，因此把 Map 挂在 view 上。 */
		this.map = m;

		return m.render().then(function(node) {
			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('本机无线信息')),
				E('p', { 'class': 'cbi-section-descr' },
					_('读取本机（可能只当 AC，也可能同时是 AP）的无线配置与运行态，确认模板是否已正确落盘。')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.refreshLocal.bind(this)
					}, _('读取本机无线信息'))
				]),
				E('div', { 'id': 'mesh-lite-local', 'style': 'margin-top:12px' }, [
					renderLocalConfigTable(),
					E('h4', { 'style': 'margin-top:12px' }, _('运行态（hostapd 回读）')),
					renderVerifyTable(verify)
				])
			]));

			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('应用')),
				E('p', { 'class': 'cbi-section-descr' },
					_('“应用到模板”只保存模板；“重启 AP 无线”会把模板下发到已纳管的 AP（节点管理在 M3 提供）。')),
				E('div', { 'class': 'cbi-page-actions' }, [
					renderSplitButton(this),
					E('button', {
						'class': 'btn cbi-button',
						'click': this.importProfile.bind(this)
					}, _('导入配置')),
					E('button', {
						'class': 'btn cbi-button',
						'click': this.exportProfile.bind(this)
					}, _('导出配置'))
				])
			]));

			return node;
		}.bind(this));
	}
});
