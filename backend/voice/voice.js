const { execFileSync } = require('child_process');
const { spawnPython, runPythonJson } = require('../core/python');

const LANGUAGE_CODES = { English: 'en-US', French: 'fr-CA', Spanish: 'es-ES', Arabic: 'ar-SA', Urdu: 'ur-PK', German: 'de-DE', Hindi: 'hi-IN', Chinese: 'zh-CN' };

function stopTree(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    else child.kill('SIGTERM');
  } catch { try { child.kill(); } catch {} }
}

function createVoice({ rootDir, getSettings, logger }) {
  let listener = null;
  let speaker = null;
  function stopSpeaking() { if (speaker) stopTree(speaker); speaker = null; }
  function stopListening() { if (listener) stopTree(listener); listener = null; }
  // Tells a held recording that the button was let go, so it stops and transcribes.
  function finishListening() { try { listener?.stdin?.write('finish\n'); } catch {} }
  function listen(send, { hold = false, wait } = {}) {
    stopListening();
    // Talking over Nexus interrupts it, the same as in a real conversation.
    stopSpeaking();
    const { voice, general } = getSettings();
    const args = ['--language', LANGUAGE_CODES[general.language] || 'en-US', '--silence', voice.silenceSeconds];
    if (voice.inputDevice !== '') args.push('--device', voice.inputDevice);
    if (hold) args.push('--hold');
    if (Number(wait) > 0) args.push('--wait', String(Math.min(60, Number(wait))));
    const child = spawnPython(rootDir, process.env.NEXUS_VOICE_SCRIPT || 'voice_app_core.py', args);
    listener = child;
    child.stdin?.on('error', () => {});
    let buffer = '';
    let answered = false;
    const handleLine = line => {
      const text = String(line).trim();
      if (!text) return;
      if (text.startsWith('LEVEL:')) { const level = Number(text.slice(6)); if (Number.isFinite(level)) send('voice-volume-level', Math.min(1, Math.max(0, level))); }
      else if (text.startsWith('STATE:')) send('voice-state', text.slice(6));
      else { answered = true; send('voice-text-result', text); }
    };
    child.stdout.on('data', data => { buffer += String(data); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(handleLine); });
    // Python warnings land on stderr without meaning failure. Treating them as errors used to cancel listening.
    let errorOutput = '';
    child.stderr.on('data', data => { errorOutput = (errorOutput + String(data)).slice(-1000); logger?.debug(`voice stderr: ${data}`); });
    child.on('error', error => { if (listener === child) listener = null; send('voice-text-result', `ERROR: Could not start voice recognition (${error.message}).`); });
    child.on('close', () => {
      // A process stopped on purpose is no longer current, and the page has already reset itself.
      if (listener !== child) return;
      listener = null;
      if (buffer.trim()) handleLine(buffer);
      if (!answered) send('voice-text-result', `ERROR: Voice recognition stopped unexpectedly. ${errorOutput.trim().split(/\r?\n/).at(-1) || ''}`.trim());
    });
  }
  function speak(text, onDone) {
    stopSpeaking();
    const { voice } = getSettings();
    const args = ['--rate', voice.rate];
    if (voice.voiceId) args.push('--voice', voice.voiceId);
    const child = spawnPython(rootDir, 'tts_core.py', args);
    speaker = child;
    const spoken = String(text || '').replace(/```[\s\S]*?```/g, ' code block ').replace(/[*_#`>]/g, '').slice(0, 12000);
    child.stdin.on('error', () => {});
    child.stdin.end(spoken);
    // Hands-free listening waits for this, so Nexus doesn't hear its own voice.
    child.on('close', () => { if (speaker === child) speaker = null; onDone?.(); });
    child.on('error', error => { logger?.error(`TTS could not start: ${error.message}`); if (speaker === child) speaker = null; onDone?.(); });
  }
  const listVoices = () => runPythonJson(rootDir, 'tts_core.py', ['--list-voices'], { timeout: 20000 });
  const listDevices = () => runPythonJson(rootDir, 'voice_app_core.py', ['--list-devices'], { timeout: 20000 });
  return { listen, finishListening, stopListening, speak, stopSpeaking, listVoices, listDevices, stopAll() { stopListening(); stopSpeaking(); } };
}

module.exports = { createVoice };
