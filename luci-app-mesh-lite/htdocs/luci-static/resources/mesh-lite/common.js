'use strict';
'require uci';

/*
 * mesh-lite 共享模块（融合 Phase 1）
 *
 * 唯一职责：把"同一份规则"从五个页面里收拢到一处。
 * 背景：原实现把 SSID -> 移动域 的派生复制在 wizard/profile/inspect 三个文件里，
 * 且三处读取的 UCI 来源还不一样（wizard 读 wizard.mobility_domain，
 * profile 读 general.*，inspect 只读 wizard.*），于是同一网络在不同页面能看到
 * 不同 MD。现在统一为：
 *
 *   MD 的权威值 = /etc/config/mesh_lite 的 general.md_auto / general.mobility_domain
 *   派生规则   = djb2(SSID) 取低 16 位（4 位小写 hex）
 *
 * 与 wifiroam 的冲突处理：对方用 sha256("md:"+ssid) 派生。融合方案不跟随对方的
 * 算法，而是明确"MD 由 AC 计算一次、以显式值下发"，agent 侧只落盘不推导，
 * 这样两种算法不会在同一个网络里混用。
 */

/* djb2：同 SSID 必得同值，不需要用户理解 MD 是什么。 */
function deriveMd(ssid) {
	var h = 5381;

	ssid = ssid || '';

	for (var i = 0; i < ssid.length; i++)
		h = ((h << 5) + h + ssid.charCodeAt(i)) >>> 0;

	return ('000' + (h & 0xffff).toString(16)).slice(-4);
}

function validMd(v) {
	return /^[0-9a-fA-F]{4}$/.test(v || '');
}

/* 用户显式指定且 md_auto=0 时才采用；否则一律派生。 */
function overrideMd() {
	if (uci.get('mesh_lite', 'general', 'md_auto') === '0') {
		var v = (uci.get('mesh_lite', 'general', 'mobility_domain') || '').trim();

		if (validMd(v))
			return v.toLowerCase();
	}

	return null;
}

function effectiveMd(ssid) {
	if (typeof ssid !== 'string')
		ssid = uci.get('mesh_lite', 'profile', 'ssid');

	var ov = overrideMd();

	return ov || deriveMd((ssid || '').trim());
}

function mdIsExplicit() {
	return overrideMd() !== null;
}

/* 下次下发要用的版本号：单调递增，只有全部 AP 成功后才落盘。 */
function nextConfigVer() {
	var v = parseInt(uci.get('mesh_lite', 'general', 'config_ver') || '0', 10);

	return isNaN(v) ? 1 : v + 1;
}

function currentConfigVer() {
	var v = parseInt(uci.get('mesh_lite', 'general', 'config_ver') || '0', 10);

	return isNaN(v) ? 0 : v;
}

return {
	deriveMd: deriveMd,
	validMd: validMd,
	overrideMd: overrideMd,
	effectiveMd: effectiveMd,
	mdIsExplicit: mdIsExplicit,
	nextConfigVer: nextConfigVer,
	currentConfigVer: currentConfigVer
};
