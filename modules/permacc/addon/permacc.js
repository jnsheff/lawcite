/* lawcite: Perma.cc archiving.
 *
 * Keeps a Perma.cc archive for every web URL in the user's Zotero libraries. The archive's link is stored in the
 * item's Extra field ("perma-cc: https://perma.cc/ABCD-1234", the form already used in the user's library); the item's own
 * URL is never changed. An archive already recorded anywhere (that Extra line in any of its spellings, a bare perma.cc
 * link in Extra, a child link attachment or note) or already in the user's Perma.cc account is never paid for twice. Archives are
 * filed in Perma.cc folders that mirror the Zotero collections: <personal or organization folder> / Zotero / <library> / <collection>.
 * A style can show the URL, the Perma.cc link, or both (formatURL, applied to the CSL item citeproc receives).
 *
 * Authentication is an API key (Authorization: ApiKey <key>); Perma.cc documents no password login. The key is
 * kept in the login manager unless the user turns that off, in which case it lives in memory for the session.
 *
 * API: https://perma.cc/docs/developer. Rate limits, quotas and URL lookup are not documented there, so requests are
 * paced, 429/5xx are retried with backoff, and a run stops on an auth or quota error or after repeated failures.
 */

var PermaCC = {
	PREF: 'lawcite.permacc.',
	API_DEFAULT: 'https://api.perma.cc/v1',
	KEY_PAGE: 'https://perma.cc/settings/tools',
	DEV_PAGE: 'https://perma.cc/docs/developer',
	LOGIN: { origin: 'chrome://lawcite', realm: 'Perma.cc API key', username: 'api-key' },
	FORMATS: ['url-archived', 'perma', 'url'],
	RETRY_FAILED_MS: 24 * 3600 * 1000,
	PENDING_MAX_MS: 24 * 3600 * 1000,

	id: null,
	version: '',
	rootURI: null,
	destroyed: false,
	running: false,
	paused: false,
	sessionKey: null,
	observerID: null,
	timer: null,
	startTimer: null,
	fetch: null,
	sleep: null,
	pacingMs: 1200,
	lastError: '',
	progress: { state: 'idle', total: 0, done: 0, adopted: 0, failed: 0, current: '' },

	// ------------------------------------------------------------------ prefs
	pref(name) { return Zotero.Prefs.get(this.PREF + name); },
	setPref(name, value) { Zotero.Prefs.set(this.PREF + name, value); },
	json(name, fallback) {
		try {
			let v = JSON.parse(this.pref(name) || '');
			return v && typeof v === 'object' ? v : fallback;
		}
		catch (e) { return fallback; }
	},
	saveJSON(name, value) { this.setPref(name, JSON.stringify(value)); },
	apiBase() { return String(this.pref('apiBase') || this.API_DEFAULT).replace(/\/+$/, ''); },

	// ------------------------------------------------------------- Extra field
	// The line this plugin writes, and the spellings it recognizes (the user's library has several):
	//   perma-cc: https://perma.cc/ABCD-1234       (the form to write)
	//   perma-cc:  https://perma.cc/ABCD-1234      (extra spaces), Perma.cc: ..., perma.cc: ..., permacc: ..., Perma CC: ...
	//   https://perma.cc/ABCD-1234                 (a bare link on a line of its own)
	// "Library Catalog: perma.cc" and "Citation Key: ...Perma..." are not archives and are not matched: a link needs a guid.
	LABEL: 'perma-cc',
	GUID: '([A-Za-z0-9]{4}-[A-Za-z0-9]{4})',
	LINE: /^\s*perma[\s._-]*cc\s*:\s*(?:https?:\/\/)?(?:www\.)?perma\.cc\/([A-Za-z0-9]{4}-[A-Za-z0-9]{4})(?![A-Za-z0-9-]).*$/i,
	BARE: /^\s*(?:https?:\/\/)?(?:www\.)?perma\.cc\/([A-Za-z0-9]{4}-[A-Za-z0-9]{4})\s*$/i,
	LINK: /(?:https?:\/\/)?(?:www\.)?perma\.cc\/([A-Za-z0-9]{4}-[A-Za-z0-9]{4})(?![A-Za-z0-9-])/ig,

	permaURL(guid) { return 'https://perma.cc/' + guid; },

	guidInLine(line) {
		let m = String(line).match(this.LINE) || String(line).match(this.BARE);
		return m ? m[1].toUpperCase() : null;
	},

	guidFromExtra(extra) {
		for (let line of String(extra || '').split(/\r?\n/)) {
			let guid = this.guidInLine(line);
			if (guid) return guid;
		}
		return null;
	},

	// Every perma.cc guid mentioned in free text (a note's HTML).
	guidsInText(text) {
		let out = [], re = new RegExp(this.LINK.source, 'ig'), m;
		while ((m = re.exec(String(text || '')))) out.push(m[1].toUpperCase());
		return out;
	},

	// Record `guid`. An existing line for the same archive is left exactly as the user wrote it; one for a different
	// archive is replaced; otherwise the canonical line is added after what is there.
	extraWithGuid(extra, guid) {
		guid = String(guid).toUpperCase();
		let line = `${this.LABEL}: ${this.permaURL(guid)}`;
		let lines = String(extra || '').split(/\r?\n/);
		let at = lines.findIndex(l => this.guidInLine(l));
		if (at >= 0) {
			if (this.guidInLine(lines[at]) === guid) return String(extra);
			lines[at] = line;
			return lines.join('\n');
		}
		let text = String(extra || '').replace(/\s+$/, '');
		return text ? text + '\n' + line : line;
	},

	extraWithoutGuid(extra) {
		return String(extra || '').split(/\r?\n/).filter(l => !this.guidInLine(l)).join('\n');
	},

	// ------------------------------------------------------------- eligibility
	skipDomains() {
		return String(this.pref('skipDomains') || '').split(/[\s,;]+/).map(d => d.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean);
	},

	// The URL to archive, or null: web (http/https) addresses only, not local or private hosts, not Perma.cc links,
	// not a site on the user's skip list (subscription sites whose pages need a login are pointless to capture).
	archivableURL(raw, { ignoreSkip = false } = {}) {
		let text = String(raw || '').trim();
		if (!text) return null;
		let url;
		try { url = new URL(text); }
		catch (e) { return null; }
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		let host = url.hostname.toLowerCase();
		if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
		if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
		if (host === 'perma.cc' || host.endsWith('.perma.cc')) return null;
		if (!ignoreSkip && this.skipDomains().some(d => host === d || host.endsWith('.' + d))) return null;
		return text;
	},

	// ------------------------------------------------------------- credentials
	loginInfo(password) {
		let LoginInfo = Components.Constructor('@mozilla.org/login-manager/loginInfo;1', Components.interfaces.nsILoginInfo, 'init');
		return new LoginInfo(this.LOGIN.origin, null, this.LOGIN.realm, this.LOGIN.username, password, '', '');
	},

	async storedLogins() {
		try { return await Services.logins.searchLoginsAsync({ origin: this.LOGIN.origin, httpRealm: this.LOGIN.realm }); }
		catch (e) { return []; }
	},

	// Only when the API base has been overridden (testing against a local mock) may a test key stand in.
	usingTestServer() { return this.apiBase() !== this.API_DEFAULT; },

	async getKey() {
		if (this.sessionKey) return this.sessionKey;
		if (this.usingTestServer() && this.pref('testKey')) return String(this.pref('testKey'));
		let logins = await this.storedLogins();
		return logins.length ? logins[0].password : null;
	},

	async hasKey() { return !!(await this.getKey()); },

	// remember: keep it in the login manager (default); otherwise only in memory until Zotero closes.
	async setKey(key, remember = this.pref('rememberKey')) {
		key = String(key || '').trim();
		if (!key) throw new Error('No API key given');
		await this.removeStoredKey();
		this.sessionKey = key;
		if (remember) {
			try { await Services.logins.addLoginAsync(this.loginInfo(key)); }
			catch (e) { Zotero.logError(e); }
		}
		this.setPref('rememberKey', !!remember);
	},

	async removeStoredKey() {
		for (let login of await this.storedLogins()) {
			try { Services.logins.removeLogin(login); } catch (e) { Zotero.logError(e); }
		}
	},

	async forgetKey() {
		this.sessionKey = null;
		await this.removeStoredKey();
		this.setPref('accountName', '');
	},

	// "Remember" switched off: delete what is stored, keep working this session.
	async applyRememberChoice(remember) {
		this.setPref('rememberKey', !!remember);
		if (remember) {
			let key = await this.getKey();
			if (key) await this.setKey(key, true);
		}
		else {
			let key = await this.getKey();
			await this.removeStoredKey();
			if (key) this.sessionKey = key;
		}
	},

	// --------------------------------------------------------------------- API
	PermaError: class PermaError extends Error {
		constructor(kind, status, message) { super(message); this.kind = kind; this.status = status; }
	},

	async request(method, path, body) {
		let key = await this.getKey();
		if (!key) throw new this.PermaError('auth', 0, 'No Perma.cc API key');
		let doFetch = this.fetch || ((...a) => fetch(...a));
		let sleep = this.sleep || (ms => new Promise(r => setTimeout(r, ms)));
		let url = this.apiBase() + path;
		let res;
		for (let attempt = 0; ; attempt++) {
			res = await doFetch(url, {
				method,
				headers: { Authorization: 'ApiKey ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			if ((res.status === 429 || res.status >= 500) && attempt < 3) {
				let after = Number(res.headers?.get?.('Retry-After'));
				await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : 2000 * 2 ** attempt);
				continue;
			}
			break;
		}
		let text = await res.text();
		let json = null;
		try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
		if (res.ok) return { status: res.status, json };

		let detail = json && (json.detail || json.error || json.message || (typeof json === 'object' ? Object.values(json).flat().join(' ') : '')) || text.slice(0, 200) || `HTTP ${res.status}`;
		let kind = 'http';
		if (res.status === 401 || res.status === 403) kind = /limit|quota|exceed|remaining/i.test(detail) ? 'quota' : 'auth';
		else if (res.status === 404) kind = 'notfound';
		else if (res.status === 429) kind = 'ratelimit';
		else if (res.status === 400 || res.status === 422) kind = /limit|quota|exceed|remaining/i.test(detail) ? 'quota' : 'rejected';
		throw new this.PermaError(kind, res.status, String(detail));
	},

	// Checks the key. Returns the account: { id, full_name, top_level_folders }.
	async verify() {
		let { json } = await this.request('GET', '/user/');
		this.setPref('accountName', json?.full_name || json?.short_name || '');
		this.saveJSON('organizations', this.organizationsOf(json));
		this.lastError = '';
		return json;
	},

	// ---------------------------------------------------------------- folders
	folderMap() { return this.json('folderMap', {}); },

	async listChildren(parentId) {
		let out = [], offset = 0;
		for (;;) {
			let { json } = await this.request('GET', `/folders/${parentId}/folders?limit=300&offset=${offset}`);
			let objects = json?.objects || [];
			out.push(...objects);
			if (objects.length < 300) return out;
			offset += 300;
		}
	},

	// Reuse a same-named child folder if one exists (so lost cache or a second computer does not duplicate), else create it.
	async ensureChild(cacheKey, parentId, name) {
		let map = this.folderMap();
		if (map[cacheKey]) return map[cacheKey];
		let kids = await this.listChildren(parentId);
		let found = kids.find(k => k.name === name);
		let id = found ? found.id : (await this.request('POST', `/folders/${parentId}/folders/`, { name })).json.id;
		map = this.folderMap();
		map[cacheKey] = id;
		this.saveJSON('folderMap', map);
		return id;
	},

	// The organization top-level folders of an account, as [{ id, name, folder }]; the personal one has none.
	orgOfFolder(f) { let o = f?.organization; return o && typeof o === 'object' ? o.id : o; },
	organizationsOf(user) {
		let out = [];
		for (let f of user?.top_level_folders || []) {
			let id = this.orgOfFolder(f);
			if (id === null || id === undefined || id === '') continue;
			out.push({ id: String(id), name: f.name || ('Organization ' + id), folder: f.id });
		}
		return out;
	},

	// Where archives go: 'organization' (default: the account's first organization, else personal), 'org:<id>', or 'personal'.
	// Returns the top-level folder and a description of what was chosen.
	pickTopFolder(user, want) {
		let tops = user?.top_level_folders || [];
		let orgs = this.organizationsOf(user);
		let personal = tops.find(f => { let id = this.orgOfFolder(f); return id === null || id === undefined || id === ''; });
		let top, label;
		if (want === 'personal') { top = personal; label = 'personal folder'; }
		else {
			let org = String(want || '').startsWith('org:') ? orgs.find(o => o.id === want.slice(4)) : null;
			org = org || orgs[0];
			if (org) { top = tops.find(f => f.id === org.folder); label = 'organization folder (' + org.name + ')'; }
			else { top = personal; label = 'personal folder (this account has no organization folder)'; }
		}
		top = top || personal || tops[0];
		return { top, label };
	},

	async rootFolderId() {
		let want = this.pref('archiveTo') || 'organization';
		let map = this.folderMap();
		if (map.root && map.rootChoice === want) return map.root;
		if (map.root) { this.forgetFolders(); } // the choice changed: the cached folders belong to the other folder
		let { json } = await this.request('GET', '/user/');
		let { top, label } = this.pickTopFolder(json, want);
		if (!top) throw new this.PermaError('rejected', 0, 'No Perma.cc folder to file archives in');
		this.setPref('archivingTo', label);
		let id = await this.ensureChild('root', top.id, 'Zotero');
		map = this.folderMap();
		map.rootChoice = want;
		this.saveJSON('folderMap', map);
		return id;
	},

	// The collection an item is filed under: its first collection by full name; none means the library's own folder.
	collectionPath(collection) {
		let path = [], seen = 0;
		for (let c = collection; c && seen < 50; c = c.parentID ? Zotero.Collections.get(c.parentID) : null, seen++) {
			path.unshift({ key: c.key, name: c.name });
		}
		return path;
	},

	primaryPath(item) {
		let paths = (item.getCollections?.() || []).map(id => Zotero.Collections.get(id)).filter(Boolean).map(c => this.collectionPath(c));
		if (!paths.length) return [];
		paths.sort((a, b) => a.map(s => s.name).join('/').localeCompare(b.map(s => s.name).join('/')));
		return paths[0];
	},

	async folderIdFor(item) {
		let libraryID = item.libraryID;
		let parent = await this.rootFolderId();
		parent = await this.ensureChild('L' + libraryID, parent, Zotero.Libraries.getName(libraryID) || ('Library ' + libraryID));
		let cacheKey = 'L' + libraryID;
		for (let seg of this.primaryPath(item)) {
			cacheKey += '/' + seg.key;
			parent = await this.ensureChild(cacheKey, parent, seg.name);
		}
		return parent;
	},

	forgetFolders() { this.saveJSON('folderMap', {}); },

	// -------------------------------------------------------------- candidates
	itemID(item) { return item.libraryID + '/' + item.key; },

	includedLibraries() {
		let excluded = new Set(this.json('excludedLibraries', []));
		return Zotero.Libraries.getAll().filter(l =>
			(l.libraryType === 'user' || l.libraryType === 'group') && l.editable !== false && !excluded.has(l.libraryID));
	},

	// Archives recorded outside Extra, by parent item id: a child link attachment whose URL is a perma.cc link, or a child
	// note that holds one. (The library has both; such an item must not be archived again.)
	childArchives(items) {
		let map = new Map();
		for (let it of items) {
			let parent = it.parentItemID;
			if (!parent || map.has(parent)) continue;
			let guids = [];
			try {
				if (it.isAttachment?.()) guids = this.guidsInText(it.getField('url'));
				else if (it.isNote?.()) guids = this.guidsInText(it.getNote?.());
			}
			catch (e) { /* an item that cannot be read is not evidence of an archive */ }
			if (guids.length) map.set(parent, guids[0]);
		}
		return map;
	},

	// For a citation: the item's own Extra line, else a perma.cc link attachment.
	archivedGuid(item) {
		let guid = this.guidFromExtra(item.getField?.('extra'));
		if (guid) return guid;
		try {
			for (let id of item.getAttachments?.() || []) {
				let guids = this.guidsInText(Zotero.Items.get(id)?.getField?.('url'));
				if (guids.length) return guids[0];
			}
		}
		catch (e) { /* no attachments to read */ }
		return null;
	},

	// Regular items with an archivable URL and no archive recorded anywhere (Extra in any spelling, a child attachment or
	// note), not waiting for a capture, not recently failed.
	// `since` (ms since the epoch) limits the search to items added at or after that moment: automatic archiving is only
	// prospective, so existing libraries are archived solely by the user's "Archive now".
	async findCandidates({ includeFailed = false, since = 0 } = {}) {
		let pending = new Set(this.json('pending', []).map(p => p.libraryID + '/' + p.key));
		let failures = this.json('failures', {});
		let now = Date.now(), out = [];
		for (let library of this.includedLibraries()) {
			try {
				await library.waitForDataLoad?.('collection');
				await library.waitForDataLoad?.('item');
			}
			catch (e) { Zotero.logError(e); }
			let all = await Zotero.Items.getAll(library.libraryID);
			let recorded = this.childArchives(all);
			for (let item of all) {
				if (!item.isRegularItem?.() || item.deleted) continue;
				if (since && !(this.addedAt(item) >= since)) continue;
				let url = this.archivableURL(item.getField('url'));
				if (!url) continue;
				if (this.guidFromExtra(item.getField('extra')) || recorded.has(item.id)) continue;
				let id = this.itemID(item);
				if (pending.has(id)) continue;
				let failure = failures[id];
				if (!includeFailed && failure && (failure.count >= 3 || now - failure.ts < this.RETRY_FAILED_MS)) continue;
				out.push({ item, url });
			}
		}
		return out;
	},

	// When an item was added (ms since the epoch); Zotero stores dateAdded as UTC 'YYYY-MM-DD HH:MM:SS'. NaN if unreadable.
	addedAt(item) {
		let raw = String(item.getField('dateAdded') || '').trim();
		return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? Date.parse(raw.replace(' ', 'T') + 'Z') : NaN;
	},

	// Automatic archiving only ever covers what is added after it is switched on (autoSince; stored as text because Zotero
	// preferences are 32-bit). Called when the checkbox changes, and lazily for a profile that already had it on.
	noteAutoState() {
		let on = !!this.pref('auto'), since = Number(this.pref('autoSince')) || 0;
		if (on && !since) this.setPref('autoSince', String(Date.now()));
		else if (!on && since) this.setPref('autoSince', '');
	},

	async countCandidates() { return (await this.findCandidates()).length; },

	// ------------------------------------------------------- existing archives
	normalizeURL(raw) {
		try {
			let u = new URL(String(raw).trim());
			let path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
			return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${path}${u.search}`;
		}
		catch (e) { return String(raw).trim(); }
	},

	// Every archive already in the user's Perma.cc account, by normalized source URL (cached for ten minutes): a URL that
	// is already archived there is recorded in Extra instead of being archived (and paid for) again. Deleted archives and
	// failed captures do not count.
	async accountArchives() {
		if (this._account && Date.now() - this._account.ts < 10 * 60 * 1000) return this._account.map;
		let map = new Map();
		for (let page = 0, offset = 0; page < 60; page++) {
			let { json } = await this.request('GET', `/archives/?limit=300&offset=${offset}`);
			let objects = json?.objects || [];
			if (!objects.length) break; // the docs: stop when objects is empty
			for (let a of objects) {
				if (a.user_deleted || !a.guid || !a.url) continue;
				let primary = (a.captures || []).find(c => c.role === 'primary') || (a.captures || [])[0];
				if (primary?.status === 'failed') continue;
				let key = this.normalizeURL(a.url), have = map.get(key);
				if (!have || String(a.creation_timestamp || '') > have.ts) map.set(key, { guid: a.guid, ts: String(a.creation_timestamp || '') });
			}
			offset += objects.length;
		}
		this._account = { ts: Date.now(), map };
		return map;
	},

	async recordExisting(item, guid) {
		item.setField('extra', this.extraWithGuid(item.getField('extra'), guid));
		await item.saveTx({ skipDateModifiedUpdate: true });
		let failures = this.json('failures', {});
		if (failures[this.itemID(item)]) { delete failures[this.itemID(item)]; this.saveJSON('failures', failures); }
		return guid;
	},

	// --------------------------------------------------------------- archiving
	async archiveOne(item, url) {
		// the item may have gained an archive since it was found (another run, a sync, the user): never pay twice
		let already = this.archivedGuid(item);
		if (already) return already;
		let guid = null;
		for (let attempt = 0; attempt < 2 && !guid; attempt++) {
			try {
				let folder = await this.folderIdFor(item);
				let body = { url, folder };
				let title = String(item.getField('title') || '').trim();
				if (title) body.title = title.slice(0, 255);
				guid = (await this.request('POST', '/archives/', body)).json?.guid;
			}
			catch (e) {
				// a folder deleted on Perma.cc (a cached id that no longer exists): forget the cache and rebuild once
				if (e.kind === 'notfound' && attempt === 0) { this.forgetFolders(); continue; }
				throw e;
			}
		}
		if (!guid) throw new this.PermaError('http', 0, 'Perma.cc returned no archive id');

		if (this.pref('private')) {
			try { await this.request('PATCH', `/archives/${guid}/`, { is_private: true }); }
			catch (e) { Zotero.logError(e); }
		}

		item.setField('extra', this.extraWithGuid(item.getField('extra'), guid));
		await item.saveTx({ skipDateModifiedUpdate: true });
		this._account = null; // the account has one more archive now

		let pending = this.json('pending', []);
		pending.push({ libraryID: item.libraryID, key: item.key, guid, ts: Date.now() });
		this.saveJSON('pending', pending);

		let failures = this.json('failures', {});
		if (failures[this.itemID(item)]) { delete failures[this.itemID(item)]; this.saveJSON('failures', failures); }
		return guid;
	},

	noteFailure(item, error) {
		let failures = this.json('failures', {});
		let id = this.itemID(item);
		failures[id] = { ts: Date.now(), count: (failures[id]?.count || 0) + 1, reason: String(error.message || error).slice(0, 200) };
		this.saveJSON('failures', failures);
	},

	// Archives made earlier: if Perma.cc could not capture the page, take the link back out of Extra so the item is retried.
	async checkPending() {
		let pending = this.json('pending', []), keep = [], now = Date.now();
		for (let p of pending) {
			if (now - p.ts > this.PENDING_MAX_MS) continue;
			let item = Zotero.Items.getByLibraryAndKey(p.libraryID, p.key);
			if (!item || item.deleted) continue;
			try {
				let { json } = await this.request('GET', `/archives/${p.guid}/`);
				let primary = (json?.captures || []).find(c => c.role === 'primary') || (json?.captures || [])[0];
				if (primary?.status === 'success') continue;
				if (primary?.status === 'failed') {
					if (this.guidFromExtra(item.getField('extra')) === String(p.guid).toUpperCase()) {
						item.setField('extra', this.extraWithoutGuid(item.getField('extra')));
						await item.saveTx({ skipDateModifiedUpdate: true });
					}
					this.noteFailure(item, new Error('Perma.cc could not capture this page'));
					continue;
				}
				keep.push(p);
			}
			catch (e) {
				if (e.kind === 'notfound') continue; // the archive was deleted on Perma.cc
				keep.push(p);
				if (e.kind === 'auth') break;
			}
		}
		this.saveJSON('pending', keep);
	},

	// run(): everything that needs an archive (the user's "Archive now"). run({ since }): only items added since then.
	async run({ since = 0 } = {}) {
		if (this.running || this.destroyed) return this.progress;
		if (!(await this.hasKey())) { this.progress = { state: 'no-key', total: 0, done: 0, adopted: 0, failed: 0, current: '' }; return this.progress; }
		this.running = true;
		this.paused = false;
		this.lastError = '';
		let sleep = this.sleep || (ms => new Promise(r => setTimeout(r, ms)));
		try {
			try { await this.checkPending(); } catch (e) { Zotero.logError(e); }
			let candidates = await this.findCandidates({ since });
			this.progress = { state: 'running', total: candidates.length, done: 0, adopted: 0, failed: 0, current: '' };
			let known = new Map();
			if (candidates.length) {
				try { known = await this.accountArchives(); }
				catch (e) {
					// without the list, archiving could duplicate archives the account already has: do nothing instead
					this.lastError = `could not read your existing Perma.cc archives (${e.message}); nothing was archived, to avoid duplicates`;
					this.progress.state = e.kind === 'auth' ? 'auth-error' : 'stopped';
					return this.progress;
				}
			}
			let streak = 0;
			for (let { item, url } of candidates) {
				if (this.paused || this.destroyed) { this.progress.state = 'paused'; break; }
				this.progress.current = String(item.getField('title') || url).slice(0, 80);
				try {
					let existing = known.get(this.normalizeURL(url));
					if (existing) { await this.recordExisting(item, existing.guid); this.progress.adopted++; continue; }
					await this.archiveOne(item, url);
					this.progress.done++;
					streak = 0;
				}
				catch (e) {
					this.lastError = e.message;
					if (e.kind === 'auth') { this.progress.state = 'auth-error'; break; }
					if (e.kind === 'quota') { this.progress.state = 'quota'; break; }
					this.progress.failed++;
					this.noteFailure(item, e);
					if (++streak >= 5) { this.progress.state = 'stopped'; break; }
				}
				await sleep(this.pacingMs);
			}
			if (this.progress.state === 'running') this.progress.state = 'done';
			this.progress.current = '';
		}
		catch (e) {
			Zotero.logError(e);
			this.lastError = e.message;
			this.progress.state = e.kind === 'auth' ? 'auth-error' : 'stopped';
		}
		finally { this.running = false; }
		return this.progress;
	},

	pause() { this.paused = true; },

	retryFailed() { this.saveJSON('failures', {}); },

	// ----------------------------------------------------------- CSL rendering
	// Called for every item citeproc is given. The Extra line is never shown by itself; this decides what the URL says.
	formatURL(cslItem, zotItem) {
		let mode = this.pref('urlFormat');
		if (!cslItem || !zotItem || mode === 'url') return false;
		let guid = this.archivedGuid(zotItem);
		if (!guid) return false;
		let perma = this.permaURL(guid);
		if (mode === 'perma') { cslItem.URL = perma; return true; }
		if (!cslItem.URL) return false;
		cslItem.URL = `${cslItem.URL}, archived at ${perma}`;
		return true;
	},

	// --------------------------------------------------------- keeping up
	onNotify(event, type, ids) {
		if (this.destroyed || type !== 'item' || !['add', 'modify'].includes(event)) return;
		this.noteAutoState();
		if (!this.pref('auto')) return;
		this.schedule(15000);
	},

	schedule(delayMs) {
		if (this.destroyed || !this.pref('auto')) return;
		this.noteAutoState();
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(async () => {
			this.timer = null;
			try {
				let since = Number(this.pref('autoSince')) || 0;
				if (since && await this.hasKey()) await this.run({ since }); // prospective only
			}
			catch (e) { Zotero.logError(e); }
		}, delayMs);
	},


	// ------------------------------------------------- right-click menu item
	FTL: 'permacc.ftl',

	alert(text) {
		try { Services.prompt.alert(Zotero.getMainWindow?.(), 'lawcite: Perma.cc', text); }
		catch (e) { Zotero.logError(e); }
	},

	// Opens Settings at the Perma.cc section of the lawcite pane.
	openSettings() {
		try { Zotero.Utilities.Internal.openPreferences(Zotero.Lawcite?.paneID, { scrollTo: '#lawcite-section-perma' }); }
		catch (e) { Zotero.logError(e); }
	},

	// "lawcite: Get Perma.cc Link": archive the selected items' URLs now (reusing an archive that already exists, in Extra
	// or in the Perma.cc account) and report the links. Works regardless of the automatic-archiving setting and the skip
	// list: it is an explicit request, for these items only.
	async getLinkFromMenu(items) {
		let regular = (items || []).filter(i => i.isRegularItem?.());
		if (!regular.length) return;
		if (!(await this.hasKey())) {
			this.alert('To get a Perma.cc link, lawcite must first be connected to your Perma.cc account.\n\n' +
				'Paste your Perma.cc API key in the Perma.cc section of the lawcite settings, which will open now.');
			this.openSettings();
			return;
		}
		let sleep = this.sleep || (ms => new Promise(r => setTimeout(r, ms)));
		let one = regular.length === 1, lines = [], links = [];
		for (let item of regular) {
			let name = String(item.getField('title') || item.getField('caseName') || item.key).slice(0, 60);
			let say = text => lines.push(one ? text : `${name}: ${text}`);
			let raw = String(item.getField('url') || '').trim();
			if (!raw) { say('this item has no URL, so there is nothing to archive.'); continue; }
			let url = this.archivableURL(raw, { ignoreSkip: true });
			if (!url) { say(`Perma.cc can only archive public web (http or https) pages, so ${raw} cannot be archived.`); continue; }
			try {
				let guid = this.archivedGuid(item), how = 'already had';
				if (!guid) {
					let existing = (await this.accountArchives()).get(this.normalizeURL(url));
					if (existing) { guid = await this.recordExisting(item, existing.guid); how = 'was already archived on Perma.cc for'; }
					else { guid = await this.archiveOne(item, url); how = 'archived'; }
				}
				let link = this.permaURL(guid);
				links.push(link);
				say(how === 'archived' ? `archived: ${link}` : `${how === 'already had' ? 'this item already has' : 'found'} a Perma.cc link: ${link}`);
			}
			catch (e) {
				if (e.kind === 'auth') {
					this.alert('Perma.cc did not accept your API key. Paste a new one in the Perma.cc section of the lawcite settings, which will open now.');
					this.openSettings();
					return;
				}
				say(`could not archive (${e.message}).`);
				if (e.kind === 'quota') break;
			}
			if (regular.length > 1) await sleep(this.pacingMs);
		}
		if (links.length) {
			try { Zotero.Utilities.Internal.copyTextToClipboard(links.join('\n')); lines.push('', links.length === 1 ? 'The link was copied to the clipboard.' : 'The links were copied to the clipboard.'); }
			catch (e) { /* no clipboard */ }
		}
		this.alert(lines.join('\n'));
	},

	registerMenus() {
		let id = Zotero.MenuManager.registerMenu({
			menuID: 'lawcite-permacc-main-library-item',
			pluginID: this.id,
			target: 'main/library/item',
			menus: [{
				menuType: 'menuitem', l10nID: 'permacc-menu-get-link',
				onShowing: (event, ctx) => ctx.setVisible(!!ctx.items?.some(i => i.isRegularItem())),
				onCommand: (event, ctx) => this.getLinkFromMenu(ctx.items),
			}],
		});
		if (id) this.menuIDs.push(id);
		else Zotero.logError(new Error('permacc: registerMenu rejected the item menu'));
	},

	addToWindow(win) { win.MozXULElement.insertFTLIfNeeded(this.FTL); },
	removeFromWindow(win) { win.document.querySelector(`[href="${this.FTL}"]`)?.remove(); },
	addToAllWindows() { for (let win of Zotero.getMainWindows?.() || []) this.addToWindow(win); },

	// ---------------------------------------------------------------- lifecycle
	async init({ id, version, rootURI, fetch = null, sleep = null }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.fetch = fetch;
		this.sleep = sleep;
		this.destroyed = false;
		this.menuIDs = [];

		this.observerID = Zotero.Notifier.registerObserver({
			notify: (event, type, ids) => this.onNotify(event, type, ids),
		}, ['item'], 'lawcite-permacc');

		// Switching automatic archiving on starts "from now"; switching it off forgets the moment.
		try { this.autoObserver = Zotero.Prefs.registerObserver?.(this.PREF + 'auto', () => this.noteAutoState()); }
		catch (e) { Zotero.logError(e); }

		// Inside lawcite the one lawcite Settings pane carries this section (lawcite's bootstrap registers it).
		if (!Zotero.Lawcite) {
			try {
				await Zotero.PreferencePanes.register({
					pluginID: this.id,
					src: this.rootURI + 'preferences.xhtml',
					label: 'Perma.cc',
					scripts: [this.rootURI + 'preferences.js'],
				});
			}
			catch (e) { Zotero.logError(e); }
		}

		try { this.registerMenus(); this.addToAllWindows(); }
		catch (e) { Zotero.logError(e); }

		// Catch up once Zotero is settled, if the user has switched archiving on.
		Zotero.uiReadyPromise?.then(() => this.schedule(60000));
	},

	destroy() {
		this.destroyed = true;
		this.paused = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
		this.observerID = null;
		try { if (this.autoObserver) Zotero.Prefs.unregisterObserver?.(this.autoObserver); } catch (e) { /* closing */ }
		this.autoObserver = null;
		for (let id of this.menuIDs || []) { try { Zotero.MenuManager.unregisterMenu(id); } catch (e) { /* closing */ } }
		this.menuIDs = [];
		try { for (let win of Zotero.getMainWindows?.() || []) this.removeFromWindow(win); } catch (e) { /* closing */ }
		delete Zotero.PermaCCPrefs; // defined by the Settings pane's script
	},
};
