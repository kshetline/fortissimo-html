import { copyScriptAsIIFE } from './copy-script';
import { ClosureState, CData, CommentElement, DeclarationElement, DocType, DomElement, DomNode, ProcessingElement,
  TextElement, UnmatchedClosingTag } from './dom';
import { isKnownEntity, isWhitespace, minimalEscape } from './characters';
import { NO_ENTITIES_ELEMENTS } from './elements';

type HtmlColor = 'attrib' | 'background' | 'comment' | 'entity' | 'error' | 'foreground' |
                 'markup' | 'tag' | 'value' | 'warning' | 'whitespace';

export interface HtmlStyleOptions {
  colors?: Record<HtmlColor, string>;
  dark?: boolean;
  font?: string;
  includeCopyScript?: boolean;
  outerTag?: 'html' | 'body' | 'div';
  showWhitespace?: boolean;
  stylePrefix?: string;
  title?: string;
}

const DEFAULT_OPTIONS = {
  dark: true,
  font: '12px Menlo, "Courier New", monospace',
  includeCopyScript: true,
  outerTag: 'html',
  showWhitespace: false,
  stylePrefix: 'fh',
  title: 'Stylized HTML'
};

const DEFAULT_DARK_THEME: Record<HtmlColor, string> = {
  attrib: '#9CDCFE',
  background: '#1E1E1E',
  comment: '#699856',
  entity: '#66BBBB',
  error: '#CC4444',
  foreground: '#D4D4D4',
  markup: '#808080',
  tag: '#569CD6',
  value: '#CE9178',
  warning: '#F49810',
  whitespace: '#605070'
};

const DEFAULT_LIGHT_THEME: Record<HtmlColor, string> = {
  attrib: '#5544FF',
  background: '#FFFFFF',
  comment: '#80B0B0',
  entity: '#0088DD',
  error: '#D40000',
  foreground: '#222222',
  markup: '#808080',
  tag: '#000080',
  value: '#008088',
  warning: '#F49810',
  whitespace: '#C0D0F0'
};

const COLORS = Object.keys(DEFAULT_LIGHT_THEME);

export function stylizeHtml(elem: DomElement, options?: HtmlStyleOptions): string {
  options = processOptions(options);

  const fullDocument = (options.outerTag === 'html');
  const tag = fullDocument ? 'body' : options.outerTag;

  return (fullDocument ? `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
  <title>${options.title}</title>
  <style>
${generateCss(options)}  </style>
</head>
` : '') +
`<${tag} class="${options.stylePrefix}-html">${stylize(elem, options)}${options.includeCopyScript ?
    '<script>' + copyScriptAsIIFE.replace(/'(\.?)\*-(html|whitespace)'/g,
      "'$1" + options.stylePrefix + "-$2'") + '</script>'
: ''}</${tag}>` + (fullDocument ? '</html>' : '');
}

function stylize(elem: DomElement, options?: HtmlStyleOptions): string {
  const pf = options.stylePrefix + '-';
  const ws = options.showWhitespace ? pf : null;

  if (elem instanceof CommentElement)
    return markup(elem.toString(), pf + 'comment', ws, null);
  else if (elem instanceof CData) {
    return markup('<![CDATA[', pf + 'markup', null, null) +
      markup(elem.content, null, ws, null) +
      markup(']]>', pf + 'markup', null, null);
  }
  else if (elem instanceof DocType) {
    return elem.toString().replace(/("[^"]*?"\s*|[^ ">]+\s*|.+)/g, match => {
      if (match.startsWith('"'))
        return markup(match, pf + 'value', ws, null);
      else if (/^\w/.test(match))
        return markup(match, pf + 'attrib', ws, null);
      else
        return markup(match, pf + 'markup', ws, null);
    });
  }
  else if (elem instanceof DeclarationElement || elem instanceof ProcessingElement)
    return markup(elem.toString(), pf + 'markup', ws, null);
  else if (elem instanceof TextElement)
    return markup(elem.toString(), null, ws, elem.parent && NO_ENTITIES_ELEMENTS.has(elem.parent.tagLc) ? null : pf);
  else if (elem instanceof UnmatchedClosingTag)
    return markup(elem.toString(), pf + 'error', ws, null);
  else if (elem instanceof DomNode) {
    const result: string[] = [];

    if (!elem.synthetic) {
      result.push(markup('<', pf + 'markup', null, null));
      result.push(markup(elem.tag, pf + 'tag', null, null));

      elem.attributes.forEach((attrib, index) => {
        result.push(markup(elem.spacing[index], null, ws, null));
        result.push(markup(attrib, pf + 'attrib', null, null));
        result.push(markup(elem.equals[index] || '', null, ws, null));
        result.push(markup(elem.quotes[index] + elem.values[index] + elem.quotes[index], pf + 'value', ws, pf));
      });

      result.push(markup(elem.innerWhitespace, null, ws, null));

      if (elem.closureState === ClosureState.SELF_CLOSED)
        result.push(markup('/>', pf + 'markup', null, null));
      else
        result.push(markup('>', pf + 'markup', null, null));
    }

    if (elem.children)
      elem.children.forEach(child => result.push(stylize(child, options)));

    if (!elem.synthetic && elem.closureState === ClosureState.EXPLICITLY_CLOSED) {
      const terminated = elem.endTagText.endsWith('>');

      result.push(markup('</', pf + (terminated ? 'markup' : 'error'), null, null));

      if (terminated) {
        result.push(markup(elem.endTagText.substring(2, elem.endTagText.length - 1), pf + 'tag', ws, null));
        result.push(markup('>', pf + 'markup', null, null));
      }
      else
        result.push(markup(elem.endTagText.substr(2), pf + 'error', null, null));
    }

    return result.join('');
  }

  return null;
}

function processOptions(options: HtmlStyleOptions): HtmlStyleOptions {
  options = Object.assign(Object.assign({}, DEFAULT_OPTIONS), options || {});
  options.colors = Object.assign(Object.assign({},
    options.dark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME), options.colors);

  return options;
}

function generateCss(options: HtmlStyleOptions) {
  const prefix = options.stylePrefix;

  let css =
`  .${prefix}-html {
    background-color: ${options.colors.background};
    color: ${options.colors.foreground};
    font: ${options.font};
    white-space: pre;
  }

`;

  COLORS.forEach(color => css +=
`  .${prefix}-${color} { color: ${(options.colors as any)[color]}; }
`);

  return css;
}

const whitespaces: Record<string, string> = {
  ' ': '·',
  '\t': '→\t',
  '\n': '↵\n',
  '\r': '␍\r',
  '\r\n': '␍↵\r\n'
};

function markup(s: string, qlass: string, separateWhitespace: string, markEntities: string): string {
  if (!separateWhitespace && !qlass && !markEntities)
    return minimalEscape(s);
  else if (separateWhitespace) {
    return s.replace(/\s+|\S+/g, match => {
      if (isWhitespace(match.charAt(0))) {
        match = match.replace(/\r\n|./gs, ch => whitespaces[ch] || String.fromCharCode(0x2400 + ch.charCodeAt(0)));

        return markup(match, separateWhitespace + 'whitespace', null, null);
      }
      else if (qlass || markEntities)
        return markup(match, qlass, null, markEntities);
      else
        return minimalEscape(match);
    });
  }
  else if (markEntities) {
    const sb: string[] = [];

    while (s) {
      const $ = /(?:&(?:amp(?:;?)|#\d+(?:;|\b|(?=\D))|#x[0-9a-f]+(?:;|\b|(?=[^0-9a-f]))|[0-9a-z]+(?:;|\b|(?=[^0-9a-z]))))/i.exec(s);

      if ($) {
        const eClass = getEntityClass($[0], s.charAt($.index + $[0].length), qlass && qlass.endsWith('value'));

        if ($.length > 0)
          sb.push(markup(s.substr(0, $.index), qlass, null, null));

        sb.push(markup($[0], markEntities + eClass, null, null));

        s = s.substr($.index + $[0].length);
      }
      else {
        sb.push(markup(s, qlass, null, null));
        break;
      }
    }

    return sb.join('');
  }

  return `<span class="${qlass}">${minimalEscape(s)}</span>`;
}

function getEntityClass(entity: string, nextChar: string, forAttribValue: boolean): string {
  entity = entity.substr(1);

  if (entity.endsWith(';')) {
    let cp: number;

    entity = entity.substr(0, entity.length - 1);

    if (entity.toLowerCase().startsWith('#x'))
      return isNaN(cp = parseInt(entity.substr(2), 16)) || cp > 0x10FFFF ? 'error' : 'entity';

    if (entity.toLowerCase().startsWith('#'))
      return isNaN(cp = parseInt(entity.substr(1), 10)) || cp > 0x10FFFF ? 'error' : 'entity';

    return isKnownEntity(entity) ? 'entity' : 'warning';
  }
  else if (forAttribValue)
    return 'value';
  else
    return 'warning';
}
