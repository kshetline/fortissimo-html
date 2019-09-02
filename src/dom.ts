import { FORMATTING_ELEMENTS, MARKER_ELEMENTS } from './elements';

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
    return '</' + this.content + '>';
  }
}

export type DomChild = DomNode | string | SpecialNode;

export class DomNode {
  attributes: string[];
  attributesLc: Record<string, string>;
  children: DomChild[];
  closureState = ClosureState.UNCLOSED;
  values: Record<string, string>;
  valuesByLc: Record<string, string>;
  tagLc: string;

  constructor(public tag: string) {
    this.tagLc = tag.toLowerCase();
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

  getRoot(): DomNode {
    return this.root;
  }

  addAttribute(name: string, value: string): void {
    this.currentNode.addAttribute(name, value);
  }

  canStillAcceptXml(): boolean {
    return this.domStack.length === 1 &&
           this.root.children.length === 0 ||
           (this.root.children.length === 1 && this.root.children[0].toString().trim() === '');
  }

  addChild(child: DomChild, leadingSpace?: string): void {
    this.currentNode.addChild(child, leadingSpace);
  }

  push(node: DomNode): void {
    this.domStack.push(node);
    this.currentNode = node;

    if (FORMATTING_ELEMENTS.has(node.tag) || MARKER_ELEMENTS.has(node.tag)) {
      this.activeFormatting.push(node);
      this.currentFormatNode = node;
    }
  }

  pop(tag?: string): void {
    if (!tag || this.currentNode.tag === tag) {
      this.domStack.pop();

      if (tag === null)
        this.currentNode.closureState = ClosureState.SELF_CLOSED;
      else
        this.currentNode.closureState = ClosureState.EXPLICITLY_CLOSED;

      if (this.currentFormatNode && this.currentFormatNode.tag === tag) {
        this.activeFormatting.pop();
        this.currentFormatNode = this.activeFormatting[this.activeFormatting.length - 1];
      }
    }
    else if (tag && FORMATTING_ELEMENTS.has(tag)) {
      const formatNode = this.currentFormatNode;

      while (formatNode && !MARKER_ELEMENTS.has(tag)) {
      }
    }

    this.currentNode = this.domStack[this.domStack.length - 1] || this.root;
  }
}
