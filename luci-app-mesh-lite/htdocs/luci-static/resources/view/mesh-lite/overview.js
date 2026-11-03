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
		E('h3', {}, _('Environment checks')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Item')),
				E('th', { 'class': 'th' }, _('Status'))
			]),
			statusRow(_('Wi-Fi driver package (wpad)'), full, wpad ? wpad : _('Not detected')),
			statusRow(_('802.11r support'), full,
				full ? _('Available') : _('Unavailable: requires a full wpad (wpad-openssl / wpad-wolfssl / wpad-mbedtls)')),
			statusRow(_('sshpass (automates first-time authorization)'), sshpass,
				sshpass ? _('Installed') : _('Not installed; first authorization falls back to entering the password manually')),
			statusRow(_('SSH key'), hasKey,
				hasKey ? (status.fingerprint || _('Generated')) : _('Not generated')),
			statusRow(_('Local role'), true, status.role || _('Not set')),
			statusRow(_('LAN address'), true, status.lan_ip || '-'),
			statusRow(_('Firewall'), true,
				status.firewall === 'fw4' ? 'fw4（nftables）'
					: (status.firewall === 'fw3' ? 'fw3（iptables）'
						: (status.firewall || _('Unknown'))))
		])
	]);
}

function renderKeyPanel(status) {
	var exists = status.key_exists === true;

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, _('SSH key')),
		E('p', { 'class': 'cbi-section-descr' }, exists
			? _('ed25519 key generated. Fingerprint: %s').format(status.fingerprint || '-')
			: _('No key yet. Once generated it allows passwordless login to APs.')),
		exists ? E('pre', {
			'style': 'white-space:pre-wrap;word-break:break-all;background:#f7f7f7;' +
				'padding:8px;border-radius:4px;font-size:12px'
		}, status.pubkey || '') : '',
		E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': function(ev) {
				ev.preventDefault();

				if (exists && !confirm(_('A key already exists. Regenerating invalidates all authorized APs. Continue?')))
					return;

				var btn = ev.currentTarget;
				btn.disabled = true;

				return callGenKey().then(function(res) {
					if (!res || res.ok !== true) {
						ui.addNotification(null, E('p', {},
							_('Generation failed: %s').format((res && res.error) || _('Unknown error'))), 'danger');
						btn.disabled = false;
						return;
					}

					ui.addNotification(null, E('p', {},
						_('Key ready: %s').format(res.fingerprint || '')), 'info');
					window.setTimeout(function() { window.location.reload(); }, 800);
				}).catch(function(err) {
					ui.addNotification(null, E('p', {},
						_('Call failed: %s').format(err)), 'danger');
					btn.disabled = false;
				});
			}
		}, exists ? _('Regenerate key') : _('Generate SSH key'))
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
			_('Configure this device role and 802.11k/v/r parameters. Click Save & Apply after changes.'));

		var s = m.section(form.TypedSection, 'settings', _('Role and roaming'));
		s.anonymous = true;
		s.addremove = false;

		var o = s.option(form.ListValue, 'role', _('Local role'),
			_('AC handles unified configuration and inspection; AP only receives configuration; standalone mode is not part of the mesh.'));
		o.value('standalone', _('Standalone'));
		o.value('controller', _('AC (controller)'));
		o.value('agent', _('AP (access point)'));
		o.default = 'standalone';
		o.rmempty = false;

		o = s.option(form.Flag, 'enable_r', _('Enable 802.11r (FT)'),
			_('Requires a full wpad; only enable on 5G, 802.11r on 2.4G tends to flap.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'enable_k', _('Enable 802.11k (neighbor reports)'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'enable_v', _('Enable 802.11v (BSS transition management)'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'md_auto', _('Derive mobility domain (MD) automatically'),
			_('When enabled, a fixed value is derived from the SSID so the whole network matches.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'mobility_domain', _('Mobility domain (MD)'),
			_('Four hex digits, e.g. a1b2. Must be identical across the whole network.'));
		o.placeholder = 'a1b2';
		o.depends('md_auto', '0');
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (!/^[0-9a-fA-F]{4}$/.test(value))
				return _('Mobility domain must be four hex digits, e.g. a1b2');
			return true;
		};

		o = s.option(form.Flag, 'ft_over_ds', _('Allow FT over DS'));
		o.default = '1';

		o = s.option(form.Flag, 'ft_psk_generate_local', _('Generate PMK locally (FT-PSK)'),
			_('Recommended for home PSK networks; no R0KH/R1KH configuration needed.'));
		o.default = '1';

		o = s.option(form.Flag, 'restrict_key_source', _('Restrict public key to the LAN subnet'),
			_('Add a from="LAN subnet" restriction to the public key when writing it to an AP.'));
		o.default = '0';

		o = s.option(form.Value, 'poll_interval', _('Inspection interval (seconds)'),
			_('How often the AC pulls each AP state over SSH.'));
		o.datatype = 'uinteger';
		o.default = '30';

		o = s.option(form.Value, 'ssh_timeout', _('SSH timeout (seconds)'),
			_('Maximum wait for a single SSH operation when an AP is offline. Default 10 seconds.'));
		o.datatype = 'uinteger';
		o.default = '10';

		return m.render().then(function(node) {
			node.appendChild(renderStatusPanel(status));
			node.appendChild(renderKeyPanel(status));
			return node;
		});
	}
});
