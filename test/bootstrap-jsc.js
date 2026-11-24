// The real bootstrap.js against mocks: conflict detection, part start/stop order, failure isolation,
// and uninstall only on genuine removal. Run from the repo root:  jsc test/bootstrap-jsc.js
var errors = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

function scenario(opts) {
	var log = [], logged = [], written = {}, removed = [], alerts = [], reinits = 0, api = null;
	var activeAddons = opts.activeAddons || [];
	var Zotero = {
		initializationPromise: Promise.resolve(), uiReadyPromise: Promise.resolve(),
		debug: function (m) { logged.push(m); }, logError: function (e) { errors.push('logError: ' + (e && e.message || e)); log.push('logError'); },
		getMainWindow: function () { return {}; }, getTranslatorsDirectory: function () { return { path: '/tz' }; },
		File: {
			getResourceAsync: function (url) { return Promise.resolve('// ' + url); },
			getContentsAsync: function () { return Promise.reject(new Error('absent')); },
			putContentsAsync: function (p, s) { written[p] = s; return Promise.resolve(); },
		},
		Translators: { reinit: function () { reinits++; return Promise.resolve(); } },
	};
	var fakeHiCite = {
		init: function (o) { log.push('hicite.init:' + (Zotero.Lawcite ? 'lawcite-set' : 'lawcite-MISSING') + ':' + o.rootURI); if (opts.hiciteFails) return Promise.reject(new Error('boom')); return Promise.resolve(); },
		addToAllWindows: function () { log.push('hicite.addToAllWindows'); },
		removeFromAllWindows: function () { log.push('hicite.removeFromAllWindows'); },
		destroy: function () { log.push('hicite.destroy'); },
		addToWindow: function (w) { log.push('hicite.addToWindow'); }, removeFromWindow: function (w) { log.push('hicite.removeFromWindow'); },
	};
	var Services = {
		scriptloader: { loadSubScript: function (url, scope) {
			if (/citation-phoenix\.js$/.test(url)) {
				log.push('phoenix.load');
				scope.CitationPhoenix = {
					activate: function (o) { log.push('phoenix.activate:' + o.rootURI.spec); return Promise.resolve(); },
					deactivate: function () { log.push('phoenix.deactivate'); return Promise.resolve(); },
				};
			}
			else if (/hicite-export\.js$/.test(url)) { log.push('hicite.load'); api.setHiCite(fakeHiCite); }
		} },
		prompt: { alert: function (w, t, text) { alerts.push(text); } },
	};
	var ChromeUtils = { importESModule: function () { return { AddonManager: { getAddonByID: function (id) {
		return Promise.resolve(activeAddons.indexOf(id) >= 0 ? { id: id, isActive: true } : (opts.disabledAddons && opts.disabledAddons.indexOf(id) >= 0 ? { id: id, isActive: false } : null));
	} } }; } };
	var IOUtils = { remove: function (p) { removed.push(p); return Promise.resolve(); } };
	var PathUtils = { join: function () { return Array.prototype.join.call(arguments, '/'); } };
	var src = read('bootstrap.js');
	api = new Function('Zotero', 'Services', 'ChromeUtils', 'IOUtils', 'PathUtils',
		src + '; return { startup: startup, shutdown: shutdown, uninstall: uninstall, onMainWindowLoad: onMainWindowLoad, setHiCite: function (v) { HiCite = v; } };')(Zotero, Services, ChromeUtils, IOUtils, PathUtils);
	return { api: api, Zotero: Zotero, log: log, written: written, removed: removed, alerts: alerts, reinits: function () { return reinits; } };
}

var base = { id: 'lawcite@zotero.local', version: '9.9.9', rootURI: 'jar:file:///x.xpi!/' };

Promise.resolve().then(function () {
	// 1. normal start, then shutdown
	var s = scenario({});
	return s.api.startup(base, 1).then(function () {
		eq(s.log, ['phoenix.load', 'phoenix.activate:jar:file:///x.xpi!/', 'hicite.load', 'hicite.init:lawcite-set:jar:file:///x.xpi!/hicite/', 'hicite.addToAllWindows'], 'start order (phoenix before hicite; Zotero.Lawcite set first)');
		eq(Object.keys(s.written).length, 6, 'six translators installed');
		eq(s.written['/tz/Westlaw (legal).js'], '// jar:file:///x.xpi!/translators/Westlaw%20(legal).js', 'translator read from translators/');
		eq(s.reinits(), 1, 'translators reloaded once');
		eq(s.Zotero.Lawcite.version, '9.9.9', 'Zotero.Lawcite published');
		eq(!!s.Zotero.CitationPhoenix, true, 'Zotero.CitationPhoenix published for the rest of the app');
		s.log.length = 0;
		return s.api.shutdown().then(function () {
			eq(s.log, ['hicite.removeFromAllWindows', 'hicite.destroy', 'phoenix.deactivate'], 'stop order');
			eq(s.Zotero.Lawcite, undefined, 'Zotero.Lawcite removed');
			eq(s.Zotero.CitationPhoenix, undefined, 'Zotero.CitationPhoenix removed');
		});
	});
}).then(function () {
	// 2. a standalone plugin is still enabled: nothing starts, the user is told which
	var s = scenario({ activeAddons: ['citation-phoenix@michaelrisch.com', 'hicite-export@zotero.local'] });
	return s.api.startup(base, 1).then(function () {
		eq(s.log, [], 'nothing started while old plugins are enabled');
		eq(Object.keys(s.written).length, 0, 'no translators installed while old plugins are enabled');
		eq(s.Zotero.Lawcite, undefined, 'Zotero.Lawcite not set');
		return Promise.resolve().then(function () { return Promise.resolve(); });
	}).then(function () {
		eq(s.alerts.length, 1, 'user alerted once');
		eq(/citation-phoenix, hicite Export/.test(s.alerts[0]), true, 'alert names the enabled plugins: ' + s.alerts[0]);
		eq(/Legal Translators\./.test(s.alerts[0]), false, 'alert omits plugins that are not enabled');
		return s.api.shutdown();
	}).then(function () { eq(s.log, [], 'shutdown after refused start does nothing'); });
}).then(function () {
	// 3. old plugins installed but disabled: fine
	var s = scenario({ disabledAddons: ['citation-phoenix@michaelrisch.com', 'zotero-legal-translators@zotero.local', 'hicite-export@zotero.local'] });
	return s.api.startup(base, 1).then(function () { eq(s.log.indexOf('hicite.addToAllWindows') >= 0, true, 'disabled old plugins do not block lawcite'); });
}).then(function () {
	// 4. one part failing does not take the others down
	var s = scenario({ hiciteFails: true });
	return s.api.startup(base, 1).then(function () {
		eq(s.log.indexOf('phoenix.activate:jar:file:///x.xpi!/') >= 0, true, 'phoenix still started');
		eq(Object.keys(s.written).length, 6, 'translators still installed');
		eq(s.log.indexOf('logError') >= 0, true, 'failure is logged');
		errors = errors.filter(function (e) { return e !== 'logError: boom'; }); // expected
	});
}).then(function () {
	// 5. uninstall only on genuine removal
	var s = scenario({});
	return Promise.all([s.api.uninstall({}, 7), s.api.uninstall({}, 8), s.api.uninstall({})]).then(function () {
		eq(s.removed, [], 'upgrade / downgrade / unknown reason delete nothing');
		return s.api.uninstall({}, 6).then(function () {
			eq(s.removed.length, 7, 'real uninstall removes the six translators and hicite.js');
			eq(s.removed.indexOf('/tz/hicite.js') >= 0, true, 'hicite.js removed');
			eq(s.reinits(), 1, 'translators reloaded after real uninstall');
		});
	});
}).then(function () {
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'bootstrap OK (conflicts, order, isolation, uninstall)');
}).catch(function (e) { print('FAIL\nexception: ' + e.message + '\n' + e.stack); });
