// Removes Perma.cc links from items whose URL is on certain domains.
// Run in Zotero: Tools > Developer > Run JavaScript (tick "Run as async function").
//
// What it touches, for every regular item whose own URL is on one of the domains:
//   - Extra: lines such as "perma-cc: https://perma.cc/ABCD-1234" (all lawcite spellings) are removed;
//   - child link attachments whose URL is a perma.cc archive are moved to the trash (recoverable).
// It never changes the item's URL field, and it does not delete anything at Perma.cc (the archives
// stay in your Perma.cc account; delete them there if you want the allowance back).
//
// Start with DRY_RUN = true: it only reports what it would change. Then set it to false.

const DOMAINS = ['arxiv.org', 'ssrn.com', 'jstor.org'];
const DRY_RUN = true;

const EXTRA_LINE = /^\s*perma[\s._-]*cc\s*:\s*(?:https?:\/\/)?(?:www\.)?perma\.cc\/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}(?![A-Za-z0-9-]).*$/i;
const PERMA_URL = /^\s*(?:https?:\/\/)?(?:www\.)?perma\.cc\/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}(?![A-Za-z0-9-])/i;

function onDomain(url) {
	try {
		let host = new URL(String(url).trim()).hostname.toLowerCase().replace(/^www\./, '');
		return DOMAINS.some(d => host === d || host.endsWith('.' + d));
	}
	catch (e) { return false; }
}

let out = [], extraChanged = 0, attachTrashed = 0, skippedReadOnly = 0;

for (let lib of Zotero.Libraries.getAll()) {
	if (!lib.editable) { skippedReadOnly++; continue; }
	let items = await Zotero.Items.getAll(lib.libraryID, true); // all items, including child items
	for (let item of items) {
		if (!item.isRegularItem() || item.deleted) continue;
		if (!onDomain(item.getField('url'))) continue;
		let label = `[${lib.name}] ${item.getField('title') || item.key}`;

		// 1. Extra lines
		let extra = item.getField('extra') || '';
		let lines = extra.split('\n');
		let kept = lines.filter(l => !EXTRA_LINE.test(l));
		if (kept.length !== lines.length) {
			out.push(`Extra: ${label}  (${lines.length - kept.length} line${lines.length - kept.length > 1 ? 's' : ''})`);
			extraChanged++;
			if (!DRY_RUN) {
				item.setField('extra', kept.join('\n').replace(/\s+$/, ''));
				await item.saveTx({ skipDateModifiedUpdate: true });
			}
		}

		// 2. Perma.cc link attachments
		for (let id of item.getAttachments()) {
			let att = Zotero.Items.get(id);
			if (!att || att.deleted) continue;
			if (att.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_URL) continue;
			if (!PERMA_URL.test(att.getField('url') || '')) continue;
			out.push(`Attachment: ${label}  ->  ${att.getField('url')}`);
			attachTrashed++;
			if (!DRY_RUN) {
				att.deleted = true;
				await att.saveTx();
			}
		}
	}
}

return (DRY_RUN ? 'DRY RUN - nothing changed.\n' : 'Done.\n')
	+ `${extraChanged} item(s) with Extra lines${DRY_RUN ? ' to remove' : ' cleaned'}, `
	+ `${attachTrashed} Perma.cc link attachment(s)${DRY_RUN ? ' to trash' : ' trashed'}`
	+ (skippedReadOnly ? `; ${skippedReadOnly} read-only librar${skippedReadOnly > 1 ? 'ies' : 'y'} skipped` : '') + '.\n\n'
	+ out.join('\n');
