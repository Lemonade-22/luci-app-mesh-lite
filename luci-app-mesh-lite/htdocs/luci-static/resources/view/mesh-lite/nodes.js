'use strict';
'require view';
'require uci';
'require rpc';
'require ui';

var callProbe = rpc.declare({ object: 'mesh-lite', method: 'auth_probe', params: [ 'ip' ], expect: {} });
var callPush = rpc.declare({ object: 'mesh-lite', method: 'auth_push', params: [ 'ip', 'mode', 'user', 'pass' ], expect: {} });
var callVerifyNode = rpc.declare({ object: 'mesh-lite', method: 'auth_verify', params: [ 'ip' ], expect: {} });
var callForget = rpc.declare({ object: 'mesh-lite', method: 'auth_forget', params: [ 'ip' ], expect: {} });
var callDiscover = rpc.declare({ object: 'mesh-lite', method: 'discover', expect: {} });
var callHarden = rpc.declare({ object: 'mesh-lite', method: 'harden', params: [ 'ip' ], expect: {} });

var STATE_LABEL = {
	unknown: _('Unknown'),
	key_ok: _('Key works'),
	override: _('Per-node credential'),
	default: _('Default credential'),
	unified: _('Unified credential'),
	failed: _('Failed')
};

function stateBadge(state) {
	var color = '#c62828';

	if (state === 'key_ok')
		color = '#2e7d32';
	else if (state === 'unknown')
		color = '#9e9e9e';

	return E('span', {
		'style': 'display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;' +
			'color:#fff;background:' + color
	}, STATE_LABEL[state] || state || _('Unknown'));
}

function askPassword(host) {
	return window.prompt(_('Enter the SSH password for %s (root user)').format(host), '');
}

return view.extend({
	load: function() {
		return uci.load('mesh_lite');
	},

	notify: function(msg, type) {
		ui.addNotification(null, E('p', {}, msg), type || 'info');
	},

	setState: function(sid, state) {
		uci.set('mesh_lite', sid, 'auth_state', state);
		return uci.save();
	},

	doProbe: function(sid, ip, ev) {
		ev.preventDefault();

		return callProbe(ip).then(function(res) {
			if (!res || res.ok !== true) {
				this.notify(_('Probe failed: %s').format((res && res.error) || _('Unknown')), 'danger');
				return;
			}

			if (res.key_ok) {
				return this.setState(sid, 'key_ok').then(function() {
					this.notify(_('%s: key works').format(ip), 'info');
					window.location.reload();
				}.bind(this));
			}

			return this.setState(sid, res.port22 ? 'failed' : 'unknown').then(function() {
				this.notify(_('%s: not authorized (port 22 %s, sshpass %s)').format(
					ip,
					res.port22 ? _('open') : _('closed'),
					res.sshpass ? _('installed') : _('not installed')), 'warning');
			}.bind(this));
		}.bind(this));
	},

	doAuthorize: function(sid, ip, ev) {
		ev.preventDefault();

		var self = this;

		return callProbe(ip).then(function(res) {
			if (res && res.key_ok) {
				return self.setState(sid, 'key_ok').then(function() {
					self.notify(_('%s: already authorized, no action needed.').format(ip), 'info');
				});
			}

			if (res && res.sshpass === false) {
				self.notify(_('sshpass is not installed, so automatic authorization is unavailable. Install sshpass or place the public key on the AP manually.'), 'danger');
				return;
			}

			/* 先按“同批默认凭据”试一轮，命中就不用问密码。 */
			return callPush(ip, 'default', 'root', '').then(function(r) {
				if (r && r.ok === true) {
					return self.setState(sid, 'key_ok').then(function() {
						self.notify(_('%s: default credentials matched; authorized.').format(ip), 'info');
						window.location.reload();
					});
				}

				var pass = askPassword(ip);

				if (pass === null || pass === '')
					return;

				return callPush(ip, 'override', 'root', pass).then(function(r2) {
					if (r2 && r2.ok === true) {
						return self.setState(sid, 'key_ok').then(function() {
							self.notify(_('%s: authorized; password saved for this node.').format(ip), 'info');
							window.location.reload();
						});
					}

					self.setState(sid, 'failed');
					self.notify(_('%s: authorization failed (%s)').format(ip, (r2 && r2.error) || _('Unknown')), 'danger');
				});
			});
		});
	},

	doVerify: function(sid, ip, ev) {
		ev.preventDefault();

		return callVerifyNode(ip).then(function(res) {
			if (res && res.ok === true) {
				this.notify(_('%s: connected, hostname %s').format(ip, res.hostname || '-'), 'info');
			}
			else {
				this.notify(_('%s: key login failed').format(ip), 'warning');
			}
		}.bind(this));
	},

	doForget: function(sid, ip, ev) {
		ev.preventDefault();

		if (!confirm(_('Clear the per-node credential for %s?').format(ip)))
			return;

		return callForget(ip).then(function() {
			return uci.set('mesh_lite', sid, 'auth_state', 'unknown');
		}).then(function() {
			return uci.save();
		}).then(function() {
			this.notify(_('Cleared the credential for %s.').format(ip), 'info');
			window.location.reload();
		}.bind(this));
	},

	doRemove: function(sid, ev) {
		ev.preventDefault();

		if (!confirm(_('Remove from the node list? The AP itself is not affected.')))
			return;

		uci.remove('mesh_lite', sid);

		return uci.save().then(function() {
			window.location.reload();
		});
	},

	doOpen: function(ip, ev) {
		ev.preventDefault();
		window.open('http://' + ip + '/cgi-bin/luci', '_blank');
	},

	doHarden: function(sid, ip, ev) {
		ev.preventDefault();

		if (!confirm(_('Disable SSH password login on %s? Make sure key login works first, or you may lock yourself out.').format(ip)))
			return;

		return callHarden(ip).then(function(res) {
			if (res && res.ok === true)
				this.notify(_('%s: password login disabled.').format(ip), 'info');
			else
				this.notify(_('%s: hardening failed (%s)').format(ip, (res && res.error) || _('Unknown')), 'danger');
		}.bind(this));
	},

	doScan: function(ev) {
		ev.preventDefault();

		var box = document.getElementById('mesh-lite-discovered');

		if (box)
			box.innerHTML = '<em>' + _('Scanning…') + '</em>';

		return callDiscover().then(function(res) {
			var nodes = (res && res.nodes) || [];

			this.discovered = nodes;

			if (!box)
				return;

			box.innerHTML = '';

			if (!nodes.length) {
				box.appendChild(E('p', { 'class': 'cbi-section-descr' }, _('No other devices found.')));
				return;
			}

			var rows = [E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:40px' }, ''),
				E('th', { 'class': 'th' }, _('IP')),
				E('th', { 'class': 'th' }, _('Hostname')),
				E('th', { 'class': 'th' }, _('MAC'))
			])];

			nodes.forEach(function(n, idx) {
				rows.push(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, E('input', { 'type': 'checkbox', 'data-idx': String(idx), 'class': 'mesh-lite-pick' })),
					E('td', { 'class': 'td' }, n.ip || '-'),
					E('td', { 'class': 'td' }, n.host || '-'),
					E('td', { 'class': 'td' }, n.mac || '-')
				]));
			});

			box.appendChild(E('table', { 'class': 'table' }, rows));
			box.appendChild(E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': this.addPicked.bind(this)
				}, _('Add selected devices as nodes'))
			]));
		}.bind(this));
	},

	addPicked: function(ev) {
		ev.preventDefault();

		var picks = document.querySelectorAll('.mesh-lite-pick');
		var added = 0;

		picks.forEach(function(cb) {
			if (!cb.checked)
				return;

			var idx = parseInt(cb.getAttribute('data-idx'), 10);
			var n = this.discovered && this.discovered[idx];

			if (!n || !n.ip)
				return;

			var exists = uci.sections('mesh_lite', 'node').some(function(s) {
				return s.ip === n.ip;
			});

			if (exists)
				return;

			var sid = uci.add('mesh_lite', 'node');

			uci.set('mesh_lite', sid, 'ip', n.ip);
			uci.set('mesh_lite', sid, 'name', n.host || n.ip);
			uci.set('mesh_lite', sid, 'auth_state', 'unknown');
			uci.set('mesh_lite', sid, 'cred_mode', 'auto');
			added++;
		}.bind(this));

		if (!added) {
			this.notify(_('No nodes added (they may already exist or none were selected).'), 'warning');
			return;
		}

		return uci.save().then(function() {
			window.location.reload();
		});
	},

	doTakeover: function(ev) {
		ev.preventDefault();

		var nodes = uci.sections('mesh_lite', 'node');

		if (!nodes.length) {
			this.notify(_('No nodes yet.'), 'warning');
			return;
		}

		var pass = window.prompt(_('Unified password: will try to authorize %d node(s)').format(nodes.length), '');

		if (pass === null || pass === '')
			return;

		var self = this;
		var box = document.getElementById('mesh-lite-takeover');
		var okCount = 0;
		var failCount = 0;

		function step(i) {
			if (i >= nodes.length) {
				box.innerHTML = '';
				box.appendChild(E('p', {}, _('Done: %d succeeded, %d failed.')
					.format(okCount, failCount)));
				return Promise.resolve();
			}

			var s = nodes[i];
			var ip = s.ip;

			if (!ip)
				return step(i + 1);

			if (box)
				box.innerHTML = '<em>' + _('Processing %s (%d/%d)…').format(ip, i + 1, nodes.length) + '</em>';

			return callPush(ip, 'unified', 'root', pass).then(function(r) {
				if (r && r.ok === true) {
					okCount++;
					uci.set('mesh_lite', s['.name'], 'auth_state', 'key_ok');
				}
				else {
					failCount++;
					uci.set('mesh_lite', s['.name'], 'auth_state', 'failed');
				}
			}).catch(function() {
				failCount++;
			}).then(function() {
				return step(i + 1);
			});
		}

		return step(0).then(function() {
			return uci.save();
		}).then(function() {
			self.notify(_('Batch authorization done: %d succeeded, %d failed').format(okCount, failCount),
				failCount ? 'warning' : 'info');
		});
	},

	render: function() {
		var nodes = uci.sections('mesh_lite', 'node');

		var rows = [E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('IP')),
			E('th', { 'class': 'th' }, _('Name')),
			E('th', { 'class': 'th' }, _('Status')),
			E('th', { 'class': 'th' }, _('Actions'))
		])];

		if (!nodes.length) {
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': '4' }, _('No nodes yet. Scan or add one manually.'))
			]));
		}

		nodes.forEach(function(s) {
			var ip = s.ip || '-';

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, ip),
				E('td', { 'class': 'td' }, s.name || '-'),
				E('td', { 'class': 'td' }, stateBadge(s.auth_state)),
				E('td', { 'class': 'td' }, [
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doProbe.bind(this, s['.name'], ip) }, _('Probe')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small cbi-button-apply', 'click': this.doAuthorize.bind(this, s['.name'], ip) }, _('Authorize')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doVerify.bind(this, s['.name'], ip) }, _('Inspect')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doOpen.bind(this, ip) }, _('Open web UI')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doHarden.bind(this, s['.name'], ip) }, _('Disable password login')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doForget.bind(this, s['.name'], ip) }, _('Clear credential')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small cbi-button-negative', 'click': this.doRemove.bind(this, s['.name']) }, _('Remove'))
				])
			]));
		}.bind(this));

		return E('div', {}, [
			E('h2', {}, _('Nodes')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Configured nodes')),
				E('table', { 'class': 'table' }, rows),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': this.doTakeover.bind(this)
					}, _('Take over all nodes'))
				]),
				E('div', { 'id': 'mesh-lite-takeover', 'style': 'margin-top:8px' })
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Discovered devices')),
				E('p', { 'class': 'cbi-section-descr' },
					_('Lists devices on the same subnet from DHCP leases and the ARP table. After adding, use Authorize to install the SSH key.')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.doScan.bind(this)
					}, _('Scan LAN'))
				]),
				E('div', { 'id': 'mesh-lite-discovered', 'style': 'margin-top:8px' })
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Notes')),
				E('ul', {}, [
					E('li', {}, _('Authorization needs sshpass; without it you must copy the public key into the AP authorized_keys manually.')),
					E('li', {}, _('"Take over all" tries the same password on every node in turn; failures are highlighted.')),
					E('li', {}, _('Clearing the credential only removes the locally stored password; the key already installed on the AP is untouched.'))
				])
			])
		]);
	}
});
