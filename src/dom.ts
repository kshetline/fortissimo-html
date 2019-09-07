import { FORMATTING_ELEMENTS, FOSTER_PARENT_SPECIAL_TARGETS, MARKER_ELEMENTS, OPEN_IMPLIES_CLOSE,
  SCOPE_ELEMENTS, SPECIAL_ELEMENTS } from './elements';

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
  IMPLICITLY_CLOSED,
  PROGRAMMATICALLY_CLOSED
}

export abstract class DomElement {
  parent: DomNode;

  protected constructor(public content: string) {}

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
    return this.toString() + ' (' + this.depth + (this.parent ? ', ' + this.parent.tag : '') + ')';
  }
}

export class CData extends DomElement {
  constructor(content: string) { super(content); }

  toString(): string {
    return '<![CDATA[' + this.content + ']]>';
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

export class DocType extends DeclarationElement {
  type: 'html' | 'xhtml';
  variety: 'frameset' | 'strict' | 'transitional';
  version: string;

  constructor(content: string) {
    super(content);

    this.type = /\bxhtml\b/i.test(content) ? 'xhtml' : 'html';
    this.variety = (/\b(frameset|strict|transitional)\b/i.exec(content.toLowerCase()) || [])[1] as any;
    this.version = (/\bx?html\s*([.\d]+)\b/i.exec(content) || [])[1] as any;

    if (!this.version && /^doctype\s+html\s*$/i.test(content))
      this.version = '5';
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

  constructor(public tag: string, caseSensitive = false, synthetic = false) {
    super(null);
    this.tagLc = caseSensitive ? tag : tag.toLowerCase();

    if (synthetic)
      this.synthetic = true;
  }

  addAttribute(name: string, value: string): void {
    // Ignore duplicate attribute names - first provided takes priority
    if (this.values && name in this.values)
      return;

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

  removeChild(child: DomElement): boolean {
    if (this.children) {
      const index = this.children.indexOf(child);

      if (index >= 0) {
        this.children.splice(index, 1);
        child.parent = undefined;

        return true;
      }
    }

    return false;
  }

  detach(): DomNode {
    if (this.parent)
      this.parent.removeChild(this);

    return this;
  }

  partialClone(synthetic?: boolean): DomNode {
    const clone = new DomNode(this.tag, true, synthetic || this.synthetic);

    clone.tagLc = this.tagLc;
    clone.attributes = this.attributes && this.attributes.slice(0);

    if (this.values)
      clone.values = Object.assign({}, this.values);

    return clone;
  }

  toJSON(): any {
    const json: any = { tag: this.tag };

    if (this.synthetic)
      json.synthetic = true;

    if (this.content)
      json.content = this.content;

    json.depth = this.depth;
    json.closureState = this.closureState;

    if (this.values)
      json.value = this.values;

    if (this.parent)
      json.parentTag = this.parent.tag;

    if (this.children)
      json.children = this.children;

    return json;
  }
}

export class DomModel {
  private root: DomNode = new DomNode('/', false, true);

  private currentFormatElem: DomNode;
  private currentFormatting: DomNode[] = [];
  private currentNode = this.root;
  private inMathOrSvg = 0;
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
    if (!this.xmlMode) {
      this.reconstructFormattingIfNeeded();

      if (this.inTable > 0 && child instanceof DomNode && /^(td|th)$/.test(child.tagLc) &&
          this.currentNode.tagLc !== 'tr') {
        const newParent = new DomNode('tr', false, true);

        this.addChild(newParent, '', child.tagLc === 'th');
        this.openStack.push(newParent);
        this.currentNode = newParent;
      }
      else if (this.inTable > 0 && child instanceof DomNode && child.tagLc === 'tr' &&
               !/^(tbody|thead|table)$/.test(this.currentNode.tagLc)) {
        const newParent = new DomNode(pending_th ? 'thead' : 'tbody', false, true);

        this.addChild(newParent);
        this.openStack.push(newParent);
        this.currentNode = newParent;
      }
    }

    this.currentNode.addChild(child, leadingSpace);
  }

  private reconstructFormattingIfNeeded(): void {
    // Adapted from https://html.spec.whatwg.org/multipage/parsing.html#reconstruct-the-active-formatting-elements.

    // Step 1.
    if (this.currentFormatting.length === 0)
      return;

    // Steps 2-4, rearranged from the original "goto" logic.
    let entryIndex = this.currentFormatting.length - 1;
    let entry = this.currentFormatting[entryIndex];
    let skipAdvance = false;

    if (MARKER_ELEMENTS.has(entry.tagLc) || this.openStack.indexOf(entry) >= 0)
      return;

    // "Rewind"
    do {
      if (entryIndex === 0) {
        skipAdvance = true;
        break;
      }

      // Step 5
      entry = this.currentFormatting[--entryIndex];
    } while (!MARKER_ELEMENTS.has(entry.tagLc) && this.openStack.indexOf(entry) < 0); // <- Step 6

    // Step 7, "Advance"
    do {
      if (skipAdvance)
        skipAdvance = false;
      else
        entry = this.currentFormatting[++entryIndex];

      // Step 8, "Create"
      entry = entry.partialClone(true);
      // Step 9
      last(this.openStack).addChild(entry);
      this.openStack.push(entry);
      this.currentNode = entry;
      this.currentFormatting[entryIndex] = entry;
    } while (entryIndex < this.currentFormatting.length - 1); // <- Step 10
  }

  push(node: DomNode): void {
    this.reconstructFormattingIfNeeded();

    this.openStack.push(node);
    this.currentNode = node;

    if (node.tagLc === 'table')
      ++this.inTable;
    else if (node.tagLc === 'math' || node.tagLc === 'svg')
      ++this.inMathOrSvg;

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
    // This is a simplified version of https://html.spec.whatwg.org/multipage/parsing.html#foster-parent,
    // with handling for <template> elements removed.
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

  private invokeAdoptionAgency(tagLc: string): [boolean, boolean] {
    // The following is adapted from https://html.spec.whatwg.org/multipage/parsing.html#adoptionAgency.
    let formatElem: DomNode;
    let popped = false;
    let parseError = false;

    // Steps 1 and 2 taken care of before this method is called.
    // Steps 3-5, "Outer loop"
    for (let i = 0; i < 8; ++i) {
      // Step 6
      formatElem = this.getFormattingElement(tagLc);

      if (!formatElem)
        break;
      // Step 7
      else if (this.openStack.indexOf(formatElem) < 0) {
        this.currentFormatting.splice(this.currentFormatting.indexOf(formatElem), 1);
        this.currentFormatElem = last(this.currentFormatting);
        parseError = true;
        break;
      }
      // Step 8
      else if (!this.isInScope(tagLc, SCOPE_ELEMENTS)) {
        parseError = true;
        break;
      }
      // Step 9
      else if (formatElem !== this.currentNode)
        parseError = true;

      // Step 10
      const furthestBlock = this.getFurthestBlock(tagLc);

      // Step 11
      if (!furthestBlock)
        break; // By leaving this loop, the details described for step 11 will be taken care of later.

      popped = true;

      // Step 12
      const commonAncestor = formatElem.parent;
      // Step 13
      let bookmark = this.currentFormatting.indexOf(formatElem);
      // Step 14
      let node = furthestBlock;
      let lastNode = furthestBlock;
      let newElem: DomNode;

      // Steps 14.1-14.2, "Inner Loop"
      for (let j = 1; ; ++j) {
        // Step 14.3
        node = node.parent;

        // Step 14.4
        if (node === formatElem)
          break;

        // Step 14.5
        const nodeIndex = this.currentFormatting.indexOf(node);

        if (j > 3 && nodeIndex >= 0)
          this.currentFormatting.splice(nodeIndex, 1);
        // Step 14.6
        else if (nodeIndex < 0) {
          const stackIndex = this.openStack.indexOf(node);

          node.closureState = ClosureState.PROGRAMMATICALLY_CLOSED;
          this.openStack.splice(stackIndex, 1);

          if (stackIndex < this.openStack.length)
            this.openStack[stackIndex].parent = this.openStack[stackIndex - 1];

          continue;
        }

        // Step 14.7
        newElem = formatElem.partialClone(true);
        newElem.closureState = ClosureState.PROGRAMMATICALLY_CLOSED;

        this.currentFormatting[nodeIndex] = newElem;
        this.openStack[this.openStack.indexOf(node)] = newElem;
        node = newElem;

        // Step 14.8
        if (lastNode === furthestBlock)
          bookmark = nodeIndex;

        // Steps 14.9-14.11
        node.addChild(lastNode.detach());
        lastNode = node;
      }

      // Step 15
      if (FOSTER_PARENT_SPECIAL_TARGETS.has(commonAncestor.tagLc)) {
        const [fosterParent, insertionIndex] = this.getFosterParent();

        if (insertionIndex < 0)
          fosterParent.addChild(lastNode);
        else {
          fosterParent.children.splice(insertionIndex, 0, lastNode);
          lastNode.parent = fosterParent;
        }

        lastNode.parent = fosterParent;
      }
      else
        commonAncestor.addChild(lastNode.detach());

      // Step 16
      newElem = formatElem.partialClone(true);
      formatElem.closureState = ClosureState.PROGRAMMATICALLY_CLOSED;
      // Step 17
      newElem.children = furthestBlock.children;
      newElem.children.forEach(child => child.parent = newElem);
      // Step 18
      furthestBlock.children = [newElem];
      newElem.parent = furthestBlock;
      newElem.closureState = ClosureState.PROGRAMMATICALLY_CLOSED;

      // Step 19
      let formatElemIndex = this.currentFormatting.indexOf(formatElem);

      if (bookmark === formatElemIndex)
        this.currentFormatting[bookmark] = newElem;
      else {
        if (bookmark < formatElemIndex)
          ++formatElemIndex;

        this.currentFormatting.splice(bookmark, 0, newElem);
        this.currentFormatting.splice(formatElemIndex, 1);
      }

      // Step 20, part 1
      formatElemIndex = this.openStack.indexOf(formatElem);
      this.openStack.splice(formatElemIndex, 1);

      // Implementing Step 20, part 2 ("...and insert the new element into the stack of open elements
      // immediately below the position of *furthest block* in that stack.") causes problems in this
      // implementation (and doesn't make a lot of sense), so it's been left out.

      // Step 21 (loop back)
    }

    return [popped, parseError];
  }

  pop(tagLc?: string): boolean {
    let popped = false;
    let parseError = false;

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
    else if (!this.xmlMode && FORMATTING_ELEMENTS.has(tagLc))
      [popped, parseError] = this.invokeAdoptionAgency(tagLc);

    if (!popped) {
      const nodeIndex = this.openStack.map(node => node.tagLc).lastIndexOf(tagLc);

      if (!this.xmlMode && nodeIndex > 0) { // No, I really don't want >= 0.
        if (FORMATTING_ELEMENTS.has(tagLc)) {
          for (let i = this.currentFormatting.length - 1; i >= 0; --i) {
            const node = this.currentFormatting[i];

            if (node.tagLc === tagLc) {
              node.closureState = ClosureState.EXPLICITLY_CLOSED;
              this.currentFormatting.splice(i, 1);
              break;
            }
            else if (MARKER_ELEMENTS.has(node.tagLc))
              break;
          }
        }
        else if (MARKER_ELEMENTS.has(tagLc)) {
          for (let i = this.currentFormatting.length - 1; i >= 0; --i) {
            const node = this.currentFormatting[i];

            if (node.tagLc === tagLc) {
              this.currentFormatting.splice(i, this.currentFormatting.length - i);
              break;
            }
          }
        }

        while (this.openStack.length > nodeIndex) {
          if (!this.currentNode.closureState)
            this.currentNode.closureState = ClosureState.IMPLICITLY_CLOSED;

          this.openStack.pop();
          this.updateCurrentNode();
        }
      }
      else {
        this.addChild(new UnmatchedClosingTag(tagLc));
        parseError = true;
      }
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
