import { ClosureState, DomElement, DomNode, TextElement } from './dom';
import { columnWidth } from './characters';

export interface HtmlFormatOptions {
  alignAttributes?: boolean;
  continuationIndent?: number;
  childrenNotIndented?: string[];
  dontBreakIfInline?: string[];
  endDocumentWithNewline?: boolean;
  indent?: number;
  inline?: string[];
  keepWhitespaceInside?: string[];
  newLineBefore?: string[];
  removeNewLineBefore?: string[];
  removeUnclosedTags?: boolean;
  tabSize?: number;
  trimDocument?: boolean;
  useTabCharacters?: boolean;
}

interface InternalOptions {
  alignAttributes: boolean;
  continuationIndent: number;
  childrenNotIndented: Set<string>;
  dontBreakIfInline: Set<string>;
  endDocumentWithNewline: boolean;
  eol: string;
  indent: number;
  inline: Set<string>;
  keepWhitespaceInside: Set<string>;
  lastText: TextElement;
  newLineBefore: Set<string>;
  removeNewLineBefore: Set<string>;
  removeUnclosedTags: boolean;
  tabSize: number;
  trimDocument: boolean;
  useTabCharacters?: boolean;
}

const DEFAULT_OPTIONS: InternalOptions = {
  alignAttributes: true,
  continuationIndent: 8,
  childrenNotIndented: new Set(['/', 'html', 'body', 'thead', 'tbody', 'tfoot']),
  dontBreakIfInline: new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'title']),
  endDocumentWithNewline: true,
  eol: null,
  indent: 4,
  inline: new Set(['a', 'abbr', 'acronym', 'b', 'basefont', 'bdo', 'big', 'br', 'cite', 'cite', 'code', 'dfn',
                   'em', 'font', 'i', 'img', 'input', 'kbd', 'label', 'q', 's', 'samp', 'select', 'small', 'span',
                   'strike', 'strong', 'sub', 'sup', 'tt', 'u', 'var']),
  keepWhitespaceInside: new Set(['/', 'pre', 'span', 'textarea']),
  lastText: null,
  newLineBefore: new Set(['body', 'div', 'form', 'h1', 'h2', 'h3', 'p']),
  removeNewLineBefore: new Set(['br']),
  removeUnclosedTags: true,
  tabSize: 8,
  trimDocument: true,
  useTabCharacters: true
};

export function formatHtml(node: DomNode, options?: HtmlFormatOptions): void {
  const opts = processOptions(options || {});

  removeSyntheticNodes(node);
  findInlineContent(node, opts);

  if (!opts.eol)
    opts.eol = '\n';

  if (opts.trimDocument && node.children && node.children.length > 0) {
    if (node.children[0] instanceof TextElement)
      node.children[0].content = (node.children[0].content || '').replace(/^\s+/, '');

    const last = node.children.length - 1;

    if (node.children[last] instanceof TextElement)
      node.children[last].content = (node.children[last].content || '').replace(/\s+$/, '');
  }

  if (opts.endDocumentWithNewline) {
    if (!node.children)
      node.children = [];

    if (node.children.length === 0 || !(node.children[node.children.length - 1] instanceof TextElement))
      node.children.push(new TextElement(opts.eol, 0, 0, false));
    else {
      const text = node.children[node.children.length - 1] as TextElement;

      text.content = text.content.replace(/\s*$/, opts.eol);
    }
  }

  formatNode(node, opts, 0);
}

function formatNode(node: DomNode, options: InternalOptions, indent: number): void {
  const children = node.children;

  if (!children)
    return;

  const delta = options.childrenNotIndented.has(node.tagLc) ? 0 : 1;
  const keepWhitespaceInside = options.keepWhitespaceInside.has(node.tagLc);
  const specialText = (node.tagLc === 'script' || node.tagLc === 'style');

  let pre_indented = -2;

  for (let i = 0; i < children.length; ++i) {
    const elem = children[i];

    if (elem instanceof DomNode) {
      formatAttributes(elem, indent + delta, options);

      if (/[\r\n][ \t\f]*>/.test(elem.endTagText || '')) {
        const $ = /(.*)[\r\n][ \t\f]*>/s.exec(elem.endTagText);

        elem.endTagText = $[1] + options.eol + tabify(' '.repeat((indent + delta) * options.indent), options) + '>';
        pre_indented = i;
      }

      if (options.lastText && options.removeNewLineBefore.has(elem.tagLc))
        options.lastText.content = options.lastText.content.replace(/\s+$/, '');
      else if ((options.newLineBefore.has(elem.tagLc) || !node.contentInline) && pre_indented !== i - 1) {
        if (!options.lastText) {
          options.lastText = new TextElement('', 0, 0, false);
          children.splice(i++, 0, options.lastText);
        }

        applyIndentation(options.lastText, indent + delta, options);
      }

      const saveLastText = options.lastText;

      options.lastText = null;
      formatNode(elem, options, indent + delta);

      if (!elem.children)
        options.lastText = null;
      else if (!options.lastText)
        options.lastText = saveLastText;
    }
    else if (elem instanceof TextElement)
      options.lastText = elem;
    else {
      if (options.lastText && /[\r\n]/.test(options.lastText.content))
        applyIndentation(options.lastText, indent + delta, options);

      options.lastText = null;
    }
  }

  if (specialText || !node.contentInline && !keepWhitespaceInside) {
    if (!options.lastText) {
      options.lastText = new TextElement('', 0, 0, false);
      children.push(options.lastText);
    }

    if (node.closureState === ClosureState.EXPLICITLY_CLOSED) {
      const indentation = tabify(' '.repeat(indent * options.indent), options);
      const $ = /^(.*(?:\r\n|\n|\r))[ \t\f]*$/s.exec(options.lastText.content);

      options.lastText.content = ($ && $[1] || options.lastText.content + options.eol) + indentation;
    }
    else
      options.lastText.content = options.lastText.content.replace(/(?:\r\n|\n|\r)[ \t\f]*$/, '');
  }

  if (node.closureState !== ClosureState.IMPLICITLY_CLOSED)
    options.lastText = null;
}

function applyIndentation(elem: DomElement, indent: number, options: InternalOptions): void {
  const indentation = tabify(' '.repeat(indent * options.indent), options);
  const $ = /(.*(?:\r\n|\n|\r))[ \t\f]*/s.exec(elem.content);

  elem.content = ($ && $[1] || elem.content + options.eol) + indentation;
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

      spacing = spacing.replace(/[^\r\n]/g, '') + ' '.repeat(indent * options.indent + extraIndent);
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

function findInlineContent(node: DomNode, options: InternalOptions): void {
  const children = node.children;

  if (!children || children.length === 0) {
    node.contentInline = options.inline.has(node.tagLc);
    return;
  }

  node.contentInline = !options.keepWhitespaceInside.has(node.tagLc);

  for (const child of children) {
    if (child instanceof DomNode) {
      findInlineContent(child, options);
      node.contentInline = node.contentInline && child.contentInline && options.inline.has(child.tagLc) &&
        !options.newLineBefore.has(child.tagLc);
    }
    else if (!options.eol && child instanceof TextElement) {
      if (child.content.includes('\r\n'))
        options.eol = '\r\n';
      else if (child.content.includes('\r'))
        options.eol = '\r';
      else if (child.content.includes('\n'))
        options.eol = '\n';
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
  opts.keepWhitespaceInside = applyTagList(opts.keepWhitespaceInside, options.keepWhitespaceInside);
  opts.newLineBefore = applyTagList(opts.newLineBefore, options.newLineBefore);
  opts.removeNewLineBefore = applyTagList(opts.removeNewLineBefore, options.removeNewLineBefore);

  return opts;
}

function applyTagList(originalSet: Set<string>, mods: string[]) {
  const updated = new Set(originalSet);

  if (mods) {
    mods.forEach((elem, index) => {
      elem = elem.toLowerCase();

      if (index === 0 && elem === '-*')
        updated.clear();
      else if (elem.startsWith('-'))
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
