import { CData, ClosureState, DomElement, DomNode, isCommentLike, TextElement } from './dom';
import {
  columnWidth, compactNewlines, compactWhitespace, EntityStyle, EscapeOptions, escapeToEntities, reencodeEntities,
  ReencodeOptions, TargetEncoding, trimLeft, trimRight
} from './characters';

export enum ValueQuoting {
  LEAVE_AS_IS,
  ALWAYS_QUOTE,
  UNQUOTE_INTEGERS,
  UNQUOTE_SIMPLE_VALUES
}

const SIMPLE_VALUE = /^[-\da-z._]+$/i;

export enum ValueQuoteStyle {
  PREFER_DOUBLE,
  PREFER_SINGLE,
  DOUBLE,
  SINGLE
}

export interface HtmlFormatOptions extends EscapeOptions {
  alignAttributes?: boolean;
  continuationIndent?: number;
  childrenNotIndented?: string[];
  dontBreakIfInline?: string[];
  endDocumentWithNewline?: boolean;
  indent?: number;
  inline?: string[];
  instantiateSyntheticNodes?: boolean;
  keepWhitespaceInside?: string[];
  maxBlankLines?: number;
  newLineBefore?: string[];
  normalizeAttributeSpacing?: boolean;
  removeNewLineBefore?: string[];
  removeUnclosedTags?: boolean;
  spaceAroundAttributeEquals?: boolean;
  tabSize?: number;
  trimDocument?: boolean;
  undoUnneededEntities?: boolean;
  useTabCharacters?: boolean;
  valueQuoting?: ValueQuoting;
  valueQuoteStyle?: ValueQuoteStyle;
}

interface InternalOptions {
  alignAttributes: boolean;
  continuationIndent: number;
  childrenNotIndented: Set<string>;
  dontBreakIfInline: Set<string>;
  endDocumentWithNewline: boolean;
  eol: string;
  escapeOptions: EscapeOptions;
  indent: number;
  inline: Set<string>;
  instantiateSyntheticNodes: boolean;
  keepWhitespaceInside: Set<string>;
  lastText: TextElement;
  maxBlankLines: number;
  newLineBefore: Set<string>;
  normalizeAttributeSpacing: boolean;
  removeNewLineBefore: Set<string>;
  removeUnclosedTags: boolean;
  spaceAroundAttributeEquals: boolean;
  tabSize: number;
  trimDocument: boolean;
  useTabCharacters?: boolean;
  valueQuoting?: ValueQuoting;
  valueQuoteStyle?: ValueQuoteStyle;
}

const DEFAULT_OPTIONS: InternalOptions = {
  alignAttributes: true,
  continuationIndent: 8,
  childrenNotIndented: new Set(['/', 'html', 'body', 'thead', 'tbody', 'tfoot']),
  dontBreakIfInline: new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'title']),
  endDocumentWithNewline: true,
  eol: null,
  escapeOptions: {
    entityStyle: EntityStyle.SHORTEST,
    reencode: ReencodeOptions.DONT_CHANGE,
    target: TargetEncoding.UNICODE,
    undoUnneededEntities: false
  },
  indent: 4,
  inline: new Set(['a', 'abbr', 'acronym', 'b', 'basefont', 'bdo', 'big', 'br', 'cite', 'cite', 'code', 'dfn',
                   'em', 'font', 'i', 'img', 'input', 'kbd', 'label', 'q', 's', 'samp', 'select', 'small', 'span',
                   'strike', 'strong', 'sub', 'sup', 'text', 'tt', 'u', 'var']),
  instantiateSyntheticNodes: false,
  keepWhitespaceInside: new Set(['pre', 'textarea']),
  lastText: null,
  maxBlankLines: 1,
  newLineBefore: new Set(['body', 'div', 'form', 'h1', 'h2', 'h3', 'p']),
  normalizeAttributeSpacing: true,
  removeNewLineBefore: new Set(['br']),
  removeUnclosedTags: true,
  spaceAroundAttributeEquals: false,
  tabSize: 8,
  trimDocument: true,
  useTabCharacters: true,
  valueQuoting: ValueQuoting.ALWAYS_QUOTE,
  valueQuoteStyle: ValueQuoteStyle.PREFER_DOUBLE,
};

export function formatHtml(node: DomNode, options?: HtmlFormatOptions): void {
  const opts = processOptions(options || {});

  if (!opts.eol)
    opts.eol = '\n';

  if (opts.instantiateSyntheticNodes)
    instantiateSyntheticNodes(node);
  else
    removeSyntheticNodes(node);

  if (opts.indent > 0) {
    opts.lastText = null;
    preprocessWhitespace(node, opts);
  }

  if (opts.indent > 0 && (opts.indent === 1 || opts.trimDocument) && node.children && node.children.length > 0) {
    if (node.children[0] instanceof TextElement)
      node.children[0].content = trimLeft(node.children[0].content);

    const last = node.children.length - 1;

    if (node.children[last] instanceof TextElement)
      node.children[last].content = trimRight(node.children[last].content);
  }

  if (opts.indent > 1 && opts.endDocumentWithNewline) {
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
  const keepWhitespaceInside = options.keepWhitespaceInside.has(node.tagLc) || node.tagLc === '/';
  const specialText = (node.tagLc === 'script' || node.tagLc === 'style');

  let pre_indented = -2;

  for (let i = 0; i < children.length; ++i) {
    const elem = children[i];

    if (elem instanceof DomNode) {
      formatAttributes(elem, indent + delta, options);

      if (options.indent > 0) {
        if (options.indent === 1)
          elem.endTagText = compactWhitespace(elem.endTagText || '').replace(/\s+>$/, '>');

        if (/[\r\n][ \t\f]*>/.test(elem.endTagText || '')) {
          // Would prefer to simply use `.*` instead of `(?:.|\s)*`, but Firefox
          // doesn't support regex "dotall" `s` flag.
          const $ = /((?:.|\s)*)[\r\n][ \t\f]*>/.exec(elem.endTagText);

          elem.endTagText = $[1] + options.eol + tabify(' '.repeat((indent + delta) * options.indent), options) + '>';
          pre_indented = i;
        }

        if (options.lastText && options.removeNewLineBefore.has(elem.tagLc))
          options.lastText.content = options.lastText.content.replace(/\s+$/, '');
        else if ((options.newLineBefore.has(elem.tagLc) || elem.blockContext) && pre_indented !== i - 1) {
          if (!options.lastText) {
            options.lastText = new TextElement('', 0, 0, false);
            children.splice(i++, 0, options.lastText);
          }

          applyIndentation(options.lastText, indent + delta, true, options);
        }
      }

      if (options.indent === 1)
        elem.innerWhitespace = '';

      const saveLastText = options.lastText;

      options.lastText = null;
      formatNode(elem, options, indent + delta);

      if (!elem.children)
        options.lastText = elem.closureState === ClosureState.EXPLICITLY_CLOSED ? undefined : null;
      else if (options.lastText === null)
        options.lastText = saveLastText;
    }
    else if (elem instanceof TextElement) {
      options.lastText = elem;

      if (options.escapeOptions.reencode !== ReencodeOptions.DONT_CHANGE && !keepWhitespaceInside &&
          node.tagLc !== 'script' && node.tagLc !== 'style') {
        if (elem.possibleEntities)
          elem.content = reencodeEntities(elem.content, options.escapeOptions);
        else
          elem.content = escapeToEntities(elem.content, options.escapeOptions);
      }
    }
    else {
      if (options.indent > 0 && options.lastText && (options.indent === 1 || /[\r\n]/.test(options.lastText.content)))
        applyIndentation(options.lastText, indent + delta, false, options);

      options.lastText = null;
    }
  }

  if (options.indent > 1 && (specialText || (!keepWhitespaceInside && !onlyContainsInline(node)))) {
    if (!options.lastText) {
      options.lastText = new TextElement('', 0, 0, false);
      children.push(options.lastText);
    }

    if (node.closureState === ClosureState.EXPLICITLY_CLOSED && !options.inline.has(node.tagLc)) {
      const indentation = tabify(' '.repeat(indent * options.indent), options);
      const $ = /^((?:.|\s)*(?:\r\n|\n|\r))[ \t\f]*$/.exec(options.lastText.content);

      options.lastText.content = ($ && $[1] || options.lastText.content + options.eol) + indentation;
    }
    else
      options.lastText.content = options.lastText.content.replace(/(?:\r\n|\n|\r)[ \t\f]*$/, '');
  }

  if (node.closureState === ClosureState.EXPLICITLY_CLOSED)
    options.lastText = undefined; // undefined signifies that any saved lastText should be cleared.
  else if (node.closureState !== ClosureState.IMPLICITLY_CLOSED)
    options.lastText = null; // null signifies that any saved lastText should be restored.
}

function onlyContainsInline(node: DomNode): boolean {
  if (!node.children)
    return true;

  let onlyInline = true;

  for (let i = 0; i < node.children.length && onlyInline; ++i)
    onlyInline = !(node.children[i] instanceof DomNode && (node.children[i] as DomNode).blockContext);

  return onlyInline;
}

function applyIndentation(elem: DomElement, indent: number, addNewLine: boolean, options: InternalOptions): void {
  if (options.indent > 1) {
    const indentation = tabify(' '.repeat(indent * options.indent), options);
    const $ = /((?:.|\s)*(?:\r\n|\n|\r))[ \t\f]*$/.exec(elem.content);

    elem.content = ($ && $[1] || elem.content + (addNewLine ? options.eol : '')) + indentation;
  }
}

function formatAttributes(node: DomNode, indent: number, options: InternalOptions): void {
  for (let i = 0; i < node.attributes.length; ++i) {
    node.equals[i] = node.equals[i].trim();

    const value = node.values[i];

    if ((value || node.quotes[i]) && options.valueQuoting !== ValueQuoting.LEAVE_AS_IS) {
      if (options.valueQuoting === ValueQuoting.UNQUOTE_SIMPLE_VALUES && SIMPLE_VALUE.test(value) ||
          options.valueQuoting === ValueQuoting.UNQUOTE_INTEGERS && /^\d+$/.test(value))
        node.quotes[i] = '';
      else if (options.valueQuoteStyle === ValueQuoteStyle.DOUBLE ||
               (options.valueQuoteStyle === ValueQuoteStyle.PREFER_DOUBLE && (!/"/.test(value) || /'/.test(value)))) {
        node.quotes[i] = '"';
        node.values[i] = value.replace(/"/g, '&quot;');
      }
      else if (options.valueQuoteStyle === ValueQuoteStyle.SINGLE ||
               (options.valueQuoteStyle === ValueQuoteStyle.PREFER_SINGLE && (!/'/.test(value) || /"/.test(value)))) {
        node.quotes[i] = "'";
        node.values[i] = value.replace(/'/g, '&apos;');
      }
    }

    if (options.escapeOptions.reencode !== ReencodeOptions.DONT_CHANGE)
      node.values[i] = reencodeEntities(node.values[i], options.escapeOptions, true);

    let spacing = node.spacing[i];

    if (options.indent > 1 && options.normalizeAttributeSpacing) {
      if (/[\r\n]/.test(spacing)) {
        const extraIndent = options.alignAttributes ? columnWidth(node.tag) + 2
          : options.continuationIndent;

        spacing = spacing.replace(/[^\r\n]/g, '') + ' '.repeat(indent * options.indent + extraIndent);
      }
      else
        spacing = ' ';

      node.spacing[i] = tabify(spacing, options);

      if (node.equals[i])
        node.equals[i] = options.spaceAroundAttributeEquals ? ' = ' : '=';
    }
    else if (options.indent === 1)
      node.spacing[i] = ' ';
  }
}

function instantiateSyntheticNodes(node: DomNode): void {
  if (!node.children)
    return;

  for (const elem of node.children) {
    if (elem instanceof DomNode) {
      if (elem.synthetic) {
        elem.synthetic = false;
        elem.closureState = ClosureState.EXPLICITLY_CLOSED;
        elem.endTagText = '</' + elem.tag + '>';
      }

      instantiateSyntheticNodes(elem);
    }
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

function preprocessWhitespace(node: DomNode, options: InternalOptions, blockStart = false, blockEnd = false): void {
  if (options.keepWhitespaceInside.has(node.tagLc) || node.tagLc === 'script' || node.tagLc === 'style') {
    node.blockContext = true;
    options.lastText = null;

    return;
  }

  const children = node.children || [];
  const isBlock = (node.blockContext = !options.inline.has(node.tagLc));

  for (let i = 0; i < children.length; ++i) {
    if (isBlock) {
      if (i === 0)
        blockStart = true;

      if (i === children.length - 1)
        blockEnd = true;
    }

    const child = children[i];

    if (child instanceof DomNode) {
      preprocessWhitespace(child, options, blockStart, blockEnd);
      blockStart = child.blockContext;
    }
    else if (child instanceof TextElement) {
      const afterComment = isCommentLike(children[i - 1]);
      const beforeComment = isCommentLike(children[i + 1]);

      if (afterComment || beforeComment)
        child.content = child.content.replace(/[ \f\t]+/g, ' ').replace(/[\n\r]+/g, options.eol)
          .replace(/^ (?=[\n\r])/, '');
      else {
        const keepNewlines = options.maxBlankLines >= 0;

        child.content = compactWhitespace(child.content, keepNewlines).replace(/(^|[\r\n])[ \f\t]+(?=[\r\n]|$)/g, '$1');

        if (keepNewlines && options.maxBlankLines >= -1)
          child.content = compactNewlines(child.content, options.maxBlankLines + 1);

        if (blockStart ||
            child.content.startsWith(' ') && options.lastText && options.lastText.content.endsWith(' ')) {
          child.content = trimLeft(child.content, keepNewlines);
          child.blockContext = true;
          blockStart = false;
        }

        if (blockEnd || followedByBlock(node, i, options))
          child.content = trimRight(child.content, keepNewlines);
      }

      if (child.content.startsWith(' ') && options.lastText)
        options.lastText.content = trimRight(options.lastText.content);

      options.lastText = child;
    }
    else if (child instanceof CData) {
      blockStart = false;
      options.lastText = null;
    }
    //    else if (blockStart || isBlock || followedByBlock(node, i, options))
    //      blockStart = child.blockContext = true;
  }

  if (isBlock)
    options.lastText = null;
}

function followedByBlock(parent: DomNode, childIndex: number, options: InternalOptions): boolean {
  while (++childIndex < parent.children.length) {
    const sibling = parent.children[childIndex];

    if (sibling instanceof DomNode)
      return !options.inline.has(sibling.tagLc);
    else if (sibling instanceof TextElement || sibling instanceof CData)
      return false;
  }

  return false;
}

function processOptions(options: HtmlFormatOptions): InternalOptions {
  const opts = Object.assign({}, DEFAULT_OPTIONS);

  Object.keys(options).forEach(option => {
    if (option in DEFAULT_OPTIONS &&
        typeof (DEFAULT_OPTIONS as any)[option] === typeof (options as any)[option] &&
        Array.isArray((DEFAULT_OPTIONS as any)[option]) === Array.isArray((options as any)[option]))
      (opts as any)[option] = (options as any)[option];
  });

  opts.childrenNotIndented = applyTagList(opts.childrenNotIndented, options.childrenNotIndented);
  opts.dontBreakIfInline = applyTagList(opts.dontBreakIfInline, options.dontBreakIfInline);
  opts.inline = applyTagList(opts.inline, options.inline);
  opts.keepWhitespaceInside = applyTagList(opts.keepWhitespaceInside, options.keepWhitespaceInside);
  opts.keepWhitespaceInside = applyTagList(opts.keepWhitespaceInside, options.keepWhitespaceInside);
  opts.newLineBefore = applyTagList(opts.newLineBefore, options.newLineBefore);
  opts.removeNewLineBefore = applyTagList(opts.removeNewLineBefore, options.removeNewLineBefore);

  opts.escapeOptions = Object.assign({}, opts.escapeOptions);

  Object.keys(opts.escapeOptions).forEach(subOption => {
    if (subOption in options)
      (opts.escapeOptions as any)[subOption] = (options as any)[subOption];
  });

  return opts;
}

function applyTagList(originalSet: Set<string>, mods: string[]): Set<string> {
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
  if (options.useTabCharacters && s.length >= options.tabSize) {
    s = s.split(/([\r\n])/).map(ss =>
      ss.replace(/^( +)/, (match, $1) =>
        '\t'.repeat(Math.floor($1.length / options.tabSize)) + ' '.repeat($1.length % options.tabSize)
      )
    ).join('');
  }

  return s;
}

// noinspection JSUnusedLocalSymbols
function detabify(s: string, options: InternalOptions): string { // eslint-disable-line @typescript-eslint/no-unused-vars
  if (options.useTabCharacters && s.includes('\t')) {
    const tabSize = options.tabSize;
    s = s.split(/([\r\n])/).map(ss => {
      let adj = 0;
      return ss.replace(/\t/g, (match, offset) => {
        const len = (offset + adj) % tabSize | tabSize;
        adj += len - 1;
        return ' '.repeat(len);
      });
    }).join('');
  }

  return s;
}
