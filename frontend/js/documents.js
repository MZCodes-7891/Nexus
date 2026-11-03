// Documents: local library with preview, search inside files, and asking questions across a selection.
let documentList = [];
const selectedDocuments = new Set();

function renderDocumentRow(doc) {
    const check = h('input', { type: 'checkbox', checked: selectedDocuments.has(doc.id), 'aria-label': `Select ${doc.name}`, onchange: event => { if (event.target.checked) selectedDocuments.add(doc.id); else selectedDocuments.delete(doc.id); renderDocuments(); } });
    const meta = [doc.extension.slice(1).toUpperCase(), doc.pages ? `${doc.pages} page${doc.pages === 1 ? '' : 's'}` : '', formatSize(doc.size), doc.folder, `changed ${new Date(doc.modified).toLocaleDateString()}`, doc.truncated ? 'partly indexed' : ''].filter(Boolean).join(' · ');
    return h('div', { class: `doc-row${selectedDocuments.has(doc.id) ? ' selected' : ''}`, dataset: { id: doc.id } }, check,
        h('div', { class: 'grow' }, h('button', { type: 'button', class: 'link-like doc-title', text: doc.name, title: doc.path, style: 'display:block;max-width:100%', onclick: () => previewDocument(doc.id) }), h('div', { class: 'doc-meta', text: meta })),
        h('button', { type: 'button', class: 'mini-button', text: doc.favorite ? '★' : '☆', title: 'Favorite', 'aria-label': doc.favorite ? 'Remove favorite' : 'Add favorite', onclick: async () => { await call('documents:patch', doc.id, { favorite: !doc.favorite }); refreshDocuments(); } }),
        h('button', { type: 'button', class: 'mini-button', text: 'Open', onclick: async () => { try { await call('documents:open', doc.id); } catch (error) { toast(error.message, 'error'); } } }),
        h('button', { type: 'button', class: 'mini-button danger', text: 'Remove', title: 'Remove from the library. The file itself is not touched.', onclick: async () => { if (!await confirmModal('Remove from library', `Remove ${doc.name} from the Nexus library? The file on your computer is not deleted.`, 'Remove')) return; await call('documents:remove', doc.id); selectedDocuments.delete(doc.id); refreshDocuments(); } }));
}
function renderDocuments() {
    const filter = document.getElementById('docs-filter').value;
    let shown = documentList.slice();
    if (filter === 'favorites') shown = shown.filter(doc => doc.favorite);
    if (filter === 'recent') shown = shown.filter(doc => doc.lastOpenedAt).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    document.getElementById('docs-list').replaceChildren(...(shown.length ? shown.map(renderDocumentRow) : [emptyState(documentList.length ? 'Nothing in this filter.' : 'No documents yet. Add PDF, Word, PowerPoint, Excel, text, or Markdown files.')]));
    const bar = document.getElementById('docs-selection-bar');
    bar.classList.toggle('hidden', !selectedDocuments.size);
    if (selectedDocuments.size) {
        const chosen = documentList.filter(doc => selectedDocuments.has(doc.id));
        bar.replaceChildren(h('span', { text: `${chosen.length} selected` }), h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'mini-button', text: 'Ask about these', onclick: () => { setChatDocuments(chosen.map(doc => doc.id), chosen.map(doc => doc.name)); go('chat'); document.getElementById('chat-input').focus(); } }),
            h('button', { type: 'button', class: 'mini-button', text: 'Summarize', onclick: () => { setChatDocuments(chosen.map(doc => doc.id), chosen.map(doc => doc.name)); askNexus('Summarize the main points of these documents, citing each file.'); } }),
            h('button', { type: 'button', class: 'mini-button', text: 'Study these', onclick: () => { go('school'); openStudyTab('sets', { documentIds: chosen.map(doc => doc.id) }); } }),
            h('button', { type: 'button', class: 'mini-button', text: 'Clear', onclick: () => { selectedDocuments.clear(); renderDocuments(); } }));
    }
}
async function refreshDocuments() {
    const list = await ipcRenderer.invoke('documents:list');
    if (Array.isArray(list)) { documentList = list; renderDocuments(); }
}
async function previewDocument(id) {
    const pane = document.getElementById('docs-preview');
    if (!documentList.length) await refreshDocuments();
    const doc = documentList.find(item => item.id === id);
    pane.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    const result = await ipcRenderer.invoke('documents:preview', id);
    if (result?.ok === false) { pane.replaceChildren(h('p', { class: 'error-text', text: result.message })); return; }
    const notes = [doc?.ocrPages?.length ? `Text on ${doc.ocrPages.length} scanned page(s) was recognized by Windows and may contain mistakes.` : '', doc?.blankPages?.length ? `Pages with no extractable text, possibly scans or images: ${doc.blankPages.join(', ')}.` : '', result.truncated ? `Showing the first ${result.text.length.toLocaleString()} of ${result.total.toLocaleString()} characters.` : ''].filter(Boolean).join(' ');
    pane.replaceChildren(h('h3', { text: doc?.name || 'Document' }), h('p', { class: 'muted small', text: doc?.path || '' }), notes ? h('p', { class: 'muted small', text: notes }) : null, h('pre', { text: result.text }));
    refreshDocumentsQuietly();
}
const refreshDocumentsQuietly = debounce(refreshDocuments, 500);
async function searchDocuments(term) {
    const pane = document.getElementById('docs-preview');
    if (!term) { pane.replaceChildren(h('p', { class: 'muted', text: 'Select a document to preview it, or search to see matching passages.' })); return; }
    const hits = await ipcRenderer.invoke('documents:search', term);
    if (hits?.ok === false) { pane.replaceChildren(h('p', { class: 'error-text', text: hits.message })); return; }
    pane.replaceChildren(h('h3', { text: `Passages matching “${term}”` }), ...(hits.length ? hits.map(hit => h('div', { class: 'passage' }, h('strong', { text: `${hit.name}${hit.location ? `, ${hit.location}` : ''}` }), h('div', { text: hit.text.slice(0, 500) }))) : [h('p', { class: 'muted', text: 'Nothing matched in your library.' })]));
}
async function renderFileBrowser(folder) {
    const box = document.getElementById('docs-browser');
    const result = await ipcRenderer.invoke('documents:browse', folder);
    if (result?.ok === false) { box.replaceChildren(h('p', { class: 'error-text small', text: result.message })); return; }
    const supported = /\.(pdf|docx?|pptx|xlsx|txt|md|csv|json|html?)$/i;
    box.replaceChildren(
        h('div', { class: 'chip-row', style: 'margin:8px 0' }, result.roots.map(root => h('button', { type: 'button', class: 'chip', text: root.split(/[\\/]/).pop(), title: root, onclick: () => renderFileBrowser(root) }))),
        h('p', { class: 'muted small', text: result.folder }),
        h('div', { class: 'doc-list', style: 'max-height:280px;overflow:auto' }, result.items.length ? result.items.map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, item.isFolder ? h('button', { type: 'button', class: 'link-like', text: `📁 ${item.name}`, onclick: () => renderFileBrowser(item.path) }) : h('div', { class: 'doc-title', text: item.name })), !item.isFolder && supported.test(item.name) ? h('button', { type: 'button', class: 'mini-button', text: 'Add', onclick: async () => { try { await call('documents:add-path', item.path); toast(`Added ${item.name}.`, 'ok'); refreshDocuments(); } catch (error) { toast(error.message, 'error'); } } }) : null)) : h('p', { class: 'muted small', text: 'This folder is empty.' }))
    );
}
function reportAddResult(result) {
    if (result.canceled) return;
    const errors = (result.errors || []).map(item => `${item.name}: ${item.message}`).join(' ');
    setLine('docs-selection-status', `${result.added?.length || 0} document(s) added.${errors ? ` Skipped: ${errors}` : ''}`, errors ? 'error' : 'ok');
    setLine('docs-progress', '');
    refreshDocuments();
}
function bindDocuments() {
    const run = async channel => { setLine('docs-progress', 'Reading files on this computer…'); reportAddResult(await ipcRenderer.invoke(channel)); };
    document.getElementById('docs-add').addEventListener('click', () => run('documents:add'));
    document.getElementById('docs-add-folder').addEventListener('click', () => run('documents:add-folder'));
    document.getElementById('docs-filter').addEventListener('change', renderDocuments);
    document.getElementById('docs-search').addEventListener('input', debounce(event => searchDocuments(event.target.value.trim()), 250));
    ipcRenderer.on('documents:progress', (_event, data) => setLine('docs-progress', `Reading ${data.index} of ${data.total}: ${data.name}`));
    document.querySelector('.browser-details summary').addEventListener('click', () => renderFileBrowser());
    PAGE_HOOKS.docs = refreshDocuments;
}
