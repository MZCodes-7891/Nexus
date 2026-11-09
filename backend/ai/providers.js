// Model providers: Ollama's native API and any OpenAI-compatible endpoint, behind one streaming interface.
function friendlyError(error, label) {
  if (error?.name === 'AbortError') return Object.assign(new Error('Cancelled.'), { cancelled: true });
  if (error?.name === 'TimeoutError') return new Error(`${label} took too long to respond.`);
  if (/llama-server binary not found|llama runner|error starting/i.test(String(error?.message))) return new Error('Ollama is running, but its AI engine is missing or damaged, so it cannot run any model. Reinstall Ollama from ollama.com; your downloaded models are kept.');
  if (/requires more system memory|out of memory/i.test(String(error?.message))) return new Error('There is not enough memory to run this model. Close other programs or choose a smaller model in Settings.');
  if (error?.status === 404 && /model/i.test(String(error?.message))) return new Error(`That model is not installed. ${error.message}`);
  const code = error?.cause?.code || error?.code;
  if (code === 'ECONNREFUSED' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ENOTFOUND' || error?.message === 'fetch failed') return new Error(`${label} is not reachable. Check that it is running.`);
  return error instanceof Error ? error : new Error(String(error));
}

async function readLines(response, onLine) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) if (line.trim()) onLine(line);
  }
  if (buffer.trim()) onLine(buffer);
}

async function expectOk(response, label) {
  if (response.ok) return response;
  const body = await response.text().catch(() => '');
  let detail = body;
  try { const parsed = JSON.parse(body); detail = parsed.error?.message || parsed.error || body; } catch {}
  const error = new Error(`${label} returned HTTP ${response.status}: ${String(detail).slice(0, 300)}`);
  error.status = response.status;
  throw error;
}

function parseArgs(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

const ollama = {
  label: 'Ollama',
  base: config => String(config.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  async listModels(config, signal) {
    const response = await expectOk(await fetch(`${this.base(config)}/api/tags`, { signal: signal || AbortSignal.timeout(8000) }), 'Ollama');
    return ((await response.json()).models || []).map(model => ({ name: model.name, size: model.size, family: model.details?.family || '' }));
  },
  async capabilities(config, model) {
    try {
      const response = await expectOk(await fetch(`${this.base(config)}/api/show`, { method: 'POST', body: JSON.stringify({ name: model }), signal: AbortSignal.timeout(8000) }), 'Ollama');
      const info = await response.json();
      const contextEntry = Object.entries(info.model_info || {}).find(([key]) => /context_length$/.test(key));
      const caps = Array.isArray(info.capabilities) ? info.capabilities : null;
      return { known: Boolean(caps), tools: caps ? caps.includes('tools') : /\btools\b/.test(String(info.template || '')) || String(info.template || '').includes('.Tools'), embedding: caps ? caps.includes('embedding') : false, vision: caps ? caps.includes('vision') : false, contextLength: contextEntry?.[1] || 0 };
    } catch { return { known: false, tools: false, embedding: false, vision: false, contextLength: 0 }; }
  },
  async chat(config, { messages, tools, format, signal, onToken, contextLength, maxTokens, keepAlive }) {
    const options = { temperature: config.temperature, top_p: config.topP, num_ctx: contextLength || config.contextLength };
    if (config.maxOutputTokens || maxTokens) options.num_predict = maxTokens || config.maxOutputTokens;
    const body = { model: config.model, messages: messages.map(toOllamaMessage), stream: true, options };
    if (keepAlive !== undefined) body.keep_alive = keepAlive;
    if (tools?.length) body.tools = tools;
    if (format) body.format = format;
    // Thinking models (Qwen3 and similar) answer directly; thinking first makes every reply much slower.
    if (/qwen3|deepseek-r1|magistral/i.test(config.model)) body.think = false;
    const response = await expectOk(await fetch(`${this.base(config)}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal }), 'Ollama');
    let content = '';
    const toolCalls = [];
    await readLines(response, line => {
      const part = JSON.parse(line);
      if (part.error) throw new Error(`Ollama: ${part.error}`);
      const text = part.message?.content;
      if (text) { content += text; onToken?.(text); }
      for (const call of part.message?.tool_calls || []) toolCalls.push({ id: `call_${toolCalls.length}`, name: String(call.function?.name || ''), args: parseArgs(call.function?.arguments) });
    });
    return { content: content.replace(/<think>[\s\S]*?<\/think>\s*/g, ''), toolCalls };
  },
  // Listing models only proves the server is up. Loading one proves it can answer; a damaged install passes the first and fails the second.
  async proveLoads(config) {
    await expectOk(await fetch(`${this.base(config)}/api/generate`, { method: 'POST', body: JSON.stringify({ model: config.model, stream: false, options: { num_ctx: config.contextLength } }), signal: AbortSignal.timeout(180000) }), 'Ollama');
  },
  async embed(config, model, input, signal) {
    const response = await expectOk(await fetch(`${this.base(config)}/api/embed`, { method: 'POST', body: JSON.stringify({ model, input }), signal: signal || AbortSignal.timeout(120000) }), 'Ollama');
    return (await response.json()).embeddings || [];
  }
};

function toOllamaMessage(message) {
  if (message.role === 'tool') return { role: 'tool', tool_name: message.name, content: message.content };
  const output = { role: message.role, content: message.content || '' };
  if (Array.isArray(message.images) && message.images.length) output.images = message.images;
  if (message.toolCalls?.length) output.tool_calls = message.toolCalls.map(call => ({ function: { name: call.name, arguments: call.args } }));
  return output;
}

const openai = {
  label: 'The AI endpoint',
  base: config => String(config.openaiBaseUrl || '').replace(/\/+$/, ''),
  headers: config => ({ 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }),
  async listModels(config, signal) {
    const response = await expectOk(await fetch(`${this.base(config)}/models`, { headers: this.headers(config), signal: signal || AbortSignal.timeout(8000) }), this.label);
    return ((await response.json()).data || []).map(model => ({ name: model.id, size: 0, family: model.owned_by || '' }));
  },
  async capabilities() { return { known: false, tools: true, embedding: false, vision: false, contextLength: 0 }; },
  async chat(config, { messages, tools, format, signal, onToken }) {
    const body = { model: config.model, messages: messages.map(toOpenAiMessage), stream: true, temperature: config.temperature, top_p: config.topP };
    if (config.maxOutputTokens) body.max_tokens = config.maxOutputTokens;
    if (tools?.length) body.tools = tools;
    if (format) body.response_format = { type: 'json_object' };
    const response = await expectOk(await fetch(`${this.base(config)}/chat/completions`, { method: 'POST', headers: this.headers(config), body: JSON.stringify(body), signal }), this.label);
    let content = '';
    const partial = new Map();
    await readLines(response, line => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const delta = JSON.parse(data).choices?.[0]?.delta || {};
      if (delta.content) { content += delta.content; onToken?.(delta.content); }
      for (const call of delta.tool_calls || []) {
        const entry = partial.get(call.index ?? 0) || { id: call.id, name: '', args: '' };
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name += call.function.name;
        if (call.function?.arguments) entry.args += call.function.arguments;
        partial.set(call.index ?? 0, entry);
      }
    });
    return { content, toolCalls: Array.from(partial.values()).map((call, index) => ({ id: call.id || `call_${index}`, name: call.name, args: parseArgs(call.args) })) };
  }
};

function toOpenAiMessage(message) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  const output = { role: message.role, content: message.content || '' };
  if (message.toolCalls?.length) output.tool_calls = message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }));
  return output;
}

function createModelManager({ getConfig }) {
  const provider = () => (getConfig().provider === 'openai' ? openai : ollama);
  const capabilityCache = new Map();
  let proof = null;
  let proofRunning = null;
  const proofKey = config => `${config.provider}|${provider().base(config)}|${config.model}|${config.contextLength}`;
  function proveModel(config) {
    if (proof?.ok && proof.key === proofKey(config)) return Promise.resolve(proof);
    if (!provider().proveLoads) return Promise.resolve({ ok: true });
    if (!proofRunning) {
      const key = proofKey(config);
      proofRunning = provider().proveLoads(config).then(() => ({ ok: true, key }), error => ({ ok: false, key, message: friendlyError(error, provider().label).message })).then(result => { proof = result; proofRunning = null; return result; });
    }
    return proofRunning;
  }
  return {
    provider,
    async listModels() { try { return await provider().listModels(getConfig()); } catch (error) { throw friendlyError(error, provider().label); } },
    async test() {
      const config = getConfig();
      if (!config.model) return { ok: false, provider: config.provider, model: '', installed: false, models: [], message: 'Choose a model in Settings → AI.' };
      try {
        const models = await provider().listModels(config);
        const names = models.map(model => model.name);
        const installed = names.some(name => name === config.model || name === `${config.model}:latest`);
        if (!installed) return { ok: true, provider: config.provider, model: config.model, installed, ready: false, models, message: `Connected, but ${config.model} is not available. Installed: ${names.join(', ') || 'none'}.` };
        const capabilities = await this.capabilities(config.model);
        const loaded = await proveModel(config);
        return { ok: true, provider: config.provider, model: config.model, installed, ready: loaded.ok, models, capabilities, message: loaded.ok ? `${config.model} is ready.` : loaded.message };
      } catch (error) { return { ok: false, provider: config.provider, model: config.model, installed: false, ready: false, models: [], message: friendlyError(error, provider().label).message }; }
    },
    async capabilities(model) {
      const config = getConfig();
      const key = `${config.provider}|${provider().base(config)}|${model}`;
      if (!capabilityCache.has(key)) capabilityCache.set(key, await provider().capabilities(config, model));
      return capabilityCache.get(key);
    },
    async chat(request) {
      // A request may name another model, such as the vision model for pictures.
      try { return await provider().chat(request.model ? { ...getConfig(), model: request.model } : getConfig(), request); }
      catch (error) { if (error?.name !== 'AbortError') proof = null; throw friendlyError(error, provider().label); }
    },
    // Unloads every loaded model except one, so a second model, such as the vision model, has room on the graphics card.
    async freeMemory(except = '') {
      const config = getConfig();
      if (config.provider !== 'ollama') return;
      const base = ollama.base(config);
      const loaded = await fetch(`${base}/api/ps`).then(reply => reply.json()).catch(() => ({ models: [] }));
      for (const item of loaded.models || []) {
        if (item.name === except || item.model === except) continue;
        await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify({ model: item.name, keep_alive: 0 }) }).catch(() => {});
      }
      proof = null;
    },
    async embed(model, input, signal) {
      if (getConfig().provider !== 'ollama') throw new Error('Local embeddings need the Ollama provider.');
      try { return await ollama.embed(getConfig(), model, input, signal); }
      catch (error) { throw friendlyError(error, 'Ollama'); }
    }
  };
}

module.exports = { ollama, openai, createModelManager, friendlyError };
