'use strict';
'require view';
'require uci';
'require rpc';
'require ui';
'require mesh-lite.common as mc';

var callPoll = rpc.declare({ object: 'mesh-lite', method: 'poll', params: [ 'ip' ], expect: {} });
var callAgentStatus = rpc.declare({ object: 'mesh-lite', method: 'agent_status', params: [ 'ip' ], expect: {} });
var callAgentClients = rpc.declare({ object: 'mesh-lite', method: 'agent_clients', params: [ 'ip' ], expect: {} });

function fmtNum(v, unit, digits) {
	if (v === null || v === undefined || isNaN(v))
		return '-';

	return Number(v).toFixed(digits === undefined ? 1 : digits) + (unit || '');
}

/* 客户端明细：只展示信号与速率（不拉厂商/品牌库）。空字段一律显示 '-'。 */
function renderAgentClients(ac) {
	var parsed = null;

	try {
		parsed = JSON.parse((ac && ac.clients_json) || '{}');
	}
	catch (e) {
		return E('p', { 'class': 'cbi-section-descr', 'style': 'color:#c62828' },
			_('Agent returned unparsable client data.'));
	}

	var list = (parsed && parsed.clients) || [];

	if (!list.length)
		return E('p', { 'class': 'cbi-section-descr' }, _('No wireless clients reported by the agent.'));

	/* 弱信号排前面：这才是要看的。 */
	list.sort(function(a, b) {
		var ra = (a.rssi === null || a.rssi === undefined) ? 999 : a.rssi;
		var rb = (b.rssi === null || b.rssi === undefined) ? 999 : b.rssi;

		return ra - rb;
	});

	var rows = [E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('Client')),
		E('th', { 'class': 'th' }, _('IP')),
		E('th', { 'class': 'th' }, _('SSID')),
		E('th', { 'class': 'th' }, _('Band')),
		E('th', { 'class': 'th' }, _('Signal')),
		E('th', { 'class': 'th' }, _('Rate Tx/Rx')),
		E('th', { 'class': 'th' }, _('Live Tx/Rx'))
	])];

	list.forEach(function(c) {
		var name = c.hostname || c.mac || '-';

		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, name),
			E('td', { 'class': 'td' }, c.ip || '-'),
			E('td', { 'class': 'td' }, c.ssid || '-'),
			E('td', { 'class': 'td' }, c.band || '-'),
			E('td', { 'class': 'td' }, fmtNum(c.rssi, ' dBm', 0)),
			E('td', { 'class': 'td' }, fmtNum(c.tx_rate, '', 1) + ' / ' + fmtNum(c.rx_rate, '', 1) + ' Mbps'),
			E('td', { 'class': 'td' }, fmtNum(c.tx_speed, '', 1) + ' / ' + fmtNum(c.rx_speed, '', 1) + ' Mbps')
		]));
	});

	return E('table', { 'class': 'table' }, rows);
}

function expected() {
	var ssid = (uci.get('mesh_lite', 'profile', 'ssid') || '').trim();

	return {
		ssid: ssid,
		enc: uci.get('mesh_lite', 'profile', 'encryption') || 'psk2',
		md: mc.effectiveMd(ssid),
		ver: String(mc.currentConfigVer()),
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

			/* 可选 agent：装了就用它的结构化状态，没装就静默跳过，不影响巡检。 */
			var ag = res.agentInfo;

			if (ag && ag.ok === true && ag.agent === true) {
				box.appendChild(E('p', {
					'class': 'cbi-section-descr',
					'style': 'color:#2e7d32'
				}, _('mesh-lite-agent: %s client(s), config version %s').format(
					ag.clients_total || 0, ag.config_ver || '-')));
			}

			var acl = res.agentClients;

			if (acl && acl.ok === true && acl.agent === true) {
				box.appendChild(E('h4', { 'style': 'margin:14px 0 6px' },
					_('Clients (%d)').format(acl.count || 0)));
				box.appendChild(renderAgentClients(acl));
			}

			var nodeDiff = 0;

			/* 收敛核对：期望版本来自本机 UCI，实际版本来自 AP 的 /etc/mesh-lite.ver。
			   两者不一致说明这台 AP 还没吃到最近一次下发，或下发失败了。 */
			var gotVer = (res.ver || '');
			var verBad = (gotVer !== exp.ver);

			box.appendChild(E('p', {
				'style': 'margin:6px 0;color:' + (verBad ? '#c62828' : '#2e7d32')
			}, verBad
				? _('Config version: expected %s, AP reports %s (out of sync)').format(exp.ver, gotVer || _('none'))
				: _('Config version: %s (in sync)').format(exp.ver)));

			if (verBad)
				nodeDiff++;

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

			/* 巡检与 agent 探测并行：agent 缺失/异常都不算失败，只是一条空结果。 */
			return Promise.all([
				callPoll(ip).catch(function(err) {
					return { ok: false, error: String(err) };
				}),
				callAgentStatus(ip).catch(function() {
					return { ok: false, agent: false };
				}),
				callAgentClients(ip).catch(function() {
					return { ok: false, agent: false };
				})
			]).then(function(r) {
				var res = r[0] || { ok: false, error: _('No response') };

				res.agentInfo = r[1] || null;
				res.agentClients = r[2] || null;
				self.results[ip] = res;
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
