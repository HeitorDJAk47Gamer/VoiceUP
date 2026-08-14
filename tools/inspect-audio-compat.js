const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9334);
http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
    if (!target) throw new Error('Janela do VoiceUP não encontrada.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.on('open', () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async () => {
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.connect(destination); oscillator.start();
          const rawTrack = destination.stream.getAudioTracks()[0];
          localStream?.getTracks?.().forEach((track) => track.stop());
          localStream = new MediaStream([rawTrack]);
          betaInputVolume = 100; closeMicGain();
          const directTrack = outgoingAudioTrack();
          const participant = { id: 'compat-test', left: false };
          makeHostedConnection(participant);
          const streamCount = participant.audioSender.getStreams?.().length ?? 0;
          const result = {
            directAt100: directTrack === rawTrack,
            senderUsesOriginal: participant.audioSender.track === rawTrack,
            associatedStreams: streamCount,
            audioMLineFirst: participant.pc.getTransceivers()[0]?.receiver?.track?.kind === 'audio'
          };
          participant.left = true; participant.pc.close();
          rawTrack.stop(); oscillator.stop(); await context.close();
          localStream = null;
          return JSON.stringify(result);
        })()`,
        awaitPromise: true,
        returnByValue: true
      }
    })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.id !== 1) return;
      if (message.result?.exceptionDetails) { console.error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text); process.exitCode = 1; }
      else console.log(message.result?.result?.value || '{}');
      socket.close();
    });
  });
}).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
