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
		E('th', { 'class': 'th' }, _('项目')),
		E('th', { 'class': 'th' }, _('将写入模板的值')),
		E('th', { 'class': 'th' }, _('来源'))
	])];

	function row(name, value, explicit) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, name),
			E('td', { 'class': 'td' }, value),
			E('td', { 'class': 'td' }, explicit ? _('已指定') : _('自动'))
		]));
	}

	row(_('移动域（MD）'), eff.md, eff.mdExplicit);
	row(_('802.11r（5G）'), eff.r5 ? _('开启') : _('关闭'), false);
	row(_('802.11r（2.4G）'), eff.r2 ? _('开启') : _('关闭'), false);
	row(_('802.11k'), eff.k ? _('开启') : _('关闭'), false);
	row(_('802.11v'), eff.v ? _('开启') : _('关闭'), false);
	row(_('FT over DS'), eff.ds ? _('开启') : _('关闭'), false);
	row(_('本地生成 PMK'), eff.local ? _('开启') : _('关闭'), false);
	row(_('Beacon 间隔'), eff.beacon + ' ms', eff.beaconExplicit);

	return E('table', { 'class': 'table' }, rows);
}

function renderRadioTable(radios) {
	if (!radios.length)
		return E('p', { 'class': 'cbi-section-descr' },
			_('没有检测到射频。若这台设备只当 AC，这是正常的。'));

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('射频')),
		E('th', { 'class': 'th' }, _('频段')),
		E('th', { 'class': 'th' }, _('当前信道')),
		E('th', { 'class': 'th' }, _('当前功率（驱动默认）'))
	])];

	radios.forEach(function(r) {
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, r.name || '-'),
			E('td', { 'class': 'td' }, r.band || '-'),
			E('td', { 'class': 'td' }, r.cur_channel || r.channel || '-'),
			E('td', { 'class': 'td' }, r.cur_txpower ? (r.cur_txpower + ' dBm') : _('由驱动决定'))
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
				ui.addNotification(null, E('p', {}, _('请先填写 SSID。')), 'danger');
				return false;
			}

			if (enc !== 'none' && key.length < 8) {
				ui.addNotification(null, E('p', {},
					_('WPA 密码至少 8 位；开放网络请把加密方式设为 none。')), 'danger');
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
						_('模板已保存：SSID %s，移动域 %s').format(eff.ssid, eff.md)));
					box.appendChild(E('p', { 'class': 'cbi-section-descr' },
						_('下发不会自动发生。请到“配置模板”页，用【应用到模板并重启 AP 无线】或【应用到模板并重启本机和 AP 无线】执行。')));
					box.appendChild(E('a', {
						'class': 'btn cbi-button cbi-button-apply',
						'href': '#/admin/network/mesh-lite/profile'
					}, _('前往配置模板页应用')));
				}

				ui.addNotification(null, E('p', {}, _('模板已保存，尚未下发。')), 'info');
				return true;
			});
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('保存失败：%s').format(err)), 'danger');
			return false;
		});
	},

	render: function(data) {
		var radio = data[3] || { radios: [] };
		var radios = radio.radios || [];
		var eff = computeEffective();

		var m = new form.Map('mesh_lite', _('一键配置'),
			_('只生成模板，不下发。最少填 SSID 与密码；高级项留空即自动生成。保存后到“配置模板”页执行下发。'));

		var s = m.section(form.TypedSection, 'profile', _('基本信息'));
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

		var w = m.section(form.TypedSection, 'wizard', _('高级（留空即自动）'),
			_('这些项不填就按默认规则生成；填了以填写值为准。'));
		w.anonymous = true;
		w.addremove = false;

		o = w.option(form.Value, 'mobility_domain', _('移动域（MD）'),
			_('留空则由 SSID 派生。'));
		o.placeholder = eff.md + _('（自动）');
		o.validate = function(section_id, value) {
			if (!value)
				return true;
			if (!/^[0-9a-fA-F]{4}$/.test(value))
				return _('移动域必须是 4 位十六进制，例如 a1b2');
			return true;
		};

		o = w.option(form.ListValue, 'enable_r_5g', _('802.11r（5G）'));
		o.value('', _('自动（开启）'));
		o.value('1', _('强制开启'));
		o.value('0', _('强制关闭'));

		o = w.option(form.ListValue, 'enable_r_2g', _('802.11r（2.4G）'));
		o.value('', _('自动（关闭）'));
		o.value('1', _('强制开启'));
		o.value('0', _('强制关闭'));

		o = w.option(form.ListValue, 'enable_k', _('802.11k'));
		o.value('', _('自动（开启）'));
		o.value('1', _('强制开启'));
		o.value('0', _('强制关闭'));

		o = w.option(form.ListValue, 'enable_v', _('802.11v'));
		o.value('', _('自动（开启）'));
		o.value('1', _('强制开启'));
		o.value('0', _('强制关闭'));

		o = w.option(form.ListValue, 'ft_over_ds', _('FT over DS'));
		o.value('', _('自动（开启）'));
		o.value('1', _('强制开启'));
		o.value('0', _('强制关闭'));

		o = w.option(form.ListValue, 'ft_psk_generate_local', _('本地生成 PMK'));
		o.value('', _('自动（开启）'));
		o.value('1', _('强制开启'));
		o.value('0', _('强制关闭'));

		o = w.option(form.Value, 'beacon', _('Beacon 间隔（ms）'),
			_('留空则为 100。'));
		o.placeholder = '100' + _('（自动）');
		o.datatype = 'uinteger';

		this.map = m;

		return m.render().then(function(node) {
			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('模板将写入的值')),
				E('div', { 'id': 'mesh-lite-effective' }, [ renderEffectiveTable(eff) ]),
				E('p', { 'class': 'cbi-section-descr' },
					_('留空的项按“自动”取值；填写覆盖值后这里会显示“已指定”。'))
			]));

			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('射频现状（本页不会修改）')),
				renderRadioTable(radios),
				E('p', { 'class': 'cbi-section-descr' },
					_('信道与功率始终由驱动和现有配置决定；需要精确控制请到“配置模板”页。'))
			]));

			node.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': this.saveTemplate.bind(this)
					}, _('一键生成模板')),
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.resetWizard.bind(this)
					}, _('恢复全自动')),
					E('a', {
						'class': 'btn cbi-button',
						'href': '#/admin/network/mesh-lite/profile'
					}, _('前往配置模板'))
				]),
				E('div', { 'id': 'mesh-lite-wizard-result', 'style': 'margin-top:12px' })
			]));

			return node;
		}.bind(this));
	}
});
