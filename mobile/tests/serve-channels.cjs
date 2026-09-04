// Local UI regression fixture. Nothing in this directory is bundled in the APK.
// Run after `npm run build`: node tests/serve-channels.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { startSignalingServer } = require('../../signaling-server');

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-mobile-channels-'));
  const host = await startSignalingServer(3181, {
    allowedOrigins: ['http://127.0.0.1:5181'],
    historyFile: path.join(scratch, 'history.json'),
    reportsFile: path.join(scratch, 'reports.json'),
    bansFile: path.join(scratch, 'bans.json'),
    pluginDirectories: [],
    musicDirectory: path.join(scratch, 'music'),
    roomLayouts: [
      { id: 'mobile-test', name: 'Teste Android', voiceChannels: ['Geral', 'Jogando', 'Ausente'], textChannels: ['geral', 'conversa', 'avisos'] },
      {
        id: 'mobile-long', name: 'Muitos canais',
        voiceChannels: Array.from({ length: 24 }, (_, i) => `Voz ${i + 1}`),
        textChannels: Array.from({ length: 24 }, (_, i) => `texto-${i + 1}`)
      }
    ]
  });

  const app = express();
  const dist = path.join(__dirname, '..', 'dist');
  app.get('/', (_request, response) => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    response.type('html').send(html.replace('</head>', '<script src="/__test__/silent-audio.js"></script></head>'));
  });
  app.get('/__test__/silent-audio.js', (_request, response) => {
    // A silent, generated track exercises joining/leaving without microphone
    // permissions or capturing the developer's real microphone.
    response.type('js').send(`
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints.video) throw new Error('Camera is not part of this test fixture.');
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        destination.stream.getAudioTracks()[0].addEventListener('ended', () => context.close(), { once: true });
        await context.resume();
        return destination.stream;
      };
    `);
  });
  app.get('/__test__/members', (_request, response) => response.json(host.members()));
  app.use(express.static(dist));
  const web = app.listen(5181, '127.0.0.1', () => {
    console.log('Mobile UI: http://127.0.0.1:5181/');
    console.log('Server: http://127.0.0.1:3181 | rooms: mobile-test, mobile-long');
  });
  const stop = () => {
    web.close();
    host.io.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
