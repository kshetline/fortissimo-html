import { copyScriptAsIIFE } from './copy-script';
import { ClosureState, CData, CommentElement, DeclarationElement, DocType, DomElement, DomNode, ProcessingElement,
  TextElement, UnmatchedClosingTag } from './dom';
import { isWhitespace, minimalEscape } from './characters';
import { NO_ENTITIES_ELEMENTS } from './elements';

type HtmlColor = 'attrib' | 'background' | 'comment' | 'entity' | 'error' | 'foreground' |
                 'markup' | 'tag' | 'value' | 'whitespace';

export interface HtmlStyleOptions {
  colors?: Record<HtmlColor, string>;
  dark?: boolean;
  font?: string;
  includeCopyScript?: boolean;
  showWhitespace?: boolean;
  stylePrefix?: string;
}

const DEFAULT_OPTIONS = {
  dark: true,
  font: '12px Menlo, "Courier New", monospace',
  includeCopyScript: true,
  showWhitespace: false,
  stylePrefix: 'fh'
};

const DEFAULT_DARK_THEME: Record<HtmlColor, string> = {
  attrib: '#9CDCFE',
  background: '#1E1E1E',
  comment: '#699856',
  entity: '#6D9CBE',
  error: '#BC3F3C',
  foreground: '#D4D4D4',
  markup: '#808080',
  tag: '#569CD6',
  value: '#CE9178',
  whitespace: '#605070'
};

const DEFAULT_LIGHT_THEME: Record<HtmlColor, string> = {
  attrib: '#0000FF',
  background: '#FFFFFF',
  comment: '#80B0B0',
  entity: '#0000FF',
  error: '#D40000',
  foreground: '#222222',
  markup: '#808080',
  tag: '#000080',
  value: '#008088',
  whitespace: '#C0D0F0'
};

const COLORS = Object.keys(DEFAULT_LIGHT_THEME);

export function stylizeAsDocument(elem: DomElement, title?: string): string;
// tslint:disable-next-line:unified-signatures
export function stylizeAsDocument(elem: DomElement, options?: HtmlStyleOptions): string;

export function stylizeAsDocument(elem: DomElement, titleOrOptions?: string | HtmlStyleOptions, options?: HtmlStyleOptions): string {
  let title = 'Stylized HTML';

  if (typeof titleOrOptions === 'string')
    title = titleOrOptions;
  else
    options = titleOrOptions;

  options = processOptions(options);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
  <title>${title}</title>
  <style>
${generateCss(options)}  </style>
</head>
<body class="${options.stylePrefix}-html">${stylize(elem, options)}${options.includeCopyScript ?
    '<script>' + copyScriptAsIIFE.replace(/'\*-whitespace'/g, "'" + options.stylePrefix + "-whitespace'") + '</script>'
: ''}</body></html>`;
}

export function stylize(elem: DomElement, options?: HtmlStyleOptions): string {
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
    return s.replace(/&.+?;|.+/g, match => {
      if (match.startsWith('&'))
        return markup(match, markEntities + 'entity', null, null);
      else if (qlass)
        return markup(match, qlass, null, null);
      else
        return minimalEscape(match);
    });
  }

  return `<span class="${qlass}">${minimalEscape(s)}</span>`;
}
