/* This file is meant to be stringified and used as ES5-compatible JavaScript. */

// tslint:disable prefer-const
// tslint:disable no-var-keyword
const wsReplacements: Record<string, string> = {
  '·': ' ',
  '→\t': '\t',
  '↵\n': '\n',
  '␍\r': '\r',
  '␍↵\r\n': '\r\n'
};

export const copyScriptAsIIFE = `(function() {
var wsReplacements = ${JSON.stringify(wsReplacements)};

${restoreWhitespaceStrict.toString()}

${restoreWhitespace.toString()}

(${addListener.toString()})();
})();
`;

function restoreWhitespaceStrict(s: string) {
  return s.replace(/·|[\u2400-\u241F]|\S/g, ch => ch === '·' ? ' ' :
           ch.charCodeAt(0) >= 0x2400 ? String.fromCharCode(ch.charCodeAt(0) - 0x2400) : '');
}

function restoreWhitespace(s: string) {
  return s.replace(/·|→\t|↵\n|␍\r|␍↵\r\n|→|↵|␍|[\u2400-\u241F]/g, ws =>
    wsReplacements[ws] || (ws.charCodeAt(0) >= 0x2400 ? String.fromCharCode(ws.charCodeAt(0) - 0x2400) : ''));
}

function addListener() {
  document.body.addEventListener('copy', (event) => {
    var selection = document.getSelection();
    var newSelection;
    var copied = false;

    if (selection.anchorNode && selection.getRangeAt) {
      try {
        var nodes = selection.getRangeAt(0).cloneContents().childNodes as NodeList;
        var parts = [];

        // nodes isn't a "real" array - no forEach!
        for (var i = 0; i < nodes.length; ++i) {
          var node = nodes[i] as any;

          if (node.classList && node.classList.contains('*-whitespace'))
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
}
