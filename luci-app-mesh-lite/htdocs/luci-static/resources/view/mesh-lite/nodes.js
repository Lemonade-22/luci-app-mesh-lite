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
	unknown: _('未知'),
	key_ok: _('密钥可用'),
	override: _('单独凭据'),
	default: _('默认凭据'),
	unified: _('统一凭据'),
	failed: _('失败')
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
	}, STATE_LABEL[state] || state || _('未知'));
}

function askPassword(host) {
	return window.prompt(_('请输入 %s 的 SSH 密码（root 用户）').format(host), '');
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
				this.notify(_('探测失败：%s').format((res && res.error) || _('未知')), 'danger');
				return;
			}

			if (res.key_ok) {
				return this.setState(sid, 'key_ok').then(function() {
					this.notify(_('%s：密钥可用').format(ip), 'info');
					window.location.reload();
				}.bind(this));
			}

			return this.setState(sid, res.port22 ? 'failed' : 'unknown').then(function() {
				this.notify(_('%s：未授权（端口 22 %s，sshpass %s）').format(
					ip,
					res.port22 ? _('开放') : _('不通'),
					res.sshpass ? _('已装') : _('未装')), 'warning');
			}.bind(this));
		}.bind(this));
	},

	doAuthorize: function(sid, ip, ev) {
		ev.preventDefault();

		var self = this;

		return callProbe(ip).then(function(res) {
			if (res && res.key_ok) {
				return self.setState(sid, 'key_ok').then(function() {
					self.notify(_('%s：已经可用，无需授权。').format(ip), 'info');
				});
			}

			if (res && res.sshpass === false) {
				self.notify(_('未安装 sshpass，无法自动授权。请先安装 sshpass，或手工把公钥放到 AP。'), 'danger');
				return;
			}

			/* 先按“同批默认凭据”试一轮，命中就不用问密码。 */
			return callPush(ip, 'default', 'root', '').then(function(r) {
				if (r && r.ok === true) {
					return self.setState(sid, 'key_ok').then(function() {
						self.notify(_('%s：默认凭据命中，授权成功。').format(ip), 'info');
						window.location.reload();
					});
				}

				var pass = askPassword(ip);

				if (pass === null || pass === '')
					return;

				return callPush(ip, 'override', 'root', pass).then(function(r2) {
					if (r2 && r2.ok === true) {
						return self.setState(sid, 'key_ok').then(function() {
							self.notify(_('%s：授权成功，已记住该台密码。').format(ip), 'info');
							window.location.reload();
						});
					}

					self.setState(sid, 'failed');
					self.notify(_('%s：授权失败（%s）').format(ip, (r2 && r2.error) || _('未知')), 'danger');
				});
			});
		});
	},

	doVerify: function(sid, ip, ev) {
		ev.preventDefault();

		return callVerifyNode(ip).then(function(res) {
			if (res && res.ok === true) {
				this.notify(_('%s：连接正常，主机名 %s').format(ip, res.hostname || '-'), 'info');
			}
			else {
				this.notify(_('%s：密钥登录失败').format(ip), 'warning');
			}
		}.bind(this));
	},

	doForget: function(sid, ip, ev) {
		ev.preventDefault();

		if (!confirm(_('清除 %s 的单独凭据？').format(ip)))
			return;

		return callForget(ip).then(function() {
			return uci.set('mesh_lite', sid, 'auth_state', 'unknown');
		}).then(function() {
			return uci.save();
		}).then(function() {
			this.notify(_('已清除 %s 的凭据。').format(ip), 'info');
			window.location.reload();
		}.bind(this));
	},

	doRemove: function(sid, ev) {
		ev.preventDefault();

		if (!confirm(_('从节点列表移除？不会影响 AP 本身。')))
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

		if (!confirm(_('在 %s 上关闭 SSH 密码登录？请先确认密钥登录可用，否则可能失联。').format(ip)))
			return;

		return callHarden(ip).then(function(res) {
			if (res && res.ok === true)
				this.notify(_('%s：已关闭密码登录。').format(ip), 'info');
			else
				this.notify(_('%s：加固失败（%s）').format(ip, (res && res.error) || _('未知')), 'danger');
		}.bind(this));
	},

	doScan: function(ev) {
		ev.preventDefault();

		var box = document.getElementById('mesh-lite-discovered');

		if (box)
			box.innerHTML = '<em>' + _('扫描中…') + '</em>';

		return callDiscover().then(function(res) {
			var nodes = (res && res.nodes) || [];

			this.discovered = nodes;

			if (!box)
				return;

			box.innerHTML = '';

			if (!nodes.length) {
				box.appendChild(E('p', { 'class': 'cbi-section-descr' }, _('没有发现其他设备。')));
				return;
			}

			var rows = [E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:40px' }, ''),
				E('th', { 'class': 'th' }, _('IP')),
				E('th', { 'class': 'th' }, _('主机名')),
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
				}, _('添加选中的设备为节点'))
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
			this.notify(_('没有新增节点（可能已存在或未勾选）。'), 'warning');
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
			this.notify(_('还没有节点。'), 'warning');
			return;
		}

		var pass = window.prompt(_('统一密码：将对 %d 台节点尝试授权').format(nodes.length), '');

		if (pass === null || pass === '')
			return;

		var self = this;
		var box = document.getElementById('mesh-lite-takeover');
		var okCount = 0;
		var failCount = 0;

		function step(i) {
			if (i >= nodes.length) {
				box.innerHTML = '';
				box.appendChild(E('p', {}, _('完成：成功 %d 台，失败 %d 台。')
					.format(okCount, failCount)));
				return Promise.resolve();
			}

			var s = nodes[i];
			var ip = s.ip;

			if (!ip)
				return step(i + 1);

			if (box)
				box.innerHTML = '<em>' + _('正在处理 %s（%d/%d）…').format(ip, i + 1, nodes.length) + '</em>';

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
			self.notify(_('批量授权完成：成功 %d，失败 %d').format(okCount, failCount),
				failCount ? 'warning' : 'info');
		});
	},

	render: function() {
		var nodes = uci.sections('mesh_lite', 'node');

		var rows = [E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('IP')),
			E('th', { 'class': 'th' }, _('名称')),
			E('th', { 'class': 'th' }, _('状态')),
			E('th', { 'class': 'th' }, _('操作'))
		])];

		if (!nodes.length) {
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': '4' }, _('还没有节点。先扫描或手动添加。'))
			]));
		}

		nodes.forEach(function(s) {
			var ip = s.ip || '-';

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, ip),
				E('td', { 'class': 'td' }, s.name || '-'),
				E('td', { 'class': 'td' }, stateBadge(s.auth_state)),
				E('td', { 'class': 'td' }, [
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doProbe.bind(this, s['.name'], ip) }, _('探测')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small cbi-button-apply', 'click': this.doAuthorize.bind(this, s['.name'], ip) }, _('授权')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doVerify.bind(this, s['.name'], ip) }, _('巡检')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doOpen.bind(this, ip) }, _('打开后台')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doHarden.bind(this, s['.name'], ip) }, _('关闭密码登录')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small', 'click': this.doForget.bind(this, s['.name'], ip) }, _('清除凭据')), ' ',
					E('button', { 'class': 'btn cbi-button cbi-button-small cbi-button-negative', 'click': this.doRemove.bind(this, s['.name']) }, _('移除'))
				])
			]));
		}.bind(this));

		return E('div', {}, [
			E('h2', {}, _('节点')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('已配置节点')),
				E('table', { 'class': 'table' }, rows),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': this.doTakeover.bind(this)
					}, _('一键接管全部节点'))
				]),
				E('div', { 'id': 'mesh-lite-takeover', 'style': 'margin-top:8px' })
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('发现设备')),
				E('p', { 'class': 'cbi-section-descr' },
					_('从 DHCP 租约与 ARP 表里列出同网段设备。添加后可用“授权”写入 SSH 公钥。')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': this.doScan.bind(this)
					}, _('扫描局域网'))
				]),
				E('div', { 'id': 'mesh-lite-discovered', 'style': 'margin-top:8px' })
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('说明')),
				E('ul', {}, [
					E('li', {}, _('授权需要 sshpass；未安装时只能手工把公钥放到 AP 的 authorized_keys。')),
					E('li', {}, _('“一键接管”使用同一个密码依次尝试所有节点，失败的节点会标红。')),
					E('li', {}, _('清除凭据只删除本机保存的密码，不影响已写入 AP 的公钥。'))
				])
			])
		]);
	}
});
