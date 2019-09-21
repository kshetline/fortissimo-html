import { ClosureState, DomNode, TextElement } from './dom';

export interface HtmlFormatOptions {
  continuationIndent?: number;
  childrenNotIndented?: string[];
  indent?: number;
  inline?: string[];
  removeUnclosedTags?: boolean;
  tabSize?: number;
  useTabCharacters?: boolean;
}

interface InternalOptions {
  continuationIndent?: number;
  childrenNotIndented?: Set<string>;
  indent?: number;
  inline?: Set<string>;
  removeUnclosedTags?: boolean;
  tabSize?: number;
  useTabCharacters?: boolean;
}

const DEFAULT_OPTIONS: InternalOptions = {
  continuationIndent: 4,
  childrenNotIndented: new Set(['html', 'body', 'thead', 'tbody', 'tfoot']),
  indent: 2,
  inline: new Set(['a', 'abbr', 'acronym', 'b', 'basefont', 'bdo', 'big', 'br', 'cite', 'cite', 'code', 'dfn',
                   'em', 'font', 'i', 'img', 'input', 'kbd', 'label', 'q', 's', 'samp', 'select', 'small', 'span',
                   'strike', 'strong', 'sub', 'sup', 'textarea', 'tt', 'u', 'var']),
  removeUnclosedTags: true,
  tabSize: 8,
  useTabCharacters: false
};

export function formatHtml(node: DomNode, options?: HtmlFormatOptions): void {
  const opts = processOptions(options || {});

  removeSyntheticNodes(node);
  formatNode(node, opts, 0);
}

function formatNode(node: DomNode, options: InternalOptions, indent: number): void {
  const children = node.children;

  if (!children)
    return;

  const delta = options.childrenNotIndented.has(node.tagLc) ? 0 : 1;

  for (let i = 0; i < children.length; ++i) {
    const elem = children[i];

    if (!(elem instanceof TextElement)) {
      let prev: TextElement;

      if (i === 0 || !(children[i - 1] instanceof TextElement)) {
        prev = new TextElement('', 0, 0, false);
        children.splice(i++, 0, prev);
      }
      else
        prev = children[i - 1] as TextElement;

      const indentation = ' '.repeat((indent + delta) * 2);
      const $ = /(.*(?:\r\n|\n|\r))[ \t\f]*/s.exec(prev.content);

      prev.content = ($ && $[1] || prev.content + '\n') + indentation;

      if (elem instanceof DomNode)
        formatNode(elem, options, indent + delta);
    }
  }

  if (!options.inline.has(node.tagLc)) {
    let last: TextElement;

    if (children[children.length - 1] instanceof TextElement)
      last = children[children.length - 1] as TextElement;
    else {
      last = new TextElement('', 0, 0, false);
      children.push(last);
    }

    if (node.closureState === ClosureState.EXPLICITLY_CLOSED) {
      const indentation = ' '.repeat(indent * 2);
      const $ = /^(.*(?:\r\n|\n|\r))[ \t\f]*$/s.exec(last.content);

      last.content = ($ && $[1] || last.content + '\n') + indentation;
    }
    else
      last.content = last.content.replace(/(?:\r\n|\n|\r)[ \t\f]*$/, '');
  }
}

function removeSyntheticNodes(node: DomNode): void {
  const children = node.children;

  if (!children)
    return;


  for (let i = 0; i < children.length; ++i) {
    const elem = children[i];

    if (elem instanceof DomNode) {
      let childNode = elem as DomNode;

      while (childNode.synthetic)
        childNode = childNode.children[0] as DomNode;

      children[i] = childNode;
      removeSyntheticNodes(childNode);
    }
  }
}

function processOptions(options: HtmlFormatOptions): InternalOptions {
  const opts = Object.assign({}, DEFAULT_OPTIONS);

  opts.childrenNotIndented = applyTagList(opts.childrenNotIndented, options.childrenNotIndented);
  opts.inline = applyTagList(opts.inline, options.inline);

  return opts;
}

function applyTagList(originalSet: Set<string>, mods: string[]) {
  const updated = new Set(originalSet);

  if (mods) {
    mods.forEach(elem => {
      elem = elem.toLowerCase();

      if (elem.startsWith('-'))
        updated.delete(elem.substr(1));
      else
        updated.add(elem);
    });
  }

  return updated;
}
