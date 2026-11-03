// Memory page: inspect, search, edit, and delete everything Nexus has been asked to remember.
async function renderMemories() {
    const term = document.getElementById('memory-search').value.trim();
    const items = await ipcRenderer.invoke(term ? 'memory:search' : 'memory:list', term);
    if (!Array.isArray(items)) return;
    savedMemories = await ipcRenderer.invoke('memory:list');
    setLine('memory-status', appSettings?.privacy.memoryEnabled === false ? 'Memory is turned off in Settings → Privacy, so saved facts are not used in replies.' : `${savedMemories.length} saved.`);
    document.getElementById('memory-list').replaceChildren(...(items.length ? items.map(item => h('div', { class: 'doc-row' },
        h('div', { class: 'grow' }, h('div', { text: item.text, style: 'overflow-wrap:anywhere' }), h('div', { class: 'doc-meta', text: `${item.category || 'General'} · ${formatWhen(item.updatedAt || item.createdAt)}` })),
        h('button', { type: 'button', class: 'mini-button', text: 'Edit', onclick: () => {
            const text = h('textarea', { rows: 4, maxlength: 800 }); text.value = item.text;
            const category = h('select', {}, ['General', 'Preference', 'Project', 'Study'].map(value => h('option', { value, text: value, selected: (item.category || 'General') === value })));
            modal('Edit memory', h('div', {}, h('label', { text: 'Memory' }), text, h('label', { text: 'Category' }), category), [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async () => { await call('memory:edit', item.id, { text: text.value, category: category.value }); renderMemories(); } }]);
        } }),
        h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { await call('memory:remove', item.id); renderMemories(); } })
    )) : [emptyState(term ? 'No memories match.' : 'Nothing saved yet. Say "Remember that…" in chat, or add one above.')]));
}
function bindMemory() {
    document.getElementById('memory-add-form').addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('memory-input');
        const result = await ipcRenderer.invoke('memory:remember', input.value, document.getElementById('memory-category').value);
        if (result.ok) { input.value = ''; setLine('memory-status', result.added ? 'Saved.' : 'That was already saved.', 'ok'); }
        else setLine('memory-status', result.message, 'error');
        renderMemories();
    });
    document.getElementById('memory-search').addEventListener('input', debounce(renderMemories, 200));
    PAGE_HOOKS.memory = renderMemories;
    PAGE_HOOKS.memoryChanged = () => { if (!document.getElementById('view-memory').classList.contains('hidden')) renderMemories(); };
}
