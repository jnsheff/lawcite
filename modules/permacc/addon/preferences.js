/* Script for the Perma.cc Settings pane (preferences.xhtml). Loaded into the pane's scope before the markup is
 * inserted; Zotero fires the fragment's `load` event once it is in the document, which calls
 * Zotero.PermaCCPrefs.init(). The module itself is Zotero.Lawcite.permacc (permacc.js). */

Zotero.PermaCCPrefs = {
	timer: null,

	get perma() { return Zotero.Lawcite?.permacc; },
	el(id) { return document.getElementById('permacc-' + id); },

	init() {
		let P = this.perma;
		if (!P) { this.el('status').setAttribute('value', 'The Perma.cc part of lawcite is not running.'); return; }
		this.el('remember').checked = !!P.pref('rememberKey');
		this.el('skip').value = P.skipDomains().join('\n');
		this.renderLibraries();
		this.refresh();
		// follow a run in progress
		if (this.timer) clearInterval(this.timer);
		this.timer = setInterval(() => {
			if (!document.getElementById('permacc-prefs')) { clearInterval(this.timer); this.timer = null; return; }
			this.refreshProgress();
		}, 1000);
	},

	async refresh() {
		let P = this.perma;
		if (!P) return;
		let label = this.el('status');
		if (await P.hasKey()) {
			let name = P.pref('accountName');
			label.setAttribute('value', name ? `Connected to Perma.cc as ${name}.` : 'An API key is saved. Use "Save and verify" to check it.');
		}
		else {
			label.setAttribute('value', 'Not connected: no API key yet.');
		}
		this.el('forget').disabled = !(await P.hasKey());
		this.renderArchiveTo();
		this.refreshProgress();
	},

	// "Perma.cc folder": the organization folder (default), each organization when the account has several, or the personal folder.
	renderArchiveTo() {
		let P = this.perma, list = this.el('archiveTo'), popup = this.el('archiveTo-popup');
		if (!P || !list || !popup) return;
		let orgs = P.json('organizations', []), want = P.pref('archiveTo') || 'organization';
		while (popup.firstChild) popup.removeChild(popup.firstChild);
		let add = (label, value) => {
			let item = popup.ownerDocument.createXULElement ? popup.ownerDocument.createXULElement('menuitem') : popup.ownerDocument.createElement('menuitem');
			item.setAttribute('label', label); item.setAttribute('value', value); popup.appendChild(item);
		};
		add(orgs.length ? `Organization folder: ${orgs[0].name} (default)` : 'Organization folder (default)', 'organization');
		if (orgs.length > 1) for (let o of orgs.slice(1)) add(`Organization folder: ${o.name}`, 'org:' + o.id);
		add('Personal folder', 'personal');
		list.value = [...popup.childNodes].some(n => n.getAttribute('value') === want) ? want : 'organization';
		let note = this.el('archiveTo-note');
		let to = P.pref('archivingTo');
		note.textContent = (orgs.length ? '' : 'Verify your API key to see your organizations. ')
			+ (to ? `Currently filing in: ${to}. ` : '')
			+ 'Changing this affects new archives only; existing archives stay where they are, and a URL already archived in either folder is recorded, not archived again.';
	},

	saveArchiveTo() {
		let P = this.perma;
		if (!P) return;
		P.setPref('archiveTo', this.el('archiveTo').value || 'organization');
		this.renderArchiveTo();
	},

	refreshProgress() {
		let P = this.perma;
		if (!P) return;
		let p = P.progress, text = '';
		switch (p.state) {
			case 'running': text = `Archiving ${p.done + (p.adopted || 0) + p.failed + 1} of ${p.total}: ${p.current}`; break;
			case 'done': text = `Finished: ${p.done} archived${p.adopted ? `, ${p.adopted} already on Perma.cc (recorded)` : ''}${p.failed ? `, ${p.failed} failed` : ''}.`; break;
			case 'paused': text = `Paused after ${p.done} of ${p.total}.`; break;
			case 'auth-error': text = 'Perma.cc rejected the API key. Paste a new one above.'; break;
			case 'quota': text = `Perma.cc reports a limit: ${P.lastError}`; break;
			case 'stopped': text = `Stopped after repeated errors: ${P.lastError}`; break;
			case 'no-key': text = 'Save an API key first.'; break;
		}
		this.el('progress').setAttribute('value', text);
		this.el('run').disabled = P.running;
		this.el('pause').disabled = !P.running;
		let failed = Object.keys(P.json('failures', {})).length;
		this.el('retry').disabled = !failed;
		let pending = P.json('pending', []).length;
		this.el('note').textContent = [
			pending ? `${pending} archive${pending == 1 ? ' is' : 's are'} waiting for Perma.cc to finish capturing.` : '',
			failed ? `${failed} item${failed == 1 ? '' : 's'} could not be archived (see the Zotero error console for reasons); they are retried after a day.` : '',
		].filter(Boolean).join(' ');
	},

	openKeyPage() { Zotero.launchURL(this.perma.KEY_PAGE); },
	openDocs() { Zotero.launchURL(this.perma.DEV_PAGE); },

	async saveKey() {
		let P = this.perma, input = this.el('key');
		let key = input.value.trim();
		if (!key) { this.el('status').setAttribute('value', 'Paste your API key first.'); return; }
		this.el('save').disabled = true;
		this.el('status').setAttribute('value', 'Checking the key with Perma.cc…');
		try {
			await P.setKey(key, this.el('remember').checked);
			let user = await P.verify();
			input.value = '';
			await this.refresh();
			await this.offerFirstRun(user);
		}
		catch (e) {
			await P.forgetKey();
			let why = e.kind === 'auth' ? 'Perma.cc did not accept that key.' : `Could not check the key: ${e.message}`;
			this.el('status').setAttribute('value', why);
		}
		finally { this.el('save').disabled = false; }
	},

	// Once, right after the first successful connection: say what will happen and let the user choose.
	async offerFirstRun() {
		let P = this.perma;
		if (P.pref('offered')) return;
		P.setPref('offered', true);
		let n = await P.countCandidates();
		let text = n
			? `lawcite found ${n} web URL${n == 1 ? '' : 's'} in your libraries without a Perma.cc archive.\n\n` +
				'Archive them now, and archive new URLs automatically from now on?\n\n' +
				'Each page is sent to Perma.cc and counts against your account\'s allowance. You can pause at any time, ' +
				'and you can list sites to leave out below.'
			: 'None of your libraries has a URL that needs an archive yet.\n\nArchive new URLs automatically from now on?';
		if (Services.prompt.confirm(window, 'Perma.cc', text)) {
			P.setPref('auto', true);
			if (n) P.run();
		}
	},

	async forget() {
		await this.perma.forgetKey();
		this.el('key').value = '';
		await this.refresh();
	},

	async setRemember(on) {
		await this.perma.applyRememberChoice(on);
	},

	saveSkip() {
		this.perma.setPref('skipDomains', this.el('skip').value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean).join(', '));
	},

	renderLibraries() {
		let P = this.perma, box = this.el('libraries');
		while (box.firstChild) box.firstChild.remove();
		let excluded = new Set(P.json('excludedLibraries', []));
		for (let lib of Zotero.Libraries.getAll()) {
			if ((lib.libraryType !== 'user' && lib.libraryType !== 'group') || lib.editable === false) continue;
			let cb = document.createXULElement('checkbox');
			cb.setAttribute('label', Zotero.Libraries.getName(lib.libraryID) + (lib.libraryType === 'group' ? ' (shared group)' : ''));
			cb.checked = !excluded.has(lib.libraryID);
			cb.addEventListener('command', () => this.toggleLibrary(lib.libraryID, cb.checked));
			box.append(cb);
		}
	},

	toggleLibrary(id, on) {
		let P = this.perma, excluded = new Set(P.json('excludedLibraries', []));
		if (on) excluded.delete(id); else excluded.add(id);
		P.saveJSON('excludedLibraries', [...excluded]);
	},

	async archiveNow() {
		let P = this.perma;
		if (!(await P.hasKey())) { this.el('progress').setAttribute('value', 'Save an API key first.'); return; }
		P.run();
		setTimeout(() => this.refreshProgress(), 200);
	},

	pause() { this.perma.pause(); },

	retryFailed() {
		this.perma.retryFailed();
		this.refreshProgress();
	},
};
