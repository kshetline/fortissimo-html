import { ClosureState, CData, CommentElement, DeclarationElement, DocType, DomElement, DomNode, ProcessingElement,
  TextElement, UnmatchedClosingTag } from './dom';
import { isWhitespace, minimalEscape } from './characters';

export interface HtmlStyleOptions {
  showWhitespace?: boolean;
}

const copyScript = `<script>
function restoreWhitespaceStrict(s) {
  return s.replace(/·|[\\u2400-\\u241F]|\\S/g, ch => ch === '·' ? ' ' :
           ch.charCodeAt(0) >= 0x2400 ? String.fromCharCode(ch.charCodeAt(0) - 0x2400) : '');
}

const wsReplacements = {
  '·': ' ',
  '→\\t': '\\t',
  '↵\\n': '\\n',
  '␍\\r': '\\r',
  '␍↵\\r\\n': '\\r\\n'
}

function restoreWhitespace(s) {
  return s.replace(/·|→\\t|↵\\n|␍\\r|␍↵\\r\\n|→|↵|␍|[\\u2400-\\u241F]/g, ws =>
    wsReplacements[ws] || (ws.charCodeAt(0) >= 0x2400 ? String.fromCharCode(ws.charCodeAt(0) - 0x2400) : ''));
}

document.body.addEventListener('copy', (event) => {
  const selection = document.getSelection();
  let newSelection;
  let copied = false;

  if (selection.anchorNode && selection.getRangeAt) {
    try {
      const nodes = selection.getRangeAt(0).cloneContents().childNodes;
      let parts = [];

      // nodes isn't a "real" array - no forEach!
      for (let i = 0; i < nodes.length; ++i) {
        const node = nodes[i];

        if (node.classList && node.classList.contains('whitespace'))
          parts.push(restoreWhitespaceStrict(node.innerText));
        else if (node.localName === 'span')
          parts.push(node.innerText);
        else
          parts.push(node.nodeValue);
      }

      newSelection = parts.join('');
      copied = true;
    }
    catch (err) {}
  }

  if (!copied)
    newSelection = restoreWhitespace(selection.toString());

  event.clipboardData.setData('text/plain', newSelection);
  event.preventDefault();
});
</script>`;

export function stylizeAsDocument(elem: DomElement, title?: string): string;
// tslint:disable-next-line:unified-signatures
export function stylizeAsDocument(elem: DomElement, options?: HtmlStyleOptions): string;

export function stylizeAsDocument(elem: DomElement, titleOrOptions?: string | HtmlStyleOptions, options?: HtmlStyleOptions): string {
  let title = 'Stylized HTML';

  if (typeof titleOrOptions === 'string')
    title = titleOrOptions;
  else
    options = titleOrOptions;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
  <title>${title}</title>
  <style>
    .html {
      background-color: #1E1E1E;
      color: #D4D4D4;
      font: 12px Menlo, "Courier New", monospace;
      white-space: pre;
    }

    .attrib {
      color: #9CDCFE;
    }

    .comment {
      color: #699856;
    }

    .entity {
      color: #6D9CBE;
    }

    .error {
      color: #BC3F3C;
    }

    .markup {
      color: #808080;
    }

    .tag {
      color: #569CD6;
    }

    .whitespace {
      color: #605070;
    }

    .value {
      color: #CE9178;
    }
  </style>
</head>
<body class="html">` + stylize(elem, options) + copyScript + `</body>
</html>`;
}

export function stylize(elem: DomElement, options?: HtmlStyleOptions): string {
  const showWhitespace = !!(options && options.showWhitespace);

  if (elem instanceof CommentElement)
    return markup(elem.toString(), 'comment', showWhitespace);
  else if (elem instanceof CData) {
    return markup('<![CDATA[', 'markup', false) +
      markup(elem.content, null, showWhitespace) +
      markup(']]>', 'markup', false);
  }
  else if (elem instanceof DocType) {
    return elem.toString().replace(/("[^"]*?"\s*|[^ ">]+\s*|.+)/g, match => {
      if (match.startsWith('"'))
        return markup(match, 'value', showWhitespace);
      else if (/^\w/.test(match))
        return markup(match, 'attrib', showWhitespace);
      else
        return markup(match, 'markup', showWhitespace);
    });
  }
  else if (elem instanceof DeclarationElement || elem instanceof ProcessingElement)
    return markup(elem.toString(), 'markup', showWhitespace);
  else if (elem instanceof TextElement)
    return markup(elem.toString(), null, showWhitespace);
  else if (elem instanceof UnmatchedClosingTag)
    return markup(elem.toString(), 'error', showWhitespace);
  else if (elem instanceof DomNode) {
    const result: string[] = [];

    if (!elem.synthetic) {
      result.push(markup('<', 'markup', false));
      result.push(markup(elem.tag, 'tag', false));

      elem.attributes.forEach((attrib, index) => {
        result.push(markup(elem.spacing[index], null, showWhitespace));
        result.push(markup(attrib, 'attrib', false));
        result.push(markup(elem.equals[index] || '', null, showWhitespace));
        result.push(markup(elem.quotes[index] + elem.values[index] + elem.quotes[index], 'value', showWhitespace));
      });

      result.push(markup(elem.innerWhitespace, null, showWhitespace));

      if (elem.closureState === ClosureState.SELF_CLOSED)
        result.push(markup('/>', 'markup', false));
      else
        result.push(markup('>', 'markup', false));
    }

    if (elem.children)
      elem.children.forEach(child => result.push(stylize(child, options)));

    if (!elem.synthetic && elem.closureState === ClosureState.EXPLICITLY_CLOSED) {
      const terminated = elem.endTagText.endsWith('>');

      result.push(markup('</', terminated ? 'markup' : 'error', false));

      if (terminated) {
        result.push(markup(elem.endTagText.substring(2, elem.endTagText.length - 1), 'tag', showWhitespace));
        result.push(markup('>', 'markup', false));
      }
      else
        result.push(markup(elem.endTagText.substr(2), 'error', false));
    }

    return result.join('');
  }

  return null;
}

const whitespaces: Record<string, string> = {
  ' ': '·',
  '\t': '→\t',
  '\n': '↵\n',
  '\r': '␍\r',
  '\r\n': '␍↵\r\n'
};

function markup(s: string, qlass: string, separateWhitespace: boolean): string {
  if (!separateWhitespace && !qlass)
    return minimalEscape(s);
  else if (separateWhitespace) {
    return s.replace(/\s+|\S+/g, match => {
      if (isWhitespace(match.charAt(0))) {
        match = match.replace(/\r\n|./gs, ch => whitespaces[ch] || String.fromCharCode(0x2400 + ch.charCodeAt(0)));

        return markup(match, 'whitespace', false);
      }
      else if (qlass)
        return markup(match, qlass, false);
      else
        return minimalEscape(match);
    });
  }

  return `<span class="${qlass}">${minimalEscape(s)}</span>`;
}
