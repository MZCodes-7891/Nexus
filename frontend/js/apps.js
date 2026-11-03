// My Apps: a launcher whose every tile comes from the saved list, so adding or removing one updates the grid immediately.
let appList = [];

async function launchApp(id) {
    const result = await ipcRenderer.invoke('apps:launch', id);
    if (result?.ok) toast(result.message, 'ok'); else toast(result?.message || 'That app could not be opened.', 'error');
    refreshApps();
}
function appIcon(app) {
    const box = h('div', { class: 'app-icon' });
    if (app.iconPath) {
        const image = h('img', { alt: '', src: `file:///${app.iconPath.replace(/\\/g, '/')}` });
        image.addEventListener('error', () => { image.remove(); box.textContent = app.icon || '🖥️'; });
        box.append(image);
    } else box.textContent = app.icon || '🖥️';
    return box;
}
function appTile(app, { compact = false, draggable = false } = {}) {
    const tile = h('div', { class: `app-tile${compact ? ' compact' : ''}`, role: 'button', tabindex: 0, title: app.target || app.name, 'aria-label': `Open ${app.name}`, draggable, dataset: { id: app.id }, onclick: () => launchApp(app.id), onkeydown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); launchApp(app.id); } } },
        app.favorite ? h('span', { class: 'app-star', text: '★', 'aria-label': 'Favorite' }) : null,
        appIcon(app), h('div', { class: 'app-name', text: app.name }),
        compact ? null : h('button', { type: 'button', class: 'app-menu', text: '⋯', 'aria-label': `Edit ${app.name}`, title: 'Edit', onclick: event => { event.stopPropagation(); editAppDialog(app); } }));
    if (draggable) {
        tile.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', app.id); tile.classList.add('dragging'); });
        tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
        tile.addEventListener('dragover', event => { event.preventDefault(); tile.classList.add('drop-target'); });
        tile.addEventListener('dragleave', () => tile.classList.remove('drop-target'));
        tile.addEventListener('drop', async event => {
            event.preventDefault(); tile.classList.remove('drop-target');
            const moved = event.dataTransfer.getData('text/plain');
            if (!moved || moved === app.id) return;
            const ids = appList.map(item => item.id).filter(id => id !== moved);
            ids.splice(ids.indexOf(app.id), 0, moved);
            appList = await call('apps:reorder', ids);
            renderApps();
        });
    }
    return tile;
}
function renderApps() {
    const term = document.getElementById('apps-search').value.trim().toLowerCase();
    const categorySelect = document.getElementById('apps-category');
    const chosen = categorySelect.value || 'all';
    const categories = [...new Set(appList.map(app => app.category || 'Other'))].sort();
    categorySelect.replaceChildren(h('option', { value: 'all', text: 'All categories' }), ...categories.map(category => h('option', { value: category, text: category })));
    categorySelect.value = categories.includes(chosen) ? chosen : 'all';
    const filtering = term || categorySelect.value !== 'all';
    const shown = appList.filter(app => (!term || app.name.toLowerCase().includes(term)) && (categorySelect.value === 'all' || app.category === categorySelect.value));
    const grid = document.getElementById('apps-grid');
    // Rearranging only makes sense on the unfiltered list.
    grid.replaceChildren(...(shown.length ? shown.map(app => appTile(app, { draggable: !filtering })) : [emptyState('No apps match. Use Add application to create one.')]));
    const recent = appList.filter(app => app.lastOpenedAt).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, 6);
    const favorites = appList.filter(app => app.favorite);
    document.getElementById('apps-recent-section').classList.toggle('hidden', filtering || !recent.length);
    document.getElementById('apps-favorites-section').classList.toggle('hidden', filtering || !favorites.length);
    document.getElementById('apps-recent').replaceChildren(...recent.map(app => appTile(app, { compact: true })));
    document.getElementById('apps-favorites').replaceChildren(...favorites.map(app => appTile(app, { compact: true })));
}
async function refreshApps() {
    const list = await ipcRenderer.invoke('apps:list');
    if (Array.isArray(list)) { appList = list; renderApps(); }
}
function appForm(app = {}) {
    let iconFile = '';
    let clearIcon = false;
    const type = h('select', { 'aria-label': 'Type' }, h('option', { value: 'url', text: 'Website', selected: app.type !== 'exe' }), h('option', { value: 'exe', text: 'Program on this computer', selected: app.type === 'exe' }));
    const name = h('input', { type: 'text', value: app.name || '', maxlength: 60, placeholder: 'Name' });
    const target = h('input', { type: 'text', value: app.target || '', placeholder: 'https://example.com' });
    const browse = h('button', { type: 'button', class: 'integration-button secondary', text: 'Browse…', onclick: async () => { const result = await call('apps:pick-exe'); if (!result.canceled) { target.value = result.path; if (!name.value) name.value = result.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''); } } });
    const syncType = () => { browse.classList.toggle('hidden', type.value !== 'exe'); target.placeholder = type.value === 'exe' ? 'C:\\Program Files\\App\\app.exe' : 'https://example.com'; };
    type.addEventListener('change', syncType); syncType();
    const emoji = h('input', { type: 'text', value: app.icon || '', maxlength: 8, placeholder: 'An emoji such as 📘' });
    const iconStatus = h('span', { class: 'muted small', text: app.iconPath ? 'Using a custom image.' : '' });
    const pickIcon = h('button', { type: 'button', class: 'integration-button secondary', text: 'Choose image…', onclick: async () => { const result = await call('apps:pick-icon'); if (!result.canceled) { iconFile = result.path; clearIcon = false; iconStatus.textContent = result.path.split(/[\\/]/).pop(); } } });
    const removeIcon = app.iconPath ? h('button', { type: 'button', class: 'mini-button', text: 'Remove image', onclick: () => { clearIcon = true; iconFile = ''; iconStatus.textContent = 'Image will be removed.'; } }) : null;
    const category = h('input', { type: 'text', value: app.category || 'Other', maxlength: 30, list: 'app-category-options' });
    const options = h('datalist', { id: 'app-category-options' }, [...new Set(['School', 'Browsers', 'Media', 'Productivity', 'Games', 'Other', ...appList.map(item => item.category)])].map(value => h('option', { value })));
    const favorite = h('input', { type: 'checkbox', checked: app.favorite, style: 'width:auto' });
    const body = h('div', {}, h('label', { text: 'Name' }), name, h('label', { text: 'Opens' }), type, h('label', { text: 'Address or file' }), h('div', { class: 'row' }, target, browse), h('label', { text: 'Icon' }), emoji, h('div', { class: 'row wrap', style: 'margin-top:6px' }, pickIcon, removeIcon, iconStatus), h('label', { text: 'Category' }), category, options, h('label', { class: 'row', style: 'margin-top:12px' }, favorite, h('span', { text: 'Favorite' })));
    return { body, values: () => ({ name: name.value, type: type.value, target: target.value, icon: emoji.value, category: category.value, favorite: favorite.checked, iconFile: iconFile || undefined, clearIcon }) };
}
function addAppDialog(prefill) {
    const form = appForm(prefill);
    modal('Add application', form.body, [{ label: 'Cancel' }, { label: 'Add', primary: true, run: async () => { await call('apps:add', form.values()); toast('Added.', 'ok'); await refreshApps(); } }]);
}
function editAppDialog(app) {
    const form = appForm(app);
    modal(`Edit ${app.name}`, form.body, [
        { label: 'Remove', danger: true, run: async () => { if (!await confirmModal('Remove app', `Remove ${app.name} from My Apps? The program itself is not touched.`, 'Remove')) return false; await call('apps:remove', app.id); await refreshApps(); } },
        { label: 'Cancel' },
        { label: 'Save', primary: true, run: async () => {
            const values = form.values();
            // A seeded tile that resolves its target at launch keeps doing so until the user fills in a target.
            if (!values.target.trim() && app.detect) { await call('apps:update', app.id, { icon: values.icon, category: values.category, favorite: values.favorite, iconFile: values.iconFile, clearIcon: values.clearIcon }); }
            else await call('apps:update', app.id, values);
            await refreshApps();
        } }
    ]);
}
async function detectAppsDialog() {
    const search = h('input', { type: 'search', placeholder: 'Filter…', 'aria-label': 'Filter installed apps' });
    const list = h('div', { class: 'doc-list', style: 'max-height:50vh;overflow:auto;margin-top:8px' }, h('p', { class: 'muted', text: 'Reading the Start menu…' }));
    modal('Installed applications', h('div', {}, search, list));
    const installed = await call('apps:detect', true);
    const draw = () => {
        const term = search.value.toLowerCase();
        const existing = new Set(appList.map(app => app.name.toLowerCase()));
        const rows = installed.filter(item => item.name.toLowerCase().includes(term)).slice(0, 150).map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: item.name }), h('div', { class: 'doc-meta', text: item.category })), existing.has(item.name.toLowerCase()) ? h('span', { class: 'muted small', text: 'Added' }) : h('button', { type: 'button', class: 'mini-button', text: 'Add', onclick: async () => { try { await call('apps:add', { name: item.name, type: 'exe', target: item.target, category: item.category }); await refreshApps(); draw(); } catch (error) { toast(error.message, 'error'); } } })));
        list.replaceChildren(...(rows.length ? rows : [emptyState('No matches.')]));
    };
    search.addEventListener('input', draw);
    draw();
}
function bindApps() {
    document.getElementById('apps-add').addEventListener('click', () => addAppDialog());
    document.getElementById('apps-detect').addEventListener('click', () => detectAppsDialog().catch(error => toast(error.message, 'error')));
    document.getElementById('apps-search').addEventListener('input', renderApps);
    document.getElementById('apps-category').addEventListener('change', renderApps);
    PAGE_HOOKS.apps = refreshApps;
    PAGE_HOOKS.appsChanged = refreshApps;
}
