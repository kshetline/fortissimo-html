function restoreWhitespaceStrict(s) {
  return s.replace(/·|[\u2400-\u241F]|\S/g, ch => ch === '·' ? ' ' :
           ch.charCodeAt(0) >= 0x2400 ? String.fromCharCode(ch.charCodeAt(0) - 0x2400) : '');
}

const wsReplacements = {
  '·': ' ',
  '→\t': '\t',
  '↵\n': '\n',
  '␍\r': '\r',
  '␍↵\r\n': '\r\n'
};

function restoreWhitespace(s) {
  return s.replace(/·|→\t|↵\n|␍\r|␍↵\r\n|→|↵|␍|[\u2400-\u241F]/g, ws =>
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
