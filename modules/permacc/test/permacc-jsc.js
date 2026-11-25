// permacc.js against fakes: a fake Zotero, the login manager, and an in-memory Perma.cc API.
// Run from modules/permacc:  jsc test/permacc-jsc.js    (prints "permacc OK ..." on success)
var errors = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function ok(c, m) { if (!c) errors.push(m); }

// ---- default prefs, read from the real prefs.js so a renamed or missing default fails here
var defaults = {};
read('addon/prefs.js').split('\n').forEach(function (line) {
	var m = line.match(/^pref\("extensions\.zotero\.(.+?)",\s*(.+)\);\s*$/);
	if (m) defaults[m[1]] = JSON.parse(m[2]);
});

function world(opts) {
	opts = opts || {};
	var prefs = Object.assign({}, defaults);
	Object.keys(opts.prefs || {}).forEach(function (k) { prefs['lawcite.permacc.' + k] = opts.prefs[k]; });
	var saved = [], logged = [], notifiers = [], logins = [];
	var collections = { 1: { id: 1, key: 'COLA', name: 'Torts', parentID: false }, 2: { id: 2, key: 'COLB', name: 'AI', parentID: 1 }, 3: { id: 3, key: 'COLC', name: 'Contracts', parentID: false } };
	var items = [], nextId = 1;
	// opts: { regular: false } for a non-regular item; { type: 'attachment' | 'note', parent: item, note: '<p>html</p>' } for a child
	function item(libraryID, key, fields, colls, opts) {
		opts = opts || {};
		var f = Object.assign({ title: 'Title ' + key, url: '', extra: '' }, fields || {});
		var it = {
			id: nextId++, libraryID: libraryID, key: key, deleted: false, regular: opts.regular === false || opts.type ? false : true,
			parentItemID: opts.parent ? opts.parent.id : undefined,
			isRegularItem: function () { return this.regular; },
			isAttachment: function () { return opts.type === 'attachment'; }, isNote: function () { return opts.type === 'note'; },
			getNote: function () { return opts.note || ''; },
			getAttachments: function () { var me = this; return items.filter(function (i) { return i.parentItemID === me.id && i.isAttachment(); }).map(function (i) { return i.id; }); },
			getField: function (n) { return f[n] === undefined ? '' : f[n]; },
			setField: function (n, v) { f[n] = v; },
			getCollections: function () { return colls || []; },
			saveTx: function (o) { saved.push({ id: libraryID + '/' + key, extra: f.extra, opts: o }); return Promise.resolve(); },
		};
		items.push(it);
		return it;
	}
	var Zotero = {
		Prefs: { get: function (n) { return prefs[n]; }, set: function (n, v) { prefs[n] = v; } },
		debug: function () {}, logError: function (e) { logged.push(String(e && e.message || e)); },
		Libraries: {
			getAll: function () { return [
				{ libraryID: 1, libraryType: 'user', editable: true, waitForDataLoad: function () { return Promise.resolve(); } },
				{ libraryID: 2, libraryType: 'group', editable: true, waitForDataLoad: function () { return Promise.resolve(); } },
				{ libraryID: 3, libraryType: 'group', editable: false, waitForDataLoad: function () { return Promise.resolve(); } },
				{ libraryID: 4, libraryType: 'feed', editable: true, waitForDataLoad: function () { return Promise.resolve(); } },
			]; },
			getName: function (id) { return { 1: 'My Library', 2: 'Law Group', 3: 'Read-only Group' }[id]; },
		},
		Collections: { get: function (id) { return collections[id] || null; } },
		Items: {
			getAll: function (lib) { return Promise.resolve(items.filter(function (i) { return i.libraryID === lib; })); },
			get: function (id) { return items.filter(function (i) { return i.id === id; })[0] || null; },
			getByLibraryAndKey: function (lib, key) { return items.filter(function (i) { return i.libraryID === lib && i.key === key; })[0] || null; },
		},
		Notifier: { registerObserver: function (o, types, name) { notifiers.push({ o: o, types: types, name: name }); return 'obs1'; }, unregisterObserver: function (id) { notifiers.push('unreg:' + id); } },
		PreferencePanes: { register: function (o) { notifiers.push({ pane: o }); return Promise.resolve(); } },
		uiReadyPromise: new Promise(function () {}),
	};
	var Services = { logins: {
		searchLoginsAsync: function (q) { return Promise.resolve(logins.filter(function (l) { return l.origin === q.origin && l.httpRealm === q.httpRealm; })); },
		addLoginAsync: function (l) { logins.push(l); return Promise.resolve(l); },
		removeLogin: function (l) { logins.splice(logins.indexOf(l), 1); },
	} };
	var Components = { interfaces: { nsILoginInfo: 1 }, Constructor: function () {
		return function (origin, formAction, httpRealm, username, password) { this.origin = origin; this.httpRealm = httpRealm; this.username = username; this.password = password; };
	} };

	// ---- fake Perma.cc
	var srv = { calls: [], nextFolder: 100, nextGuid: 1, folders: { 10: { id: 10, name: 'Personal Links', parent: null, organization: null } }, archives: {}, key: 'GOODKEY', failUrl: {}, captureStatus: {}, preexisting: [], listFails: false, forceStatus: null, user: { id: 7, full_name: 'Jane Doe', top_level_folders: [{ id: 10, name: 'Personal Links', organization: null }] } };
	function respond(status, json, headers) {
		return Promise.resolve({ status: status, ok: status >= 200 && status < 300, headers: { get: function (h) { return (headers || {})[h]; } }, text: function () { return Promise.resolve(json === undefined || json === null ? '' : JSON.stringify(json)); } });
	}
	function fetchFake(url, o) {
		var path = url.replace('https://api.perma.cc/v1', ''), method = o.method, body = o.body ? JSON.parse(o.body) : null;
		srv.calls.push(method + ' ' + path + (body ? ' ' + JSON.stringify(body) : ''));
		if (srv.forceStatus) { var f = srv.forceStatus; if (f.once) srv.forceStatus = null; return respond(f.status, f.json, f.headers); }
		if (o.headers.Authorization !== 'ApiKey ' + srv.key) return respond(401, { detail: 'Authentication credentials were not provided.' });
		var m;
		if (method === 'GET' && path === '/user/') return respond(200, srv.user);
		if ((m = path.match(/^\/folders\/(\d+)\/folders/)) && !srv.folders[m[1]]) return respond(404, { detail: 'Not found.' });
		if (method === 'GET' && (m = path.match(/^\/folders\/(\d+)\/folders/))) return respond(200, { objects: Object.values(srv.folders).filter(function (x) { return String(x.parent) === m[1]; }) });
		if (method === 'POST' && (m = path.match(/^\/folders\/(\d+)\/folders\/$/))) { var id = srv.nextFolder++; srv.folders[id] = { id: id, name: body.name, parent: Number(m[1]) }; return respond(201, srv.folders[id]); }
		if (method === 'GET' && (m = path.match(/^\/archives\/\?limit=(\d+)&offset=(\d+)$/))) {
			if (srv.listFails) return respond(500, null);
			var all = srv.preexisting.concat(Object.values(srv.archives).map(function (a) { return { guid: a.guid, url: a.url, user_deleted: false, creation_timestamp: '2026-01-01T00:00:00Z', captures: [{ role: 'primary', status: 'pending' }] }; }));
			return respond(200, { objects: all.slice(Number(m[2]), Number(m[2]) + Number(m[1])) });
		}
		if (method === 'POST' && path === '/archives/') {
			if (srv.failUrl[body.url]) return respond(srv.failUrl[body.url].status, srv.failUrl[body.url].json);
			if (!srv.folders[body.folder]) return respond(404, { detail: 'Not found.' });
			var guid = 'AAAA-' + String(1000 + srv.nextGuid++);
			srv.archives[guid] = { guid: guid, url: body.url, title: body.title, folder: body.folder, is_private: false };
			return respond(201, { guid: guid, url: body.url, captures: [{ role: 'primary', status: 'pending' }] });
		}
		if (method === 'PATCH' && (m = path.match(/^\/archives\/([A-Z0-9-]+)\/$/))) { srv.archives[m[1]].is_private = !!body.is_private; return respond(200, srv.archives[m[1]]); }
		if (method === 'GET' && (m = path.match(/^\/archives\/([A-Z0-9-]+)\/$/))) {
			if (!srv.archives[m[1]]) return respond(404, { detail: 'Not found.' });
			return respond(200, { guid: m[1], captures: [{ role: 'primary', status: srv.captureStatus[m[1]] || 'success' }] });
		}
		return respond(404, { detail: 'no route ' + method + ' ' + path });
	}

	var src = read('addon/permacc.js');
	// jsc has no URL class: the part of it permacc.js uses (protocol, hostname, port, pathname, search), throwing on anything unparsable
	function URLShim(text) {
		var m = String(text).match(/^([a-z][a-z0-9+.-]*):(?:\/\/(?:[^@\/?#]*@)?([^\/:?#]*)(?::(\d+))?)?([^?#]*)(\?[^#]*)?/i);
		if (!m || (/^(https?|ftp)$/i.test(m[1]) && !m[2])) throw new TypeError('Invalid URL');
		this.protocol = m[1].toLowerCase() + ':';
		this.hostname = (m[2] || '').toLowerCase();
		this.port = m[3] || '';
		this.pathname = m[4] || (m[2] ? '/' : '');
		this.search = m[5] === '?' ? '' : (m[5] || '');
	}
	var P = new Function('Zotero', 'Services', 'Components', 'setTimeout', 'clearTimeout', 'URL', src + '; return PermaCC;')(Zotero, Services, Components, function (fn) { return 1; }, function () {}, URLShim);
	P.fetch = fetchFake;
	P.sleep = function () { return Promise.resolve(); };
	return { P: P, Zotero: Zotero, prefs: prefs, saved: saved, logged: logged, notifiers: notifiers, logins: logins, srv: srv, item: item, collections: collections };
}

var chain = Promise.resolve();
function test(name, fn) { chain = chain.then(function () { return fn(); }).catch(function (e) { errors.push(name + ' threw: ' + (e && e.stack || e)); }); }

test('defaults', function () {
	var w = world();
	eq(w.P.pref('urlFormat'), 'url-archived', 'default URL format');
	eq(w.P.pref('rememberKey'), true, 'key remembered by default');
	eq(w.P.pref('auto'), false, 'archiving is opt-in');
	eq(w.P.apiBase(), 'https://api.perma.cc/v1', 'default API base');
	ok(w.P.skipDomains().indexOf('westlaw.com') >= 0, 'subscription sites skipped by default');
});

test('Extra helpers: the library\'s own form is written and every spelling in it is recognized', function () {
	var P = world().P;
	// forms found in the real library (see the plugin's README): label spellings, extra spaces, a bare link
	[['perma-cc: https://perma.cc/6742-6GUE', '6742-6GUE', 'the form this library uses'],
	 ['perma-cc:  https://perma.cc/N3GJ-U7A3', 'N3GJ-U7A3', 'two spaces after the colon'],
	 ['https://perma.cc/V57A-TDE3', 'V57A-TDE3', 'a bare link on a line of its own'],
	 ['Perma.cc: https://perma.cc/ab12-CD34', 'AB12-CD34', 'the label as Perma.cc writes it, any case'],
	 ['perma.cc: perma.cc/AB12-CD34', 'AB12-CD34', 'no scheme'],
	 ['permacc: https://perma.cc/AB12-CD34', 'AB12-CD34', 'no hyphen'],
	 ['Perma CC: https://www.perma.cc/AB12-CD34', 'AB12-CD34', 'a space and www'],
	 ['foo: bar\nperma-cc: https://perma.cc/AB12-CD34\nbaz', 'AB12-CD34', 'among other lines'],
	 ['  perma-cc: https://perma.cc/AB12-CD34  ', 'AB12-CD34', 'indented']].forEach(function (c) {
		eq(P.guidFromExtra(c[0]), c[1], 'recognized: ' + c[2]);
	});
	// not archives
	['Library Catalog: perma.cc', 'Citation Key: KPPermanentMakeUp2004', 'perma-cc: https://example.com/AB12-CD34', 'perma-cc: not yet', 'see https://perma.cc/AB12-CD34 for the page',
	 'perma-cc: https://perma.cc/AB12-CD34567', 'perma-cc: https://perma.cc/AB12', '', 'Perma.cc'].forEach(function (x) {
		eq(P.guidFromExtra(x), null, 'not an archive: ' + JSON.stringify(x));
	});
	// writing: the library's own form
	eq(P.extraWithGuid('', 'ab12-cd34'), 'perma-cc: https://perma.cc/AB12-CD34', 'adds the line in the library\'s form to empty Extra');
	eq(P.extraWithGuid('Citation Key: x\n', 'AB12-CD34'), 'Citation Key: x\nperma-cc: https://perma.cc/AB12-CD34', 'appends after other lines');
	// an existing line is the user's: left byte for byte when it names the same archive
	var theirs = 'a\nperma-cc:  https://perma.cc/AB12-CD34\nb';
	eq(P.extraWithGuid(theirs, 'AB12-CD34'), theirs, 'an existing line for the same archive is not rewritten (spacing and all)');
	var bare = 'https://perma.cc/AB12-CD34';
	eq(P.extraWithGuid(bare, 'ab12-cd34'), bare, 'nor a bare link');
	eq(P.extraWithGuid('a\nPerma.cc: https://perma.cc/OLD1-OLD1\nb', 'AB12-CD34'), 'a\nperma-cc: https://perma.cc/AB12-CD34\nb', 'a line for a different archive is replaced in place');
	eq(P.extraWithoutGuid('a\nperma-cc: https://perma.cc/AB12-CD34\nb'), 'a\nb', 'removes only the line');
	eq(P.extraWithoutGuid('a\nhttps://perma.cc/AB12-CD34\nb'), 'a\nb', 'including a bare link');
	eq(P.extraWithoutGuid('Library Catalog: perma.cc'), 'Library Catalog: perma.cc', 'but not lines that are not archives');
	eq(P.extraWithGuid(P.extraWithGuid('x', 'AB12-CD34'), 'AB12-CD34'), 'x\nperma-cc: https://perma.cc/AB12-CD34', 'idempotent');
	var mlz = 'mlzsync1:{"reporter":"U.S."}';
	eq(P.extraWithoutGuid(P.extraWithGuid(mlz, 'AB12-CD34')), mlz, 'leaves the Juris-M sync line untouched');
	eq(P.guidsInText('<p>Perma.cc link: https://perma.cc/V3UL-BTZH</p><p>and perma.cc/ABCD-1234.</p>'), ['V3UL-BTZH', 'ABCD-1234'], 'finds every link in a note');
});

test('archivable URLs', function () {
	var P = world().P;
	eq(P.archivableURL('https://www.law.harvard.edu/x'), 'https://www.law.harvard.edu/x', 'web page');
	eq(P.archivableURL('  http://example.org/a?b=1#c '), 'http://example.org/a?b=1#c', 'trimmed');
	[['', 'empty'], ['ftp://example.org/x', 'ftp'], ['file:///Users/x.pdf', 'file'], ['not a url', 'text'], ['http://localhost:8080/x', 'localhost'],
	 ['http://192.168.1.5/x', 'private IP'], ['http://10.0.0.1/', '10.x'], ['https://perma.cc/AB12-CD34', 'a perma link'], ['https://www.westlaw.com/Document/x', 'skip list (subdomain)'],
	 ['https://heinonline.org/HOL/x', 'skip list'], ['doi:10.1/x', 'doi scheme'], ['http://intranet/x', 'dotless host']].forEach(function (c) {
		eq(P.archivableURL(c[0]), null, 'not archivable: ' + c[1]);
	});
	var w = world({ prefs: { skipDomains: 'example.org' } });
	eq(w.P.archivableURL('https://sub.example.org/x'), null, 'custom skip list');
	eq(w.P.archivableURL('https://www.westlaw.com/x'), 'https://www.westlaw.com/x', 'custom skip list replaces the default');
});

test('key storage: remembered', function () {
	var w = world();
	return w.P.setKey(' GOODKEY ', true).then(function () {
		eq(w.logins.length, 1, 'one login stored');
		eq(w.logins[0].password, 'GOODKEY', 'trimmed key stored');
		eq(w.logins[0].origin, 'chrome://lawcite', 'stored under the lawcite origin');
		eq(w.prefs['lawcite.permacc.rememberKey'], true, 'choice recorded');
		w.P.sessionKey = null;
		return w.P.getKey();
	}).then(function (k) {
		eq(k, 'GOODKEY', 'read back from the login manager');
		return w.P.setKey('NEWKEY', true);
	}).then(function () { eq(w.logins.length, 1, 'replacing a key leaves one login'); eq(w.logins[0].password, 'NEWKEY', 'new key stored');
		return w.P.forgetKey();
	}).then(function () {
		eq(w.logins.length, 0, 'forget removes the stored login');
		return w.P.getKey();
	}).then(function (k) { eq(k, null, 'no key after forgetting'); });
});

test('key storage: not remembered', function () {
	var w = world();
	return w.P.setKey('GOODKEY', false).then(function () {
		eq(w.logins.length, 0, 'nothing written to the login manager');
		eq(w.prefs['lawcite.permacc.rememberKey'], false, 'choice recorded');
		return w.P.getKey();
	}).then(function (k) {
		eq(k, 'GOODKEY', 'still usable this session');
		w.P.sessionKey = null; // a new Zotero session
		return w.P.getKey();
	}).then(function (k) { eq(k, null, 'gone after the session ends'); });
});

test('key storage: switching the remember option', function () {
	var w = world();
	return w.P.setKey('GOODKEY', true).then(function () { return w.P.applyRememberChoice(false); }).then(function () {
		eq(w.logins.length, 0, 'turning remembering off deletes the stored key');
		return w.P.getKey();
	}).then(function (k) {
		eq(k, 'GOODKEY', 'but it keeps working for the session');
		return w.P.applyRememberChoice(true);
	}).then(function () { eq(w.logins.length, 1, 'turning it back on stores the key again'); });
});

test('test key only works against a test server', function () {
	var w = world({ prefs: { testKey: 'TESTKEY' } });
	return w.P.getKey().then(function (k) {
		eq(k, null, 'a testKey pref is ignored against the real Perma.cc');
		w.prefs['lawcite.permacc.apiBase'] = 'http://127.0.0.1:9/v1';
		return w.P.getKey();
	}).then(function (k) { eq(k, 'TESTKEY', 'used once the API base is overridden'); });
});

test('verify', function () {
	var w = world();
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.verify(); }).then(function (u) {
		eq(u.full_name, 'Jane Doe', 'account returned');
		eq(w.prefs['lawcite.permacc.accountName'], 'Jane Doe', 'account name remembered for the pane');
		return w.P.setKey('BADKEY', false);
	}).then(function () { return w.P.verify().then(function () { errors.push('bad key should fail'); }, function (e) { eq(e.kind, 'auth', 'bad key is an auth error'); eq(e.status, 401, '401'); }); });
});

test('folders: library and nested collections', function () {
	var w = world();
	var it = w.item(1, 'ITEM1', { url: 'https://example.org/a' }, [2]); // AI, inside Torts
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.folderIdFor(it); }).then(function (id) {
		var created = w.srv.calls.filter(function (c) { return c.indexOf('POST /folders') === 0; });
		eq(created, ['POST /folders/10/folders/ {"name":"Zotero"}', 'POST /folders/100/folders/ {"name":"My Library"}', 'POST /folders/101/folders/ {"name":"Torts"}', 'POST /folders/102/folders/ {"name":"AI"}'], 'folders mirror the collection path under Personal Links/Zotero/<library>');
		eq(id, 103, 'the deepest folder is used');
		w.srv.calls.length = 0;
		return w.P.folderIdFor(it);
	}).then(function (id) {
		eq(id, 103, 'cached');
		eq(w.srv.calls, [], 'no requests when everything is cached');
		w.prefs['lawcite.permacc.folderMap'] = '{}'; // cache lost: reuse same-named folders, do not duplicate
		w.srv.calls.length = 0;
		return w.P.folderIdFor(it);
	}).then(function (id) {
		eq(id, 103, 'existing folders are found again');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST') === 0; }), [], 'nothing created twice');
	});
});

test('folders: item in several collections, and in none', function () {
	var w = world();
	var multi = w.item(1, 'M', { url: 'https://example.org/m' }, [3, 2]); // Contracts and Torts/AI: "Contracts" sorts before "Torts/AI"
	var none = w.item(1, 'N', { url: 'https://example.org/n' }, []);
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.folderIdFor(multi); }).then(function () {
		eq(w.P.primaryPath(multi).map(function (s) { return s.name; }), ['Contracts'], 'first collection by name');
		return w.P.folderIdFor(none);
	}).then(function (id) { eq(w.srv.folders[id].name, 'My Library', 'no collection: the library folder itself'); });
});

test('findCandidates', function () {
	var w = world();
	w.item(1, 'GOOD', { url: 'https://example.org/good' }, []);
	w.item(1, 'NOURL', { url: '' }, []);
	w.item(1, 'DONE', { url: 'https://example.org/done', extra: 'Perma.cc: https://perma.cc/AB12-CD34' }, []);
	var trash = w.item(1, 'TRASH', { url: 'https://example.org/trash' }, []); trash.deleted = true;
	w.item(1, 'ATT', { url: 'https://example.org/att' }, [], { regular: false });
	w.item(1, 'FILE', { url: 'file:///x.pdf' }, []);
	w.item(1, 'WL', { url: 'https://www.westlaw.com/Document/1' }, []);
	w.item(2, 'GROUP', { url: 'https://example.org/group' }, []);
	w.item(3, 'RO', { url: 'https://example.org/readonly' }, []);
	w.item(4, 'FEED', { url: 'https://example.org/feed' }, []);
	return w.P.findCandidates().then(function (c) {
		eq(c.map(function (x) { return x.item.libraryID + '/' + x.item.key; }).sort(), ['1/GOOD', '2/GROUP'], 'only regular, live, archivable, unarchived items in editable user/group libraries');
		w.prefs['lawcite.permacc.excludedLibraries'] = '[2]';
		return w.P.findCandidates();
	}).then(function (c) { eq(c.map(function (x) { return x.item.key; }), ['GOOD'], 'an excluded library is skipped'); });
});

test('run: archives, files, writes Extra, then is idempotent', function () {
	var w = world();
	var a = w.item(1, 'A', { url: 'https://example.org/a', title: 'Case A' }, [2]);
	var b = w.item(1, 'B', { url: 'https://example.org/b', extra: 'Citation Key: bkey' }, []);
	var g = w.item(2, 'G', { url: 'https://example.org/g' }, []);
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.run(); }).then(function (p) {
		eq(p.state, 'done', 'run finished');
		eq([p.total, p.done, p.failed], [3, 3, 0], 'all three archived');
		var posts = w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0; });
		eq(posts.length, 3, 'one archive request per item');
		ok(posts[0].indexOf('"title":"Case A"') > 0, 'the item title is sent');
		eq(a.getField('extra'), 'perma-cc: https://perma.cc/AAAA-1001', 'link stored in Extra');
		eq(b.getField('extra'), 'Citation Key: bkey\nperma-cc: https://perma.cc/AAAA-1002', 'existing Extra preserved');
		eq(a.getField('url'), 'https://example.org/a', 'the item URL is never changed');
		eq(w.saved.length, 3, 'each item saved once');
		eq(w.saved[0].opts, { skipDateModifiedUpdate: true }, 'saves do not touch dateModified');
		eq(w.srv.archives['AAAA-1001'].folder, 103, 'archive filed under Torts/AI');
		eq(w.srv.folders[w.srv.archives['AAAA-1003'].folder].name, 'Law Group', 'group library items go in the group folder');
		eq(JSON.parse(w.prefs['lawcite.permacc.pending']).length, 3, 'captures are tracked until confirmed');
		w.srv.calls.length = 0;
		return w.P.run();
	}).then(function (p) {
		eq(p.total, 0, 'second run: nothing to do');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0; }), [], 'no archive requests for items that already have one');
	});
});

test('run: private option', function () {
	var w = world({ prefs: { 'private': true } });
	w.item(1, 'A', { url: 'https://example.org/a' }, []);
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.run(); }).then(function () {
		eq(w.srv.calls.filter(function (c) { return c.indexOf('PATCH') === 0; }), ['PATCH /archives/AAAA-1001/ {"is_private":true}'], 'archive made private');
		eq(w.srv.archives['AAAA-1001'].is_private, true, 'private on the server');
	});
});

test('run: no key, bad key, quota, repeated failure', function () {
	var w = world();
	w.item(1, 'A', { url: 'https://example.org/a' }, []);
	return w.P.run().then(function (p) {
		eq(p.state, 'no-key', 'refuses without a key');
		eq(w.srv.calls, [], 'and makes no requests');
		return w.P.setKey('WRONG', false);
	}).then(function () { return w.P.run(); }).then(function (p) {
		eq(p.state, 'auth-error', 'a bad key stops the run');
		return w.P.setKey('GOODKEY', false);
	}).then(function () {
		w.srv.failUrl['https://example.org/a'] = { status: 400, json: { detail: 'You have reached your link limit for this month.' } };
		return w.P.run();
	}).then(function (p) {
		eq(p.state, 'quota', 'a limit message stops the run as a quota problem');
		eq(JSON.parse(w.prefs['lawcite.permacc.failures'] || '{}')['1/A'], undefined, 'a quota stop does not blame the item');
	});
});

test('run: a rejected URL is recorded, not retried for a day, and does not stop the rest', function () {
	var w = world();
	w.item(1, 'BAD', { url: 'https://example.org/bad' }, []);
	w.item(1, 'GOOD', { url: 'https://example.org/good' }, []);
	w.srv.failUrl['https://example.org/bad'] = { status: 400, json: { url: ['Not a valid URL.'] } };
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.run(); }).then(function (p) {
		eq([p.done, p.failed], [1, 1], 'one archived, one failed');
		var f = JSON.parse(w.prefs['lawcite.permacc.failures']);
		eq(f['1/BAD'].count, 1, 'failure counted');
		ok(/valid URL/.test(f['1/BAD'].reason), 'reason kept: ' + f['1/BAD'].reason);
		w.srv.calls.length = 0;
		return w.P.run();
	}).then(function (p) {
		eq(p.total, 0, 'not retried straight away');
		w.P.retryFailed();
		return w.P.findCandidates();
	}).then(function (c) { eq(c.map(function (x) { return x.item.key; }), ['BAD'], 'retry-failed puts it back'); });
});

test('run: stops after five failures in a row', function () {
	var w = world();
	for (var i = 0; i < 8; i++) { w.item(1, 'F' + i, { url: 'https://example.org/f' + i }, []); w.srv.failUrl['https://example.org/f' + i] = { status: 400, json: { detail: 'nope' } }; }
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.run(); }).then(function (p) {
		eq(p.state, 'stopped', 'run gave up');
		eq(p.failed, 5, 'after five');
	});
});

test('request: retries 429 with backoff and honors Retry-After', function () {
	var w = world(), sleeps = [];
	w.P.sleep = function (ms) { sleeps.push(ms); return Promise.resolve(); };
	return w.P.setKey('GOODKEY', false).then(function () {
		w.srv.forceStatus = { status: 429, json: { detail: 'slow down' }, headers: { 'Retry-After': '7' }, once: true };
		return w.P.request('GET', '/user/');
	}).then(function (r) {
		eq(r.status, 200, 'succeeded after the retry');
		eq(sleeps, [7000], 'waited the Retry-After time');
		sleeps.length = 0;
		w.srv.forceStatus = { status: 503, json: null };
		return w.P.request('GET', '/user/').then(function () { errors.push('persistent 503 should fail'); }, function (e) { eq(e.status, 503, 'gave up on a persistent 503'); eq(sleeps, [2000, 4000, 8000], 'exponential backoff'); });
	});
});

test('a deleted folder is rebuilt once', function () {
	var w = world();
	w.item(1, 'A', { url: 'https://example.org/a' }, [1]);
	return w.P.setKey('GOODKEY', false).then(function () {
		w.prefs['lawcite.permacc.folderMap'] = JSON.stringify({ root: 10, L1: 555 }); // 555 no longer exists on Perma.cc
		return w.P.run();
	}).then(function (p) {
		eq(p.done, 1, 'archived after rebuilding the folder cache');
		ok(JSON.parse(w.prefs['lawcite.permacc.folderMap']).L1 !== 555, 'stale folder id replaced');
	});
});

test('pending captures: a failed capture takes the link back out', function () {
	var w = world();
	var a = w.item(1, 'A', { url: 'https://example.org/a' }, []);
	var b = w.item(1, 'B', { url: 'https://example.org/b' }, []);
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.run(); }).then(function () {
		w.srv.captureStatus['AAAA-1001'] = 'failed';
		w.srv.captureStatus['AAAA-1002'] = 'pending';
		return w.P.checkPending();
	}).then(function () {
		eq(a.getField('extra'), '', 'link removed from the item whose capture failed');
		ok(w.P.guidFromExtra(b.getField('extra')) === 'AAAA-1002', 'a pending capture keeps its link');
		eq(JSON.parse(w.prefs['lawcite.permacc.pending']).map(function (p) { return p.guid; }), ['AAAA-1002'], 'only the pending one is still tracked');
		eq(JSON.parse(w.prefs['lawcite.permacc.failures'])['1/A'].count, 1, 'the failure is recorded');
		w.srv.captureStatus['AAAA-1002'] = 'success';
		return w.P.checkPending();
	}).then(function () { eq(JSON.parse(w.prefs['lawcite.permacc.pending']), [], 'confirmed captures are dropped from tracking'); });
});

test('formatURL: the three formats', function () {
	var w = world();
	var it = w.item(1, 'A', { url: 'https://example.org/a', extra: 'Perma.cc: https://perma.cc/AB12-CD34' }, []);
	var plain = w.item(1, 'B', { url: 'https://example.org/b' }, []);
	function css(url) { return { URL: url }; }
	var c = css('https://example.org/a');
	eq(w.P.formatURL(c, it), true, 'default format applies');
	eq(c.URL, 'https://example.org/a, archived at https://perma.cc/AB12-CD34', '[url], archived at [perma-cc url]');
	w.prefs['lawcite.permacc.urlFormat'] = 'perma';
	c = css('https://example.org/a'); w.P.formatURL(c, it);
	eq(c.URL, 'https://perma.cc/AB12-CD34', '[perma-cc url]');
	w.prefs['lawcite.permacc.urlFormat'] = 'url';
	c = css('https://example.org/a'); eq(w.P.formatURL(c, it), false, 'url-only changes nothing');
	eq(c.URL, 'https://example.org/a', '[url]');
	w.prefs['lawcite.permacc.urlFormat'] = 'url-archived';
	c = css('https://example.org/b'); eq(w.P.formatURL(c, plain), false, 'an item without an archive is left alone');
	eq(c.URL, 'https://example.org/b', 'unchanged');
	c = {}; eq(w.P.formatURL(c, it), false, 'no URL, nothing to combine');
	w.prefs['lawcite.permacc.urlFormat'] = 'perma';
	c = {}; w.P.formatURL(c, it); eq(c.URL, 'https://perma.cc/AB12-CD34', 'perma-only supplies the URL even if the style had none');
});

test('notifier and lifecycle', function () {
	var w = world();
	var scheduled = 0;
	w.P.schedule = function () { scheduled++; };
	return w.P.init({ id: 'lawcite@zotero.local', version: '9', rootURI: 'jar:x!/permacc/', fetch: w.P.fetch, sleep: w.P.sleep }).then(function () {
		var obs = w.notifiers.filter(function (n) { return n.o; })[0];
		eq(obs.types, ['item'], 'observes items');
		var pane = w.notifiers.filter(function (n) { return n.pane; })[0].pane;
		eq([pane.label, pane.src, pane.pluginID], ['Perma.cc', 'jar:x!/permacc/preferences.xhtml', 'lawcite@zotero.local'], 'Settings pane registered');
		obs.o.notify('modify', 'item', [1]);
		eq(scheduled, 0, 'nothing scheduled while archiving is off');
		w.prefs['lawcite.permacc.auto'] = true;
		obs.o.notify('modify', 'item', [1]); obs.o.notify('add', 'item', [2]); obs.o.notify('delete', 'item', [3]); obs.o.notify('modify', 'collection', [4]);
		eq(scheduled, 2, 'adds and changes to items schedule a run; deletes and other types do not');
		w.P.destroy();
		eq(w.notifiers.indexOf('unreg:obs1') >= 0, true, 'observer removed');
		obs.o.notify('add', 'item', [5]);
		eq(scheduled, 2, 'nothing after destroy');
	});
});

// ---- the Settings pane's script, run against a fake DOM: it has never run in a real pane in this suite otherwise
function flush(w, n) { var p = Promise.resolve(); for (var i = 0; i < (n || 300); i++) p = p.then(function () {}); return p; }
function paneWorld(w) {
	var ids = (read('addon/preferences.xhtml').match(/id="(permacc-[a-z-]+)"/g) || []).map(function (m) { return m.slice(4, -1); });
	var els = {};
	function el(id) {
		var e = { id: id, attrs: {}, checked: false, disabled: false, value: '', textContent: '', children: [], parent: null, listener: null,
			setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; },
			append: function (c) { c.parent = this; this.children.push(c); },
			addEventListener: function (t, f) { this.listener = f; },
			remove: function () { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); } };
		Object.defineProperty(e, 'firstChild', { get: function () { return this.children[0] || null; } });
		return e;
	}
	ids.forEach(function (id) { els[id] = el(id); });
	var document = { getElementById: function (id) { return els[id] || null; }, createXULElement: function () { return el(null); } };
	var launched = [], confirms = [], answer = { yes: true };
	w.Zotero.Lawcite = { permacc: w.P };
	w.Zotero.launchURL = function (u) { launched.push(u); };
	var timers = [];
	var Services = { prompt: { confirm: function (win, title, text) { confirms.push(text); return answer.yes; } } };
	new Function('Zotero', 'document', 'Services', 'window', 'setInterval', 'clearInterval', read('addon/preferences.js'))(w.Zotero, document, Services, {}, function (f) { timers.push(f); return 1; }, function () {});
	return { pane: w.Zotero.PermaCCPrefs, els: els, launched: launched, confirms: confirms, answer: answer, timers: timers };
}

test('pane script: opens, connects, offers, forgets', function () {
	var w = world();
	w.item(1, 'A', { url: 'https://example.org/a' }, []);
	w.item(1, 'B', { url: 'https://example.org/b' }, []);
	var W = paneWorld(w), E = W.els;
	return W.pane.init(), flush(w).then(function () {
		eq(E['permacc-status'].attrs.value, 'Not connected: no API key yet.', 'status before connecting');
		eq(E['permacc-remember'].checked, true, 'remember is on by default');
		eq(E['permacc-skip'].value.split('\n').indexOf('westlaw.com') >= 0, true, 'skip list shown one per line');
		eq(E['permacc-libraries'].children.map(function (c) { return c.attrs.label; }), ['My Library', 'Law Group (shared group)'], 'editable libraries listed; read-only group and feed left out');
		eq(E['permacc-forget'].disabled, true, 'nothing to forget yet');
		E['permacc-libraries'].children[1].checked = false; E['permacc-libraries'].children[1].listener();
		eq(JSON.parse(w.prefs['lawcite.permacc.excludedLibraries']), [2], 'unticking a library excludes it');
		E['permacc-libraries'].children[1].checked = true; E['permacc-libraries'].children[1].listener();
		eq(JSON.parse(w.prefs['lawcite.permacc.excludedLibraries']), [], 'and ticking it includes it again');
		eq(W.timers.length, 1, 'progress is polled while the pane is open');

		E['permacc-key'].value = 'WRONG';
		return W.pane.saveKey();
	}).then(function () {
		eq(E['permacc-status'].attrs.value, 'Perma.cc did not accept that key.', 'a bad key is explained');
		return w.P.hasKey();
	}).then(function (has) {
		eq(has, false, 'a rejected key is not kept');
		eq(W.confirms.length, 0, 'no offer after a failure');
		E['permacc-key'].value = '  GOODKEY ';
		return W.pane.saveKey();
	}).then(function () { return flush(w); }).then(function () {
		eq(E['permacc-status'].attrs.value, 'Connected to Perma.cc as Jane Doe.', 'status after connecting');
		eq(E['permacc-key'].value, '', 'the key is cleared from the field');
		eq(E['permacc-forget'].disabled, false, 'forget is available');
		eq(W.confirms.length, 1, 'the first-run offer is made once');
		ok(/2 web URLs/.test(W.confirms[0]), 'it says how many URLs are waiting: ' + W.confirms[0].slice(0, 60));
		eq(w.prefs['lawcite.permacc.auto'], true, 'accepting turns automatic archiving on');
		eq(w.prefs['lawcite.permacc.offered'], true, 'and is not offered again');
		eq(w.logins.length, 1, 'the key was remembered (default)');
		return flush(w, 600);
	}).then(function () {
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0; }).length, 2, 'accepting archives the waiting URLs');
		W.pane.refreshProgress();
		eq(E['permacc-progress'].attrs.value, 'Finished: 2 archived.', 'progress text after a run');
		eq(E['permacc-run'].disabled, false, 'Archive now is available again');
		E['permacc-key'].value = 'GOODKEY'; W.answer.yes = false;
		return W.pane.saveKey();
	}).then(function () { eq(W.confirms.length, 1, 'reconnecting does not repeat the offer'); return W.pane.setRemember(false); }).then(function () {
		eq(w.logins.length, 0, 'switching "remember" off deletes the stored key');
		eq(w.prefs['lawcite.permacc.rememberKey'], false, 'and records the choice');
		return W.pane.forget();
	}).then(function () {
		eq(E['permacc-status'].attrs.value, 'Not connected: no API key yet.', 'status after forgetting');
		return w.P.hasKey();
	}).then(function (has) { eq(has, false, 'key gone'); });
});

test('pane script: declining the first-run offer, skip list, progress texts, buttons', function () {
	var w = world();
	w.item(1, 'A', { url: 'https://example.org/a' }, []);
	var W = paneWorld(w), E = W.els;
	W.answer.yes = false;
	return w.P.setKey('GOODKEY', false).then(function () { E['permacc-key'].value = 'GOODKEY'; return W.pane.saveKey(); }).then(function () {
		eq(w.prefs['lawcite.permacc.auto'], false, 'declining leaves automatic archiving off');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0; }), [], 'and archives nothing');
		E['permacc-skip'].value = 'a.com\nb.org, c.net'; W.pane.saveSkip();
		eq(w.prefs['lawcite.permacc.skipDomains'], 'a.com, b.org, c.net', 'the skip list is saved, normalized');
		w.P.progress = { state: 'quota', total: 5, done: 1, failed: 0, current: '' }; w.P.lastError = 'link limit reached'; W.pane.refreshProgress();
		eq(E['permacc-progress'].attrs.value, 'Perma.cc reports a limit: link limit reached', 'quota text');
		w.P.progress = { state: 'auth-error', total: 5, done: 0, failed: 0, current: '' }; W.pane.refreshProgress();
		eq(/rejected the API key/.test(E['permacc-progress'].attrs.value), true, 'auth text');
		w.P.progress = { state: 'running', total: 4, done: 1, failed: 1, current: 'Some Case' }; w.P.running = true; W.pane.refreshProgress();
		eq(E['permacc-progress'].attrs.value, 'Archiving 3 of 4: Some Case', 'running text');
		eq([E['permacc-run'].disabled, E['permacc-pause'].disabled], [true, false], 'while running: archive disabled, pause enabled');
		W.pane.pause(); eq(w.P.paused, true, 'pause pauses'); w.P.running = false;
		w.prefs['lawcite.permacc.failures'] = JSON.stringify({ '1/X': { ts: 1, count: 1, reason: 'r' } }); W.pane.refreshProgress();
		eq(E['permacc-retry'].disabled, false, 'retry failed is available when something failed');
		eq(/1 item could not be archived/.test(E['permacc-note'].textContent), true, 'and the note says so');
		W.pane.retryFailed(); eq(w.prefs['lawcite.permacc.failures'], '{}', 'retry clears the failures');
		W.pane.openKeyPage(); W.pane.openDocs();
		eq(W.launched, ['https://perma.cc/settings/tools', 'https://perma.cc/docs/developer'], 'links open the key page and the docs');
		return w.P.forgetKey();
	}).then(function () { E['permacc-progress'].attrs.value = ''; return W.pane.archiveNow(); }).then(function () {
		eq(E['permacc-progress'].attrs.value, 'Save an API key first.', 'Archive now without a key says what to do');
	});
});

test('lawcite pane coordinator: starts every part, isolates failures', function () {
	var calls = [], errs = [];
	var Z = { logError: function (e) { errs.push(e.message); }, PermaCCPrefs: { init: function () { calls.push('perma'); throw new Error('perma init boom'); } }, HiCitePrefs: { init: function () { calls.push('hicite'); } } };
	new Function('Zotero', 'document', read('../../pane/preferences.js'))(Z, { getElementById: function (id) { calls.push('scroll:' + id); return { scrollIntoView: function () {} }; } });
	Z.LawcitePrefs.init();
	eq(calls, ['perma', 'hicite'], 'both parts are started, in order, even though the first throws');
	eq(errs, ['perma init boom'], 'the failure is logged, not swallowed silently');
	Z.LawcitePrefs.scrollTo('hicite');
	eq(calls[calls.length - 1], 'scroll:lawcite-section-hicite', 'sections can be scrolled to by name');
	eq(Z.LawcitePrefs.SECTIONS, ['perma', 'hicite', 'jurisdictions'], 'the three sections');
});

test('findCandidates: archives recorded anywhere in the library are never archived again', function () {
	var w = world();
	// the shapes found in the real library
	w.item(1, 'LABEL', { url: 'https://example.org/1', extra: 'perma-cc: https://perma.cc/6742-6GUE' }, []);
	w.item(1, 'SPACES', { url: 'https://example.org/2', extra: 'perma-cc:  https://perma.cc/N3GJ-U7A3' }, []);
	w.item(1, 'BARE', { url: 'https://example.org/3', extra: 'https://perma.cc/V57A-TDE3' }, []);
	var withAttachment = w.item(1, 'ATTACH', { url: 'https://example.org/4' }, []);
	w.item(1, 'ATTACHED', { url: 'https://perma.cc/V2NP-PVC8' }, [], { type: 'attachment', parent: withAttachment });
	var withNote = w.item(1, 'NOTE', { url: 'https://example.org/5' }, []);
	w.item(1, 'THENOTE', {}, [], { type: 'note', parent: withNote, note: '<p>Perma.cc link: https://perma.cc/V3UL-BTZH</p>' });
	var plainNote = w.item(1, 'PLAINNOTE', { url: 'https://example.org/6' }, []);
	w.item(1, 'ANOTE', {}, [], { type: 'note', parent: plainNote, note: '<p>Read this one carefully.</p>' });
	var otherAttachment = w.item(1, 'OTHERATT', { url: 'https://example.org/7' }, []);
	w.item(1, 'PDF', { url: 'https://example.org/7.pdf' }, [], { type: 'attachment', parent: otherAttachment });
	w.item(1, 'LIBCAT', { url: 'https://example.org/8', extra: 'Library Catalog: perma.cc' }, []);
	w.item(1, 'ISPERMA', { url: 'https://perma.cc/WCP6-P66N', extra: 'Library Catalog: perma.cc' }, []);
	w.item(1, 'KEYONLY', { url: 'https://example.org/9', extra: 'Citation Key: KPPermanentMakeUp2004' }, []);
	return w.P.findCandidates().then(function (c) {
		eq(c.map(function (x) { return x.item.key; }).sort(), ['KEYONLY', 'LIBCAT', 'OTHERATT', 'PLAINNOTE'],
			'only items with no archive anywhere: an unrelated attachment, an unrelated note, "Library Catalog: perma.cc" and a Citation Key are not archives, and an item whose URL is itself a perma.cc page is skipped');
	});
});

test('archiveOne never pays twice', function () {
	var w = world();
	var it = w.item(1, 'A', { url: 'https://example.org/a' }, []);
	return w.P.setKey('GOODKEY', false).then(function () {
		it.setField('extra', 'perma-cc: https://perma.cc/AB12-CD34'); // an archive appeared after the item was found (sync, the user, another run)
		return w.P.archiveOne(it, 'https://example.org/a');
	}).then(function (guid) {
		eq(guid, 'AB12-CD34', 'the recorded archive is returned');
		eq(w.srv.calls, [], 'and the API is not touched');
		eq(w.saved.length, 0, 'and the item is not saved');
		var at = w.item(1, 'B', { url: 'https://example.org/b' }, []);
		w.item(1, 'BA', { url: 'https://perma.cc/ZZZZ-1111' }, [], { type: 'attachment', parent: at });
		return w.P.archiveOne(at, 'https://example.org/b');
	}).then(function (guid) {
		eq(guid, 'ZZZZ-1111', 'an archive recorded as a child attachment counts as well');
		eq(w.srv.calls, [], 'still no API calls');
	});
});

test('run: an archive already in the account is recorded, not created again', function () {
	var w = world();
	var hit = w.item(1, 'HIT', { url: 'https://Example.ORG/page/' }, [2]);      // differs only by host case and a trailing slash
	var gone = w.item(1, 'GONE', { url: 'https://example.org/was-deleted' }, []);
	var failed = w.item(1, 'FAILED', { url: 'https://example.org/failed-before' }, []);
	var fresh = w.item(1, 'FRESH', { url: 'https://example.org/new' }, []);
	w.srv.preexisting = [
		{ guid: 'OLD1-0001', url: 'https://example.org/page', user_deleted: false, creation_timestamp: '2024-01-01T00:00:00Z', captures: [{ role: 'primary', status: 'success' }] },
		{ guid: 'NEW1-0002', url: 'https://example.org/page', user_deleted: false, creation_timestamp: '2025-06-01T00:00:00Z', captures: [{ role: 'primary', status: 'success' }] },
		{ guid: 'DEL1-0003', url: 'https://example.org/was-deleted', user_deleted: true, creation_timestamp: '2025-01-01T00:00:00Z', captures: [{ role: 'primary', status: 'success' }] },
		{ guid: 'BAD1-0004', url: 'https://example.org/failed-before', user_deleted: false, creation_timestamp: '2025-01-01T00:00:00Z', captures: [{ role: 'primary', status: 'failed' }] },
	];
	return w.P.setKey('GOODKEY', false).then(function () { return w.P.run(); }).then(function (p) {
		eq([p.total, p.adopted, p.done, p.failed], [4, 1, 3, 0], 'one adopted, three archived');
		eq(hit.getField('extra'), 'perma-cc: https://perma.cc/NEW1-0002', 'the newest archive of that URL is recorded, in the library\'s form');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0 && c.indexOf('example.org/page') >= 0; }), [], 'nothing was created for it');
		ok(w.P.guidFromExtra(gone.getField('extra')) && w.P.guidFromExtra(gone.getField('extra')) !== 'DEL1-0003', 'a deleted archive does not count: a new one is made');
		ok(w.P.guidFromExtra(failed.getField('extra')) !== 'BAD1-0004', 'nor does a failed capture');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0; }).length, 3, 'three archives created');
		eq(JSON.parse(w.prefs['lawcite.permacc.pending']).length, 3, 'an adopted archive needs no capture check');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('PUT') === 0; }), [], 'and an existing archive is not moved between folders');
		w.srv.calls.length = 0;
		return w.P.run();
	}).then(function (p) {
		eq(p.total, 0, 'a second run finds nothing to do');
		eq(w.srv.calls.filter(function (c) { return c.indexOf('GET /archives/?') === 0; }), [], 'and does not read the account again when there is nothing to check');
	});
});

test('run: if the account cannot be read, nothing is archived', function () {
	var w = world();
	var it = w.item(1, 'A', { url: 'https://example.org/a' }, []);
	return w.P.setKey('GOODKEY', false).then(function () {
		w.srv.listFails = true;
		return w.P.run();
	}).then(function (p) {
		eq(p.state, 'stopped', 'the run stops');
		ok(/avoid duplicates/.test(w.P.lastError), 'and says why: ' + w.P.lastError);
		eq(w.srv.calls.filter(function (c) { return c.indexOf('POST /archives/') === 0; }), [], 'no archive was created without checking the account');
		eq(it.getField('extra'), '', 'the item is untouched');
		w.srv.listFails = false; w.P._account = null;
		return w.P.run();
	}).then(function (p) { eq([p.state, p.done], ['done', 1], 'it works once the account can be read'); });
});

test('formatURL uses an archive recorded as a child attachment', function () {
	var w = world();
	var it = w.item(1, 'A', { url: 'https://example.org/a' }, []);
	w.item(1, 'AA', { url: 'https://perma.cc/V2NP-PVC8' }, [], { type: 'attachment', parent: it });
	var c = { URL: 'https://example.org/a' };
	eq(w.P.formatURL(c, it), true, 'applies');
	eq(c.URL, 'https://example.org/a, archived at https://perma.cc/V2NP-PVC8', 'with the attachment\'s archive');
});

test('inside lawcite: no pane of its own', function () {
	var w = world();
	w.Zotero.Lawcite = { version: 'test' };
	return w.P.init({ id: 'lawcite@zotero.local', version: '9', rootURI: 'jar:x!/permacc/', fetch: w.P.fetch, sleep: w.P.sleep }).then(function () {
		eq(w.notifiers.filter(function (n) { return n.pane; }).length, 0, 'the lawcite pane carries this section; permacc registers none');
		eq(w.notifiers.filter(function (n) { return n.o; }).length, 1, 'but still observes items');
	});
});

chain.then(function () {
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'permacc OK (extra, urls, keys, api, folders, run, failures, formats, lifecycle, stands down inside lawcite, pane script)');
});
