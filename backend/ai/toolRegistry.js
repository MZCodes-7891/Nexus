const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'please', 'nexus', 'can', 'you', 'help', 'want', 'need', 'what', 'how', 'are', 'not']);

// Extensible tool registry. Adding a capability means registering one object here; nothing else in the agent changes.
class ToolRegistry {
  constructor() { this.tools = new Map(); this.dynamicProviders = []; }
  register(tool) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name || '')) throw new Error(`Invalid tool name: ${tool.name}`);
    if (typeof tool.handler !== 'function') throw new Error(`Tool ${tool.name} has no handler.`);
    this.tools.set(tool.name, { risk: 'read', category: 'other', keywords: [], parameters: { type: 'object', properties: {} }, ...tool });
    return this;
  }
  registerAll(tools) { for (const tool of tools) this.register(tool); return this; }
  // Dynamic providers contribute tools at run time, such as Composio's session tools.
  addDynamicProvider(provider) { this.dynamicProviders.push(provider); }
  get(name) { return this.tools.get(name) || null; }
  list() { return Array.from(this.tools.values()); }
  score(tool, words, text) {
    let score = tool.always ? 100 : 0;
    const name = tool.name.toLowerCase();
    for (const keyword of tool.keywords) if (text.includes(keyword)) score += keyword.length > 4 ? 4 : 3;
    for (const word of words) { if (name.includes(word)) score += 2; if (tool.description.toLowerCase().includes(word)) score += 0.5; }
    return score;
  }
  // Small local models degrade with very long tool lists, so each turn offers only the most relevant ones.
  select(query, { max = 14, recent = [] } = {}) {
    const text = String(query || '').toLowerCase();
    const words = (text.match(/[a-z0-9]{3,}/g) || []).filter(word => !STOP.has(word));
    return this.list()
      .map(tool => ({ tool, score: this.score(tool, words, text) + (recent.includes(tool.name) ? 6 : 0) }))
      .sort((a, b) => b.score - a.score)
      .filter(entry => entry.score > 0)
      .slice(0, max)
      .map(entry => entry.tool);
  }
  async dynamicTools(context) {
    const output = [];
    for (const provider of this.dynamicProviders) {
      try { output.push(...await provider(context)); }
      catch (error) { context.logger?.warn(`dynamic tool provider failed: ${error.message}`); }
    }
    return output;
  }
}

function toSchema(tool) { return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }; }

// Minimal JSON-Schema validation so bad model output yields a useful error instead of a crash.
function validateArgs(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Arguments must be a JSON object.';
  const schema = tool.parameters || {};
  for (const required of schema.required || []) if (args[required] === undefined || args[required] === null || args[required] === '') return `Missing required argument: ${required}.`;
  for (const [key, value] of Object.entries(args)) {
    const type = schema.properties?.[key]?.type;
    if (!type || value === null) continue;
    if (type === 'array' ? !Array.isArray(value) : type === 'integer' || type === 'number' ? Number.isNaN(Number(value)) : type === 'boolean' ? false : type === 'string' ? typeof value === 'object' : false) return `Argument ${key} must be of type ${type}.`;
    const allowed = schema.properties[key].enum;
    if (allowed && !allowed.includes(value)) return `Argument ${key} must be one of: ${allowed.join(', ')}.`;
  }
  return '';
}

// Fallback for models without native tool calling, and for models that print tool calls as text.
function parseTextToolCalls(text, isKnown) {
  const source = String(text || '');
  const calls = [];
  const consider = raw => {
    try {
      const parsed = JSON.parse(raw);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        const name = item?.name || item?.tool || item?.function?.name;
        const args = item?.arguments ?? item?.args ?? item?.parameters ?? item?.function?.arguments ?? {};
        if (typeof name === 'string' && isKnown(name)) calls.push({ id: `text_${calls.length}`, name, args: typeof args === 'string' ? JSON.parse(args || '{}') : args });
      }
    } catch {}
  };
  for (const match of source.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) consider(match[1]);
  if (!calls.length) for (const match of source.matchAll(/```(?:tool|json)?\s*([\[{][\s\S]*?[\]}])\s*```/g)) consider(match[1]);
  if (!calls.length && /^\s*[\[{]/.test(source) && /[\]}]\s*$/.test(source)) consider(source.trim());
  return calls;
}

function textToolInstructions(tools) {
  return `\n\nYou can use these tools. To use one, reply with ONLY a block like:\n\`\`\`tool\n{"name":"tool_name","arguments":{"key":"value"}}\n\`\`\`\nThen wait for the result. When you are finished, answer normally with no tool block.\nTools:\n${tools.map(tool => `- ${tool.name}: ${tool.description} Arguments: ${JSON.stringify(tool.parameters?.properties || {})}`).join('\n')}`;
}

module.exports = { ToolRegistry, toSchema, validateArgs, parseTextToolCalls, textToolInstructions };
