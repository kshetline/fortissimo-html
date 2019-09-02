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
  EXPLICITLY_CLOSED,
  IMPLICITLY_CLOSED
}

export abstract class SpecialNode {
  protected constructor(public content: string) {}
}

export class Comment extends SpecialNode {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<!--' + this.content + '-->';
  }
}

export class Declaration extends SpecialNode {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<!' + this.content + '>';
  }
}

export class ProcessingInstruction extends SpecialNode {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<?' + this.content + '>';
  }
}

export class UnmatchedClosingTag extends SpecialNode {
  constructor(content: string) { super(content); }

  toString(): string {
    return '</' + this.content.toUpperCase() + '>';
  }
}

export type DomChild = DomNode | string | SpecialNode;

export class DomNode {
  attributes: string[];
  attributesLc: Record<string, string>;
  children: DomChild[];
  closureState = ClosureState.UNCLOSED;
  synthetic?: boolean;
  tagLc: string;
  values: Record<string, string>;
  valuesByLc: Record<string, string>;

  constructor(public tag: string, synthetic?: boolean) {
    this.tagLc = tag.toLowerCase();

    if (synthetic)
      this.synthetic = true;
  }

  addAttribute(name: string, value: string): void {
    const nameLc = name.toLowerCase();

    this.attributes = this.attributes || [];
    this.attributes.push(name);
    this.attributesLc = this.attributesLc || {};
    this.attributesLc[name] = nameLc;
    this.values = this.values || {};
    this.values[name] = value;
    this.valuesByLc = this.valuesByLc || {};
    this.values[nameLc] = value;
  }

  addChild(child: DomChild, leadingSpace?: string): void {
    this.children = this.children || [];

    if (this.children.length > 0 && typeof this.children[this.children.length - 1] === 'string')
      this.children[this.children.length - 1] += leadingSpace;

    this.children.push(child);
  }

  matches(node: DomNode): boolean {
    if (!node || this.tagLc !== node.tagLc)
      return false;
    else if ((!node.attributes || node.attributes.length === 0) && (!this.attributes || this.attributes.length === 0))
      return true;
    else if (node.attributes.length !== this.attributes.length)
      return false;

    for (const attrib of node.attributes) {
      const attribLc = node.attributesLc[attrib];

      if (node.valuesByLc[attribLc] !== this.valuesByLc[attribLc])
        return false;
    }

    return true;
  }
}

export class DomModel {
  private root: DomNode = new DomNode('/');

  private activeFormatting: DomNode[] = [];
  private currentFormatNode: DomNode;
  private currentNode = this.root;
  private domStack = [this.root];
  private inTable = 0;
  private xmlMode = false;

  getRoot(): DomNode {
    return this.root;
  }

  addAttribute(name: string, value: string): void {
    this.currentNode.addAttribute(name, value);
  }

  canDoXmlMode(): boolean {
    return this.domStack.length === 1 &&
           this.root.children.length === 0 ||
           (this.root.children.length === 1 && this.root.children[0].toString().trim() === '');
  }

  setXmlMode(mode: boolean): void {
    this.xmlMode = mode;
  }

  prePush(node: DomNode): void {
    if (!this.xmlMode && node.tagLc in OPEN_IMPLIES_CLOSE) {
      while (OPEN_IMPLIES_CLOSE[node.tagLc].has(this.currentNode.tagLc)) {
        this.currentNode.closureState = ClosureState.IMPLICITLY_CLOSED;
        this.domStack.pop();
        this.updateCurrentNode();
      }
    }
  }

  addChild(child: DomChild, leadingSpace?: string, pending_th = false): void {
    if (this.inTable > 0 && child instanceof DomNode && /^(td|th)$/.test(child.tagLc) && this.currentNode.tagLc !== 'tr') {
      const newParent = new DomNode('tr', true);

      this.addChild(newParent, '', child.tagLc === 'th');
      this.domStack.push(newParent);
      this.currentNode = newParent;
    }
    else if (this.inTable > 0 && child instanceof DomNode && child.tagLc === 'tr' &&  !/^(tbody|thead|table)$/.test(this.currentNode.tagLc)) {
      const newParent = new DomNode(pending_th ? 'thead' : 'tbody', true);

      this.addChild(newParent);
      this.domStack.push(newParent);
      this.currentNode = newParent;
    }

    this.currentNode.addChild(child, leadingSpace);
  }

  push(node: DomNode): void {
    this.domStack.push(node);
    this.currentNode = node;

    if (node.tagLc === 'table')
      ++this.inTable;

    if (FORMATTING_ELEMENTS.has(node.tagLc) || MARKER_ELEMENTS.has(node.tagLc)) {
      this.activeFormatting.push(node);
      this.currentFormatNode = node;
    }
  }

  pop(tagLc?: string): void {
    if (!tagLc || this.currentNode.tagLc === tagLc) {
      this.domStack.pop();

      if (tagLc === 'table')
        --this.inTable;

      if (tagLc === null)
        this.currentNode.closureState = ClosureState.SELF_CLOSED;
      else
        this.currentNode.closureState = ClosureState.EXPLICITLY_CLOSED;

      if (this.currentFormatNode && this.currentFormatNode.tagLc === tagLc) {
        this.activeFormatting.pop();
        this.currentFormatNode = last(this.activeFormatting);
      }
    }
    else if (FORMATTING_ELEMENTS.has(tagLc)) {
      const formatNode = this.currentFormatNode;

      while (formatNode && !MARKER_ELEMENTS.has(tagLc)) {
      }
    }
    else {
      const nodeIndex = this.domStack.map(node => node.tagLc).lastIndexOf(tagLc);

      if (nodeIndex > 0) { // No, not >= 0, on purpose!
        while (this.domStack.length > nodeIndex) {
          this.currentNode.closureState = ClosureState.IMPLICITLY_CLOSED;
          this.domStack.pop();

          if (this.currentNode.tagLc === 'table')
            --this.inTable;

          this.updateCurrentNode();
        }
      }
      else
        this.addChild(new UnmatchedClosingTag(tagLc));
    }

    this.updateCurrentNode();
  }

  getUnclosedTagCount(): number {
    return Math.max(this.domStack.length - 1, 0);
  }

  private updateCurrentNode(): void {
    this.currentNode = last(this.domStack) || this.root;
  }
}
