import { ClosureState, DomElement, DomNode, TextElement } from './dom';
import { columnWidth } from './characters';

export interface HtmlFormatOptions {
  alignAttributes?: boolean;
  continuationIndent?: number;
  childrenNotIndented?: string[];
  dontBreakIfInline?: string[];
  indent?: number;
  inline?: string[];
  keepWhitespaceInside?: string[];
  removeUnclosedTags?: boolean;
  tabSize?: number;
  useTabCharacters?: boolean;
}

interface InternalOptions {
  alignAttributes: boolean;
  continuationIndent: number;
  childrenNotIndented: Set<string>;
  dontBreakIfInline: Set<string>;
  indent: number;
  inline: Set<string>;
  keepWhitespaceInside: Set<string>;
  removeUnclosedTags: boolean;
  tabSize: number;
  useTabCharacters?: boolean;
}

const DEFAULT_OPTIONS: InternalOptions = {
  alignAttributes: true,
  continuationIndent: 4,
  childrenNotIndented: new Set(['/', 'html', 'body', 'thead', 'tbody', 'tfoot']),
  dontBreakIfInline: new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'title']),
  indent: 2,
  inline: new Set(['a', 'abbr', 'acronym', 'b', 'basefont', 'bdo', 'big', 'br', 'cite', 'cite', 'code', 'dfn',
                   'em', 'font', 'i', 'img', 'input', 'kbd', 'label', 'q', 's', 'samp', 'select', 'small', 'span',
                   'strike', 'strong', 'sub', 'sup', 'tt', 'u', 'var']),
  keepWhitespaceInside: new Set(['pre', 'script', 'span', 'style', 'textarea']),
  removeUnclosedTags: true,
  tabSize: 8,
  useTabCharacters: true
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
  const keepWhitespaceInside = options.keepWhitespaceInside.has(node.tagLc);
  let firstIndented = false;

  if (!keepWhitespaceInside && !options.inline.has(node.tagLc)) {
    for (let i = 0; i < children.length; ++i) {
      const elem = children[i];

      if (elem instanceof TextElement && (i === 0 ||
          children[i - 1] instanceof DomNode && options.inline.has((children[i - 1] as DomNode).tagLc)))
        elem.content = (elem.content || '').trim();
    }
  }

  for (let i = 0; i < children.length; ++i) {
    const elem = children[i];

    if (!(elem instanceof TextElement)) {
      if (elem instanceof DomNode)
        formatAttributes(elem, indent + delta, options);

      if (!keepWhitespaceInside && (i !== 1 || !firstIndented)) {
        let prev: TextElement;

        if (i === 0 || !(children[i - 1] instanceof TextElement)) {
          prev = new TextElement('', 0, 0, false);
          children.splice(i++, 0, prev);
        }
        else
          prev = children[i - 1] as TextElement;

        applyIndentation(prev, indent + delta, options);
      }

      if (elem instanceof DomNode)
        formatNode(elem, options, indent + delta);
    }
    else if (!keepWhitespaceInside && i === 0 &&
             !options.dontBreakIfInline.has(elem.parent.tagLc) && /[\r\n]/.test(elem.content || '')) {
      applyIndentation(elem, indent + delta, options);
      firstIndented = true;
    }
  }

  if (!options.inline.has(node.tagLc)) {
    let last: TextElement;

    if (children[children.length - 1] instanceof TextElement) {
      last = children[children.length - 1] as TextElement;

      if (!/(?:\r\n|\n|\r)[ \t\f]*/.test(last.content))
        return;
    }
    else {
      last = new TextElement('', 0, 0, false);
      children.push(last);
    }

    if (!keepWhitespaceInside && node.closureState === ClosureState.EXPLICITLY_CLOSED) {
      const indentation = tabify(' '.repeat(indent * 2), options);
      const $ = /^(.*(?:\r\n|\n|\r))[ \t\f]*$/s.exec(last.content);

      last.content = ($ && $[1] || last.content + '\n') + indentation;
    }
    else
      last.content = last.content.replace(/(?:\r\n|\n|\r)[ \t\f]*$/, '');
  }
}

function applyIndentation(elem: DomElement, indent: number, options: InternalOptions): void {
  const indentation = tabify(' '.repeat(indent * 2), options);
  const $ = /(.*(?:\r\n|\n|\r))[ \t\f]*/s.exec(elem.content);

  elem.content = ($ && $[1] || elem.content + '\n') + indentation;
}

function formatAttributes(node: DomNode, indent: number, options: InternalOptions): void {
  for (let i = 0; i < node.attributes.length; ++i) {
    node.equals[i] = node.equals[i].trim();

    const value = node.values[i];

    if (/^[\da-z-._]+$/.test(value))
      node.quotes[i] = '';
    else if (value && !/"/.test(value))
      node.quotes[i] = '"';

    let spacing = node.spacing[i];

    if (/[\r\n]/.test(spacing)) {
      const extraIndent = options.alignAttributes ? columnWidth(node.tag) + 2
        : options.continuationIndent;

      spacing = spacing.replace(/[^\r\n]/g, '') + ' '.repeat(indent * 2 + extraIndent);
    }
    else
      spacing = ' ';

    node.spacing[i] = tabify(spacing, options);
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

  Object.keys(options).forEach(option => {
    if (option in DEFAULT_OPTIONS && typeof (DEFAULT_OPTIONS as any)[option] === typeof (options as any)[option])
      (opts as any)[option] = (options as any)[option];
  });

  opts.childrenNotIndented = applyTagList(opts.childrenNotIndented, options.childrenNotIndented);
  opts.dontBreakIfInline = applyTagList(opts.dontBreakIfInline, options.dontBreakIfInline);
  opts.inline = applyTagList(opts.inline, options.inline);
  opts.keepWhitespaceInside = applyTagList(opts.keepWhitespaceInside, options.keepWhitespaceInside);

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

function tabify(s: string, options: InternalOptions): string {
  if (options.useTabCharacters)
    s = s.replace(/(^|[\r\n]+)( +)/g, (match, $1, $2) => {
      return $1 + '\t'.repeat(Math.floor($2.length / options.tabSize)) + ' '.repeat($2.length % options.tabSize);
    });

  return s;
}
