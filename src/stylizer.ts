import { getCopyScript } from './copy-script';
import {
  ClosureState, CData, CommentElement, DeclarationElement, DocType, DomElement, DomNode, ProcessingElement,
  TextElement, UnmatchedClosingTag, OQ, CQ
} from './dom';
import { isAllPCENChar, isKnownNamedEntity, isValidEntityCodepoint, minimalEscape, replaceIsolatedSurrogates, separateEntities } from './characters';
import { NO_ENTITIES_ELEMENTS } from './elements';

type HtmlColor = 'attrib' | 'background' | 'bg_whitespace' | 'comment' | 'entity' | 'error' | 'foreground' |
                 'invalid' | 'markup' | 'tag' | 'value' | 'warning' | 'whitespace';

export interface HtmlStyleOptions {
  colors?: Record<HtmlColor, string>;
  dark?: boolean;
  font?: string;
  includeCopyScript?: boolean;
  outerTag?: 'html' | 'body' | 'div';
  showWhitespace?: boolean;
  stylePrefix?: string;
  tabSize?: number;
  title?: string;
}

const DEFAULT_OPTIONS = {
  dark: true,
  font: '12px Menlo, "Courier New", monospace',
  includeCopyScript: true,
  outerTag: 'html',
  showWhitespace: false,
  stylePrefix: 'fh-',
  tabSize: 8,
  title: 'Stylized HTML'
};

const DEFAULT_DARK_THEME: Record<HtmlColor, string> = {
  attrib: '#9CDCFE',
  background: '#1E1E1E',
  bg_whitespace: '#555555',
  comment: '#699856',
  entity: '#66BBBB',
  error: '#CC4444',
  foreground: '#D4D4D4',
  invalid: '#FF00FF',
  markup: '#808080',
  tag: '#569CD6',
  value: '#CE9178',
  warning: '#F49810',
  whitespace: '#605070'
};

const DEFAULT_LIGHT_THEME: Record<HtmlColor, string> = {
  attrib: '#5544FF',
  background: '#FFFFFF',
  bg_whitespace: '#CCCCCC',
  comment: '#80B0B0',
  entity: '#0088DD',
  error: '#D40000',
  foreground: '#222222',
  invalid: '#FF00FF',
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
`<${tag} class="${options.stylePrefix}html">${stylize(elem, options)}${options.includeCopyScript ?
  '<script>' + getCopyScript(options.stylePrefix) + '</script>'
  : ''}</${tag}>` + (fullDocument ? '</html>' : '');
}

function stylize(elem: DomElement, options?: HtmlStyleOptions): string {
  const pf = options.stylePrefix;
  const ws = options.showWhitespace;

  if (elem instanceof CommentElement)
    return markup(elem.toString(), pf, 'comment', ws, false);
  else if (elem instanceof CData) {
    return markup('<![CDATA[', pf, 'markup', false, false) +
      markup(elem.content, pf, null, ws, false) +
      markup(']]>', pf, 'markup', false, false);
  }
  else if (elem instanceof DocType) {
    return elem.toString().replace(/("[^"]*?"[ \n\r\t\f]*|[^ ">]+[ \n\r\t\f]*|.+)/g, match => {
      if (match.startsWith('"'))
        return markup(match, pf, 'value', ws, false);
      else if (/^\w/.test(match))
        return markup(match, pf, 'attrib', ws, false);
      else
        return markup(match, pf, 'markup', ws, false);
    });
  }
  else if (elem instanceof DeclarationElement || elem instanceof ProcessingElement)
    return markup(elem.toString(), pf, 'markup', ws, false);
  else if (elem instanceof TextElement)
    return markup(elem.toString(), pf, null, ws, !elem.parent || !NO_ENTITIES_ELEMENTS.has(elem.parent.tagLc));
  else if (elem instanceof UnmatchedClosingTag)
    return markup(elem.toString(), pf, 'error', ws, false);
  else if (elem instanceof DomNode) {
    const result: string[] = [];
    const badTerminator = elem.badTerminator;
    let tagClass = 'tag';

    if (!elem.synthetic) {
      if (!isAllPCENChar(elem.tag))
        tagClass = 'warning';

      result.push(markup('<', pf, badTerminator !== null ? 'error' : 'markup', false, false));
      result.push(markup(elem.tag, pf, badTerminator ? 'error' : tagClass, false, false));

      elem.attributes.forEach((attrib, index) => {
        result.push(markup(elem.spacing[index], pf, null, ws, false));
        result.push(markup(attrib, pf, attrib === '/' ? 'error' : 'attrib', false, false));
        result.push(markup(elem.equals[index] || '', pf, null, ws, false));

        const quote = elem.quotes[index];
        const value = OQ(quote) + elem.values[index] + CQ(quote);

        if (!quote && /["'<=>`]/.test(value))
          result.push(markup(value, pf, 'warning', false, false));
        else
          result.push(markup(value, pf, 'value', ws, true));
      });

      result.push(markup(elem.innerWhitespace, pf, null, ws, false));

      if (badTerminator !== null)
        result.push(markup(badTerminator, pf, 'error', false, false));
      else if (elem.closureState === ClosureState.SELF_CLOSED)
        result.push(markup('/>', pf, 'markup', false, false));
      else
        result.push(markup('>', pf, 'markup', false, false));
    }

    if (elem.children)
      elem.children.forEach(child => result.push(stylize(child, options)));

    if (!elem.synthetic && elem.closureState === ClosureState.EXPLICITLY_CLOSED) {
      const terminated = elem.endTagText.endsWith('>');

      result.push(markup('</', pf, terminated ? 'markup' : 'error', false, false));

      if (terminated) {
        result.push(markup(elem.endTagText.substring(2, elem.endTagText.length - 1), pf, tagClass, ws, false));
        result.push(markup('>', pf, 'markup', false, false));
      }
      else
        result.push(markup(elem.endTagText.substr(2), pf, 'error', false, false));
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
`  .${prefix}html {
    background-color: ${options.colors.background};
    color: ${options.colors.foreground};
    font: ${options.font};
    -moz-tab-size: ${options.tabSize};
    tab-size: ${options.tabSize};
    white-space: pre;
  }

  .${prefix}tab {
    color: ${options.colors.whitespace};
  }

  .${prefix}tab::before {
    content: "→";
    display: inline-block;
    overflow-x: visible;
    width: 0;
  }

`;

  COLORS.forEach(color => {
    const property = color.startsWith('bg_') ? 'background-color' : 'color';
    const value = (options.colors as any)[color];

    css += `  .${prefix}${color} { ${property}: ${value}; }\n`;
  });

  return css;
}

const whitespaces: Record<string, string> = {
  ' ': '·',
  '\t': '\t',
  '\n': '↵\n',
  '\f': '↧\f',
  '\r': '␍\r',
  '\r\n': '␍↵\r\n',
  '\xA0': '•'
};

function markup(s: string, prefix: string, qlass: string, markWhitespace: boolean, markEntities: boolean,
                checkInvalid = true): string {
  if (!s)
    return '';
  else if (!qlass && !markWhitespace && !markEntities && !checkInvalid)
    return minimalEscape(s);
  else if (markWhitespace) {
    return s.split(/([ \n\r\f\xA0]+|\t)/).map((match, index) => {
      if (index % 2 === 1) {
        match = match.replace(/\r\n|\n|\r|./g, ch => whitespaces[ch]);

        return markup(match, prefix, match === '\t' ? 'tab' : 'whitespace', false, false, false);
      }
      else if (match) {
        return match.split(/([\u2000-\u200A]|\u202F|\u205F|\u3000)/).map((match2, index2) => {
          if (index2 % 2 === 1)
            return markup(match2, prefix, 'bg_whitespace', false, false, false);
          else
            return markup(match2, prefix, qlass, false, markEntities, checkInvalid);
        }).join('');
      }
      else
        return '';
    }).join('');
  }
  else if (checkInvalid) {
    s = replaceIsolatedSurrogates(s);

    return s.split(/([\x00-\x08\x0B\x0E-\x1F\x7F-\x9F\uFFFD]+)/).map((match, index) => {
      if (index % 2 === 1)
        return markup('�'.repeat(match.length), prefix, 'invalid', false, false, false);
      else {
        return markup(match, prefix, qlass, false, markEntities, false);
      }
    }).join('');
  }
  else if (markEntities) {
    const sb: string[] = [];

    separateEntities(s).forEach((part, index) => {
      if (index % 2 === 0)
        sb.push(markup(part, prefix, qlass, false, false, false));
      else {
        const eClass = getEntityClass(part, qlass && qlass.endsWith('value'));
        sb.push(markup(part, prefix, eClass, false, false, false));
      }
    });

    return sb.join('');
  }

  return `<span class="${prefix}${qlass}">${minimalEscape(s)}</span>`;
}

function getEntityClass(entity: string, forAttribValue: boolean): string {
  let bestCase = 'entity';

  entity = entity.substr(1);

  if (!entity.endsWith(';')) {
    if (forAttribValue)
      return 'value';
    else
      bestCase = 'warning';
  }
  else
    entity = entity.substr(0, entity.length - 1);

  let cp: number;

  if (entity.toLowerCase().startsWith('#x'))
    return isNaN(cp = parseInt(entity.substr(2), 16)) ||
      !isValidEntityCodepoint(cp) ? 'error' : (cp === 0xFFFD ? 'invalid' : bestCase);

  if (entity.toLowerCase().startsWith('#'))
    return isNaN(cp = parseInt(entity.substr(1), 10)) ||
      !isValidEntityCodepoint(cp) ? 'error' : (cp === 0xFFFD ? 'invalid' : bestCase);

  return isKnownNamedEntity(entity) ? 'entity' : 'warning';
}
