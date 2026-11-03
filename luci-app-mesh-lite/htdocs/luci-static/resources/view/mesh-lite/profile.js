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
			_('Cannot read runtime state: %s').format((result && result.error) || _('Unknown reason')));
	}

	var ifaces = result.ifaces || [];

	if (!ifaces.length)
		return E('p', { 'class': 'cbi-section-descr' },
			_('No hostapd interfaces found. Make sure a full wpad is installed and wireless is running.'));

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('Interface')),
		E('th', { 'class': 'th' }, _('SSID')),
		E('th', { 'class': 'th' }, _('Channel')),
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
				rOn ? _('Enabled') : _('Disabled')),
			E('td', { 'class': 'td' }, i.md || '-'),
			E('td', { 'class': 'td' }, i.k === '1' ? _('Enabled') : _('Disabled')),
			E('td', { 'class': 'td' }, i.v === '1' ? _('Enabled') : _('Disabled')),
			E('td', { 'class': 'td' }, i.ds === '1' ? _('Yes') : _('No'))
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
			_('No wireless interfaces on this device. This is normal if it only acts as an AC.'));

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('Interface')),
		E('th', { 'class': 'th' }, _('Device')),
		E('th', { 'class': 'th' }, _('Band')),
		E('th', { 'class': 'th' }, _('Mode')),
		E('th', { 'class': 'th' }, _('SSID')),
		E('th', { 'class': 'th' }, _('Encryption')),
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
			E('td', { 'class': 'td' }, s.ieee80211r === '1' ? _('Enabled') : _('Disabled')),
			E('td', { 'class': 'td' }, s.mobility_domain || '-'),
			E('td', { 'class': 'td' }, s.ieee80211k === '1' ? _('Yes') : _('No')),
			E('td', { 'class': 'td' }, s.bss_transition === '1' ? _('Yes') : _('No'))
		]));
	});

	return E('table', { 'class': 'table' }, rows);
}

function paintLocal(box, verify) {
	if (!box)
		return;

	box.innerHTML = '';
	box.appendChild(renderLocalConfigTable());
	box.appendChild(E('h4', { 'style': 'margin-top:12px' }, _('Runtime state (hostapd read-back)')));
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
		}, _('Apply to template and restart local and AP radios'))
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
		}, _('Apply to template and restart AP radios')),
		E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'style': 'padding-left:8px;padding-right:8px;border-left:1px solid rgba(255,255,255,.35)',
			'title': _('More apply options'),
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
					_('Template saved. No AP nodes configured, skipping push (add nodes on the Nodes page first).')), 'warning');
				return;
			}

			var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();
			var mdAuto = uci.get('mesh_lite', 'general', 'md_auto') !== '0';
			var md = mdAuto ? deriveMd(ssid) : (uci.get('mesh_lite', 'general', 'mobility_domain') || '');

			return callApplyNodes(md).then(function(res) {
				if (!res || res.ok !== true)
					ui.addNotification(null, E('p', {},
						_('Template saved, but pushing to APs failed: %s').format((res && res.error) || _('Unknown reason'))), 'warning');
				else
					ui.addNotification(null, E('p', {},
						_('Template saved and pushed to %d AP(s).').format(res.count || 0)), 'info');
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
			ui.addNotification(null, E('p', {}, _('SSID must not be empty.')), 'danger');
			return Promise.resolve(false);
		}

		if (enc !== 'none' && key.length < 8) {
			ui.addNotification(null, E('p', {}, _('WPA password must be at least 8 characters; use encryption "none" for an open network.')), 'danger');
			return Promise.resolve(false);
		}

		if (!mdAuto && !/^[0-9a-fA-F]{4}$/.test(md)) {
			ui.addNotification(null, E('p', {}, _('Mobility domain must be four hex digits, e.g. a1b2.')), 'danger');
			return Promise.resolve(false);
		}

		var ifaces = apInterfaces();

		if (!ifaces.length) {
			ui.addNotification(null, E('p', {}, _('No AP interfaces available to apply.')), 'danger');
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
			ta.innerHTML = '<em>' + _('Reloading wireless and reading back…') + '</em>';

		return uci.save().then(function() {
			return callApplyWireless();
		}).then(function() {
			return new Promise(function(resolve) { window.setTimeout(resolve, 5000); });
		}).then(function() {
			return callVerifyWireless();
		}).then(function(res) {
			paintLocal(ta, res);
			ui.addNotification(null, E('p', {}, _('Configuration written and local wireless reloaded.')), 'info');
			return true;
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Apply failed: %s').format(err)), 'danger');
			return false;
		});
	},

	refreshLocal: function(ev) {
		ev.preventDefault();

		var box = document.getElementById('mesh-lite-local');

		if (box)
			box.innerHTML = '<em>' + _('Reading…') + '</em>';

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

		ui.showModal(_('Export configuration'), [
			E('p', { 'class': 'cbi-section-descr' },
				_('Save the following as profile.json to import on other APs. Note: it contains the Wi-Fi password.')),
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
						ui.addNotification(null, E('p', {}, _('Copied to clipboard (if the browser allows it).')), 'info');
					}
				}, _('Copy')),
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': ui.hideModal
				}, _('Disable'))
			])
		]);
	},

	importProfile: function(ev) {
		ev.preventDefault();

		var self = this;
		var ta = E('textarea', {
			'rows': 12,
			'style': 'width:100%;font-family:monospace;font-size:12px',
			'placeholder': _('Paste profile.json content')
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

		ui.showModal(_('Import configuration'), [
			E('p', { 'class': 'cbi-section-descr' },
				_('Paste or choose profile.json and click Import. It only writes the template; nothing is pushed.')),
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
								_('JSON parse failed: %s').format(e)), 'danger');
							return;
						}

						self.applyImport(data).then(function() {
							ui.hideModal();
						});
					}
				}, _('Import')),
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': ui.hideModal
				}, _('Cancel'))
			])
		]);
	},

	applyImport: function(data) {
		if (!data || typeof data !== 'object') {
			ui.addNotification(null, E('p', {}, _('The imported content is not a valid configuration object.')), 'danger');
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
			ui.addNotification(null, E('p', {}, _('Configuration imported into the template.')), 'info');
			window.location.reload();
		});
	},

	render: function(data) {
		var verify = data[2] || {};

		var m = new form.Map('mesh_lite', _('Configuration Profile'),
			_('Define one set of Wi-Fi and roaming parameters for the whole network. Applying writes them to every local AP interface and reloads wireless.'));

		var s = m.section(form.TypedSection, 'profile', _('Wireless template'));
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.Value, 'ssid', _('SSID'));
		o.rmempty = false;
		o.placeholder = 'Home';

		o = s.option(form.Value, 'key', _('Password'),
			_('For an open network, set encryption to none.'));
		o.password = true;

		o = s.option(form.ListValue, 'encryption', _('Encryption'));
		o.value('psk2', 'WPA2-PSK (CCMP)');
		o.value('psk-mixed', 'WPA/WPA2-PSK 混合');
		o.value('sae', 'WPA3-SAE');
		o.value('sae-mixed', 'WPA2/WPA3 混合');
		o.value('none', _('Open (no password)'));

		o = s.option(form.Flag, 'hidden', _('Hide SSID'));
		o.default = '0';

		o = s.option(form.Value, 'beacon', _('Beacon interval (ms)'));
		o.datatype = 'uinteger';
		o.default = '100';

		o = s.option(form.Value, 'channel_2g', _('2.4G channel'),
			_('Empty means do not change; auto means automatic.'));
		o.placeholder = _('auto or 1-13');

		o = s.option(form.Value, 'channel_5g', _('5G channel'),
			_('Empty means do not change; auto means automatic.'));
		o.placeholder = _('auto or 36-165');

		o = s.option(form.Value, 'txpower_2g', _('2.4G tx power (dBm)'));
		o.datatype = 'uinteger';

		o = s.option(form.Value, 'txpower_5g', _('5G tx power (dBm)'));
		o.datatype = 'uinteger';

		o = s.option(form.ListValue, 'bw_2g', _('2.4G bandwidth'));
		o.value('', _('Do not change'));
		o.value('HT20', 'HT20');
		o.value('HT40', 'HT40');

		o = s.option(form.ListValue, 'bw_5g', _('5G bandwidth'));
		o.value('', _('Do not change'));
		o.value('VHT80', 'VHT80');
		o.value('VHT160', 'VHT160');

		o = s.option(form.Flag, 'enable_r_5g', _('Enable 802.11r on 5G'));
		o.default = '1';

		o = s.option(form.Flag, 'enable_r_2g', _('Enable 802.11r on 2.4G'),
			_('Not recommended: 802.11r on 2.4G tends to flap.'));
		o.default = '0';

		var ft = m.section(form.TypedSection, 'settings', _('Roaming parameters (802.11k/v and FT)'));
		ft.anonymous = true;
		ft.addremove = false;

		o = ft.option(form.Flag, 'enable_k', _('Enable 802.11k'));
		o.default = '1';

		o = ft.option(form.Flag, 'enable_v', _('Enable 802.11v'));
		o.default = '1';

		o = ft.option(form.Flag, 'md_auto', _('Derive mobility domain automatically'));
		o.default = '1';

		o = ft.option(form.Value, 'mobility_domain', _('Mobility domain (MD)'));
		o.placeholder = 'a1b2';
		o.depends('md_auto', '0');
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (!/^[0-9a-fA-F]{4}$/.test(value))
				return _('Mobility domain must be four hex digits, e.g. a1b2');
			return true;
		};

		o = ft.option(form.Flag, 'ft_over_ds', _('FT over DS'));
		o.default = '1';

		o = ft.option(form.Flag, 'ft_psk_generate_local', _('Generate PMK locally (FT-PSK)'));
		o.default = '1';

		/* 自定义的“应用”按钮需要先保存表单，因此把 Map 挂在 view 上。 */
		this.map = m;

		return m.render().then(function(node) {
			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Local wireless information')),
				E('p', { 'class': 'cbi-section-descr' },
					_('Read this device wireless configuration and runtime state (it may act only as an AC or also as an AP) to confirm the template was applied.')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.refreshLocal.bind(this)
					}, _('Read local wireless information'))
				]),
				E('div', { 'id': 'mesh-lite-local', 'style': 'margin-top:12px' }, [
					renderLocalConfigTable(),
					E('h4', { 'style': 'margin-top:12px' }, _('Runtime state (hostapd read-back)')),
					renderVerifyTable(verify)
				])
			]));

			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Apply')),
				E('p', { 'class': 'cbi-section-descr' },
					_('"Apply to template" only saves the template; "restart AP radios" pushes it to managed APs.')),
				E('div', { 'class': 'cbi-page-actions' }, [
					renderSplitButton(this),
					E('button', {
						'class': 'btn cbi-button',
						'click': this.importProfile.bind(this)
					}, _('Import configuration')),
					E('button', {
						'class': 'btn cbi-button',
						'click': this.exportProfile.bind(this)
					}, _('Export configuration'))
				])
			]));

			return node;
		}.bind(this));
	}
});
