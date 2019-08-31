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

export type DomChild = DomNode | string | SpecialNode;

export class DomNode {
  attributes: string[];
  values: Record<string, string>;
  children: DomChild[];

  constructor(public tag: string) {}

  addAttribute(name: string, value: string): void {
    this.attributes = this.attributes || [];
    this.attributes.push(name);
    this.values = this.values || {};
    this.values[name] = value;
  }

  addChild(child: DomChild, leadingSpace?: string): void {
    this.children = this.children || [];

    if (this.children.length > 0 && typeof this.children[this.children.length - 1] === 'string')
      this.children[this.children.length - 1] += leadingSpace;

    this.children.push(child);
  }

  // TODO: Case sensitivity
  equals(node: DomNode): boolean {
    if (!node || this.tag !== node.tag)
      return false;
    else if ((!node.attributes || node.attributes.length === 0) && (!this.attributes || this.attributes.length === 0))
      return true;
    else if (node.attributes.length !== this.attributes.length)
      return false;

    for (const attrib in node.attributes) {
      if (node.values[attrib] !== this.values[attrib])
        return false;
    }

    return true;
  }
}
