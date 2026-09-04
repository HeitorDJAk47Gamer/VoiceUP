const { app, desktopCapturer } = require('electron');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    fetchWindowIcons: false,
    thumbnailSize: { width: 1, height: 1 }
  });
  process.stdout.write(`${JSON.stringify(sources.slice(0, 30).map(({ id, name }) => ({ id, name })), null, 2)}\n`);
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
