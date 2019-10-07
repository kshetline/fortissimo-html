import { FORMATTING_ELEMENTS, MARKER_ELEMENTS, OPEN_IMPLIES_CLOSE } from './elements';
import { unescapeEntities } from './characters';

function last<T>(array: T[]): T {
  if (array && array.length > 0)
    return array[array.length - 1];
  else
    return undefined;
}

export enum ClosureState {
  UNCLOSED,
  SELF_CLOSED,
  VOID_CLOSED,
  EXPLICITLY_CLOSED,
  IMPLICITLY_CLOSED
}

export function OQ(quote: string): string {
  return quote.length < 2 ? quote : quote.substr(1);
}

export function CQ(quote: string): string {
  return quote.length < 2 ? quote : '';
}

interface Selector {
  element: string;
  id: string;
  qlass: string;
}

function stringToSelector(s: string): Selector {
  const selector = {} as Selector;
  const $ = /(.*)\.(.+)/.exec(s);

  if ($) {
    s = $[1];
    selector.qlass = $[2];
  }

  if (s) {
    if (s.startsWith('#'))
      selector.id = s.substr(1);
    else if (s === '*')
      selector.element = '';
    else
      selector.element = s.toLowerCase();
  }
  else
    selector.element = '';

  return selector;
}

export abstract class DomElement {
  parent: DomNode;

  protected constructor(
    public content: string,
    public readonly line: number,
    public readonly column: number,
    public readonly terminated: boolean
  ) {}

  get depth(): number {
    let depth = -1;
    let node = this.parent;

    while (node) {
      depth += (node.synthetic && node.parent ? 0 : 1);
      node = node.parent;
    }

    return depth;
  }

  get syntheticDepth(): number {
    let depth = -1;
    let node = this.parent;

    while (node) {
      ++depth;
      node = node.parent;
    }

    return depth;
  }

  // noinspection JSUnusedGlobalSymbols
  toJSON(): any {
    return this.toString() + ' (' + this.depth +
      (this.line ? `; ${this.line}, ${this.column}` : '') +
      (this.parent ? '; ' + this.parent.tag : '') + ')' +
      (this.terminated ? '' : '!');
  }
}

export class CData extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number,
    terminated: boolean
  ) {
    super(content, line, column, terminated);
  }

  toString(): string {
    return '<![CDATA[' + this.content + (this.terminated ? ']]>' : '');
  }
}

export class CommentElement extends DomElement {
  constructor(content: string,
    line: number,
    column: number,
    terminated: boolean
  ) {
    super(content, line, column, terminated);
  }

  toString(): string {
    return '<!--' + this.content + (this.terminated ? '-->' : '');
  }
}

export class DeclarationElement extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number,
    terminated: boolean
  ) {
    super(content, line, column, terminated);
  }

  toString(): string {
    return '<!' + this.content + (this.terminated ? '>' : '');
  }
}

export class DocType extends DeclarationElement {
  readonly type: 'html' | 'xhtml';
  readonly variety: 'frameset' | 'strict' | 'transitional';
  readonly version: string;

  constructor(
    content: string,
    line: number,
    column: number,
    terminated: boolean
  ) {
    super(content, line, column, terminated);

    this.type = /\bxhtml\b/i.test(content) ? 'xhtml' : 'html';
    this.variety = (/\b(frameset|strict|transitional)\b/i.exec(content.toLowerCase()) || [])[1] as any;
    this.version = (/\bx?html[ \n\r\t\f]*([.\d]+)\b/i.exec(content) || [])[1] as any;

    if (!this.version && /^doctype[ \n\r\t\f]+html[ \n\r\t\f]*$/i.test(content))
      this.version = '5';
  }
}

export class ProcessingElement extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number,
    terminated: boolean
  ) {
    super(content, line, column, terminated);
  }

  toString(): string {
    return '<?' + this.content + (this.terminated ? '>' : '');
  }
}

export class TextElement extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number,
    public possibleEntities: boolean
  ) {
    super(content, line, column, true);
  }

  toString(): string {
    return this.content;
  }
}

export class UnmatchedClosingTag extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number
  ) {
    super(content, line, column, true);
  }

  toString(): string {
    return this.content;
  }
}

export class DomNode extends DomElement {
  attributes: string[] = [];
  badTerminator: string = null;
  blockContext = false; // Used by formatter.ts
  children: DomElement[];
  closureState = ClosureState.UNCLOSED;
  endTagLine = 0;
  endTagColumn = 0;
  endTagText = '';
  equals: string[] = [];
  innerWhitespace = '';
  quotes: string[] = [];
  spacing: string[] = [];
  synthetic?: boolean;
  tagLc: string;
  values: string[] = [];
  valuesLookup: Record<string, string> = {};

  constructor(
    public tag: string,
    line: number,
    column: number,
    caseSensitive = false,
    synthetic = false
  ) {
    super(null, line, column, true);
    this.tagLc = caseSensitive ? tag : tag.toLowerCase();

    if (synthetic)
      this.synthetic = true;
  }

  addAttribute(name: string, value: string, leadingSpace = '', equals = '=', quote = '"'): void {
    this.attributes.push(name);
    this.values.push(value);
    this.spacing.push(leadingSpace);
    this.equals.push(equals);
    this.quotes.push(quote);
    this.valuesLookup[name] = value;
  }

  addChild(child: DomElement): void {
    this.children = this.children || [];
    child.parent = this;
    this.children.push(child);
  }

  setEndTag(text: string, line = 0, column = 0) {
    this.endTagText = text;
    this.endTagLine = line;
    this.endTagColumn = column;
  }

  querySelector(selector: string): DomNode {
    const results: DomNode[] = [];

    this.querySelectorImpl(selector, results, 1);

    if (results.length === 0)
      return null;
    else
      return results[0];
  }

  querySelectorAll(selector: string): DomNode[] {
    const results: DomNode[] = [];

    this.querySelectorImpl(selector, results);

    return results;
  }

  private querySelectorImpl(selector: string | Selector, results: DomNode[], limit = Number.MAX_SAFE_INTEGER): void {
    if (typeof selector === 'string')
      selector = stringToSelector(selector);

    if ((!selector.element || this.tagLc === selector.element) &&
        (!selector.qlass || (this.valuesLookup.class || '').split(/\s+/).indexOf(selector.qlass) >= 0) &&
        (!selector.id || this.valuesLookup.id === selector.id))
      results.push(this);

    if (this.children) {
      for (let i = 0; i < this.children.length && results.length < limit; ++i) {
        if (this.children[i] instanceof DomNode)
          (this.children[i] as DomNode).querySelectorImpl(selector, results);
      }
    }
  }

  get textContent(): string {
    const text: string[] = [];

    if (this.children) {
      for (const child of this.children) {
        if (child instanceof CData)
          text.push(child.content);
        else if (child instanceof TextElement)
          text.push(child.possibleEntities ? unescapeEntities(child.content) : child.content);
        else if (child instanceof DomNode)
          text.push(child.textContent);
      }
    }

    return text.join('');
  }

  get innerHTML(): string {
    return this.toString(false);
  }

  countUnclosed(): [number, number] {
    let unclosed = 0;
    let implicitlyClosed = 0;

    if (!this.synthetic) {
      if (this.closureState === ClosureState.UNCLOSED)
        ++unclosed;
      else if (this.closureState === ClosureState.IMPLICITLY_CLOSED)
        ++implicitlyClosed;
    }

    if (this.children) {
      this.children.forEach(child => {
        if (child instanceof DomNode) {
          const [childUnclosed, childImplicit] = child.countUnclosed();
          unclosed += childUnclosed;
          implicitlyClosed += childImplicit;
        }
      });
    }

    return [unclosed, implicitlyClosed];
  }

  toJSON(): any {
    const json: any = { tag: this.tag };

    if (this.line)
      json.line = this.line;

    if (this.column)
      json.column = this.column;

    if (this.synthetic)
      json.synthetic = true;

    if (this.badTerminator !== null)
      json.badTerminator = this.badTerminator;

    json.depth = this.depth;

    if (json.depth !== this.syntheticDepth)
      json.syntheticDepth = this.syntheticDepth;

    json.closureState = this.closureState;

    if (this.attributes.length > 0)
      json.values = this.attributes.reduce((values: any, attrib, index) =>
        { values[attrib] = this.values[index]; return values; }, {});

    if (this.parent)
      json.parentTag = this.parent.tag;

    if (this.children)
      json.children = this.children;

    if (this.closureState === ClosureState.EXPLICITLY_CLOSED && this.endTagText)
      json.endTagText = `${this.endTagText} (${this.endTagLine}, ${this.endTagColumn})`;

    return json;
  }

  toString(includeSelf = true): string {
    const parts: string[] = [];

    if (includeSelf && !this.synthetic) {
      parts.push('<', this.tag);

      if (this.attributes) {
        this.attributes.forEach((attrib, index) => {
          parts.push(this.spacing[index], attrib, this.equals[index],
            OQ(this.quotes[index]), this.values[index], CQ(this.quotes[index]));
        });
      }

      if (this.innerWhitespace)
        parts.push(this.innerWhitespace);

      if (this.badTerminator !== null)
        parts.push(this.badTerminator);
      else if (this.closureState === ClosureState.SELF_CLOSED)
        parts.push('/>');
      else
        parts.push('>');
    }

    if (this.children)
      this.children.forEach(child => parts.push(child.toString()));

    if (includeSelf && !this.synthetic && this.closureState === ClosureState.EXPLICITLY_CLOSED && this.endTagText)
      parts.push(this.endTagText);

    return parts.join('');
  }
}

export class DomModel {
  private root: DomNode = new DomNode('/', 0, 0, false, true);

  private currentNode = this.root;
  private inMathOrSvg = 0;
  private openStack = [this.root];
  private xmlMode = false;

  getRoot(): DomNode {
    return this.root;
  }

  getCurrentNode(): DomNode {
    return this.currentNode;
  }

  addAttribute(name: string, value: string, leadingSpace = '', equals = '=', quote = '"'): void {
    this.currentNode.addAttribute(name, value, leadingSpace, equals, quote);
  }

  addInnerWhitespace(whitespace: string): void {
    if (this.currentNode)
      this.currentNode.innerWhitespace = whitespace || '';
  }

  canDoXmlMode(): boolean {
    return this.openStack.length === 1 &&
           this.root.children.length === 0 ||
           (this.root.children.length === 1 && this.root.children[0].toString().trim() === '');
  }

  getDepth(): number {
    return this.openStack.length - 2;
  }

  setXmlMode(mode: boolean): void {
    this.xmlMode = mode;
  }

  prePush(node: DomNode): void {
    if (!this.xmlMode && node.tagLc in OPEN_IMPLIES_CLOSE) {
      while (OPEN_IMPLIES_CLOSE[node.tagLc].has(this.currentNode.tagLc)) {
        this.currentNode.closureState = ClosureState.IMPLICITLY_CLOSED;
        this.openStack.pop();
        this.updateCurrentNode();
      }
    }
  }

  addChild(child: DomElement): void {
    this.currentNode.addChild(child);
  }

  private examineTable(table: DomNode): void {
    const children = table.children;

    if (!children || this.xmlMode)
      return;

    DomModel.insertRowsWhereNeeded(table);

    const sections = new Set<string>();

    for (const elem of children) {
      if (elem instanceof DomNode) {
        if (/^(thead|tbody|tfoot)$/.test(elem.tagLc)) {
          sections.add(elem.tagLc);
          DomModel.insertRowsWhereNeeded(elem);
        }
      }
    }

    if (sections.size === 0)
      return;

    let section: DomNode;

    for (let i = 0; i < children.length; ++i) {
      const elem = children[i];

      if (elem instanceof DomNode) {
        if (/^(thead|tbody|tfoot)$/.test(elem.tagLc))
          section = elem.closureState === ClosureState.EXPLICITLY_CLOSED ? undefined : elem;
        else if (elem.tagLc === 'tr') {
          const hasTh = !!elem.querySelector('th');

          if (!section || (hasTh && section.tagLc !== 'thead')) {
            section = new DomNode(hasTh ? 'thead' : 'tbody', 0, 0, false, true);
            section.parent = table;
            children[i] = section;
          }

          section.addChild(elem);
        }
      }
    }
  }

  private static insertRowsWhereNeeded(node: DomNode): void {
    const children = node.children;

    if (!children)
      return;

    let row: DomNode;

    for (let i = 0; i < children.length; ++i) {
      const elem = children[i];

      if (elem instanceof DomNode) {
        if (elem.tagLc === 'th' || elem.tagLc === 'td') {
          if (!row) {
            row = new DomNode('tr', 0, 0, false, true);
            row.parent = node;
            children[i] = row;
          }

          row.addChild(elem);
        }
        else if (elem.tagLc === 'tr')
          row = elem.closureState === ClosureState.EXPLICITLY_CLOSED ? undefined : elem;
      }
    }
  }

  push(node: DomNode): void {
    this.openStack.push(node);
    this.currentNode = node;

    if (node.tagLc === 'math' || node.tagLc === 'svg')
      ++this.inMathOrSvg;
  }

  pop(tagLc: string, endTagText = '</' + tagLc + '>', line = 0, column = 0): boolean {
    let popped = false;
    let parseError = false;

    if (!tagLc || this.currentNode.tagLc === tagLc) {
      popped = true;
      this.openStack.pop();

      if (tagLc === null)
        this.currentNode.closureState = ClosureState.SELF_CLOSED;
      else if (tagLc === undefined)
        this.currentNode.closureState = ClosureState.VOID_CLOSED;
      else {
        this.currentNode.closureState = ClosureState.EXPLICITLY_CLOSED;
        this.currentNode.setEndTag(endTagText, line, column);
      }

      if (this.currentNode.tagLc === 'table')
        this.examineTable(this.currentNode);
    }

    if (!popped && !this.xmlMode) {
      let nodeIndex = this.openStack.map(node => node.tagLc).lastIndexOf(tagLc);

      if (nodeIndex > 0) { // No, I really don't want >= 0.
        if (FORMATTING_ELEMENTS.has(tagLc)) {
          for (let i = nodeIndex + 1; i < this.openStack.length; ++i) {
            if (MARKER_ELEMENTS.has(this.openStack[i].tagLc)) {
              nodeIndex = -1;
              break;
            }
          }
        }

        while (this.openStack.length > nodeIndex) {
          if (!this.currentNode.closureState) {
            if (this.openStack.length - 1 === nodeIndex) {
              popped = true;
              this.currentNode.closureState = ClosureState.EXPLICITLY_CLOSED;
              this.currentNode.setEndTag(endTagText, line, column);
            }
            else
              this.currentNode.closureState = ClosureState.IMPLICITLY_CLOSED;

            if (this.currentNode.tagLc === 'table')
              this.examineTable(this.currentNode);
          }

          this.openStack.pop();
          this.updateCurrentNode();
        }
      }
    }

    if (!popped) {
      this.addChild(new UnmatchedClosingTag(endTagText, line, column));
      parseError = true;
    }

    if (this.openStack.length === 0)
      this.openStack.push(this.root);

    this.updateCurrentNode();

    this.inMathOrSvg = 0;
    this.openStack.forEach((node, index) => {
      this.inMathOrSvg += (node.tagLc === 'math' || node.tagLc === 'svg' ? 1 : 0);

      if (index > 0)
        node.parent = this.openStack[index - 1];
    });

    return !parseError;
  }

  shouldParseCData(): boolean {
    return this.xmlMode || this.inMathOrSvg > 0;
  }

  private updateCurrentNode(): void {
    this.currentNode = last(this.openStack) || this.root;
  }
}
