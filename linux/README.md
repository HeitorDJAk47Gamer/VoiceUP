# VoiceUP 1.2.0 para Linux

Cliente e ServerHost usam a mesma base do Desktop e têm pacotes separados para
Linux x64. O Electron está incluído; não é necessário instalar Node.js.

## Pacotes

- `VoiceUP-1.2.0-linux-x64.AppImage`: Cliente portátil.
- `VoiceUP-1.2.0-linux-x64.deb`: Cliente para Debian/Ubuntu e derivados.
- `VoiceUPServer-1.2.0-linux-x64.AppImage`: ServerHost portátil.
- `VoiceUPServer-1.2.0-linux-x64.deb`: ServerHost para Debian/Ubuntu e derivados.

Use somente os arquivos da Release oficial `v1.2.0`. O site redireciona para
essa Release com base no catálogo assinado, sem duplicar os binários no Cloud.

```bash
chmod +x VoiceUP-1.2.0-linux-x64.AppImage
./VoiceUP-1.2.0-linux-x64.AppImage
```

Sem suporte FUSE, tente `--appimage-extract-and-run`. Para instalar o DEB:

```bash
sudo apt install ./VoiceUP-1.2.0-linux-x64.deb
```

Execute o aplicativo como usuário normal, sem `sudo` e sem `--no-sandbox`.
O atualizador verifica assinatura Ed25519, versão, tamanho e SHA-256 antes de
abrir um pacote. Abrir um novo AppImage não substitui automaticamente o arquivo
antigo ou seus atalhos. O DEB é instalado pelo gerenciador da distribuição.

## Captura e limitações

O áudio isolado da tela/aplicativo não está disponível nesta edição Linux.
Microfone e áudio das lives recebidas permanecem separados. Não há fallback que
capture todo o computador sem consentimento. No Wayland, a escolha de tela/janela
depende do portal PipeWire e pode ser feita na janela do sistema.

Atalhos globais, bandeja, sandbox e dispositivos dependem da distribuição e do
ambiente gráfico. Não há garantia de funcionamento em toda distribuição glibc.
Se necessário, teste XWayland com `--ozone-platform=x11`.

## ServerHost

As configurações, plugins e bancos ficam na pasta de dados do usuário, não
dentro do AppImage ou de `/opt`. A porta padrão é TCP 3000; libere-a no firewall
para acesso de outras máquinas. UPnP/NAT-PMP exige consentimento e suporte do
roteador e não contorna CGNAT. A mídia das chamadas continua P2P.

## Geração e testes

```bash
npm ci
npm run test:linux
npm run dist:linux
npm run dist:linux:server
npm run test:linux-package -- --release
```

Os arquivos ficam em `release-linux/` e `release-linux-server/`. No GitHub Actions,
execute **Publicar VoiceUP**, marque `linux_only` e deixe `publish` desmarcado.
O artefato `linux-x64` contém os quatro pacotes, sem publicar uma Release.

As verificações automatizadas de código e estrutura não substituem teste em
hardware Linux. Permanecem necessários testes de dispositivos de áudio/câmera,
GNOME/KDE Wayland e X11, atalhos, instalação, firewall e redes distintas.
