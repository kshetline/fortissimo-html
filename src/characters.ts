import * as entities from './entities.json';

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

export function isPCENChar(ch: string) {
  if (ch <= 'z')
    return /[-._0-9a-z]/i.test(ch);
  else if (ch.length === 1)
    return PCENCharRanges.test(ch);

  const cp = ch.codePointAt(0);

  return 0x10000 <= cp && cp <= 0xEFFFF;
}

export function isAttributeNameChar(ch: string): boolean {
  return ch > ' ' && !/["`>/=]/.test(ch) && (ch < '0x7F' || ch >= '0xA0');
}

export function fixBadChars(s: string): string {
  s = s.replace(/</g, '&lt;');
  s = s.replace(/>/g, '&gt;');

  const parts = s.split('&');

  if (parts.length > 1) {
    s = parts.map((part, index) => {
      if (index > 0) {
        const $ = /^([a-z]+|#\d+|#x[0-9a-f]+)(;?)/i.exec(part);

        if (!$)
          part = 'amp;' + part;
        else if (!$[2])
          part = $[1] + ';' + part.substr($[1].length);
      }

      return part;
    }).join('&');
  }

  return s;
}

const basicEntities: Record<string, string> = {'<': '&lt;', '>': '&gt;', '&': '&amp;'};

export function minimalEscape(s: string): string {
  return s.replace(/[<>&]/g, match => basicEntities[match]);
}

export function isKnownEntity(entity: string): boolean {
  if (entity.startsWith('&'))
    entity = entity.substr(1);

  if (entity.endsWith(';'))
    entity = entity.substr(0, entity.length - 1);

  return entity in entities;
}

export function codepointLength(s: string): number {
  return s ? s.length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length : 0;
}

export function isValidEntityCodepoint(cp: number): boolean {
  return cp > 0 && cp <= 0x10FFFF && cp !== 0x0D && (cp < 0x80 || cp > 0x9F) && (cp < 0xD800 || cp > 0xDFFF);
}
