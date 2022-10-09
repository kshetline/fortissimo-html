/* This file is meant to be stringified and used as ES5-compatible JavaScript. */

// noinspection JSNonASCIINames, NonAsciiCharacters
const wsReplacements: Record<string, string> = {
  '·': ' ',
  '↵\n': '\n',
  '↧\f': '\f',
  '␍\r': '\r',
  '␍↵\r\n': '\r\n',
  '•': '\xA0'
};

export const copyScriptAsIIFE = `(function() {
var wsReplacements = ${JSON.stringify(wsReplacements)};

${restoreWhitespaceStrict.toString()}

${restoreWhitespace.toString()}

(${addCopyListener.toString()})();
})();
`.replace(/cov_\w+\.\w(\[\d+])+\+\+[;,]/g, ''); // Remove code-coverage changes that might get embedded in the code.

export function getCopyScript(prefix = 'fh-'): string {
  return copyScriptAsIIFE.replace("'fh-'", "'" + prefix + "'");
}

function restoreWhitespaceStrict(s: string): string {
  return s.replace(/[^ \n\r\t\f\xA0]/g, function (ch) { return ch === '·' ? ' ' : ch === '•' ? '\xA0' : ''; });
}

function restoreWhitespace(s: string): string {
  return s.replace(/·|↵\n|↧\f|␍\r|␍↵\r\n|•|↵|↧|␍|�/g, function (ws) {
    return wsReplacements[ws] || '';
  });
}

export function addCopyListener(prefix?: string): void {
  prefix = prefix || 'fh-';

  const doc = document.querySelector('.' + prefix + 'html') as HTMLElement;

  if (!doc)
    return;

  doc.addEventListener('copy', function (event) {
    const selection = document.getSelection();
    let newSelection;
    let copied = false;

    if (selection.anchorNode && selection.getRangeAt) {
      try {
        const nodes = selection.getRangeAt(0).cloneContents().childNodes as NodeList;
        const parts = [];

        /* nodes isn't a "real" array - no forEach! */
        for (let i = 0; i < nodes.length; ++i) {
          const node = nodes[i] as any;

          if (node.classList && (node.classList.contains(prefix + 'invalid') ||
              node.classList.contains(prefix + 'whitespace')))
            parts.push(restoreWhitespaceStrict(node.innerText));
          else if (node.localName === 'span')
            parts.push(node.innerText);
          else
            parts.push(node.nodeValue);
        }

        newSelection = parts.join('');
        copied = true;
      }
      catch {}
    }

    if (!copied)
      newSelection = restoreWhitespace(selection.toString());

    event.clipboardData.setData('text/plain', newSelection);
    event.preventDefault();
  });
}
