'use strict';

const STARTUP_ENTRY_NAME = 'VoiceUP';

function startupQuery(executablePath) {
  return { path: String(executablePath || ''), args: [] };
}

function startupUnavailable() {
  return { supported: false, enabled: false };
}

function readWindowsStartup(electronApp, options = {}) {
  const platform = options.platform || process.platform;
  const packaged = options.packaged ?? electronApp?.isPackaged === true;
  const executablePath = options.executablePath || process.execPath;
  if (platform !== 'win32' || !packaged || !electronApp?.getLoginItemSettings) return startupUnavailable();
  try {
    const status = electronApp.getLoginItemSettings(startupQuery(executablePath));
    return { supported: true, enabled: status?.openAtLogin === true };
  } catch (error) {
    return { ...startupUnavailable(), error: String(error?.message || error || 'unavailable').slice(0, 180) };
  }
}

function writeWindowsStartup(electronApp, enabled, options = {}) {
  const platform = options.platform || process.platform;
  const packaged = options.packaged ?? electronApp?.isPackaged === true;
  const executablePath = options.executablePath || process.execPath;
  if (platform !== 'win32' || !packaged || !electronApp?.setLoginItemSettings) return startupUnavailable();
  const nextEnabled = enabled === true;
  try {
    electronApp.setLoginItemSettings({
      ...startupQuery(executablePath),
      name: STARTUP_ENTRY_NAME,
      openAtLogin: nextEnabled,
      enabled: nextEnabled
    });
    return readWindowsStartup(electronApp, { platform, packaged, executablePath });
  } catch (error) {
    const current = readWindowsStartup(electronApp, { platform, packaged, executablePath });
    return { ...current, error: String(error?.message || error || 'unavailable').slice(0, 180) };
  }
}

module.exports = { readWindowsStartup, writeWindowsStartup };
