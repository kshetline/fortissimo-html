import { FORMATTING_ELEMENTS, FOSTER_PARENT_SPECIAL_TARGETS, MARKER_ELEMENTS, OPEN_IMPLIES_CLOSE, SCOPE_ELEMENTS, SPECIAL_ELEMENTS } from './elements';

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

export abstract class DomElement {
  parent: DomNode;

  protected constructor(public content: string) {}

  getDepth(): number {
    let depth = -1;
    let node = this.parent;

    while (node) {
      ++depth;
      node = node.parent;
    }

    return depth;
  }
}

export class CommentElement extends DomElement {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<!--' + this.content + '-->';
  }
}

export class DeclarationElement extends DomElement {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<!' + this.content + '>';
  }
}

export class ProcessingElement extends DomElement {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<?' + this.content + '>';
  }
}

export class TextElement extends DomElement {
  constructor(content: string) { super(content); }

  toString(): string {
    return this.content;
  }
}

export class UnmatchedClosingTag extends DomElement {
  constructor(content: string) { super(content); }

  toString(): string {
    return '</' + this.content.toUpperCase() + '>';
  }
}

export class DomNode extends DomElement {
  attributes: string[];
  children: DomElement[];
  closureState = ClosureState.UNCLOSED;
  synthetic?: boolean;
  tagLc: string;
  values: Record<string, string>;

  constructor(public tag: string, synthetic?: boolean) {
    super(null);
    this.tagLc = tag.toLowerCase();

    if (synthetic)
      this.synthetic = true;
  }

  addAttribute(name: string, value: string): void {
    this.attributes = this.attributes || [];
    this.attributes.push(name);
    this.values = this.values || {};
    this.values[name] = value;
  }

  addChild(child: DomElement, leadingSpace?: string): void {
    this.children = this.children || [];

    if (this.children.length > 0 && this.children[this.children.length - 1] instanceof TextElement)
      this.children[this.children.length - 1].content += leadingSpace || '';

    this.children.push(child);
    child.parent = this;
  }
}

export class DomModel {
  private root: DomNode = new DomNode('/');

  private currentFormatElem: DomNode;
  private currentFormatting: DomNode[] = [];
  private currentNode = this.root;
  private inTable = 0;
  private openStack = [this.root];
  private xmlMode = false;

  getRoot(): DomNode {
    return this.root;
  }

  addAttribute(name: string, value: string): void {
    this.currentNode.addAttribute(name, value);
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

  addChild(child: DomElement, leadingSpace?: string, pending_th = false): void {
    if (this.inTable > 0 && child instanceof DomNode && /^(td|th)$/.test(child.tagLc) && this.currentNode.tagLc !== 'tr') {
      const newParent = new DomNode('tr', true);

      this.addChild(newParent, '', child.tagLc === 'th');
      this.openStack.push(newParent);
      this.currentNode = newParent;
    }
    else if (this.inTable > 0 && child instanceof DomNode && child.tagLc === 'tr' &&  !/^(tbody|thead|table)$/.test(this.currentNode.tagLc)) {
      const newParent = new DomNode(pending_th ? 'thead' : 'tbody', true);

      this.addChild(newParent);
      this.openStack.push(newParent);
      this.currentNode = newParent;
    }

    this.currentNode.addChild(child, leadingSpace);
  }

  push(node: DomNode): void {
    this.openStack.push(node);
    this.currentNode = node;

    if (node.tagLc === 'table')
      ++this.inTable;

    if (FORMATTING_ELEMENTS.has(node.tagLc) || MARKER_ELEMENTS.has(node.tagLc)) {
      this.currentFormatting.push(node);
      this.currentFormatElem = node;
    }
  }

  private getFormattingElement(tagLc: string): DomNode {
    let formattingElem: DomNode;

    for (let i = this.currentFormatting.length - 1; i >= 0; --i) {
      const elem = this.currentFormatting[i];

      if (elem.tagLc === tagLc) {
        formattingElem = elem;
        break;
      }
      else if (MARKER_ELEMENTS.has(elem.tagLc))
        break;
    }

    if (!formattingElem && this.currentFormatting.length > 0 && this.currentFormatting[0].tagLc === tagLc)
      return this.currentFormatting[0];
    else
      return formattingElem;
  }

  private isInScope(tagLc: string, scopeLimits: Set<string>): boolean {
    for (let i = this.openStack.length - 1; i >= 0; --i) {
      const elem = this.openStack[i];

      if (elem.tagLc === tagLc)
        return true;
      else if (scopeLimits.has(elem.tagLc))
        return false;
    }

    return false;
  }

  private getFurthestBlock(tagLc: string): DomNode {
    let start: number;

    for (start = this.openStack.length - 1; start >= 0 && this.openStack[start].tagLc !== tagLc; --start) {}

    if (start < 0)
      return undefined;

    for (let i = start + 1; i < this.openStack.length; ++i) {
      const elem = this.openStack[i];

      if (SPECIAL_ELEMENTS.has(elem.tagLc))
        return elem;
    }

    return undefined;
  }

  private getFosterParent(): [DomNode, number] {
    let fosterParent: DomNode;
    let insertionIndex = -1;

    for (let i = this.openStack.length - 1; i > 0; --i) {
      if (this.openStack[i].tagLc === 'table') {
        fosterParent = this.openStack[i - 1];
        insertionIndex = fosterParent.children.indexOf(this.openStack[i]);
        break;
      }
    }

    if (!fosterParent)
      fosterParent = this.openStack.find(node => node.tagLc === 'html') || this.root;

    return [fosterParent, insertionIndex];
  }

  pop(tagLc?: string): void {
    let popped = false;
    let unmatched = false;

    if (!tagLc || this.currentNode.tagLc === tagLc) {
      popped = true;
      this.openStack.pop();

      if (tagLc === null)
        this.currentNode.closureState = ClosureState.SELF_CLOSED;
      else
        this.currentNode.closureState = ClosureState.EXPLICITLY_CLOSED;

      if (this.currentFormatElem && this.currentFormatElem.tagLc === tagLc) {
        this.currentFormatting.pop();
        this.currentFormatElem = last(this.currentFormatting);
      }
    }
    else if (FORMATTING_ELEMENTS.has(tagLc)) {
      // The following is adapted from https://html.spec.whatwg.org/multipage/parsing.html#adoptionAgency
      let formatElem: DomNode;
      let parseError = false;

      for (let i = 0; i < 8; ++i) {
        formatElem = this.getFormattingElement(tagLc);

        if (!formatElem)
          break;
        else if (this.openStack.indexOf(formatElem) < 0) {
          this.currentFormatting.splice(this.currentFormatting.indexOf(formatElem), 1);
          this.currentFormatElem = last(this.currentFormatting);
          parseError = true;
          unmatched = true;
          break;
        }
        else if (!this.isInScope(tagLc, SCOPE_ELEMENTS)) {
          parseError = true;
          unmatched = true;
          break;
        }
        else if (formatElem !== this.currentNode)
          parseError = true;

        const furthestBlock = this.getFurthestBlock(tagLc);

        if (!furthestBlock)
          break;

        popped = true;

        const commonAncestor = formatElem.parent;
        let bookmark = this.currentFormatting.indexOf(formatElem);
        let node = furthestBlock;
        let lastNode = furthestBlock;
        let nodeIndex: number;
        let newElem: DomNode;

        for (let j = 0; j < 3; ++j) {
          node = node.parent;
          nodeIndex = this.currentFormatting.indexOf(node);

          if (nodeIndex < 0) {
            this.openStack.splice(this.openStack.indexOf(node), 1);
            continue;
          }
          else if (node === formatElem)
            break;

          newElem = new DomNode(tagLc, true);

          this.currentFormatting[nodeIndex] = newElem;
          this.openStack[this.openStack.indexOf(node)] = newElem;
          node = newElem;

          if (lastNode === furthestBlock)
            bookmark = nodeIndex;

          node.addChild(lastNode);
          lastNode = node;
        }

        if (FOSTER_PARENT_SPECIAL_TARGETS.has(commonAncestor.tagLc)) {
          const [fosterParent, insertionIndex] = this.getFosterParent();

          if (insertionIndex < 0)
            fosterParent.addChild(lastNode);
          else {
            fosterParent.children.splice(insertionIndex, 0, lastNode);
            lastNode.parent = fosterParent;
          }
        }
        else
          commonAncestor.addChild(lastNode);

        newElem = new DomNode(tagLc, true);
        newElem.children = furthestBlock.children;
        furthestBlock.children = [newElem];
        newElem.parent = furthestBlock;

        let formatElemIndex = this.currentFormatting.indexOf(formatElem);

        if (bookmark === formatElemIndex)
          this.currentFormatting[bookmark] = newElem;
        else {
          if (bookmark < formatElemIndex)
            ++formatElemIndex;

          this.currentFormatting.splice(bookmark, 0, newElem);
          this.currentFormatting.splice(formatElemIndex, 1);
        }

        formatElemIndex = this.openStack.indexOf(formatElem);
        this.openStack.splice(formatElemIndex, 1);

        const furthestBlockIndex = this.openStack.indexOf(furthestBlock);

        this.openStack.splice(furthestBlockIndex + 1, 0, newElem);
      }
    }

    if (!popped && !unmatched) {
      const nodeIndex = this.openStack.map(node => node.tagLc).lastIndexOf(tagLc);

      if (nodeIndex > 0) { // No, not >= 0, on purpose!
        while (this.openStack.length > nodeIndex) {
          this.currentNode.closureState = ClosureState.IMPLICITLY_CLOSED;
          this.openStack.pop();

          if (this.currentFormatElem && this.currentFormatElem.tagLc === this.currentNode.tagLc) {
            this.currentFormatting.pop();
            this.currentFormatElem = last(this.currentFormatting);
          }

          if (this.currentNode.tagLc === 'table')
            --this.inTable;

          this.updateCurrentNode();
        }
      }
      else
        this.addChild(new UnmatchedClosingTag(tagLc));
    }

    if (this.openStack.length === 0)
      this.openStack.push(this.root);

    this.updateCurrentNode();

    this.inTable = 0;
    this.openStack.forEach(node => this.inTable += (node.tagLc === 'table' ? 1 : 0));
  }

  getUnclosedTagCount(): number {
    return Math.max(this.openStack.length - 1, 0);
  }

  private updateCurrentNode(): void {
    this.currentNode = last(this.openStack) || this.root;
  }
}
