const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gotoWithRetry, bringForward } = require('../browser/browser');

// D2L page titles read "Topic - Course name - School".
function courseNameFrom(title) {
  const parts = String(title || '').split(' - ').map(part => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1].slice(0, 80) : '';
}

// D2L / Brightspace access through a visible browser the user signs in to. Nexus never collects the password.
function createD2L({ dataDir, ipcMain, getBrowserExecutables, extractPdfText, extractOffice }) {
  // D2L addresses are always https, apart from the local stand-in server the automated tests use.
  const isSecure = url => url.protocol === 'https:' || Boolean(process.env.NEXUS_TEST && url.hostname === '127.0.0.1');
  let d2lBrowserContext;
  let d2lBrowserPage;
  function d2lSettingsPath() { return path.join(dataDir, 'd2l-settings.json'); }
  function d2lLibraryPath() { return path.join(dataDir, 'd2l-study-library.json'); }
async function readD2LLibrary() {
  try {
    const value = JSON.parse(await fs.promises.readFile(d2lLibraryPath(), 'utf8'));
    return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string') : [];
  } catch { return []; }
}
async function saveD2LLibrary(items) {
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.writeFile(d2lLibraryPath(), JSON.stringify(items.slice(-160), null, 2), { mode: 0o600 });
}
function detectD2LObjectives(title, text) {
  const found = new Set();
  const pattern = /^\s*(?:(?:objective|outcome|reading|section)\s*)?(\d{1,2})\s*([A-C])(?:\s*[:.)\-]|\s|$)/i;
  for (const line of `${title || ''}\n${String(text || '')}`.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) found.add(`${Number(match[1])}${match[2].toUpperCase()}`);
  }
  return Array.from(found).sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]) || a.localeCompare(b));
}
function extractD2LObjectiveText(source, requestedCodes) {
  const lines = String(source || '').split(/\r?\n/);
  const headings = [];
  const pattern = /^\s*(?:(?:objective|outcome|reading|section)\s*)?(\d{1,2})\s*([A-C])(?:\s*[:.)\-]|\s|$)/i;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(pattern);
    if (match) headings.push({ code: `${Number(match[1])}${match[2].toUpperCase()}`, index });
  }
  if (!headings.length) return '';
  const excerpts = [];
  for (const code of requestedCodes) {
    const matches = headings.filter(item => item.code === code);
    for (const heading of matches) {
      const end = headings.find(item => item.index > heading.index)?.index ?? lines.length;
      excerpts.push(`OBJECTIVE ${code}\n${lines.slice(heading.index, end).join('\n').trim()}`);
    }
  }
  return excerpts.join('\n\n');
}
async function readD2LSettings() {
  try { const value = JSON.parse(await fs.promises.readFile(d2lSettingsPath(), 'utf8')); return { url: String(value.url || '') }; }
  catch { return { url: '' }; }
}
function checkedD2LUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter your school’s full Brightspace address, such as https://school.brightspace.com.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('For your safety, D2L addresses must start with https:// and cannot include a username or password.');
  url.hash = ''; url.search = '';
  return url.href.replace(/\/$/, '');
}
  async function getD2LBrowser() {
    if (d2lBrowserContext && d2lBrowserPage && !d2lBrowserPage.isClosed()) return d2lBrowserPage;
    const { chromium } = require('playwright-core');
    const browsers = getBrowserExecutables();
    if (!browsers.length) throw new Error('No supported browser was found. Install Chrome, Edge, Opera GX, or Brave.');
    let lastError;
    for (const exe of browsers) {
      try {
        // An existing D2L sign-in in Opera GX keeps working; other browsers get their own profile folder.
        d2lBrowserContext = await chromium.launchPersistentContext(path.join(dataDir, `NexusD2LProfile${/opera/i.test(exe) ? '' : `-${path.basename(exe, '.exe')}`}`), {
          executablePath: exe, headless: Boolean(process.env.NEXUS_TEST), timeout: 40000, acceptDownloads: true, viewport: { width: 1365, height: 900 },
          args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync']
        });
        break;
      } catch (error) { lastError = error; }
    }
    if (!d2lBrowserContext) throw new Error(`The D2L window could not be started: ${String(lastError?.message || '').split('\n')[0].slice(0, 200)}`);
    d2lBrowserContext.on('page', page => { d2lBrowserPage = page; });
    d2lBrowserPage = d2lBrowserContext.pages()[0] || await d2lBrowserContext.newPage();
    d2lBrowserContext.on('close', () => { d2lBrowserContext = null; d2lBrowserPage = null; });
    return d2lBrowserPage;
  }
ipcMain.handle('school:status', async () => {
  const settings = await readD2LSettings();
  const currentUrl = d2lBrowserPage && !d2lBrowserPage.isClosed() ? d2lBrowserPage.url() : '';
  let signedIn = false;
  try { signedIn = Boolean(settings.url && currentUrl && new URL(currentUrl).hostname === new URL(settings.url).hostname); } catch {}
  return { ok: true, configured: Boolean(settings.url), url: settings.url, signedIn, currentUrl,
    message: !settings.url ? 'Enter your school’s Brightspace link to set up D2L.' : signedIn ? 'D2L is open. Sign in if needed, then open a course’s Content page.' : 'Your D2L link is saved. Open the sign-in window to continue.' };
});
ipcMain.handle('school:save-url', async (_event, input) => {
  try {
    const url = checkedD2LUrl(input);
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(d2lSettingsPath(), JSON.stringify({ url }, null, 2), { mode: 0o600 });
    return { ok: true, url, message: 'Brightspace address saved on this computer.' };
  } catch (error) { return { ok: false, message: error.message }; }
});
const ipcHandlers = {};
  ipcHandlers.open = async () => {
  try {
    const { url } = await readD2LSettings();
    if (!url) throw new Error('Enter and save your school’s Brightspace link first.');
    let page = await getD2LBrowser();
    if (!page.url().startsWith(url)) { page = await gotoWithRetry(page, url, { waitUntil: 'domcontentloaded', timeout: 60000 }); d2lBrowserPage = page; }
    await bringForward(page);
    return { ok: true, url: page.url(), message: 'D2L opened in a separate sign-in window. Sign in there, then open the course Content page.' };
  } catch (error) { return { ok: false, message: String(error.message || error).slice(0, 500) }; }
  };
  ipcMain.handle('school:open', () => ipcHandlers.open());
ipcHandlers.read = async (options = {}) => {
  const MAX_TOTAL = 180000;
  try {
    const allowedSubjects = ['English', 'Science', 'Social Studies', 'Math'];
    const subject = allowedSubjects.includes(options?.subject) ? options.subject : 'Science';
    const { url: schoolUrl } = await readD2LSettings();
    if (!schoolUrl) throw new Error('Enter and save your school’s Brightspace link first.');
    if (!d2lBrowserPage || d2lBrowserPage.isClosed()) throw new Error('Open D2L and sign in first, then return to Nexus.');
    const base = new URL(schoolUrl);
    const page = d2lBrowserPage;
    const current = new URL(page.url());
    if (current.hostname !== base.hostname) throw new Error('D2L is currently showing a sign-in page. Finish signing in and open a course before reading it.');
    if (/\/(?:login|signin)(?:\/|$)/i.test(current.pathname) || await page.locator('input[type="password"]').count().catch(() => 0)) throw new Error('D2L still shows a sign-in form. Finish signing in, open a course’s Content page, then retry.');
    const startingUrl = page.url();
    const collectLinks = async () => page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => ({ href: anchor.href, label: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().slice(0, 200) })).filter(item => item.href));
    const seenFiles = new Set();
    let total = 0;
    let skipped = 0;
    const sections = [];
    const libraryItems = [];
    let scanCourse = '';
    const addStudyItem = (title, itemUrl, kind, value) => {
      const sourceText = String(value || '').trim();
      if (!sourceText || total >= MAX_TOTAL) { skipped++; return; }
      const block = `${kind.toUpperCase()}: ${title}\nSOURCE: ${itemUrl}\n${sourceText}`;
      const available = MAX_TOTAL - total;
      const storedBlock = block.slice(0, available);
      sections.push(storedBlock); total += storedBlock.length;
      libraryItems.push({
        id: crypto.createHash('sha256').update(String(itemUrl)).digest('hex').slice(0, 24),
        title: String(title || 'Untitled D2L item').slice(0, 240), kind, url: String(itemUrl), provider: 'd2l', subject, course: courseNameFrom(title) || scanCourse,
        text: sourceText.slice(0, 30000), objectives: detectD2LObjectives(title, sourceText),
        updatedAt: new Date().toISOString(), truncated: storedBlock.length < block.length || sourceText.length > 30000
      });
    };
    const currentText = (await page.locator('body').innerText({ timeout: 15000 })).slice(0, 16000);
    const startingTitle = await page.title();
    scanCourse = courseNameFrom(startingTitle);
    addStudyItem(startingTitle, page.url(), 'D2L page', currentText);
    const links = await collectLinks();
    const courseLinks = links.filter(item => {
      try { const target = new URL(item.href); return target.hostname === base.hostname && (/\/d2l\/(?:le\/(?:content|lessons)|lms\/dropbox|lp\/assignments)\//i.test(target.pathname) || /\bcontent\b|\bassignment\b|\bdropbox\b/i.test(item.label)); }
      catch { return false; }
    });
    const allTargets = Array.from(new Set([startingUrl, ...courseLinks.map(item => item.href)]));
    if (allTargets.length > 80) skipped += allTargets.length - 80;
    const targets = allTargets.slice(0, 80);
    const queuedPages = new Set(targets);
    for (let targetIndex = 0; targetIndex < targets.length && targetIndex < 80; targetIndex++) {
      const target = targets[targetIndex];
      if (total >= MAX_TOTAL) { skipped++; continue; }
      try {
        const targetUrl = new URL(target);
        if (targetUrl.hostname !== base.hostname || !isSecure(targetUrl)) { skipped++; continue; }
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (new URL(page.url()).hostname !== base.hostname) { skipped++; continue; }
        if (await page.locator('input[type="password"]').count().catch(() => 0)) { skipped++; continue; }
        const title = await page.title();
        if (target !== startingUrl) {
          const body = (await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).slice(0, 9000);
          if (body.trim()) addStudyItem(title, page.url(), 'D2L page', body);
          else skipped++;
        }
        const attachments = await collectLinks();
        for (const child of attachments) {
          try {
            const childUrl = new URL(child.href);
            const isCoursePage = /\/d2l\/(?:le\/(?:content|lessons)|lms\/dropbox|lp\/assignments)\//i.test(childUrl.pathname);
            if (childUrl.hostname !== base.hostname || !isSecure(childUrl) || !isCoursePage || queuedPages.has(childUrl.href)) continue;
            if (targets.length < 80) { targets.push(childUrl.href); queuedPages.add(childUrl.href); }
            else skipped++;
          } catch {}
        }
        // A topic page only shows the file in a viewer frame, so its text isn't on the page. D2L serves the file itself at a fixed address.
        const topicPage = new URL(page.url()).pathname.match(/\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)\/View/i);
        if (topicPage) attachments.push({ href: new URL(`/d2l/le/content/${topicPage[1]}/topics/files/download/${topicPage[2]}/DirectFileTopicDownload`, page.url()).href, label: title });
        for (const file of attachments) {
          if (total >= MAX_TOTAL) { skipped++; continue; }
          let fileUrl;
          try { fileUrl = new URL(file.href); } catch { continue; }
          let ext = path.extname(fileUrl.pathname).toLowerCase();
          const quickLinkFile = (/\/d2l\/common\/dialogs\/quicklink\/quicklink\.d2l$/i.test(fileUrl.pathname) && /(?:\?|&)type=file(?:&|$)/i.test(fileUrl.search)) || /\/topics\/files\/download\/\d+\/DirectFileTopicDownload$/i.test(fileUrl.pathname);
          if ((!['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.html', '.htm'].includes(ext) && !quickLinkFile) || fileUrl.hostname !== base.hostname || seenFiles.has(fileUrl.href)) continue;
          seenFiles.add(fileUrl.href);
          try {
            const response = await d2lBrowserContext.request.get(fileUrl.href, { timeout: 20000 });
            if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
            const data = await response.body();
            const contentType = String(response.headers()['content-type'] || '').toLowerCase();
            if (!['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.html', '.htm'].includes(ext)) {
              const disposition = String(response.headers()['content-disposition'] || '').toLowerCase();
              if (contentType.includes('pdf') || disposition.includes('.pdf')) ext = '.pdf';
              else if (contentType.includes('wordprocessingml') || disposition.includes('.docx')) ext = '.docx';
              else if (contentType.includes('presentationml') || disposition.includes('.pptx')) ext = '.pptx';
              else if (contentType.includes('spreadsheetml') || disposition.includes('.xlsx')) ext = '.xlsx';
              else if (contentType.includes('text/plain')) ext = '.txt';
              else if (contentType.includes('text/html')) ext = '.html';
              else throw new Error('This D2L file format is not supported for text extraction.');
            }
            if (data.length > 25 * 1024 * 1024) throw new Error('File exceeds the 25 MB reading limit.');
            const tempFolder = path.join(dataDir, 'D2LTempFiles');
            await fs.promises.mkdir(tempFolder, { recursive: true });
            const localFile = path.join(tempFolder, `${crypto.randomUUID()}${ext}`);
            let text;
            try {
              await fs.promises.writeFile(localFile, data, { mode: 0o600 });
              if (ext === '.pdf') text = (await extractPdfText(localFile, Math.min(30000, MAX_TOTAL - total))).text;
              else if (['.docx', '.pptx', '.xlsx'].includes(ext)) text = (await extractOffice(localFile, Math.min(30000, MAX_TOTAL - total))).text;
              else text = data.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
            } finally { await fs.promises.unlink(localFile).catch(() => {}); }
            if (text) addStudyItem(file.label || path.basename(fileUrl.pathname), fileUrl.href, 'D2L file', text);
          } catch (error) { skipped++; console.warn(`[NEXUS] Could not read a D2L attachment: ${String(error.message || error).slice(0, 160)}`); }
        }
      } catch { skipped++; }
    }
    await page.goto(startingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const text = sections.join('\n\n');
    if (!text.trim()) throw new Error('Nexus could not find readable text on this D2L page. Open a course’s Content page and try again.');
    const library = new Map((await readD2LLibrary()).map(item => [item.id, item]));
    for (const item of libraryItems) library.set(item.id, item);
    await saveD2LLibrary(Array.from(library.values()));
    return { ok: true, text, items: libraryItems.map(({ id, title, kind, url, truncated }) => ({ id, title, kind, url, truncated })), pageCount: libraryItems.length, skipped, currentUrl: startingUrl, message: `Added ${libraryItems.length} course page/file item(s) to your study library. ${skipped ? `${skipped} item(s) were skipped or exceeded limits.` : ''}` };
  } catch (error) { return { ok: false, message: String(error.message || error).slice(0, 700) }; }
  };
  ipcMain.handle('school:read-content', (_event, options = {}) => ipcHandlers.read(options));
  ipcMain.handle('school:library:list', async () => (await readD2LLibrary()).map(item => ({
  id: item.id, title: item.title, kind: item.kind, url: item.url, provider: item.provider || 'd2l', subject: item.subject || '', course: item.course || courseNameFrom(item.title), updatedAt: item.updatedAt, truncated: item.truncated,
  objectives: item.objectives?.length ? item.objectives : detectD2LObjectives(item.title, item.text)
})));
ipcMain.handle('school:library:selected', async (_event, selection = {}) => {
  const ids = Array.isArray(selection) ? selection : selection.ids;
  const allowedSubjects = ['English', 'Science', 'Social Studies', 'Math'];
  const requestedSubject = !Array.isArray(selection) && allowedSubjects.includes(selection?.subject) ? selection.subject : '';
  const requestedObjectives = Array.isArray(selection?.objectives) ? Array.from(new Set(selection.objectives.filter(code => /^\d{1,2}[A-C]$/i.test(code)).map(code => code.toUpperCase()))) : [];
  const selectedIds = Array.isArray(ids) ? new Set(ids.filter(id => typeof id === 'string')) : new Set();
  if (selectedIds.size > 12) return { ok: false, message: 'Select up to 12 topics or files at a time so Nexus can include their source context in the test.' };
  if (!selectedIds.size && !requestedObjectives.length) return { ok: false, message: 'Choose a subject and select at least one D2L topic/file or reading objective.' };
  const library = await readD2LLibrary();
  const { cleanD2LText, d2lReadingLength } = require('../study/study');
  // Saved D2L pages can be just menus and a viewer frame. Those would produce questions about the page instead of the subject.
  const readable = library.filter(item => item.provider === 'local' || d2lReadingLength(item.text) >= 200).map(item => (item.provider === 'local' ? item : { ...item, text: cleanD2LText(item.text) }));
  let items = readable.filter(item => (!requestedSubject || !item.subject || item.subject === requestedSubject) && (!selectedIds.size || selectedIds.has(item.id)) && (!requestedObjectives.length || (item.objectives || detectD2LObjectives(item.title, item.text)).some(code => requestedObjectives.includes(code))));
  if (!items.length && library.some(item => (!selectedIds.size || selectedIds.has(item.id)) && item.provider !== 'local' && d2lReadingLength(item.text) < 200)) return { ok: false, message: 'Those D2L items hold only page titles, with no reading text. Open the course in D2L and save it again so Nexus can read its files.' };
  if (!items.length) return { ok: false, message: requestedObjectives.length ? `No saved D2L material is tagged with ${requestedObjectives.join(', ')}. Scan the reading again or select its topic/file.` : 'Those study-library items are no longer available. Rescan the course and try again.' };
  if (items.length > 12) return { ok: false, message: `These objectives match ${items.length} D2L items. Select specific files/topics too, or choose fewer objectives.` };
  const sources = items.map(item => {
    const codes = requestedObjectives.filter(code => (item.objectives || detectD2LObjectives(item.title, item.text)).includes(code));
    const text = codes.length ? (extractD2LObjectiveText(item.text, codes) || item.text) : item.text;
    return `STUDY SOURCE ITEM: ${item.kind} — ${item.title}\nSOURCE: ${item.url || 'Saved on this computer'}${item.truncated ? '\nNOTE: This item was truncated while saving.' : ''}${codes.length ? `\nSELECTED OBJECTIVES: ${codes.join(', ')}` : ''}\n${text}`;
  });
  const material = sources.join('\n\n');
  return { ok: true, text: material, names: items.map(item => item.title), count: items.length, objectives: requestedObjectives };
});
ipcMain.handle('school:library:clear', async () => { await saveD2LLibrary([]); return { ok: true }; });
ipcMain.handle('study:library:add-local', async (_event, payload = {}) => {
  const documents = Array.isArray(payload) ? payload : payload.documents;
  const allowedSubjects = ['English', 'Science', 'Social Studies', 'Math'];
  const subject = allowedSubjects.includes(payload?.subject) ? payload.subject : 'Science';
  if (!Array.isArray(documents)) return { ok: false, message: 'Choose readable files to add.' };
  const library = await readD2LLibrary();
  const added = [];
  for (const document of documents.slice(0, 30)) {
    const title = String(document?.name || '').trim().slice(0, 240);
    const text = String(document?.content || '').slice(0, 600000);
    if (!title || !text.trim()) continue;
    const digest = crypto.createHash('sha256').update(`${title}\n${text}`).digest('hex').slice(0, 28);
    const id = `local-${digest}`;
    const item = { id, title, kind: 'Computer file', provider: 'local', subject, url: '', text, truncated: Boolean(document.truncated), objectives: detectD2LObjectives(title, text), updatedAt: new Date().toISOString() };
    const existingIndex = library.findIndex(entry => entry.id === id);
    if (existingIndex >= 0) library.splice(existingIndex, 1);
    library.push(item); added.push({ id, title });
  }
  if (!added.length) return { ok: false, message: 'No readable text was found in those files.' };
  await saveD2LLibrary(library);
  return { ok: true, added, message: `Added ${added.length} file(s) to your study library on this computer.` };
});
  // Brightspace's own REST API, called from inside the signed-in page so the user's session and D2L's CSRF rules apply.
  async function listCourses() {
    const { url: schoolUrl } = await readD2LSettings();
    if (!schoolUrl) return { ok: false, error: 'The D2L address is not set. Save it in the Study Center.' };
    if (!d2lBrowserPage || d2lBrowserPage.isClosed()) return { ok: false, error: 'The D2L window is not open. Open D2L and sign in first.' };
    if (new URL(d2lBrowserPage.url()).hostname !== new URL(schoolUrl).hostname) return { ok: false, error: 'D2L is still showing a sign-in page. Finish signing in first.' };
    const result = await d2lBrowserPage.evaluate(async () => {
      const headers = { 'X-Csrf-Token': localStorage.getItem('XSRF.Token') || '' };
      const versions = await fetch('/d2l/api/versions/', { headers });
      if (!versions.ok) return { error: `HTTP ${versions.status}` };
      const lp = (await versions.json()).find(item => item.ProductCode === 'lp');
      const response = await fetch(`/d2l/api/lp/${lp.LatestVersion}/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100`, { headers });
      if (!response.ok) return { error: `HTTP ${response.status}` };
      return { items: (await response.json()).Items || [] };
    }).catch(error => ({ error: error.message }));
    if (result.error) return { ok: false, error: `D2L would not list courses (${result.error}). Your school may restrict its API; open a course page and use "Add this course's content" instead.` };
    const courses = result.items.map(item => ({ id: item.OrgUnit?.Id, name: item.OrgUnit?.Name, code: item.OrgUnit?.Code, active: item.Access?.IsActive !== false, url: `${schoolUrl}/d2l/home/${item.OrgUnit?.Id}` })).filter(course => course.id && course.name);
    return { ok: true, courses, message: `Found ${courses.length} course(s).` };
  }
  // Assignments and due dates come from Brightspace's own API, one course at a time, using the signed-in session.
  async function listAssignments() {
    const courses = await listCourses();
    if (!courses.ok) return courses;
    const assignments = [];
    const failedCourses = [];
    for (const course of courses.courses.filter(item => item.active)) {
      const result = await d2lBrowserPage.evaluate(async ou => {
        const headers = { 'X-Csrf-Token': localStorage.getItem('XSRF.Token') || '' };
        const versions = await (await fetch('/d2l/api/versions/', { headers })).json();
        const le = versions.find(item => item.ProductCode === 'le');
        const response = await fetch(`/d2l/api/le/${le.LatestVersion}/${ou}/dropbox/folders/`, { headers });
        if (!response.ok) return { error: `HTTP ${response.status}` };
        return { items: await response.json() };
      }, course.id).catch(error => ({ error: error.message }));
      if (result.error) { failedCourses.push(course.name); continue; }
      for (const folder of result.items || []) {
        if (folder.IsHidden) continue;
        assignments.push({ id: folder.Id, courseId: course.id, course: course.name, title: String(folder.Name || 'Assignment').slice(0, 140), due: folder.DueDate || '' });
      }
    }
    return { ok: true, assignments, failedCourses };
  }
  async function openCourse(id) {
    const { url: schoolUrl } = await readD2LSettings();
    if (!/^\d+$/.test(String(id))) return { ok: false, message: 'That is not a valid course id.' };
    let page = await getD2LBrowser();
    page = await gotoWithRetry(page, `${schoolUrl}/d2l/le/content/${id}/Home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    d2lBrowserPage = page;
    await bringForward(page);
    return { ok: true, url: page.url(), message: 'Opened the course content page.' };
  }
  async function readLibraryForTopic(topic, subject) {
    const words = String(topic || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    const library = await readD2LLibrary();
    return library.filter(item => !subject || !item.subject || item.subject.toLowerCase() === String(subject).toLowerCase()).map(item => { const haystack = `${item.title} ${item.text}`.toLowerCase(); return { item, hits: words.filter(word => haystack.includes(word)).length, titleHits: words.filter(word => item.title.toLowerCase().includes(word)).length }; }).filter(entry => !words.length || entry.hits).sort((a, b) => b.titleHits - a.titleHits || b.hits - a.hits).map(entry => entry.item);
  }
  ipcMain.handle('school:courses', async () => listCourses());
  ipcMain.handle('school:open-course', async (_event, id) => { try { return await openCourse(id); } catch (error) { return { ok: false, message: String(error.message).slice(0, 400) }; } });
  return {
    readD2LSettings, readD2LLibrary, readLibraryForTopic, listCourses, listAssignments, openCourse,
    open: () => ipcHandlers.open(), readOpenCourse: subject => ipcHandlers.read({ subject }),
    async closeBrowser() { if (d2lBrowserContext) await d2lBrowserContext.close().catch(() => {}); }
  };

}

module.exports = { createD2L, courseNameFrom };
