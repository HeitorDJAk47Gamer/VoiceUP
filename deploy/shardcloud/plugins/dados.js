const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#e8b65a"/><path d="M17 20l15-9 15 9v23l-15 10-15-10z" fill="#352914" stroke="#fff3cd" stroke-width="3"/><circle cx="25" cy="26" r="3" fill="#fff3cd"/><circle cx="39" cy="37" r="3" fill="#fff3cd"/><circle cx="25" cy="41" r="3" fill="#fff3cd"/><circle cx="39" cy="22" r="3" fill="#fff3cd"/></svg>').toString('base64')}`;

// A expressão precisa começar com um dado. Depois dele, aceita outros dados
// ou números, ligados por + ou -. Exemplos: d20, 2d6 + d20, 4d8 - 1 + d4.
const expressionPattern = /(?:^|\s)((?:\d{0,3}d\d{1,5})(?:\s*[+-]\s*(?:(?:\d{0,3}d\d{1,5})|\d{1,5}))*)(?=\s|$)/i;

function parseExpression(expression) {
  const terms = [];
  const token = /\s*([+-]?)\s*(?:(\d{0,3})d(\d{1,5})|(\d{1,5}))/iy;
  let cursor = 0;
  while (cursor < expression.length) {
    token.lastIndex = cursor;
    const match = token.exec(expression);
    if (!match) return [];
    const sign = match[1] === '-' ? -1 : 1;
    if (match[4]) terms.push({ sign, constant: Number(match[4]) });
    else terms.push({ sign, dice: Math.max(1, Number(match[2] || 1)), faces: Number(match[3]) });
    cursor = token.lastIndex;
  }
  return terms;
}

function describeTerm(term, index) {
  const prefix = index === 0 ? (term.sign < 0 ? '-' : '') : (term.sign < 0 ? ' - ' : ' + ');
  if (term.constant !== undefined) return `${prefix}${term.constant}`;
  const notation = `${term.dice === 1 ? '' : term.dice}d${term.faces}`;
  return `${prefix}${notation} [${term.rolls.join(', ')}]`;
}

module.exports = {
  id: 'dados',
  name: 'Dados RPG',
  version: 'beta.3',
  icon: ICON,
  description: 'Rola equações como d20, 2d6 + d20 e 4d8 - 1 diretamente no chat.',
  settings: [
    { key: 'maxDice', label: 'Máximo de dados', description: 'Limite de dados somados em uma única equação.', type: 'number', default: 100, min: 1, max: 500 },
    { key: 'maxFaces', label: 'Máximo de faces', description: 'Maior quantidade de faces aceita por dado.', type: 'number', default: 1000, min: 2, max: 100000 },
    { key: 'maxConstant', label: 'Máximo de modificador', description: 'Maior número fixo aceito após + ou - na equação.', type: 'number', default: 10000, min: 0, max: 1000000 }
  ],

  onTextMessage({ text, room, textChannel, user, api, plugin }) {
    const match = String(text).match(expressionPattern);
    if (!match) return;
    const expression = match[1];
    const terms = parseExpression(expression);
    if (!terms.length || !terms.some((term) => term.dice)) return;

    const totalDice = terms.reduce((sum, term) => sum + (term.dice || 0), 0);
    const invalidDice = terms.some((term) => term.dice && (term.faces < 2 || term.faces > api.settings.maxFaces));
    const invalidConstant = terms.some((term) => term.constant !== undefined && term.constant > api.settings.maxConstant);
    if (totalDice > api.settings.maxDice || invalidDice || invalidConstant) return;

    let total = 0;
    for (const term of terms) {
      if (term.constant !== undefined) { total += term.sign * term.constant; continue; }
      term.rolls = Array.from({ length: term.dice }, () => Math.floor(Math.random() * term.faces) + 1);
      term.value = term.rolls.reduce((sum, value) => sum + value, 0);
      total += term.sign * term.value;
    }

    const details = terms.map(describeTerm).join('');
    api.systemMessage(room, textChannel, `🎲 ${user.name} rolou ${expression}: ${details} = ${total}`, { name: 'Dados RPG', color: '#e8b65a', avatar: ICON, pluginId: plugin.id });
  }
};
