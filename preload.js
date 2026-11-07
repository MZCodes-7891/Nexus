const { contextBridge, ipcRenderer } = require('electron');

// The page gets no Node access. It can only use these message channels, which main.js validates.
const ALLOWED = /^(composio|tasks|memory|school|study|computer-mode|documents|browser|apps|agent|settings|system|calendar|reminders|research|automations|voice|conversations|notifications|ollama|ai|dashboard|shell|nav|setup|hub|web|smarthome|sections|section)[:-]|^(open-external-url|start-voice-recognition|finish-voice-recognition|stop-voice-recognition|speak-response|stop-speaking|voice-volume-level|voice-text-result)$/;
function check(channel) { if (!ALLOWED.test(String(channel))) throw new Error(`Blocked channel: ${channel}`); }

contextBridge.exposeInMainWorld('nexusBridge', {
  invoke: (channel, ...args) => { check(channel); return ipcRenderer.invoke(channel, ...args); },
  send: (channel, ...args) => { check(channel); ipcRenderer.send(channel, ...args); },
  on: (channel, listener) => {
    check(channel);
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});
