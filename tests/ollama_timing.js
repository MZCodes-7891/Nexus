// Times the local model directly, with and without a tool list. Run: node tests/ollama_timing.js
const tool = name => ({ type: 'function', function: { name, description: 'Example tool with a typical description of moderate length for sizing purposes.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search text' } }, required: ['query'] } } });
async function run(label, body) {
  const started = Date.now();
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: 'qwen2.5', stream: false, messages: [{ role: 'user', content: 'Reply with only the word READY.' }], ...body }), signal: AbortSignal.timeout(280000) });
    const data = await response.json();
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)}s, load ${((data.load_duration || 0) / 1e9).toFixed(1)}s, prompt tokens ${data.prompt_eval_count}, speed ${(data.eval_count / (data.eval_duration / 1e9)).toFixed(1)} tok/s, calls ${data.message?.tool_calls?.length || 0}, reply ${JSON.stringify(data.message?.content || data.error).slice(0, 80)}`);
  } catch (error) { console.log(`${label}: FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${error.message}`); }
}
(async () => {
  await run('default context, no tools', {});
  await run('8192 context, no tools', { options: { num_ctx: 8192 } });
  await run('8192 context, 10 tools', { options: { num_ctx: 8192 }, tools: Array.from({ length: 10 }, (_, index) => tool(`tool_${index}`)) });
  const ps = await (await fetch('http://127.0.0.1:11434/api/ps')).json();
  console.log('loaded:', JSON.stringify((ps.models || []).map(model => ({ name: model.name, size: model.size, vram: model.size_vram, context: model.context_length }))));
})();
