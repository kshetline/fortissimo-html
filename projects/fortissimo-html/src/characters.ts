import * as entitiesAsJson from './entities.json';

export enum EntityStyle { DECIMAL, HEX, NUMERIC_SHORTEST, NAMED_OR_DECIMAL, NAMED_OR_HEX, NAMED_OR_SHORTEST, SHORTEST }
const ES = EntityStyle;

export enum ReencodeOptions { DONT_CHANGE, REPAIR_ONLY, LOOSE_MINIMAL, MINIMAL, NAMED_ENTITIES }
const RO = ReencodeOptions;

export enum TargetEncoding { SEVEN_BIT, EIGHT_BIT, UNICODE }
const TE = TargetEncoding;

export interface EscapeOptions {
  entityStyle?: EntityStyle;
  reencode?: ReencodeOptions;
  target?: TargetEncoding;
  undoUnneededEntities?: boolean;
}

const DEFAULT_ESCAPE_OPTIONS: EscapeOptions = {
  entityStyle: ES.SHORTEST,
  reencode: RO.MINIMAL,
  target: TE.UNICODE
};

let entities: Record<string, string> = entitiesAsJson;

if (entities.default)
  entities = entities.default as any as Record<string, string>;

const codePointToEntity: Record<number, string> = {};
const pairsToEntity: Record<string, string> = {};

Object.keys(entities).forEach(entity => {
  const value = entities[entity];
  const cp = value.codePointAt(0);

  if (cp < 0x10000 && value.length === 1 || cp >= 0x10000 && value.length === 2) {
    const oldValue = codePointToEntity[cp];
    const newValue = '&' + entity + ';';

    if (!oldValue || newValue.length < oldValue.length || oldValue.charAt(1) < 'a' && newValue.charAt(1) >= 'a')
      codePointToEntity[cp] = newValue;
  }
  else if (value.length === 2)
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

// The following trim functions differ from the standard string functions in that they only operate on HTML whitespace
export function trim(s: string, skipNewlines = false): string {
  if (skipNewlines)
    return (s || '').replace(/(?:^[ \t\f]+)|(?:[ \t\f]+$)/g, '');
  else
    return (s || '').replace(/(?:^[ \t\n\f\r]+)|(?:[ \t\n\f\r]+$)/g, '');
}

export function trimLeft(s: string, skipNewlines = false): string {
  if (skipNewlines)
    return (s || '').replace(/^[ \t\f]+/, '');
  else
    return (s || '').replace(/^[ \t\n\f\r]+/, '');
}

export function trimRight(s: string, skipNewlines = false): string {
  if (skipNewlines)
    return (s || '').replace(/[ \t\f]+$/, '');
  else
    return (s || '').replace(/[ \t\n\f\r]+$/, '');
}

export function compactWhitespace(s: string, skipNewlines = false): string {
  if (skipNewlines)
    return (s || '').replace(/[ \t\f]+/g, ' ');
  else
    return (s || '').replace(/[ \t\n\f\r]+/g, ' ');
}

export function compactNewlines(s: string, maxInARow = 1): string {
  s = s || '';

  const replacement = s.includes('\r\n') ? '\r\n' : (s.includes('\r') ? '\r' : '\n').repeat(maxInARow);
  const regex = new RegExp(`(\r\n|\r|\n){${maxInARow + 1},}`, 'g');

  return s.replace(regex, replacement);
}

export function isInvalidCharacter(ch: string): boolean {
  return /[\x00-\x08\x0B\x0E-\x1F\x7F-\x9F]/.test(ch);
}

export function replaceIsolatedSurrogates(s: string): string {
  return s && s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|[^\uD800-\uDBFF][\uDC00-\uDFFF]/g,
      ch => ch.length === 1 ? '\x02' : ch.charAt(0) + '\x03');
}

// This combines two tests, whether a character is a valid first character of a standard HTML element
// or custom HTML element, or if it's anything else that starts markup (/ ! ?) when it follows <.
export function isMarkupStart(ch: string): boolean {
  return ch !== undefined && /[a-z:/!?]/i.test(ch);
}

const PCENCharRanges = new RegExp(
  '[\xB7\xC0-\xD6\xD8-\xF6\xF8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F' +
  '\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]' // U+10000 - U+EFFFF tested separately
);

// PCEN: Potential Custom Element Name
export function isPCENChar(ch: string, loose = false): boolean {
  if (loose)
    return /[^ \n\r\t\f/>]/.test(ch);
  else if (ch <= 'z')
    return /[-._0-9a-z]/i.test(ch);
  else if (ch.length === 1)
    return PCENCharRanges.test(ch);

  const cp = ch.codePointAt(0);

  return (0x10000 <= cp && cp <= 0xEFFFF);
}

export function isAllPCENChar(s: string, loose = false): boolean {
  for (let i = 0; i < s.length; ++i) {
    let ch = s.charAt(i);

    if (s.codePointAt(i) > 0xFFFF)
      ch += s.charAt(++i);

    if (!isPCENChar(ch, loose))
      return false;
  }

  return true;
}

export function isAttributeNameChar(ch: string, loose = false): boolean {
  if (loose)
    return /[^ \n\r\t\f>/=]/.test(ch);
  else
    return ch > ' ' && !/["`>/=]/.test(ch) && (ch < '0x7F' || ch >= '0xA0');
}

const basicEntities: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;' };

export function minimalEscape(s: string): string {
  return s.replace(/[<>&]/g, match => basicEntities[match]);
}

export function escapeToEntities(s: string, options?: EscapeOptions): string {
  options = Object.assign(Object.assign({}, DEFAULT_ESCAPE_OPTIONS), options || {});

  const sb: string[] = [];
  const style = options.entityStyle;
  const highest = (options.target === TE.SEVEN_BIT ? 0x7E : options.target === TE.EIGHT_BIT ? 0xFF : 0x10FFFF);

  for (let i = 0; i < s.length; ++i) {
    let ch = s.charAt(i);
    const cp = s.codePointAt(i);
    let pairMatch: string;
    let named: string;
    let numeric: string;

    if (cp > 0xFFFF) {
      ch = s.substr(i, 2);
      ++i;
    }

    const nextCh = s.charAt(i + 1) || '';
    const entityNeeded = (
      cp < 32 && !isWhitespace(ch) ||
      (0x7F <= cp && cp <= 0x9F) ||
      cp > highest ||
      options.reencode >= RO.MINIMAL && /[<>&]/.test(ch) ||
      options.reencode === RO.LOOSE_MINIMAL && (ch === '<' && (!nextCh || isMarkupStart(nextCh)) ||
                                                ch === '&' && nextCh && /[a-z0-9#]/i.test(nextCh)));

    if ((entityNeeded || options.reencode === RO.NAMED_ENTITIES) &&
        cp <= 0xFFFF && nextCh && style >= ES.NAMED_OR_DECIMAL)
      named = pairMatch = pairsToEntity[s.substr(i, 2)];

    if (!named && style >= ES.NAMED_OR_DECIMAL && (entityNeeded || options.reencode === RO.NAMED_ENTITIES))
      named = codePointToEntity[cp];

    if (!entityNeeded && named) {
      sb.push(named);

      if (pairMatch)
        ++i;

      continue;
    }

    if ((entityNeeded || (options.reencode === RO.NAMED_ENTITIES && cp >= highest)) && !named && style >= ES.NAMED_OR_DECIMAL)
      named = codePointToEntity[cp];

    if (entityNeeded && (!named || style >= ES.NAMED_OR_SHORTEST)) {
      if (style === ES.DECIMAL || style === ES.NAMED_OR_DECIMAL ||
          (style === ES.NUMERIC_SHORTEST || (!named && style === ES.NAMED_OR_SHORTEST) || style === ES.SHORTEST) && cp <= 9999)
        numeric = '&#' + cp + ';';
      else if (style === ES.HEX || style === ES.NAMED_OR_HEX ||
          (style === ES.NUMERIC_SHORTEST || (!named && style === ES.NAMED_OR_SHORTEST) || style === ES.SHORTEST) && cp > 9999)
        numeric = '&#x' + cp.toString(16).toUpperCase() + ';';
    }

    if (!numeric && named || numeric && named && named.length <= numeric.length) {
      sb.push(named);

      if (pairMatch)
        ++i;
    }
    else if (numeric)
      sb.push(numeric);
    else
      sb.push(ch);
  }

  return sb.join('');
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

export function reencodeEntities(s: string, options: EscapeOptions, forAttributeValue = false): string {
  const sb: string[] = [];

  separateEntities(s).forEach((value, index) => {
    if (index % 2 === 0 || (forAttributeValue && !value.endsWith(';')))
      sb.push(escapeToEntities(value, options));
    else {
      const valid = isValidEntity(value);

      if (valid && !value.endsWith(';'))
        value += ';';

      if (options.reencode !== RO.REPAIR_ONLY && valid) {
        const chars = resolveEntity(value);

        if (options.undoUnneededEntities && !/&(amp|lt|gt|quot|apos);/.test(value) &&
            chars > ' ' && !isOtherWhitespace(chars) &&
            (options.target === TargetEncoding.UNICODE ||
             (options.target === TargetEncoding.EIGHT_BIT && /^[\x00-\xFF]+$/.test(value)) ||
             (options.target === TargetEncoding.SEVEN_BIT && /^[\x00-\x7E]+$/.test(value))))
          value = chars;
        else
          value = escapeToEntities(chars, options);
      }

      sb.push(value);
    }
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

export function isValidEntity(entity: string): boolean {
  if (entity.startsWith('&'))
    entity = entity.substr(1);

  if (entity.endsWith(';'))
    entity = entity.substr(0, entity.length - 1);

  let cp: number;

  if (entity.toLowerCase().startsWith('#x'))
    return !isNaN(cp = parseInt(entity.substr(2), 16)) && isValidEntityCodepoint(cp);

  if (entity.toLowerCase().startsWith('#'))
    return !isNaN(cp = parseInt(entity.substr(1), 10)) && isValidEntityCodepoint(cp);

  return entity in entities;
}

export function resolveEntity(entity: string): string {
  const original = entity;
  let ambiguous = false;

  if (entity.endsWith(';'))
    entity = entity.substr(0, entity.length - 1);
  else
    ambiguous = true;

  if (entity.startsWith('&'))
    entity = entity.substr(1);
  else
    ambiguous = false;

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

  return entities[entity] || (ambiguous ? original : '�');
}

export function columnWidth(s: string): number {
  return s ? s.length -
    // eslint-disable-next-line no-misleading-character-class
    (s.match(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g)
      || []).length : 0;
}

export function isValidEntityCodepoint(cp: number): boolean {
  return cp > 0 && cp <= 0x10FFFF && cp !== 0x0D && (cp < 0x80 || cp > 0x9F) && (cp < 0xD800 || cp > 0xDFFF);
}
