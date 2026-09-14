'use strict';

const { contextBridge } = require('electron');
let updateHandler = null;
contextBridge.exposeInMainWorld('voiceupDesktop', {
  onUpdateProgress: (handler) => { updateHandler = handler; }
});
contextBridge.exposeInMainWorld('voiceupUpdateTest', {
  emit: (progress) => updateHandler?.(progress)
});
