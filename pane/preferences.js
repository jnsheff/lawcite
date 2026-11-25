/* Coordinator for the lawcite Settings pane. Each part's own script (permacc, hicite and the jurisdictions editor)
 * is loaded into the same scope before the markup is inserted; Zotero fires the fragment's `load` event once it is in the
 * document, which calls Zotero.LawcitePrefs.init(). A part that fails to start must not leave the others blank. */

Zotero.LawcitePrefs = {
	// Section ids are lawcite-section-<name>; the pane id is lawcite-prefpane, so any code can open one with
	// Zotero.Utilities.Internal.openPreferences('lawcite-prefpane', { scrollTo: '#lawcite-section-hicite' }).
	SECTIONS: ['perma', 'hicite', 'jurisdictions'],

	init() {
		// the Jurisdictions section starts itself (it waits for its own markup)
		for (let part of ['PermaCCPrefs', 'HiCitePrefs']) {
			try { Zotero[part]?.init(); }
			catch (e) { Zotero.logError(e); }
		}
	},

	scrollTo(name) {
		document.getElementById('lawcite-section-' + name)?.scrollIntoView({ block: 'start' });
	},
};
