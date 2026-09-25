// preload.js — the only bridge between the UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assistant', {
  i18n: {
    data: () => ipcRenderer.invoke('i18n:data'),
  },
  models: () => ipcRenderer.invoke('chat:models'),
  send: (chatInput, model, sessionId, history) =>
    ipcRenderer.invoke('chat:send', { chatInput, model, sessionId, history }),
  onChunk: (cb) =>
    ipcRenderer.on('chat:chunk', (_e, p) => cb(p)),
  stop: () => ipcRenderer.invoke('chat:stop'),
  shutdownAll: () => ipcRenderer.invoke('app:shutdown-all'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s),
  },
  clipboard: {
    history: () => ipcRenderer.invoke('clipboard:history'),
    set: (text) => ipcRenderer.invoke('clipboard:set', text),
    clear: () => ipcRenderer.invoke('clipboard:clear'),
    onNew: (cb) => ipcRenderer.on('clipboard:new', (_e, text) => cb(text)),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
  },
  logs: {
    errors: (n) => ipcRenderer.invoke('logs:errors', n),
    tail: (n) => ipcRenderer.invoke('logs:tail', n),
  },
  status: () => ipcRenderer.invoke('status:check'),
  studio: {
    status: () => ipcRenderer.invoke('studio:status'),
    connect: () => ipcRenderer.invoke('studio:connect'),
  },
  memory: {
    get: () => ipcRenderer.invoke('memory:get'),
    set: (text) => ipcRenderer.invoke('memory:set', text),
  },
  tts: {
    edge: (text) => ipcRenderer.invoke('tts:edge', { text }),
    piper: (text) => ipcRenderer.invoke('tts:piper', { text }),
    status: () => ipcRenderer.invoke('tts:status'),
    onPiperProgress: (cb) => ipcRenderer.on('tts:piper-progress', (_e, msg) => cb(msg)),
    onPlay: (cb) => ipcRenderer.on('tts:play', (_e, p) => cb(p)),
  },
  reminders: {
    onFire: (cb) => ipcRenderer.on('reminder:fire', (_e, p) => cb(p)),
  },
  morning: {
    onBriefing: (cb) => ipcRenderer.on('morning:briefing', (_e, p) => cb(p)),
  },
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    cover: (artist, track) => ipcRenderer.invoke('spotify:cover', artist, track),
    control: (action) => ipcRenderer.invoke('spotify:control', action),
    seek: (seconds) => ipcRenderer.invoke('spotify:seek', seconds),
    connect: () => ipcRenderer.invoke('spotify:connect'),
    onRefresh: (cb) => ipcRenderer.on('spotify:refresh', () => cb()),
  },
  focus: {
    start: (p) => ipcRenderer.invoke('focus:start', p),
    control: (action) => ipcRenderer.invoke('focus:control', action),
    heartbeat: () => ipcRenderer.invoke('focus:heartbeat'),
  },
  evolution: {
    stats: () => ipcRenderer.invoke('evolution:stats'),
    suggest: () => ipcRenderer.invoke('evolution:suggest'),
    skills: () => ipcRenderer.invoke('evolution:skills'),
  },
  files: {
    pick: () => ipcRenderer.invoke('file:pick'),
    readPath: (filePath) => ipcRenderer.invoke('file:readPath', filePath),
    fromClipboard: () => ipcRenderer.invoke('clipboard:files'),
  },
  workspace: {
    pick: (sessionId) => ipcRenderer.invoke('workspace:pick', sessionId),
    release: (sessionId) => ipcRenderer.invoke('workspace:release', sessionId),
    get: (sessionId) => ipcRenderer.invoke('workspace:get', sessionId),
    listAll: () => ipcRenderer.invoke('workspace:list-all'),
    list: (sessionId, rel) => ipcRenderer.invoke('workspace:list', sessionId, rel),
    read: (sessionId, rel) => ipcRenderer.invoke('workspace:read', sessionId, rel),
    write: (sessionId, rel, content, append) => ipcRenderer.invoke('workspace:write', sessionId, rel, content, append),
  },
  log: (msg) => ipcRenderer.send('renderer:log', msg),
  projects: {
    scan: () => ipcRenderer.invoke('projects:scan'),
    get: (name) => ipcRenderer.invoke('projects:get', name),
    setNotes: (name, notes) => ipcRenderer.invoke('projects:setNotes', name, notes),
    setGithub: (name, url) => ipcRenderer.invoke('projects:setGithub', name, url),
    search: (name, query) => ipcRenderer.invoke('projects:search', name, query),
  },
  github: {
    list: () => ipcRenderer.invoke('github:list'),
    status: (name) => ipcRenderer.invoke('github:status', name),
    diff: (name) => ipcRenderer.invoke('github:diff', name),
    config: () => ipcRenderer.invoke('github:config'),
  },
  task: {
    create: (desc, model) => ipcRenderer.invoke('task:create', desc, model),
    active: () => ipcRenderer.invoke('task:active'),
    completeStep: (stepId) => ipcRenderer.invoke('task:completeStep', stepId),
    startStep: (stepId) => ipcRenderer.invoke('task:startStep', stepId),
    cancel: () => ipcRenderer.invoke('task:cancel'),
    onUpdate: (cb) => ipcRenderer.on('task:update', (_e, task) => cb(task)),
  },
  services: {
    status: () => ipcRenderer.invoke('services:status'),
  },
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
  },
  connections: {
    status: () => ipcRenderer.invoke('connections:status'),
    test: (name) => ipcRenderer.invoke('connections:test', { name }),
    saveDeepseek: (apiKey, model) => ipcRenderer.invoke('connections:saveDeepseek', { apiKey, model }),
    saveGithub: (token) => ipcRenderer.invoke('connections:saveGithub', { token }),
    saveSpotify: (clientId) => ipcRenderer.invoke('connections:saveSpotify', { clientId }),
    connectSpotify: () => ipcRenderer.invoke('connections:connectSpotify'),
    saveGoogle: (clientId, clientSecret) => ipcRenderer.invoke('connections:saveGoogle', { clientId, clientSecret }),
    connectGoogle: () => ipcRenderer.invoke('connections:connectGoogle'),
  },
  data: {
    export: () => ipcRenderer.invoke('data:export'),
    reset: () => ipcRenderer.invoke('data:reset'),
  },
  appReload: () => ipcRenderer.invoke('app:reload'),
  updates: {
    version: () => ipcRenderer.invoke('app:version'),
    check: () => ipcRenderer.invoke('app:checkUpdates'),
    open: (url) => ipcRenderer.invoke('app:openExternal', url),
    onAvailable: (cb) => ipcRenderer.on('update:available', (_e, u) => cb(u)),
  },
  code: {
    writeFile: (path, content) => ipcRenderer.invoke('code:writeFile', { path, content }),
  },
  autowrite: {
    set: (v) => ipcRenderer.invoke('autowrite:set', v),
    get: () => ipcRenderer.invoke('autowrite:get'),
  },
  feedback: {
    record: (msg, resp, rating, cat) => ipcRenderer.invoke('feedback:record', msg, resp, rating, cat),
    stats: () => ipcRenderer.invoke('feedback:stats'),
  },
  personalization: {
    getProfile: () => ipcRenderer.invoke('personalization:getProfile'),
    updateProfile: (updates) => ipcRenderer.invoke('personalization:updateProfile', updates),
    getRoutineInsights: () => ipcRenderer.invoke('personalization:getRoutineInsights'),
    getProactiveSuggestion: () => ipcRenderer.invoke('personalization:getProactiveSuggestion'),
    recordActivity: (type, data) => ipcRenderer.invoke('personalization:recordActivity', type, data),
    learnFromFeedback: (userMsg, assistantResp, rating) => ipcRenderer.invoke('personalization:learnFromFeedback', userMsg, assistantResp, rating),
  },
  testRunner: {
    run: (options) => ipcRenderer.invoke('testRunner:run', options),
    coverage: (options) => ipcRenderer.invoke('testRunner:coverage', options),
    watch: (options) => ipcRenderer.invoke('testRunner:watch', options),
    getConfig: (options) => ipcRenderer.invoke('testRunner:getConfig', options),
    prePushGate: (options) => ipcRenderer.invoke('testRunner:prePushGate', options),
  },
  pet: {
    onEvent: (cb) => ipcRenderer.on('pet:event', (_e, state) => cb(state)),
  },
  tool: {
    onProgress: (cb) => ipcRenderer.on('tool:progress', (_e, p) => cb(p)),
  },
  approval: {
    onRequest: (cb) => ipcRenderer.on('approval:request', (_e, p) => cb(p)),
    respond: (id, approved) => ipcRenderer.invoke('approval:respond', id, approved),
  },
});
