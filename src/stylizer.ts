import { ClosureState, CommentElement, DeclarationElement, DomElement, DomNode, ProcessingElement, TextElement } from './dom';
import { minimalEscape } from './characters';

export function stylizeAsDocument(elem: DomElement, title?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
  <title>${title || 'Stylized HTML'}</title>
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

    .markup {
      color: #808080;
    }

    .tag {
      color: #569CD6;
    }

    .value {
      color: #CE9178;
    }
  </style>
</head>
<body class="html">
` +
    stylize(elem) +
  `</body>
</html>`;
}

export function stylize(elem: DomElement): string {
  if (elem instanceof CommentElement)
    return enclose(elem.toString(), 'comment');
  else if (elem instanceof DeclarationElement || elem instanceof ProcessingElement)
    return enclose(elem.toString(), 'markup');
  else if (elem instanceof TextElement)
    return minimalEscape(elem.toString());
  else if (elem instanceof DomNode) {
    const result: string[] = [];

    if (!elem.synthetic) {
      result.push(enclose('<', 'markup'));
      result.push(enclose(elem.tag, 'tag'));

      elem.attributes.forEach((attrib, index) => {
        result.push(elem.spacing[index]);
        result.push(enclose(attrib, 'attrib'));
        result.push(elem.equals[index] || '');
        result.push(enclose(elem.quotes[index] + elem.values[index] + elem.quotes[index], 'value'));
      });

      result.push(elem.innerWhitespace);

      if (elem.closureState === ClosureState.SELF_CLOSED)
        result.push(enclose('/>', 'markup'));
      else
        result.push(enclose('>', 'markup'));
    }

    if (elem.children)
      elem.children.forEach(child => result.push(stylize(child)));

    if (!elem.synthetic && elem.closureState === ClosureState.EXPLICITLY_CLOSED) {
      result.push(enclose('</', 'markup'));

      if (elem.endTagText.endsWith('>')) {
        result.push(enclose(elem.endTagText.substring(2, elem.endTagText.length - 1), 'tag'));
        result.push(enclose('>', 'markup'));
      }
      else
        result.push(enclose(elem.endTagText.substr(2), 'tag'));
    }

    return result.join('');
  }

  return null;
}

function enclose(s: string, qlass: string): string {
  s = minimalEscape(s);

  return `<span class="${qlass}">${s}</span>`;
}
