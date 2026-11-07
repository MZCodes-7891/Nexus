// Sections: extra pages kept in sections/<id>/, each with its own page script and style. They join the sidebar like any page.
const SECTION_PAGES = {};
// A section's page.js calls this with { show(container) }.
window.NexusSections = { register(id, page) { SECTION_PAGES[id] = page; } };
const DEFAULT_SECTION_ICON = ['M5 4h14v16H5z', 'M9 8h6', 'M9 12h6', 'M9 16h4'];

function loadScript(src) {
    return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => reject(new Error(`Could not load ${src}`)); document.head.append(script); });
}

async function loadSections() {
    let list;
    try { list = await ipcRenderer.invoke('sections:list'); } catch { return; }
    for (const section of list?.sections || []) {
        if (NAV_ITEMS.some(([view]) => view === section.id)) continue;
        // Sections sit just above Settings in the sidebar.
        NAV_ITEMS.splice(NAV_ITEMS.findIndex(([view]) => view === 'settings'), 0, [section.id, section.title]);
        ICONS[section.id] = section.icon.length ? section.icon : DEFAULT_SECTION_ICON;
        const view = h('div', { id: `view-${section.id}`, class: 'view hidden' }, h('div', { class: 'page section-page', dataset: { section: section.id } }));
        document.getElementById('view-port').append(view);
        if (section.style) document.head.append(h('link', { rel: 'stylesheet', href: `sections/${section.id}/style.css` }));
        if (!section.page) continue;
        try { await loadScript(`sections/${section.id}/page.js`); }
        catch (error) { view.firstChild.append(h('p', { class: 'error-text', text: error.message })); continue; }
        PAGE_HOOKS[section.id] = () => { const page = SECTION_PAGES[section.id]; if (page) Promise.resolve(page.show(view.firstChild)).catch(error => toast(error.message, 'error')); };
    }
    drawNavigation.last = '';
    drawNavigation(appSettings?.appearance);
    // Asked alongside startup, so an unanswered question never holds NEXUS up; an unanswered section stays private and is asked about next time.
    decideNewSections(list).catch(error => toast(error.message, 'error'));
}

// A section seen for the first time is private until its owner chooses. Only the owner's own copy can choose.
async function decideNewSections(list) {
    if (!list?.editable || !appSettings?.sections) return;
    const known = new Set(appSettings.sections.decided);
    // Sections that were already there when this choice was added keep what they have.
    if (!appSettings.sections.seeded) { await updateSettings({ sections: { seeded: true, decided: list.sections.map(item => item.id) } }); return; }
    for (const section of list.sections.filter(item => !known.has(item.id))) {
        let makePublic = appSettings.sections.newAs === 'public';
        if (appSettings.sections.newAs === 'ask') makePublic = await new Promise(resolve => modal(`New section: ${section.title}`, h('div', {}, h('p', { text: section.description || 'A new page was added to NEXUS.' }), h('p', { class: 'muted small', text: 'Private keeps it only on this PC: it never goes to GitHub or into the version your friends download. Public sends it out with the next update. You can change this later in Settings → Sections.' })), [{ label: 'Keep it private', run: () => resolve(false) }, { label: 'Make it public', primary: true, run: () => resolve(true) }]));
        if (makePublic !== section.public) await call('sections:set-public', section.id, makePublic);
        section.public = makePublic;
        await updateSettings({ sections: { decided: [...new Set([...appSettings.sections.decided, section.id])] } });
        if (appSettings.sections.newAs !== 'ask') toast(`New section "${section.title}" is ${makePublic ? 'public' : 'private'}, as set in Settings → Sections.`, 'ok');
    }
}
