import { ClosureState, DomElement, DomNode, TextElement } from './dom';
import { columnWidth, EntityStyle, EscapeOptions, escapeToEntities, reencodeEntities, ReencodeOptions, TargetEncoding } from './characters';

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
  // TODO: Added 'text' below for SVG. Might other SVG elements belong here?
  inline: new Set(['a', 'abbr', 'acronym', 'b', 'basefont', 'bdo', 'big', 'br', 'cite', 'cite', 'code', 'dfn',
                   'em', 'font', 'i', 'img', 'input', 'kbd', 'label', 'q', 's', 'samp', 'select', 'small', 'span',
                   'strike', 'strong', 'sub', 'sup', 'text', 'tt', 'u', 'var']),
  instantiateSyntheticNodes: false,
  keepWhitespaceInside: new Set(['/', 'pre', 'span', 'textarea']),
  lastText: null,
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

function compactWhitespace(s: string): string {
  return s.replace(/[ \t\n\f\r]+/g, ' ');
}

export function formatHtml(node: DomNode, options?: HtmlFormatOptions): void {
  const opts = processOptions(options || {});

  if (opts.instantiateSyntheticNodes)
    instantiateSyntheticNodes(node);
  else
    removeSyntheticNodes(node);

  findInlineContent(node, opts);

  if (!opts.eol)
    opts.eol = '\n';

  if (opts.indent > 0 && (opts.indent === 1 || opts.trimDocument) && node.children && node.children.length > 0) {
    if (node.children[0] instanceof TextElement)
      node.children[0].content = (node.children[0].content || '').replace(/^\s+/, '');

    const last = node.children.length - 1;

    if (node.children[last] instanceof TextElement)
      node.children[last].content = (node.children[last].content || '').replace(/\s+$/, '');
  }

  if (opts.indent > 0 && opts.endDocumentWithNewline) {
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

      if (options.indent > 0) {
        if (options.indent === 1)
          elem.endTagText = compactWhitespace(elem.endTagText || '').replace(/\s+>$/, '>');
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

          applyIndentation(options.lastText, indent + delta, options, node.contentInline);
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

      if (options.escapeOptions.reencode !== ReencodeOptions.DONT_CHANGE &&
          node.tagLc !== 'script' && node.tagLc !== 'style') {
        if (elem.possibleEntities)
          elem.content = reencodeEntities(elem.content, options.escapeOptions);
        else
          elem.content = escapeToEntities(elem.content, options.escapeOptions);
      }

      if (options.indent === 1 && !keepWhitespaceInside && !specialText)
        elem.content = compactWhitespace(elem.content);
    }
    else {
      if (options.indent > 0 && options.lastText && (options.indent === 1 || /[\r\n]/.test(options.lastText.content)))
        applyIndentation(options.lastText, indent + delta, options, node.contentInline);

      options.lastText = null;
    }
  }

  if (options.indent > 0 && (specialText || !node.contentInline && !keepWhitespaceInside)) {
    if (options.indent === 1) {
      if (options.lastText && !specialText)
        options.lastText.content = options.lastText.content && compactWhitespace(options.lastText.content);
    }
    else {
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
  }

  if (node.closureState === ClosureState.EXPLICITLY_CLOSED)
    options.lastText = undefined; // undefined signifies that any saved lastText should be cleared.
  else if (node.closureState !== ClosureState.IMPLICITLY_CLOSED)
    options.lastText = null; // null signifies that any saved lastText should be restored.
}

function applyIndentation(elem: DomElement, indent: number, options: InternalOptions, inline: boolean): void {
  if (options.indent > 1) {
    const indentation = tabify(' '.repeat(indent * options.indent), options);
    const $ = /(.*(?:\r\n|\n|\r))[ \t\f]*/s.exec(elem.content);

    elem.content = ($ && $[1] || elem.content + options.eol) + indentation;
  }
  else
    elem.content = compactWhitespace(inline ? elem.content : elem.content.trim());
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
      node.contentInline = node.contentInline && options.inline.has(child.tagLc) &&
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

  const scriptOrStyle = (node.tagLc === 'script' || node.tagLc === 'style');

  if (options.indent > 0 && !node.contentInline && !scriptOrStyle && !options.inline.has(node.tagLc)) {
    for (const child of children) {
      if (child instanceof TextElement)
        child.content = child.content.trim();
    }
  }
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
