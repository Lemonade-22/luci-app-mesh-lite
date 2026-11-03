'use strict';
'require view';
'require uci';
'require rpc';
'require ui';

var callPoll = rpc.declare({ object: 'mesh-lite', method: 'poll', params: [ 'ip' ], expect: {} });

function deriveMd(ssid) {
	var h = 5381;

	for (var i = 0; i < ssid.length; i++)
		h = ((h << 5) + h + ssid.charCodeAt(i)) >>> 0;

	return ('000' + (h & 0xffff).toString(16)).slice(-4);
}

function expected() {
	var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();
	var mdOv = (uci.get('mesh_lite', 'wizard', 'mobility_domain') || '').trim();
	var mdExplicit = /^[0-9a-fA-F]{4}$/.test(mdOv);

	return {
		ssid: ssid,
		enc: uci.get('mesh_lite', 'profile', 'encryption') || 'psk2',
		md: mdExplicit ? mdOv.toLowerCase() : deriveMd(ssid),
		r2: uci.get('mesh_lite', 'profile', 'enable_r_2g') === '1',
		r5: uci.get('mesh_lite', 'profile', 'enable_r_5g') !== '0',
		k: uci.get('mesh_lite', 'general', 'enable_k') !== '0',
		v: uci.get('mesh_lite', 'general', 'enable_v') !== '0'
	};
}

function cell(text, bad) {
	return E('td', {
		'class': 'td',
		'style': bad ? 'background:#fdecea;color:#c62828;font-weight:bold' : ''
	}, text);
}

return view.extend({
	load: function() {
		return uci.load('mesh_lite');
	},

	results: {},
	progressText: '',

	setProgress: function(text) {
		this.progressText = text;

		var el = document.getElementById('mesh-lite-inspect-progress');

		if (el)
			el.textContent = text;
	},

	renderResults: function() {
		var box = document.getElementById('mesh-lite-inspect-results');
		var exp = expected();
		var nodes = uci.sections('mesh_lite', 'node');
		var self = this;
		var same = 0;
		var diff = 0;
		var fail = 0;

		if (!box)
			return;

		box.innerHTML = '';

		if (!nodes.length) {
			box.appendChild(E('p', { 'class': 'cbi-section-descr' }, _('No nodes yet.')));
			return;
		}

		nodes.forEach(function(n) {
			var ip = n.ip || '';
			var res = self.results[ip];

			box.appendChild(E('h3', { 'style': 'margin-top:12px' },
				(ip || '-') + ' · ' + (n.name || '')));

			if (!res) {
				box.appendChild(E('p', { 'class': 'cbi-section-descr' }, _('Not inspected yet.')));
				return;
			}

			if (res.ok !== true) {
				fail++;
				box.appendChild(E('p', { 'style': 'color:#c62828' },
					_('Unreachable or read failed: %s').format(res.error || _('Unknown'))));
				return;
			}

			var bandOf = {};

			(res.devices || []).forEach(function(d) {
				bandOf[d.dev] = d.band;
			});

			box.appendChild(E('p', { 'class': 'cbi-section-descr' },
				_('Hostname: %s · uptime %s s').format(res.hostname || '-', res.uptime || '-')));

			var rows = [E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Interface')),
				E('th', { 'class': 'th' }, _('Band')),
				E('th', { 'class': 'th' }, _('SSID')),
				E('th', { 'class': 'th' }, _('Encryption')),
				E('th', { 'class': 'th' }, _('802.11r')),
				E('th', { 'class': 'th' }, _('MD')),
				E('th', { 'class': 'th' }, _('802.11k')),
				E('th', { 'class': 'th' }, _('802.11v')),
				E('th', { 'class': 'th' }, _('Password'))
			])];

			var nodeDiff = 0;

			(res.bss || []).forEach(function(b) {
				if (b.mode !== 'ap')
					return;

				var band = bandOf[b.dev] || '';
				var wantR = (band === '2g') ? exp.r2 : exp.r5;
				var gotR = (b.r === '1');
				var badSsid = (b.ssid !== exp.ssid);
				var badEnc = (b.encryption !== exp.enc);
				var badR = (gotR !== wantR);
				var badMd = (wantR && b.md !== exp.md);
				var badK = ((b.k === '1') !== exp.k);
				var badV = ((b.v === '1') !== exp.v);
				var badKey = (b.key !== '1' && exp.enc !== 'none');

				if (badSsid || badEnc || badR || badMd || badK || badV || badKey)
					nodeDiff++;

				rows.push(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, b.name || '-'),
					E('td', { 'class': 'td' }, band || '-'),
					cell(b.ssid || '-', badSsid),
					cell(b.encryption || '-', badEnc),
					cell(gotR ? _('Enabled') : _('Disabled'), badR),
					cell(b.md || '-', badMd),
					cell(b.k === '1' ? _('Yes') : _('No'), badK),
					cell(b.v === '1' ? _('Yes') : _('No'), badV),
					cell(b.key === '1' ? _('yes') : _('none'), badKey)
				]));
			});

			if (nodeDiff)
				diff++;
			else
				same++;

			box.appendChild(E('table', { 'class': 'table' }, rows));
		});

		box.appendChild(E('p', { 'style': 'margin-top:12px;font-weight:bold' },
			_('%d in sync · %d with differences · %d unreachable').format(same, diff, fail)));
	},

	startInspect: function(ev) {
		ev.preventDefault();

		var nodes = uci.sections('mesh_lite', 'node');
		var self = this;

		if (!nodes.length) {
			ui.addNotification(null, E('p', {}, _('No nodes yet; add them on the Nodes page first.')), 'warning');
			return;
		}

		/* 严格串行：一台的结果返回后才发下一台，降低 A53 小主机的并发开销。 */
		var idx = 0;

		this.results = {};
		this.renderResults();

		function step() {
			if (idx >= nodes.length) {
				self.setProgress(_('Inspection complete'));
				return Promise.resolve();
			}

			var n = nodes[idx++];
			var ip = n.ip;

			if (!ip)
				return step();

			self.setProgress(_('Inspecting %s (%d/%d)…').format(ip, idx, nodes.length));

			return callPoll(ip).then(function(res) {
				self.results[ip] = res || { ok: false, error: _('No response') };
				self.renderResults();
				return step();
			}).catch(function(err) {
				self.results[ip] = { ok: false, error: String(err) };
				self.renderResults();
				return step();
			});
		}

		return step();
	},

	clearResults: function(ev) {
		ev.preventDefault();
		this.results = {};
		this.setProgress('');
		this.renderResults();
	},

	render: function() {
		return E('div', {}, [
			E('h2', {}, _('Inspect')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-section-descr' },
					_('Reads each AP actual wireless configuration over SSH and compares it with the current template. Strictly serial: the next AP is only contacted after the previous one returns.')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': this.startInspect.bind(this)
					}, _('Start inspection')),
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.clearResults.bind(this)
					}, _('Clear results'))
				]),
				E('p', { 'id': 'mesh-lite-inspect-progress', 'style': 'margin-top:8px;font-weight:bold' }, '')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Results')),
				E('div', { 'id': 'mesh-lite-inspect-results' }, [
					E('p', { 'class': 'cbi-section-descr' }, _('Results appear node by node after you click Start inspection.'))
				])
			])
		]);
	}
});
