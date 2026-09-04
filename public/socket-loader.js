(() => {
  const localSource = location.protocol === 'file:'
    ? '../node_modules/socket.io-client/dist/socket.io.min.js'
    : '/socket.io/socket.io.js';

  window.voiceupSocketClientReady = new Promise((resolve, reject) => {
    if (typeof window.io === 'function') {
      resolve(window.io);
      return;
    }

    const script = document.createElement('script');
    script.src = localSource;
    script.async = true;
    script.addEventListener('load', () => {
      if (typeof window.io === 'function') resolve(window.io);
      else reject(new Error('O componente local de conexão não foi encontrado.'));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Não foi possível carregar o componente local de conexão.')), { once: true });
    document.head.append(script);
  });
})();
