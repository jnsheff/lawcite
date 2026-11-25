/* lawcite: one Zotero plugin made of three parts.
 *
 *   phoenix      citation-phoenix (Michael Risch; fork by Jeremy Sheff): legal item types and fields, CSL-M
 *                modules, Juris-M style abbreviations. Bundled to content/citation-phoenix.js.
 *   translators  web translators for Westlaw, Lexis+, Cornell LII, Federal Register, Bloomberg Law, LegiScan.
 *   hicite       hicite export, pinned citation keys, auto-export (hicite/hicite-export.js).
 *   permacc      Perma.cc archives for the URLs in the user's libraries (permacc/permacc.js).
 *
 * The three standalone plugins this replaces must be removed first: running them together would patch Zotero
 * twice and install duplicate translators. If one of them is still enabled, lawcite starts nothing and says so.
 */

var HiCite; // assigned by hicite/hicite-export.js
var PermaCC; // assigned by permacc/permacc.js

const LAWCITE_REPLACES = {
	'citation-phoenix@michaelrisch.com': 'citation-phoenix',
	'zotero-legal-translators@zotero.local': 'Legal Translators',
	'hicite-export@zotero.local': 'hicite Export',
};

const LAWCITE_TRANSLATORS = [
	'Westlaw (legal).js', 'Lexis+ (legal).js', 'Cornell LII (legal).js',
	'Federal Register (legal).js', 'Bloomberg Law (legal).js', 'LegiScan (legal).js',
];

var lawciteState = { paneID: null, started: false, parts: { phoenix: false, translators: false, hicite: false, permacc: false } };

function lawciteLog(msg) {
	try { Zotero.debug('[lawcite] ' + msg); } catch (e) { /* no Zotero yet */ }
}

function lawciteBase(rootURI) {
	let base = (rootURI && typeof rootURI === 'object' && rootURI.spec) ? rootURI.spec : String(rootURI);
	return base.slice(-1) === '/' ? base : base + '/';
}

// Names of the standalone plugins that are installed and enabled.
async function lawciteConflicts() {
	let found = [];
	try {
		let { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
		for (let [id, name] of Object.entries(LAWCITE_REPLACES)) {
			let addon = await AddonManager.getAddonByID(id);
			if (addon && addon.isActive) found.push(name);
		}
	}
	catch (e) { Zotero.logError(e); }
	return found;
}

function lawciteWarnConflicts(names) {
	let text = `lawcite includes ${Object.values(LAWCITE_REPLACES).join(', ')}.\n\n` +
		`Still enabled: ${names.join(', ')}.\n\n` +
		'Disable or remove them under Tools > Plugins, then restart Zotero. Until then lawcite is inactive.';
	lawciteLog('inactive: ' + names.join(', ') + ' still enabled');
	Zotero.uiReadyPromise.then(() => {
		try { Services.prompt.alert(Zotero.getMainWindow(), 'lawcite', text); }
		catch (e) { Zotero.logError(e); }
	});
}

// ---------------------------------------------------------------- phoenix
async function lawciteStartPhoenix({ id, version }, base) {
	let scope = { Zotero, rootURI: { spec: base } };
	Services.scriptloader.loadSubScript(base + 'content/citation-phoenix.js', scope);
	Zotero.CitationPhoenix = scope.CitationPhoenix;
	Zotero.IndigoBookCSLM = Zotero.CitationPhoenix;
	if (!Zotero.CitationPhoenix || typeof Zotero.CitationPhoenix.activate !== 'function') {
		throw new Error('Bundle loaded but CitationPhoenix.activate not found');
	}
	await Zotero.CitationPhoenix.activate({ id, version, rootURI: { spec: base } });
	lawciteState.parts.phoenix = true;
}

async function lawciteStopPhoenix() {
	try {
		if (Zotero.CitationPhoenix?.deactivate) await Zotero.CitationPhoenix.deactivate();
	}
	finally {
		try { delete Zotero.CitationPhoenix; } catch (e) { /* ignore */ }
		try { delete Zotero.IndigoBookCSLM; } catch (e) { /* ignore */ }
		lawciteState.parts.phoenix = false;
	}
}

// ------------------------------------------------------------ translators
async function lawciteReadPackaged(url) {
	// getContentsFromURLAsync cannot fetch jar: URLs; getResourceAsync opens a channel
	try {
		return await Zotero.File.getResourceAsync(url);
	}
	catch (e) {
		let response = await fetch(url);
		if (!response.ok) throw new Error(`Could not read ${url}: ${response.status}`);
		return await response.text();
	}
}

async function lawciteInstallTranslators(base) {
	let dir = Zotero.getTranslatorsDirectory().path, changed = false;
	for (let name of LAWCITE_TRANSLATORS) {
		try {
			let source = await lawciteReadPackaged(base + 'translators/' + encodeURI(name));
			let path = PathUtils.join(dir, name), current = null;
			try { current = await Zotero.File.getContentsAsync(path); } catch (e) { /* not installed yet */ }
			if (current === source) continue;
			await Zotero.File.putContentsAsync(path, source);
			changed = true;
		}
		catch (e) { Zotero.logError(e); }
	}
	if (changed) await Zotero.Translators.reinit();
	lawciteState.parts.translators = true;
}

// ----------------------------------------------------------------- hicite
async function lawciteStartHiCite({ id, version }, base) {
	let hiciteBase = base + 'hicite/';
	Services.scriptloader.loadSubScript(hiciteBase + 'hicite-export.js');
	await HiCite.init({ id, version, rootURI: hiciteBase });
	HiCite.addToAllWindows();
	lawciteState.parts.hicite = true;
}

function lawciteStopHiCite() {
	if (!HiCite) return;
	try {
		HiCite.removeFromAllWindows();
		HiCite.destroy();
	}
	finally {
		HiCite = undefined;
		lawciteState.parts.hicite = false;
	}
}

// ----------------------------------------------------------------- permacc
async function lawciteStartPermaCC({ id, version }, base) {
	let permaBase = base + 'permacc/';
	Services.scriptloader.loadSubScript(permaBase + 'permacc.js');
	await PermaCC.init({ id, version, rootURI: permaBase });
	// the rest of lawcite reaches it here: the Settings pane, and citation-phoenix's CSL item hook
	Zotero.Lawcite.permacc = PermaCC;
	Zotero.Lawcite.permaFormat = (cslItem, zotItem) => PermaCC?.formatURL(cslItem, zotItem);
	lawciteState.parts.permacc = true;
}

function lawciteStopPermaCC() {
	if (!PermaCC) return;
	try { PermaCC.destroy(); }
	finally {
		PermaCC = undefined;
		try { delete Zotero.Lawcite.permacc; delete Zotero.Lawcite.permaFormat; } catch (e) { /* ignore */ }
		lawciteState.parts.permacc = false;
	}
}

// ------------------------------------------------------------ Settings pane
// One sidebar item, "lawcite", with a section for each part: Perma.cc, hicite and Jurisdictions. The parts do not
// register panes of their own inside lawcite; this pane (composed at build time, see build.py) carries their markup and
// loads their scripts. Section ids (lawcite-section-perma | -hicite | -jurisdictions) are scroll targets.
async function lawciteRegisterPane({ id }, base) {
	lawciteState.paneID = await Zotero.PreferencePanes.register({
		pluginID: id,
		id: 'lawcite-prefpane',
		src: base + 'pane/preferences.xhtml',
		label: 'lawcite',
		image: base + 'icon.svg',
		scripts: [
			base + 'permacc/preferences.js',
			base + 'hicite/preferences.js',
			base + 'content/prefs-abbrev.js',
			base + 'pane/preferences.js',
		],
		stylesheets: [base + 'pane/preferences.css', base + 'content/prefs-abbrev.css'],
	});
	Zotero.Lawcite.paneID = lawciteState.paneID; // the right-click menu opens Settings here
}

function lawciteUnregisterPane() {
	if (!lawciteState.paneID) return;
	try { Zotero.PreferencePanes.unregister(lawciteState.paneID); }
	catch (e) { Zotero.logError(e); }
	finally { lawciteState.paneID = null; }
}

// -------------------------------------------------------------- lifecycle
async function startup({ id, version, rootURI }, reason) {
	await Zotero.initializationPromise;
	let base = lawciteBase(rootURI);

	let conflicts = await lawciteConflicts();
	if (conflicts.length) {
		lawciteWarnConflicts(conflicts);
		return;
	}

	Zotero.Lawcite = { id, version, rootURI: base, parts: lawciteState.parts };
	lawciteLog(`startup ${version}`);

	// Each part is independent: a failure in one must not take the others down.
	let parts = [
		['phoenix', () => lawciteStartPhoenix({ id, version }, base)],
		['translators', () => lawciteInstallTranslators(base)],
		['hicite', () => lawciteStartHiCite({ id, version }, base)], // after phoenix: it asks Zotero.Lawcite
		['permacc', () => lawciteStartPermaCC({ id, version }, base)],
	];
	for (let [name, start] of parts) {
		try { await start(); lawciteLog(`${name} started`); }
		catch (e) { Zotero.logError(e); lawciteLog(`${name} FAILED: ${e}`); }
	}
	try { await lawciteRegisterPane({ id }, base); }
	catch (e) { Zotero.logError(e); lawciteLog(`settings pane FAILED: ${e}`); }
	lawciteState.started = true;
}

async function shutdown() {
	if (!lawciteState.started) {
		try { delete Zotero.Lawcite; } catch (e) { /* ignore */ }
		return;
	}
	lawciteUnregisterPane();
	try { lawciteStopPermaCC(); } catch (e) { Zotero.logError(e); }
	try { lawciteStopHiCite(); } catch (e) { Zotero.logError(e); }
	try { await lawciteStopPhoenix(); } catch (e) { Zotero.logError(e); }
	try { delete Zotero.Lawcite; } catch (e) { /* ignore */ }
	lawciteState.started = false;
}

function install() {}

// Zotero also calls uninstall() on the old version during an upgrade (reason 7) or downgrade (8);
// only remove the installed translators when the plugin is really being removed (6).
async function uninstall(data, reason) {
	if (reason !== 6) return;
	await Zotero.initializationPromise;
	try {
		let dir = Zotero.getTranslatorsDirectory().path;
		for (let name of [...LAWCITE_TRANSLATORS, 'hicite.js']) {
			await IOUtils.remove(PathUtils.join(dir, name), { ignoreAbsent: true });
		}
		await Zotero.Translators.reinit();
	}
	catch (e) { Zotero.logError(e); }
}

function onMainWindowLoad({ window }) { HiCite?.addToWindow(window); PermaCC?.addToWindow(window); }
function onMainWindowUnload({ window }) { HiCite?.removeFromWindow(window); PermaCC?.removeFromWindow(window); }
