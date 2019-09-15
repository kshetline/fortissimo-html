import * as entitiesAsJson from './entities.json';

let entities: Record<string, string> = entitiesAsJson;

if (entities.default)
  entities = entities.default as any as Record<string, string>;

const codePointToEntity: Record<number, string> = {};
const pairsToEntity: Record<string, string> = {};

Object.keys(entities).forEach(entity => {
  const value = entities[entity];
  const cp = value.codePointAt(0);

  if (cp < 0x10000 && value.length === 1 || cp >= 0x10000 && value.length === 2) {
    // Where multiple names exist for the same codepoint, first one found takes priority.
    if (!(cp in codePointToEntity))
      codePointToEntity[cp] = '&' + entity + ';';
  }
  else if (value.length === 2 || !(value in pairsToEntity))
    pairsToEntity[value] = '&' + entity + ';';
});

export function isWhitespace(ch: string): boolean {
  return ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r' || ch === ' ';
}

export function isOtherWhitespace(ch: string): boolean {
  return /\xA0|[\u2000-\u200A]|\u202F|\u205F|\u3000/.test(ch);
}

export function isEol(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === '\r\n';
}

export function isInvalidCharacter(ch: string): boolean {
  return /[\x00-\x08\x0B\x0E-\x1F\x7F-\x9F]/.test(ch);
}

export function replaceIsolatedSurrogates(s: string): string {
  return s && s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|[^\uD800-\uDBFF][\uDC00-\uDFFF]/g,
      ch => ch.length === 1 ? '\x02' : ch.charAt(0) + '\x03');
}

export function isMarkupStart(ch: string) {
  return ch !== undefined && /[a-z\/!?]/i.test(ch);
}

const PCENCharRanges = new RegExp(
  '[\xB7\xC0-\xD6\xD8-\xF6\xF8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F' +
  '\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]'
);

export function isPCENChar(ch: string, loose = false) {
  if (loose)
    return /[^ \n\r\t\f>]/.test(ch);
  if (ch <= 'z')
    return /[-._0-9a-z]/i.test(ch);
  else if (ch.length === 1)
    return PCENCharRanges.test(ch);

  const cp = ch.codePointAt(0);

  return 0x10000 <= cp && cp <= 0xEFFFF;
}

export function isAllPCENChar(s: string): boolean {
  for (let i = 0; i < s.length; ++i) {
    if (!isPCENChar(s.charAt(i)))
      return false;
  }

  return true;
}

export function isAttributeNameChar(ch: string, loose = false): boolean {
  if (loose)
    return /[^ \n\r\t\f>=\/]/.test(ch);
  else
    return ch > ' ' && !/["`>/=]/.test(ch) && (ch < '0x7F' || ch >= '0xA0');
}

const basicEntities: Record<string, string> = {'<': '&lt;', '>': '&gt;', '&': '&amp;'};

export function minimalEscape(s: string): string {
  return s.replace(/[<>&]/g, match => basicEntities[match]);
}

export function unescapeEntities(s: string, forAttributeValue = false): string {
  const sb: string[] = [];

  separateEntities(s).forEach((value, index) => {
    if (index % 2 === 0 || forAttributeValue && !value.endsWith(';'))
      sb.push(value);
    else
      sb.push(resolveEntity(value));
  });

  return sb.join('');
}

export function separateEntities(s: string): string[] {
  return s ? s.split(/(&(?:amp(?:;?)|#\d+(?:;|\b|(?=\D))|#x[0-9a-f]+(?:;|\b|(?=[^0-9a-f]))|[0-9a-z]+(?:;|\b|(?=[^0-9a-z]))))/i) : [s];
}

export function isKnownNamedEntity(entity: string): boolean {
  if (entity.startsWith('&'))
    entity = entity.substr(1);

  if (entity.endsWith(';'))
    entity = entity.substr(0, entity.length - 1);

  return entity in entities;
}

export function resolveEntity(entity: string): string {
  if (entity.startsWith('&'))
    entity = entity.substr(1);

  if (entity.endsWith(';'))
    entity = entity.substr(0, entity.length - 1);

  if (entity.startsWith('#')) {
    let cp: number;

    entity = entity.substr(1);

    if (entity.startsWith('x') || entity.startsWith('X'))
      cp = parseInt(entity.substr(1), 16);
    else
      cp = parseInt(entity, 10);

    if (isNaN(cp) || cp > 0x10FFFF || (0xD800 <= cp && cp <= 0xDFFF))
      return '�';
    else
      return String.fromCodePoint(cp);
  }

  return entities[entity] || '�';
}

export function codepointLength(s: string): number {
  return s ? s.length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length : 0;
}

export function isValidEntityCodepoint(cp: number): boolean {
  return cp > 0 && cp <= 0x10FFFF && cp !== 0x0D && (cp < 0x80 || cp > 0x9F) && (cp < 0xD800 || cp > 0xDFFF);
}
