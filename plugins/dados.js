const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#e8b65a"/><path d="M17 20l15-9 15 9v23l-15 10-15-10z" fill="#352914" stroke="#fff3cd" stroke-width="3"/><circle cx="25" cy="26" r="3" fill="#fff3cd"/><circle cx="39" cy="37" r="3" fill="#fff3cd"/><circle cx="25" cy="41" r="3" fill="#fff3cd"/><circle cx="39" cy="22" r="3" fill="#fff3cd"/></svg>').toString('base64')}`;

module.exports = {
  id: 'dados',
  name: 'Dados RPG',
  version: 'beta.2',
  icon: ICON,
  description: 'Rola expressões como d20, 2d6+3 e 4d8 - 1 nas mensagens.',
  settings: [
    { key: 'maxDice', label: 'Máximo de dados', description: 'Limite de dados permitidos em uma única rolagem.', type: 'number', default: 100, min: 1, max: 500 },
    { key: 'maxFaces', label: 'Máximo de faces', description: 'Maior quantidade de faces aceita por dado.', type: 'number', default: 1000, min: 2, max: 100000 }
  ],

  onTextMessage({ text, room, textChannel, user, api, plugin }) {
    const match = String(text).match(/(?:^|\s)(\d{0,3})d(\d{1,5})(?:\s*([+-])\s*(\d{1,5}))?(?=\s|$)/i);
    if (!match) return;
    const dice = Math.max(1, Number(match[1] || 1));
    const faces = Number(match[2]);
    const modifier = match[3] ? (match[3] === '-' ? -1 : 1) * Number(match[4]) : 0;
    if (dice > api.settings.maxDice || faces < 2 || faces > api.settings.maxFaces || Math.abs(modifier) > 10000) return;
    const rolls = Array.from({ length: dice }, () => Math.floor(Math.random() * faces) + 1);
    const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
    const expression = `${dice === 1 ? '' : dice}d${faces}${modifier ? (modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`) : ''}`;
    api.systemMessage(room, textChannel, `🎲 ${user.name} rolou ${expression}: [${rolls.join(', ')}]${modifier ? ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}` : ''} = ${total}`, { name: 'Dados RPG', color: '#e8b65a', avatar: ICON, pluginId: plugin.id });
  }
};
