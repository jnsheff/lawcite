// Run in Zotero: Tools > Developer > Run JavaScript (async). Replaces all authors of singhOpenAIGPT5System2026
// (the GPT-5 System Card) with the single author "OpenAI". Set DRY = false to apply.
const DRY = true;
const lib = Zotero.Libraries.getAll().find(l => l.name === "GenAI Research").libraryID;
const s = new Zotero.Search({ libraryID: lib });
s.addCondition("citationKey", "is", "singhOpenAIGPT5System2026");
const items = (await Zotero.Items.getAsync(await s.search())).filter(i => !i.deleted);
if (items.length !== 1) return `expected 1 item, found ${items.length}`;
const item = items[0];
const authors = item.getCreators().filter(c => Zotero.CreatorTypes.getName(c.creatorTypeID) === "author");
const others = item.getCreators().filter(c => Zotero.CreatorTypes.getName(c.creatorTypeID) !== "author");
const msg = `"${item.getField("title")}": ${authors.length} authors${others.length ? ` (keeping ${others.length} non-author creators)` : ""} -> OpenAI`;
if (DRY) return "would change " + msg;
// the Citation Key field is left alone, so the key (and the book's citations) stay the same
item.setCreators([{ creatorType: "author", lastName: "OpenAI", fieldMode: 1 }, ...others]);
await item.saveTx();
return "changed " + msg;
