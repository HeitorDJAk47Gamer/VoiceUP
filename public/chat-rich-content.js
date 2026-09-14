((scope, factory) => {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (scope) scope.voiceupChatRichContent = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  'use strict';

  const MESSAGE_LIMIT = 500;
  const TEXT_FILE_MAX_CHARACTERS = 30000;
  const TEXT_FILE_MAX_BYTES = 64 * 1024;
  const DEFAULT_TEXT_FILE_NAME = 'mensagem.txt';

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const utf8Size = (value) => {
    const text = String(value ?? '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    if (typeof Buffer === 'function') return Buffer.byteLength(text, 'utf8');
    return encodeURIComponent(text).replace(/%[0-9a-f]{2}|./gi, 'x').length;
  };

  const safeTextFileName = (value) => {
    const withoutPath = String(value || DEFAULT_TEXT_FILE_NAME).split(/[\\/]/).pop() || DEFAULT_TEXT_FILE_NAME;
    const cleaned = withoutPath.replace(/[\u0000-\u001f<>:"|?*]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'mensagem';
    return /\.txt$/i.test(cleaned) ? cleaned : `${cleaned.replace(/\.+$/g, '') || 'mensagem'}.txt`;
  };

  const normalizeTextFile = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const content = String(value.content ?? '').replaceAll('\u0000', '');
    const size = utf8Size(content);
    if (!content.trim() || content.length > TEXT_FILE_MAX_CHARACTERS || size > TEXT_FILE_MAX_BYTES) return null;
    return { name: safeTextFileName(value.name), content, size, type: 'text/plain' };
  };

  const createOutgoingMessage = (value) => {
    const content = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!content) return null;
    if (content.length <= MESSAGE_LIMIT) return { text: content, textFile: null };
    const textFile = normalizeTextFile({ name: DEFAULT_TEXT_FILE_NAME, content });
    if (!textFile) {
      const error = new RangeError('O texto ultrapassa o limite de 30.000 caracteres ou 64 KB.');
      error.code = 'TEXT_FILE_TOO_LARGE';
      throw error;
    }
    return { text: `Arquivo de texto: ${textFile.name}`, textFile };
  };

  const languageAliases = Object.freeze({
    js: 'javascript', jsx: 'javascript', javascript: 'javascript',
    ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
    py: 'python', python: 'python',
    html: 'html', htm: 'html', xml: 'html',
    css: 'css', json: 'json',
    sh: 'shell', bash: 'shell', shell: 'shell', zsh: 'shell',
    ps1: 'powershell', pwsh: 'powershell', powershell: 'powershell',
    java: 'java', kt: 'kotlin', kotlin: 'kotlin',
    c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp',
    cs: 'csharp', 'c#': 'csharp', csharp: 'csharp',
    go: 'go', rs: 'rust', rust: 'rust', sql: 'sql', php: 'php',
    rb: 'ruby', ruby: 'ruby', lua: 'lua', yml: 'yaml', yaml: 'yaml',
    md: 'markdown', markdown: 'markdown', txt: 'text', text: 'text', plaintext: 'text'
  });
  const languageLabels = Object.freeze({
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', html: 'HTML / XML', css: 'CSS', json: 'JSON', shell: 'Shell', powershell: 'PowerShell', java: 'Java', kotlin: 'Kotlin', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust', sql: 'SQL', php: 'PHP', ruby: 'Ruby', lua: 'Lua', yaml: 'YAML', markdown: 'Markdown', text: 'Texto'
  });
  const commonKeywords = new Set(('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield true false null undefined this').split(' '));
  const languageKeywords = Object.freeze({
    python: new Set(('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield').split(' ')),
    shell: new Set(('case do done elif else esac export fi for function if in local readonly then until while').split(' ')),
    powershell: new Set(('begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using while').split(' ')),
    java: new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null').split(' ')),
    kotlin: new Set(('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while').split(' ')),
    c: new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while').split(' ')),
    cpp: new Set(('alignas alignof and asm auto bitand bitor bool break case catch char class const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor').split(' ')),
    csharp: new Set(('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while').split(' ')),
    go: new Set(('break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var true false nil').split(' ')),
    rust: new Set(('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while').split(' ')),
    sql: new Set(('add all alter and any as asc backup between by case check column constraint create database default delete desc distinct drop exec exists foreign from full group having in index inner insert into is join key left like limit not null or order outer primary procedure right rownum select set table top truncate union unique update values view where').split(' ')),
    php: new Set(('abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield true false null').split(' ')),
    ruby: new Set(('alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield').split(' ')),
    lua: new Set(('and break do else elseif end false for function goto if in local nil not or repeat return then true until while').split(' '))
  });

  const normalizeLanguage = (value) => {
    const info = String(value || '').trim().toLowerCase().slice(0, 24);
    return languageAliases[info] || (/^[a-z0-9_+#.-]{1,24}$/i.test(info) ? info : 'text');
  };
  const languageLabel = (value) => {
    const normalized = normalizeLanguage(value);
    return languageLabels[normalized] || normalized.toUpperCase();
  };

  const parseFencedCode = (value) => {
    const source = String(value ?? '');
    const segments = [];
    let cursor = 0;
    while (cursor < source.length) {
      const opening = source.indexOf('```', cursor);
      if (opening < 0) { segments.push({ type: 'text', value: source.slice(cursor) }); break; }
      const closing = source.indexOf('```', opening + 3);
      if (closing < 0) { segments.push({ type: 'text', value: source.slice(cursor) }); break; }
      if (opening > cursor) segments.push({ type: 'text', value: source.slice(cursor, opening) });
      let body = source.slice(opening + 3, closing);
      let language = '';
      const lineEnd = body.search(/\r?\n/);
      if (lineEnd >= 0) {
        const info = body.slice(0, lineEnd).trim();
        const newlineSize = body.slice(lineEnd).startsWith('\r\n') ? 2 : 1;
        if (!info || /^[a-z0-9_+#.-]{1,24}$/i.test(info)) {
          language = info;
          body = body.slice(lineEnd + newlineSize);
        }
      }
      if (body.endsWith('\r\n')) body = body.slice(0, -2);
      else if (body.endsWith('\n')) body = body.slice(0, -1);
      segments.push({ type: 'code', value: body, language: normalizeLanguage(language) });
      cursor = closing + 3;
    }
    return segments.length ? segments : [{ type: 'text', value: source }];
  };

  const highlightCode = (value, language = 'text') => {
    const code = String(value ?? '');
    const normalized = normalizeLanguage(language);
    if (normalized === 'text' || normalized === 'markdown') return escapeHtml(code);
    const keywords = languageKeywords[normalized] || commonKeywords;
    const hashComments = new Set(['python', 'shell', 'powershell', 'ruby', 'yaml']);
    const dashComments = new Set(['sql', 'lua']);
    const result = [];
    let index = 0;
    const token = (kind, raw) => `<span class="code-token ${kind}">${escapeHtml(raw)}</span>`;
    while (index < code.length) {
      if (normalized === 'html' && code.startsWith('<!--', index)) {
        const end = code.indexOf('-->', index + 4); const next = end < 0 ? code.length : end + 3;
        result.push(token('comment', code.slice(index, next))); index = next; continue;
      }
      if (code.startsWith('/*', index)) {
        const end = code.indexOf('*/', index + 2); const next = end < 0 ? code.length : end + 2;
        result.push(token('comment', code.slice(index, next))); index = next; continue;
      }
      const lineComment = hashComments.has(normalized) && code[index] === '#'
        ? '#'
        : dashComments.has(normalized) && code.startsWith('--', index)
          ? '--'
          : !hashComments.has(normalized) && !dashComments.has(normalized) && code.startsWith('//', index)
            ? '//'
            : '';
      if (lineComment) {
        const end = code.indexOf('\n', index + lineComment.length); const next = end < 0 ? code.length : end;
        result.push(token('comment', code.slice(index, next))); index = next; continue;
      }
      if (['"', "'", '`'].includes(code[index])) {
        const quote = code[index]; let next = index + 1;
        while (next < code.length) {
          if (code[next] === '\\') { next += 2; continue; }
          if (code[next] === quote) { next += 1; break; }
          next += 1;
        }
        result.push(token('string', code.slice(index, next))); index = next; continue;
      }
      const number = /^(?:0x[\da-f]+|0b[01]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(code.slice(index));
      if (number) { result.push(token('number', number[0])); index += number[0].length; continue; }
      const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(index));
      if (identifier) {
        const raw = identifier[0];
        const isKeyword = keywords.has(raw) || commonKeywords.has(raw);
        const isLiteral = /^(?:true|false|null|undefined|nil|None|True|False)$/i.test(raw);
        result.push(isKeyword ? token(isLiteral ? 'literal' : 'keyword', raw) : escapeHtml(raw));
        index += raw.length; continue;
      }
      result.push(escapeHtml(code[index])); index += 1;
    }
    return result.join('');
  };

  const renderCodeBlock = ({ value = '', language = 'text' } = {}) => {
    const normalized = normalizeLanguage(language);
    return `<section class="message-code-block" data-code-language="${escapeHtml(normalized)}"><header><span>${escapeHtml(languageLabel(normalized))}</span><button type="button" data-copy-code aria-label="Copiar código" title="Copiar código">Copiar</button></header><pre><code>${highlightCode(value, normalized)}</code></pre></section>`;
  };

  const formatBytes = (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace('.0', '')} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.0', '')} MB`;
  };

  const renderTextFileAttachment = (value) => {
    const textFile = normalizeTextFile(value);
    if (!textFile) return '';
    const previewCharacters = Math.min(textFile.content.length, 1600);
    const remainingBytes = Math.max(0, textFile.size - utf8Size(textFile.content.slice(0, previewCharacters)));
    const remaining = remainingBytes ? `<span class="text-file-remaining">… (${escapeHtml(formatBytes(remainingBytes))} restante(s))</span>` : '';
    return `<section class="message-text-file" data-text-file-name="${escapeHtml(textFile.name)}"><div class="text-file-preview"><pre><code class="text-file-content">${escapeHtml(textFile.content)}</code></pre>${remaining}</div><footer><button type="button" class="text-file-toggle" data-text-file-toggle aria-expanded="false" aria-label="Expandir arquivo" title="Expandir arquivo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button><span class="text-file-meta"><strong>${escapeHtml(textFile.name)}</strong><small>${escapeHtml(formatBytes(textFile.size))}</small></span><span class="text-file-actions"><button type="button" data-text-file-copy aria-label="Copiar texto" title="Copiar texto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/></svg></button><button type="button" data-text-file-download aria-label="Baixar arquivo" title="Baixar arquivo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></svg></button></span></footer></section>`;
  };

  // Uploaded source files use the host's file policy, not the short-message limit.
  // Decode/highlight bounded portions so large files remain usable in the chat.
  const sourceFileLanguage = (name) => {
    const extension = String(name || '').split('.').pop().toLowerCase();
    return languageAliases[extension] || ({ mjs: 'javascript', cjs: 'javascript', pyi: 'python', jsonc: 'json', ini: 'text', toml: 'text', log: 'text', csv: 'text', vue: 'html', svelte: 'html', scss: 'css', bat: 'text' })[extension] || null;
  };
  const sourceFileChunk = (bytes, offset = 0, collapsed = false) => {
    let end = Math.min(bytes.length, offset + (collapsed ? 1600 : 16384));
    while (end < bytes.length && end > offset && (bytes[end] & 0xc0) === 0x80) end--;
    let text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, end));
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw Error('Arquivo não textual.');
    if (collapsed) {
      const lines = [...text.matchAll(/\n/g)];
      if (lines.length >= 8) text = text.slice(0, lines[7].index + 1);
      end = offset + utf8Size(text);
    }
    return { text, next: end, remaining: bytes.length - end };
  };

  return Object.freeze({
    sourceFileLanguage,
    sourceFileChunk,
    MESSAGE_LIMIT,
    TEXT_FILE_MAX_CHARACTERS,
    TEXT_FILE_MAX_BYTES,
    DEFAULT_TEXT_FILE_NAME,
    escapeHtml,
    utf8Size,
    safeTextFileName,
    normalizeTextFile,
    createOutgoingMessage,
    normalizeLanguage,
    languageLabel,
    parseFencedCode,
    highlightCode,
    renderCodeBlock,
    renderTextFileAttachment,
    formatBytes
  });
});
