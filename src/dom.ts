import { FORMATTING_ELEMENTS, MARKER_ELEMENTS, OPEN_IMPLIES_CLOSE } from './elements';

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

export abstract class DomElement {
  parent: DomNode;

  protected constructor(
    public content: string,
    public readonly line: number,
    public readonly column: number
  ) {}

  get depth(): number {
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
      (this.parent ? '; ' + this.parent.tag : '') + ')';
  }
}

export class CData extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number
  ) {
    super(content, line, column);
  }

  toString(): string {
    return '<![CDATA[' + this.content + ']]>';
  }
}

export class CommentElement extends DomElement {
  constructor(content: string,
    line: number,
    column: number
  ) {
    super(content, line, column);
  }

  toString(): string {
    return '<!--' + this.content + '-->';
  }
}

export class DeclarationElement extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number
  ) {
    super(content, line, column);
  }

  toString(): string {
    return '<!' + this.content + '>';
  }
}

export class DocType extends DeclarationElement {
  readonly type: 'html' | 'xhtml';
  readonly variety: 'frameset' | 'strict' | 'transitional';
  readonly version: string;

  constructor(
    content: string,
    line: number,
    column: number
  ) {
    super(content, line, column);

    this.type = /\bxhtml\b/i.test(content) ? 'xhtml' : 'html';
    this.variety = (/\b(frameset|strict|transitional)\b/i.exec(content.toLowerCase()) || [])[1] as any;
    this.version = (/\bx?html\s*([.\d]+)\b/i.exec(content) || [])[1] as any;

    if (!this.version && /^doctype\s+html\s*$/i.test(content))
      this.version = '5';
  }
}

export class ProcessingElement extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number
  ) {
    super(content, line, column);
  }

  toString(): string {
    return '<?' + this.content + '>';
  }
}

export class TextElement extends DomElement {
  constructor(
    content: string,
    line: number,
    column: number
  ) {
    super(content, line, column);
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
    super(content, line, column);
  }

  toString(): string {
    return '</' + this.content + '>';
  }
}

export class DomNode extends DomElement {
  attributes: string[] = [];
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

  constructor(
    public tag: string,
    line: number,
    column: number,
    caseSensitive = false,
    synthetic = false
  ) {
    super(null, line, column);
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

  toJSON(): any {
    const json: any = { tag: this.tag };

    if (this.line)
      json.line = this.line;

    if (this.column)
      json.column = this.column;

    if (this.synthetic)
      json.synthetic = true;

    if (this.content)
      json.content = this.content;

    json.depth = this.depth;
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

  toString(): string {
    const parts: string[] = [];

    if (!this.synthetic) {
      parts.push('<', this.tag);

      if (this.attributes) {
        this.attributes.forEach((attrib, index) => {
          parts.push(this.spacing[index], attrib, this.equals[index], this.quotes[index], this.values[index], this.quotes[index]);
        });
      }

      if (this.innerWhitespace)
        parts.push(this.innerWhitespace);

      if (this.closureState === ClosureState.SELF_CLOSED)
        parts.push('/>');
      else
        parts.push('>');
    }

    if (this.children)
      this.children.forEach(child => parts.push(child.toString()));

    if (!this.synthetic && this.closureState === ClosureState.EXPLICITLY_CLOSED && this.endTagText)
      parts.push(this.endTagText);

    return parts.join('');
  }
}

export class DomModel {
  private root: DomNode = new DomNode('/', 0, 0, false, true);

  private currentNode = this.root;
  private inMathOrSvg = 0;
  private inTable = 0;
  private openStack = [this.root];
  private xmlMode = false;

  getRoot(): DomNode {
    return this.root;
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

  addChild(child: DomElement, pending_th = false): void {
    if (!this.xmlMode) {
      if (this.inTable > 0 && child instanceof DomNode && /^(td|th)$/.test(child.tagLc) &&
          this.currentNode.tagLc !== 'tr') {
        const newParent = new DomNode('tr', 0, 0, false, true);

        this.addChild(newParent, child.tagLc === 'th');
        this.openStack.push(newParent);
        this.currentNode = newParent;
      }
      else if (this.inTable > 0 && child instanceof DomNode && child.tagLc === 'tr' &&
               !/^(tbody|thead|table)$/.test(this.currentNode.tagLc)) {
        const newParent = new DomNode(pending_th ? 'thead' : 'tbody', 0, 0, false, true);

        this.addChild(newParent);
        this.openStack.push(newParent);
        this.currentNode = newParent;
      }
    }

    this.currentNode.addChild(child);
  }

  push(node: DomNode): void {
    this.openStack.push(node);
    this.currentNode = node;

    if (node.tagLc === 'table')
      ++this.inTable;
    else if (node.tagLc === 'math' || node.tagLc === 'svg')
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
          }

          this.openStack.pop();
          this.updateCurrentNode();
        }
      }
    }

    if (!popped) {
      this.addChild(new UnmatchedClosingTag(tagLc, line, column));
      parseError = true;
    }

    if (this.openStack.length === 0)
      this.openStack.push(this.root);

    this.updateCurrentNode();

    this.inMathOrSvg = 0;
    this.inTable = 0;
    this.openStack.forEach((node, index) => {
      this.inTable += (node.tagLc === 'table' ? 1 : 0);
      this.inMathOrSvg += (node.tagLc === 'math' || node.tagLc === 'svg' ? 1 : 0);

      if (index > 0)
        node.parent = this.openStack[index - 1];
    });

    return !parseError;
  }

  shouldParseCData(): boolean {
    return this.xmlMode || this.inMathOrSvg > 0;
  }

  getUnclosedTagCount(): number {
    return Math.max(this.openStack.length - 1, 0);
  }

  private updateCurrentNode(): void {
    this.currentNode = last(this.openStack) || this.root;
  }
}
