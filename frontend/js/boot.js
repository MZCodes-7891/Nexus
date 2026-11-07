// Startup order matters: settings before anything draws, conversations before the chat page.
document.addEventListener('DOMContentLoaded', async () => {
    bindShell();
    bindIntegrationControls();
    bindHome();
    bindApps();
    bindDocuments();
    bindStudy();
    bindResearch();
    bindCalendar();
    bindAutomations();
    bindHub();
    bindMemory();
    bindSettings();
    const loaded = await ipcRenderer.invoke('settings:get');
    appSettings = loaded.settings;
    applyAppearance(appSettings);
    await loadSections();
    try { await loadConversations(); } catch (error) { toast(`Could not load conversations: ${error.message}`, 'error'); }
    initializeProjects();
    try {
        let legacyTasks = [];
        try { legacyTasks = JSON.parse(localStorage.getItem('nexus.tasks') || '[]'); } catch {}
        localTasks = await ipcRenderer.invoke('tasks:initialize', legacyTasks);
        renderTasks();
    } catch (error) { toast(`Could not load your tasks: ${error.message}`, 'error'); }
    try { savedMemories = await ipcRenderer.invoke('memory:list'); } catch { savedMemories = []; }
    let startPage = appSettings.general.startPage;
    if (startPage === 'last') { try { startPage = localStorage.getItem('nexus.lastView') || 'home'; } catch { startPage = 'home'; } }
    go(NAV_ITEMS.some(([view]) => view === startPage) ? startPage : 'home');
    refreshNotifications();
    await refreshTopbarStatus().catch(() => {});
    setInterval(() => refreshTopbarStatus().catch(() => {}), 30000);
    await refreshComposioStatus().catch(() => {});
    renderIntegrations();
    await showSetup().catch(error => toast(error.message, 'error'));
    if (appSettings.voice.wakeWordEnabled) setWakeWordListening(true);
    if (!document.getElementById('view-home').classList.contains('hidden')) renderHome();
});
