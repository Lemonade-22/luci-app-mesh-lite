'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var callRadioInfo = rpc.declare({
	object: 'mesh-lite',
	method: 'radio_info',
	expect: {}
});

/* 与 profile 页保持一致的 SSID -> 移动域派生规则。 */
function deriveMd(ssid) {
	var h = 5381;

	for (var i = 0; i < ssid.length; i++)
		h = ((h << 5) + h + ssid.charCodeAt(i)) >>> 0;

	return ('000' + (h & 0xffff).toString(16)).slice(-4);
}

/* 覆盖值：'1' 强制开、'0' 强制关、其它（含空）使用自动值。 */
function tri(opt, auto) {
	var v = uci.get('mesh_lite', 'wizard', opt);

	if (v === '1')
		return true;
	if (v === '0')
		return false;
	return auto;
}

function computeEffective() {
	var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();
	var mdOv = (uci.get('mesh_lite', 'wizard', 'mobility_domain') || '').trim();
	var mdExplicit = /^[0-9a-fA-F]{4}$/.test(mdOv);
	var beaconOv = (uci.get('mesh_lite', 'wizard', 'beacon') || '').trim();
	var beaconExplicit = /^[0-9]+$/.test(beaconOv);

	return {
		ssid: ssid,
		md: mdExplicit ? mdOv.toLowerCase() : deriveMd(ssid),
		mdExplicit: mdExplicit,
		r5: tri('enable_r_5g', true),
		r2: tri('enable_r_2g', false),
		k: tri('enable_k', true),
		v: tri('enable_v', true),
		ds: tri('ft_over_ds', true),
		local: tri('ft_psk_generate_local', true),
		beacon: beaconExplicit ? beaconOv : '100',
		beaconExplicit: beaconExplicit
	};
}

function renderEffectiveTable(eff) {
	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('Item')),
		E('th', { 'class': 'th' }, _('Values to write into the template')),
		E('th', { 'class': 'th' }, _('Source'))
	])];

	function row(name, value, explicit) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, name),
			E('td', { 'class': 'td' }, value),
			E('td', { 'class': 'td' }, explicit ? _('Overridden') : _('Auto'))
		]));
	}

	row(_('Mobility domain (MD)'), eff.md, eff.mdExplicit);
	row(_('802.11r (5G)'), eff.r5 ? _('Enable') : _('Disable'), false);
	row(_('802.11r (2.4G)'), eff.r2 ? _('Enable') : _('Disable'), false);
	row(_('802.11k'), eff.k ? _('Enable') : _('Disable'), false);
	row(_('802.11v'), eff.v ? _('Enable') : _('Disable'), false);
	row(_('FT over DS'), eff.ds ? _('Enable') : _('Disable'), false);
	row(_('Generate PMK locally'), eff.local ? _('Enable') : _('Disable'), false);
	row(_('Beacon interval'), eff.beacon + ' ms', eff.beaconExplicit);

	return E('table', { 'class': 'table' }, rows);
}

function renderRadioTable(radios) {
	if (!radios.length)
		return E('p', { 'class': 'cbi-section-descr' },
			_('No radios detected. This is normal if this device only acts as an AC.'));

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('Radio')),
		E('th', { 'class': 'th' }, _('Band')),
		E('th', { 'class': 'th' }, _('Current channel')),
		E('th', { 'class': 'th' }, _('Current tx power (driver default)'))
	])];

	radios.forEach(function(r) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, r.name || '-'),
			E('td', { 'class': 'td' }, r.band || '-'),
			E('td', { 'class': 'td' }, r.cur_channel || r.channel || '-'),
			E('td', { 'class': 'td' }, r.cur_txpower ? (r.cur_txpower + ' dBm') : _('Determined by driver'))
		]));
	});

	return E('table', { 'class': 'table' }, rows);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wireless'),
			uci.load('mesh_lite'),
			uci.load('system'),
			callRadioInfo().catch(function() { return { radios: [] }; })
		]);
	},

	resetWizard: function(ev) {
		ev.preventDefault();

		var keys = [ 'mobility_domain', 'enable_r_5g', 'enable_r_2g', 'enable_k',
			'enable_v', 'ft_over_ds', 'ft_psk_generate_local', 'beacon' ];

		keys.forEach(function(k) {
			uci.set('mesh_lite', 'wizard', k, '');
		});

		return uci.save().then(function() {
			window.location.reload();
		});
	},

	/* 只写模板，不下发、不重载无线。 */
	saveTemplate: function(ev) {
		ev.preventDefault();

		var box = document.getElementById('mesh-lite-wizard-result');
		var effBox = document.getElementById('mesh-lite-effective');

		return Promise.resolve(this.map.save()).then(function() {
			var eff = computeEffective();
			var enc = uci.get('mesh_lite', 'profile', 'encryption') || 'psk2';
			var key = uci.get('mesh_lite', 'profile', 'key') || '';

			if (!eff.ssid) {
				ui.addNotification(null, E('p', {}, _('Please fill in the SSID first.')), 'danger');
				return false;
			}

			if (enc !== 'none' && key.length < 8) {
				ui.addNotification(null, E('p', {},
					_('WPA password must be at least 8 characters; use encryption "none" for an open network.')), 'danger');
				return false;
			}

			uci.set('mesh_lite', 'general', 'md_auto', eff.mdExplicit ? '0' : '1');
			uci.set('mesh_lite', 'general', 'mobility_domain', eff.mdExplicit ? eff.md : '');
			uci.set('mesh_lite', 'general', 'enable_k', eff.k ? '1' : '0');
			uci.set('mesh_lite', 'general', 'enable_v', eff.v ? '1' : '0');
			uci.set('mesh_lite', 'general', 'ft_over_ds', eff.ds ? '1' : '0');
			uci.set('mesh_lite', 'general', 'ft_psk_generate_local', eff.local ? '1' : '0');

			uci.set('mesh_lite', 'profile', 'hidden', '0');
			uci.set('mesh_lite', 'profile', 'beacon', eff.beacon);
			uci.set('mesh_lite', 'profile', 'enable_r_2g', eff.r2 ? '1' : '0');
			uci.set('mesh_lite', 'profile', 'enable_r_5g', eff.r5 ? '1' : '0');

			return uci.save().then(function() {
				if (effBox) {
					effBox.innerHTML = '';
					effBox.appendChild(renderEffectiveTable(eff));
				}

				if (box) {
					box.innerHTML = '';
					box.appendChild(E('p', { 'style': 'font-weight:bold;color:#2e7d32' },
						_('Template saved: SSID %s, mobility domain %s').format(eff.ssid, eff.md)));
					box.appendChild(E('p', { 'class': 'cbi-section-descr' },
						_('Nothing is pushed automatically. Go to the Configuration Profile page and use "Apply to template and restart AP radios" or the split-button alternative.')));
					box.appendChild(E('a', {
						'class': 'btn cbi-button cbi-button-apply',
						'href': '#/admin/network/mesh-lite/profile'
					}, _('Open Configuration Profile to apply')));
				}

				ui.addNotification(null, E('p', {}, _('Template saved, not pushed yet.')), 'info');
				return true;
			});
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Save failed: %s').format(err)), 'danger');
			return false;
		});
	},

	render: function(data) {
		var radio = data[3] || { radios: [] };
		var radios = radio.radios || [];
		var eff = computeEffective();

		var m = new form.Map('mesh_lite', _('Quick setup'),
			_('Generates the template only, no push. Fill in SSID and password; advanced fields left empty are generated automatically. Apply from the Configuration Profile page afterwards.'));

		var s = m.section(form.TypedSection, 'profile', _('Basic settings'));
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

		var w = m.section(form.TypedSection, 'wizard', _('Advanced (empty = automatic)'),
			_('Leave these empty to use the default rules; filled values take precedence.'));
		w.anonymous = true;
		w.addremove = false;

		o = w.option(form.Value, 'mobility_domain', _('Mobility domain (MD)'),
			_('Leave empty to derive from the SSID.'));
		o.placeholder = eff.md + _('(auto)');
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (!/^[0-9a-fA-F]{4}$/.test(value))
				return _('Mobility domain must be four hex digits, e.g. a1b2');
			return true;
		};

		o = w.option(form.ListValue, 'enable_r_5g', _('802.11r (5G)'));
		o.value('', _('Auto (on)'));
		o.value('1', _('Force on'));
		o.value('0', _('Force off'));

		o = w.option(form.ListValue, 'enable_r_2g', _('802.11r (2.4G)'));
		o.value('', _('Auto (off)'));
		o.value('1', _('Force on'));
		o.value('0', _('Force off'));

		o = w.option(form.ListValue, 'enable_k', _('802.11k'));
		o.value('', _('Auto (on)'));
		o.value('1', _('Force on'));
		o.value('0', _('Force off'));

		o = w.option(form.ListValue, 'enable_v', _('802.11v'));
		o.value('', _('Auto (on)'));
		o.value('1', _('Force on'));
		o.value('0', _('Force off'));

		o = w.option(form.ListValue, 'ft_over_ds', _('FT over DS'));
		o.value('', _('Auto (on)'));
		o.value('1', _('Force on'));
		o.value('0', _('Force off'));

		o = w.option(form.ListValue, 'ft_psk_generate_local', _('Generate PMK locally'));
		o.value('', _('Auto (on)'));
		o.value('1', _('Force on'));
		o.value('0', _('Force off'));

		o = w.option(form.Value, 'beacon', _('Beacon interval (ms)'),
			_('Leave empty for 100.'));
		o.placeholder = '100' + _('(auto)');
		o.datatype = 'uinteger';

		this.map = m;

		return m.render().then(function(node) {
			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Values written into the template')),
				E('div', { 'id': 'mesh-lite-effective' }, [ renderEffectiveTable(eff) ]),
				E('p', { 'class': 'cbi-section-descr' },
					_('Empty fields use the automatic value; filled fields show as overridden here.'))
			]));

			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Radio status (not modified by this page)')),
				renderRadioTable(radios),
				E('p', { 'class': 'cbi-section-descr' },
					_('Channel and tx power are controlled by the driver and existing configuration; use the Configuration Profile page for precise control.'))
			]));

			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': this.saveTemplate.bind(this)
					}, _('Generate template')),
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.resetWizard.bind(this)
					}, _('Reset to fully automatic')),
					E('a', {
						'class': 'btn cbi-button',
						'href': '#/admin/network/mesh-lite/profile'
					}, _('Open Configuration Profile'))
				]),
				E('div', { 'id': 'mesh-lite-wizard-result', 'style': 'margin-top:12px' })
			]));

			return node;
		}.bind(this));
	}
});
