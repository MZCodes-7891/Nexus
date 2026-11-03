const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FEATURED_SLUGS = ['googledocs', 'googleslides', 'googledrive', 'gmail', 'googlecalendar', 'youtube', 'spotify', 'discord', 'discordbot', 'notion', 'github', 'slack', 'microsoft_word', 'one_drive', 'trello'];

function normalizeComposioApiKey(value) {
  let key = String(value || '').trim();
  const assignment = key.match(/^(?:export\s+)?COMPOSIO_API_KEY\s*=\s*([\s\S]*)$/i);
  if (assignment) key = assignment[1].trim();
  const quoted = key.match(/^(["'`])([\s\S]*)\1$/);
  if (quoted) key = quoted[2].trim();
  return key;
}

function describeComposioError(error) {
  const chain = [];
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) chain.push(current);
  const details = chain.map(item => String(item?.message || '')).filter(Boolean);
  const detailText = details.join(' | ');
  const causeStatus = detailText.match(/(?:^|\s)(\d{3})(?:\s|$)/)?.[1];
  const status = Number(error?.statusCode || error?.status || error?.response?.status || causeStatus) || 0;
  if (status === 401 || status === 403) return 'Composio rejected this key or its permissions. Use a Project API Key from Platform → your project → Settings → API Keys (not an organization or For You key). Scoped keys also need Toolkit read, Auth configs read/write, Connected accounts read/write, Session management write, and Session tool execution write.';
  if (status === 429) return 'Composio is rate limiting requests. Wait a little and retry.';
  if (status >= 500) return `Composio is temporarily unavailable (HTTP ${status}). Retry later.`;
  if (chain.some(item => ['ECONNABORTED', 'ETIMEDOUT'].includes(item?.code)) || /timed? ?out|timeout/i.test(detailText)) return 'The request to Composio timed out. Check your internet connection and retry.';
  if (chain.some(item => ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'].includes(item?.code)) || /fetch failed|network error|could not resolve|certificate/i.test(detailText)) return 'Nexus could not reach Composio. Check your internet connection, firewall, and system clock, then retry.';
  return String(details.at(-1) || 'Unexpected Composio error').slice(0, 400);
}

function needsConfirmation(toolName, args) {
  const name = String(toolName).toLowerCase();
  if (/composio_(search_tools|manage_connections|wait_for_connections)/i.test(name)) return false;
  if (/(delete|remove|send|reply|post|publish|create|update|edit|move|share|invite|upload|submit|complete|archive|cancel|change|write|add)/i.test(name)) return true;
  return Boolean(args && Object.keys(args).length && !/(fetch|get|list|search|read|find|view|retrieve|download|profile)/i.test(name));
}

function toolDefinitions(value) {
  const raw = Array.isArray(value) ? value : Object.values(value || {});
  return raw.map(item => item?.function ? item : (item?.name ? { type: 'function', function: { name: item.name, description: item.description || '', parameters: item.parameters || { type: 'object', properties: {} } } } : null)).filter(item => item?.function?.name && item.function.parameters);
}

// Composio's search result runs to 20,000 characters of guidance, and a small model gets lost in it and searches again. This keeps what it needs to act.
function compactSearchResult(result) {
  const data = result?.data;
  if (!data?.tool_schemas) return result;
  const primary = (data.results || []).flatMap(item => item.primary_tool_slugs || []);
  const related = (data.results || []).flatMap(item => item.related_tool_slugs || []);
  const order = [...new Set([...primary, ...related])].filter(slug => data.tool_schemas[slug]?.input_schema).slice(0, 4);
  const tools = order.map(slug => {
    const schema = data.tool_schemas[slug];
    return { tool_slug: slug, description: String(schema.description || '').slice(0, 220), arguments: Object.fromEntries(Object.entries(schema.input_schema.properties || {}).slice(0, 14).map(([name, value]) => [name, value.type || 'any'])), required: schema.input_schema.required || [] };
  });
  const notConnected = (data.toolkit_connection_statuses || []).filter(item => !item.has_active_connection).map(item => item.toolkit);
  return { ok: true, current_time_utc: data.time_info?.current_time_utc, recommended_tool: primary[0] || order[0]?.tool_slug, tools, not_connected: notConnected, next_step: notConnected.length ? `These apps are not connected, so tell the user to connect them in Connected Apps: ${notConnected.join(', ')}.` : 'Do not search again. Now call COMPOSIO_MULTI_EXECUTE_TOOL with {"tools":[{"tool_slug":"<slug>","arguments":{...}}]}.' };
}

function normalizeToolkit(item) {
  return { slug: item.slug, name: item.name, description: item.meta?.description || '', logo: item.meta?.logo || '', appUrl: item.meta?.appUrl || '', categories: (item.meta?.categories || []).map(category => category.name), toolCount: item.meta?.toolsCount ?? null, noAuth: Boolean(item.noAuth), authSchemes: item.authSchemes || [], managedAuthSchemes: item.composioManagedAuthSchemes || [] };
}

// Official Composio SDK. A key only counts as verified after a real authenticated request succeeds, and "connected" only ever comes from Composio's own account status.
// blockChanges is for automated tests: they may read the real accounts, but must never change anything in them.
const BLOCKED_IN_TESTS = { ok: false, error: 'Blocked in test mode: this would change something in a real account.' };
function createComposio({ dataDir, safeStorage, openExternal, logger, env = process.env, sdk = () => import('@composio/core'), blockChanges = false }) {
  const secretPath = () => path.join(dataDir, 'composio-api-key.enc');
  const userIdPath = () => path.join(dataDir, 'composio-user-id');
  let client;
  let session;
  let sessionKey = '';
  let stableUserId;

  async function readApiKey() {
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        const encrypted = await fs.promises.readFile(secretPath());
        return (await safeStorage.decryptStringAsync(encrypted)).result;
      }
    } catch {}
    return normalizeComposioApiKey(env.COMPOSIO_API_KEY) || null;
  }
  async function getUserId() {
    if (stableUserId) return stableUserId;
    try { stableUserId = (await fs.promises.readFile(userIdPath(), 'utf8')).trim(); } catch {}
    if (!stableUserId) {
      stableUserId = `nexus-${crypto.randomUUID()}`;
      await fs.promises.mkdir(dataDir, { recursive: true });
      await fs.promises.writeFile(userIdPath(), stableUserId, { mode: 0o600 });
    }
    return stableUserId;
  }
  async function createClient(apiKey) { const { Composio } = await sdk(); return new Composio({ apiKey, allowTracking: false, logLevel: 'error' }); }
  async function getClient() {
    const apiKey = await readApiKey();
    if (!apiKey) throw new Error('Add and verify your Composio project API key in Settings first.');
    if (!client) client = await createClient(apiKey);
    return client;
  }
  async function getConnectedAccounts(activeClient) {
    const result = await activeClient.connectedAccounts.list({ userIds: [await getUserId()], limit: 100 });
    const items = Array.isArray(result) ? result : (result?.items || []);
    return items.map(account => ({
      id: account.id || account.nanoid,
      toolkit: account.toolkit?.slug || account.toolkitSlug || '',
      status: String(account.status || 'UNKNOWN').toUpperCase(),
      displayName: account.state?.val?.displayName || account.alias || account.label || '',
      createdAt: account.createdAt || account.created_at || ''
    })).filter(account => account.id && account.toolkit);
  }
  async function status() {
    const key = await readApiKey();
    if (!key) return { configured: false, verified: false, message: 'Add a Composio Project API Key in Settings.' };
    try {
      const active = client || await createClient(key);
      await active.toolkits.get({ limit: 1 });
      client = active;
      return { configured: true, verified: true, message: 'Composio API key verified.' };
    } catch (error) {
      client = null;
      const message = describeComposioError(error);
      logger?.warn(`Composio verification failed: ${message}`);
      return { configured: true, verified: false, message };
    }
  }
  async function saveKey(supplied) {
    const apiKey = normalizeComposioApiKey(supplied);
    if (!apiKey) return { ok: false, message: 'Enter your Composio project API key.' };
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) return { ok: false, message: 'Windows secure storage is unavailable, so Nexus did not save the key.' };
      const candidate = await createClient(apiKey);
      await candidate.toolkits.get({ limit: 1 });
      await fs.promises.mkdir(dataDir, { recursive: true });
      await fs.promises.writeFile(secretPath(), await safeStorage.encryptStringAsync(apiKey), { mode: 0o600 });
      client = candidate;
      session = null;
      return { ok: true, verified: true, message: 'Composio API key verified and saved securely.' };
    } catch (error) {
      client = null;
      return { ok: false, verified: false, message: describeComposioError(error) };
    }
  }
  async function removeKey() {
    await fs.promises.unlink(secretPath()).catch(() => {});
    client = null; session = null;
    return { ok: true, message: 'The saved Composio key was removed from this computer.' };
  }
  async function catalog({ search = '' } = {}) {
    try {
      const active = await getClient();
      const query = { limit: 200, sortBy: 'usage', managedBy: 'all' };
      if (search) query.search = String(search).slice(0, 100);
      const [toolkits, accounts] = await Promise.all([active.toolkits.get(query), getConnectedAccounts(active)]);
      const items = Array.isArray(toolkits) ? toolkits : (toolkits?.items || []);
      // The list returns only the most used apps, so anything featured or connected past that point is looked up by name rather than labelled unsupported.
      const known = new Set(items.map(item => item.slug));
      const wanted = search ? [] : [...new Set([...FEATURED_SLUGS, ...accounts.map(account => account.toolkit)])].filter(slug => !known.has(slug));
      const lookedUp = await Promise.all(wanted.map(slug => active.toolkits.get(slug).catch(() => null)));
      const apps = [...items, ...lookedUp.filter(Boolean)].map(normalizeToolkit);
      return { ok: true, verified: true, apps, accounts };
    } catch (error) { return { ok: false, verified: false, message: describeComposioError(error), apps: [], accounts: [] }; }
  }
  async function toolkitActions(slug) {
    try {
      const active = await getClient();
      const result = await active.tools.getRawComposioTools({ toolkits: [String(slug)], limit: 300 });
      const list = Array.isArray(result) ? result : (result?.items || []);
      return { ok: true, actions: list.map(tool => ({ slug: tool.slug, name: tool.name || tool.slug, description: String(tool.description || '').slice(0, 240), inputs: Object.keys(tool.inputParameters?.properties || {}), inputTypes: Object.fromEntries(Object.entries(tool.inputParameters?.properties || {}).map(([name, value]) => [name, value.type || 'string'])), required: tool.inputParameters?.required || [] })) };
    } catch (error) { return { ok: false, actions: [], message: describeComposioError(error) }; }
  }
  async function connect(toolkitSlug) {
    try {
      const active = await getClient();
      const toolkit = await active.toolkits.get(String(toolkitSlug || ''));
      if (toolkit.noAuth) return { ok: false, status: 'unsupported_auth', message: 'This integration does not require an account connection.' };
      const existing = await active.authConfigs.list({ toolkit: toolkit.slug, isComposioManaged: true, limit: 100 });
      let authConfig = existing.items?.[0];
      if (!authConfig) {
        if (!toolkit.authConfigDetails?.length) return { ok: false, status: 'unsupported_auth', message: 'Composio does not provide an authentication configuration for this integration.' };
        authConfig = await active.authConfigs.create(toolkit.slug, { type: 'use_composio_managed_auth', name: `Nexus ${toolkit.name} Auth` });
      }
      const connection = await active.connectedAccounts.link(await getUserId(), authConfig.id, { allowMultiple: true });
      const redirectUrl = connection.redirectUrl || connection.redirect_url;
      if (!redirectUrl) return { ok: false, status: 'error', message: 'Composio did not return an authorization link.' };
      const parsed = new URL(redirectUrl);
      if (parsed.protocol !== 'https:' || !/(^|\.)composio\.dev$/.test(parsed.hostname)) return { ok: false, status: 'error', message: 'Composio returned an unexpected authorization URL; it was not opened.' };
      await openExternal(redirectUrl);
      session = null;
      return { ok: true, status: 'connecting', message: `Finish authorization for ${toolkit.name} in your browser.`, connectionId: connection.id || null };
    } catch (error) { return { ok: false, status: 'error', message: describeComposioError(error) }; }
  }
  async function ownedAccount(active, id) {
    const account = (await getConnectedAccounts(active)).find(item => item.id === id);
    if (!account) throw new Error('That connection was not found for this Nexus user.');
    return account;
  }
  async function disconnect(id) {
    try {
      const active = await getClient();
      const account = await ownedAccount(active, id);
      await active.connectedAccounts.revoke(account.id);
      session = null;
      return { ok: true, message: 'The provider connection was revoked.' };
    } catch (error) { return { ok: false, message: describeComposioError(error) }; }
  }
  // Reconnect refreshes the existing account; if the provider needs the user again, its sign-in page opens.
  async function reconnect(id) {
    try {
      const active = await getClient();
      const account = await ownedAccount(active, id);
      const result = await active.connectedAccounts.refresh(account.id);
      session = null;
      const redirectUrl = result?.redirectUrl || result?.redirect_url;
      if (redirectUrl) {
        const parsed = new URL(redirectUrl);
        if (parsed.protocol === 'https:') { await openExternal(redirectUrl); return { ok: true, status: 'connecting', message: 'Finish reconnecting in your browser.' }; }
      }
      return { ok: true, status: 'refreshed', message: `Asked Composio to refresh ${account.toolkit}. Refresh this page to see its status.` };
    } catch (error) { return { ok: false, message: describeComposioError(error) }; }
  }
  // A session must be told which accounts to use. Without this it reports "no active connection" even for accounts that are active, so the AI could never reach them.
  async function currentSession(active) {
    const accounts = (await getConnectedAccounts(active)).filter(account => account.status === 'ACTIVE');
    const connectedAccounts = {};
    for (const account of accounts) if (!connectedAccounts[account.toolkit]) connectedAccounts[account.toolkit] = account.id;
    const key = JSON.stringify(Object.entries(connectedAccounts).sort());
    if (!session || key !== sessionKey) {
      session = await active.sessions.create(await getUserId(), { manageConnections: true, connectedAccounts });
      sessionKey = key;
    }
    return { session, toolkits: Object.keys(connectedAccounts) };
  }
  // Tools the agent may call. Composio's session exposes search and execute meta-tools covering every connected app, so the list stays dynamic.
  async function sessionTools(context) {
    let active;
    try { active = await getClient(); } catch { return []; }
    const { session: current, toolkits } = await currentSession(active);
    // Offered only when the request is about an online account; otherwise these tools distract the model from plain questions.
    const names = toolkits.map(name => name.toLowerCase());
    const query = String(context?.query || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const squeezed = query.replace(/ /g, '');
    const relevant = names.some(name => squeezed.includes(name.replace(/[^a-z0-9]/g, ''))) || /\b(connected|my account|gmail|e ?mail|inbox|google|drive|slack|notion|github|trello|outlook|onedrive|sheets?)\b/.test(query);
    if (!relevant) return [];
    const note = toolkits.length ? ` Connected accounts: ${toolkits.join(', ')}.` : ' No accounts are connected yet.';
    // The remote code tools aren't needed for app actions and shouldn't be within reach of a model reading untrusted content.
    return toolDefinitions(await current.tools()).filter(definition => !/REMOTE_(BASH|WORKBENCH)/.test(definition.function.name)).map(definition => ({
      name: definition.function.name, description: `${definition.function.description.slice(0, 600)}${note}`, parameters: definition.function.parameters, category: 'integrations', title: definition.function.name,
      risk: needsConfirmation(definition.function.name, { any: true }) ? 'sensitive' : 'read',
      // Reading from a connected app needs no prompt; anything that could change something still asks.
      riskFor: args => {
        if (!/multi_execute/i.test(definition.function.name)) return needsConfirmation(definition.function.name, { any: true }) ? 'sensitive' : 'read';
        const inner = Array.isArray(args?.tools) ? args.tools : [];
        return inner.length && inner.every(item => item?.tool_slug && !needsConfirmation(item.tool_slug, { any: true })) ? 'read' : 'sensitive';
      },
      confirmMessage: args => `Allow Nexus to run ${Array.isArray(args?.tools) ? args.tools.map(item => item?.tool_slug).join(', ') : definition.function.name} on your connected account?`,
      handler: async args => {
        if (blockChanges && (/multi_execute/i.test(definition.function.name) ? !(Array.isArray(args?.tools) && args.tools.every(item => item?.tool_slug && !needsConfirmation(item.tool_slug, { any: true }))) : needsConfirmation(definition.function.name, { any: true }))) return BLOCKED_IN_TESTS;
        try {
          const result = await current.execute(definition.function.name, args);
          return /SEARCH_TOOLS/.test(definition.function.name) ? compactSearchResult(result) : result;
        }
        catch (error) { return { ok: false, error: describeComposioError(error) }; }
      }
    }));
  }
  async function execute(slug, args) {
    if (blockChanges && needsConfirmation(slug, { any: true })) return { data: null, error: BLOCKED_IN_TESTS.error };
    const active = await getClient();
    const { session: current } = await currentSession(active);
    return current.execute(String(slug), args || {});
  }
  async function activeAccounts() { try { return (await getConnectedAccounts(await getClient())).filter(account => account.status === 'ACTIVE'); } catch { return []; } }
  async function accounts() { return getConnectedAccounts(await getClient()); }
  return { accounts, status, saveKey, removeKey, catalog, toolkitActions, connect, disconnect, reconnect, sessionTools, execute, activeAccounts };
}

module.exports = { compactSearchResult, createComposio, normalizeComposioApiKey, describeComposioError, needsConfirmation, toolDefinitions, normalizeToolkit };
