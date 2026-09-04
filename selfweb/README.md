# VoiceUP SelfWeb — 1.2.0

Aplicativo web portátil do VoiceUP. Não precisa instalar o Client, Node.js ou
Electron: abra **VoiceUP-SelfWeb.html** no Chrome ou Edge atualizado.
Nenhuma página precisa ser hospedada por nós. JavaScript, estilos, ícone e
Socket.IO estão incluídos no arquivo; o navegador é fornecido pelo usuário.

## Status e plataforma

O globo identifica o SelfWeb. Os outros participantes podem aparecer com o ícone
do Windows, pinguim Linux ou robô Android. Verde = online; laranja = ausente;
vermelho = não perturbe. Clientes antigos sem essa informação mantêm a bolinha.
O mesmo HTML é preparado em `deploy/shardcloud/downloads` para o botão do site;
gerar o arquivo não publica o site nem o Cloud.

## Usar

1. Extraia o ZIP, se recebeu o pacote compactado.
2. Abra `VoiceUP-SelfWeb.html` no navegador (não na prévia de um mensageiro).
3. Escolha seu nick e foto. Informe a URL do Cloud/ServerHost e o código da sala.
4. Entre no servidor, escolha um canal de voz e autorize o microfone para falar.
5. Use o perfil dos participantes para assistir às lives. Câmera, microfone e
   compartilhamento de tela dependem das permissões do navegador.

Para P2P sem ServerHost: A cria um convite; B cola o convite e devolve a resposta;
A cola a resposta e confirma. Os códigos são temporários, não uma sala pública
permanente. Esse modo é para dois participantes; servidores permitem grupos.

Para testar A/B no mesmo computador, use dois navegadores ou um perfil normal e
uma janela privada. Duas abas do mesmo perfil compartilham a mesma identidade;
o servidor pode substituir a sessão anterior de propósito, sem duplicar você.

## Incluído

- Perfil e preferências locais, temas e servidores salvos.
- Canais de texto/voz, membros, estados de mute, presença e ping.
- Chat, menções, respostas, reações, edição/exclusão e fixação conforme o host.
- Voz, câmera e transmissões simultâneas com o mesmo protocolo do Desktop.
- Volumes de voz e live separados, assistir/parar de assistir e tela cheia.
- Redução de ruído do navegador e push-to-talk com a aba em foco.
- Reconexão e compatibilidade com salas de Cloud e ServerHost.

## Limites e privacidade

- Esta é uma beta web, não um instalador. Nada muda no Desktop, APK ou servidor.
- O arquivo não se conecta a uma sala nem ativa dispositivos ao abrir. As
  conexões começam por uma ação do usuário; não há atualizador do Desktop.
- Perfil, identidade e preferências ficam no armazenamento do navegador com
  prefixo próprio. Podem ser perdidos ao limpar dados, usar navegação privada
  ou mover/renomear o HTML. Mantenha uma localização fixa para este arquivo.
  Se o armazenamento for bloqueado, a interface avisa e usa memória da sessão.
- Não há coleta automática de relatórios. Ao enviar um relatório, o destino é
  o servidor informado. Mensagens enviadas ao host seguem sua retenção em disco.
- Mídia externa é carregada sob consentimento (automático somente se ativado).
- Microfone/câmera só são solicitados quando usados. Fechar a aba encerra a
  conexão. O navegador pode suspender áudio/vídeo em segundo plano.
- P2P usa STUN público do Google/Cloudflare para descoberta de rotas. Os
  participantes podem conhecer os IPs uns dos outros. NAT/firewall podem impedir
  a chamada; não incluímos nem prometemos um relay TURN gratuito.
- Tela com áudio depende do navegador/SO. Prefira compartilhar uma aba com áudio.
  Tela inteira pode incluir vozes da call; não existe exclusão de processos aqui.
  O SelfWeb não adiciona o microfone à faixa de áudio da transmissão.
- Não inclui o modelo RNNoise, atalhos globais, bandeja, abertura de portas,
  criação de ServerHost nem captura protegida de áudio do Windows.
- Outros navegadores/celulares podem limitar a captura. Não desative proteções
  do navegador. Use HTTPS para servidores públicos e só aceite servidores
  confiáveis. Acesso a hosts locais pode pedir permissão de rede local.
- Atualização: substitua o HTML pela próxima edição SelfWeb. Não baixe um
  instalador Desktop para atualizar este arquivo.

## Desenvolver e verificar (somente desenvolvedor)

A geração usa os scripts/estilos já presentes em `../public/` e o Socket.IO
instalado no projeto raiz. Não reescreve esses arquivos nem configura releases.

```powershell
cd selfweb
npm run build
npm test
npm run preview
```

O preview é opcional e atende apenas em `127.0.0.1`. Ele não hospeda salas,
não encaminha tráfego e não abre portas do roteador. O usuário final precisa
somente do HTML. `dist/manifest.json` registra versão, tamanho, hashes e fontes.

## Verificação da beta

Há testes automatizados de empacotamento, CSP e isolamento/indisponibilidade do
armazenamento. `npm run test:runtime` usa Chromium com sandbox, sem preload de
Electron, arquivo `file://` e dispositivos simulados. Verifica três clientes,
interoperabilidade com o código Desktop, ServerHost/Cloud locais, chat, voz,
câmeras, lives simultâneas e P2P manual. O arquivo não faz pedidos externos ao
abrir. Consulte `runtime-test-results.json` para os resultados do pacote.

Isso não substitui testar no seu Chrome/Edge com câmera, microfone e captura
reais. Testes entre computadores em redes diferentes, navegadores móveis e
performance de jogos não foram realizados nesta beta. A versão pública Cloud
não é alterada nem usada pelos testes.
