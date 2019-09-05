import { processMillis } from './util';
import { VOID_ELEMENTS } from './elements';
import { fixBadChars, isAttributeNameChar, isMarkupStart, isPCENChar, isWhiteSpace } from './characters';
import { CData, CommentElement, DeclarationElement, DomModel, DomNode, ProcessingElement, TextElement } from './dom';

export interface HtmlParserOptions {
  eol?: string;
  fixBadChars?: boolean;
}

enum State {
  OUTSIDE_MARKUP,
  AT_MARKUP_START,
  AT_CLOSE_TAG_START,
  IN_CLOSE_TAG,
  AT_DECLARATION_START,
  AT_COMMENT_START,
  AT_PROCESSING_START,
  AT_OPEN_TAG_START,
  AT_ATTRIBUTE_START,
  AT_ATTRIBUTE_ASSIGNMENT,
  AT_ATTRIBUTE_VALUE,
  IN_SCRIPT_ELEMENT,
  IN_STYLE_ELEMENT,
  IN_TEXT_AREA_ELEMENT,
}

const DEFAULT_OPTIONS: HtmlParserOptions = {
  eol: '\n',
  fixBadChars: false,
};

const DEFAULT_YIELD_TIME = 50;

const tagForState = {
  [State.IN_SCRIPT_ELEMENT]: 'script',
  [State.IN_STYLE_ELEMENT]: 'style',
  [State.IN_TEXT_AREA_ELEMENT]: 'textarea',
};

type AttributeCallback = (leadingSpace: string, name: string, equalSign: string, value: string, quote: string) => void;
type BasicCallback = (depth: number, leadingSpace: string, text: string, trailing?: string) => void;
type EndCallback = (finalSpace?: string, dom?: DomNode, unclosedTagCount?: number) => void;
type ErrorCallback = (error: string, line?: number, column?: number, source?: string) => void;

export class HtmlParser {
  private callbackAttribute: AttributeCallback;
  private callbackCloseTag: BasicCallback;
  private callbackCData: BasicCallback;
  private callbackComment: BasicCallback;
  private callbackDeclaration: BasicCallback;
  private callbackEnd: EndCallback;
  private callbackError: ErrorCallback;
  private callbackOpenTagEnd: BasicCallback;
  private callbackOpenTagStart: BasicCallback;
  private callbackProcessing: BasicCallback;
  private callbackText: BasicCallback;
  private callbackUnhandled: BasicCallback;

  private attribute = '';
  private collectedSpace = '';
  private column = 0;
  private currentTag = '';
  private currentTagLc = '';
  private dom = new DomModel();
  private leadingSpace = '';
  private lineNumber  = 1;
  readonly options: HtmlParserOptions;
  private parsingResolver: (node: DomNode) => void;
  private pendingSource = '';
  private preEqualsSpace = '';
  private putBacks: string[] = [];
  private srcIndex = 0;
  private state = State.OUTSIDE_MARKUP;
  private yieldTime = DEFAULT_YIELD_TIME;
  private xmlMode = false;

  constructor(
    private htmlSource: string,
    options = DEFAULT_OPTIONS
  ) {
    this.options = {};
    Object.assign(this.options, options);
    this.adjustOptions();
  }

  onAttribute(callback: AttributeCallback): HtmlParser {
    this.callbackAttribute = callback;
    return this;
  }

  onCData(callback: BasicCallback): HtmlParser {
    this.callbackCData = callback;
    return this;
  }

  onCloseTag(callback: BasicCallback): HtmlParser {
    this.callbackCloseTag = callback;
    return this;
  }

  onComment(callback: BasicCallback): HtmlParser {
    this.callbackComment = callback;
    return this;
  }

  onDeclaration(callback: BasicCallback): HtmlParser {
    this.callbackDeclaration = callback;
    return this;
  }

  onEnd(callback: EndCallback): HtmlParser {
    this.callbackEnd = callback;
    return this;
  }

  onError(callback: ErrorCallback): HtmlParser {
    this.callbackError = callback;
    return this;
  }

  onOpenTagEnd(callback: BasicCallback): HtmlParser {
    this.callbackOpenTagEnd = callback;
    return this;
  }

  onOpenTagStart(callback: BasicCallback): HtmlParser {
    this.callbackOpenTagStart = callback;
    return this;
  }

  onProcessing(callback: BasicCallback): HtmlParser {
    this.callbackProcessing = callback;
    return this;
  }

  onText(callback: BasicCallback): HtmlParser {
    this.callbackText = callback;
    return this;
  }

  onUnhandled(callback: BasicCallback): HtmlParser {
    this.callbackUnhandled = callback;
    return this;
  }

  parse(): DomNode {
    if (!this.callbackEnd)
      throw new Error('onEnd callback must be specified');

    this.callbackCloseTag = this.callbackCloseTag || this.callbackUnhandled;
    this.callbackText = this.callbackText || this.callbackUnhandled;

    this.parseLoop();

    return this.dom.getRoot();
  }

  async parseAsync(yieldTime = DEFAULT_YIELD_TIME): Promise<DomNode> {
    this.yieldTime = yieldTime;
    setTimeout(() => this.parseLoop());

    return new Promise<DomNode>(resolve => {
      this.parsingResolver = resolve;
    });
  }

  private parseLoop(): void {
    let ch: string;
    let content: string;
    let terminated: boolean;
    let isCData: boolean;
    let closeTag: string;
    let node: DomNode;
    const startTime = processMillis();

    while ((ch = this.getNonSpace()) !== undefined) {
      switch (this.state) {
        case State.OUTSIDE_MARKUP:
          this.putBack(ch);

          let [text, nextWSStart] = this.gatherText();
          if (text) {
            const collected = this.collectedSpace;

            if (nextWSStart > 0) {
              this.collectedSpace = text.substr(nextWSStart);
              text = text.substr(0, nextWSStart);
            }
            else
              this.collectedSpace = '';

            this.dom.addChild(new TextElement(collected + text));

            if (this.callbackText)
              this.callbackText(this.dom.getDepth() + 1, collected, text, '');

            this.pendingSource = '';
          }

          this.state = State.AT_MARKUP_START;
        break;

        case State.AT_MARKUP_START:
          switch (ch) {
            case '/':
              this.state = State.AT_CLOSE_TAG_START;
            break;

            case '!':
            case '?':
              this.state = (ch === '!' ? State.AT_DECLARATION_START : State.AT_PROCESSING_START);
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
            break;

            default:
              this.state = State.AT_OPEN_TAG_START;
              this.putBack(ch);
          }
        break;

        case State.AT_OPEN_TAG_START:
          this.gatherTagName(ch);

          node = new DomNode(this.currentTag);
          this.dom.prePush(node);
          this.dom.addChild(node, this.collectedSpace);
          this.dom.push(node);

          if (this.callbackOpenTagStart)
            this.callbackOpenTagStart(this.dom.getDepth(), this.collectedSpace, this.currentTag);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.dom.getDepth(), this.collectedSpace, '<' + this.currentTag);

          this.collectedSpace = '';
          this.pendingSource = '';
          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_CLOSE_TAG_START:
          this.gatherTagName(ch);
          this.state = State.IN_CLOSE_TAG;
          this.leadingSpace = this.collectedSpace;
          this.collectedSpace = '';
        break;

        case State.IN_CLOSE_TAG:
          if (ch !== '>') {
            this.reportError('Syntax error in close tag');
            break;
          }
          else {
            this.pop(this.currentTagLc);
            this.doCloseTagCallback(this.leadingSpace, this.currentTag, this.collectedSpace);
          }
        break;

        case State.AT_ATTRIBUTE_START:
          let end = '>';

          if (ch === '/') {
            end = '/>';
            ch = this.getChar();
          }

          if (ch !== '>') {
            if (end.length > 1) {
              this.reportError(`Syntax error in <${this.currentTag}>`);
              break;
            }

            if (isAttributeNameChar(ch)) {
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
              this.gatherAttributeName(ch);
              this.state = State.AT_ATTRIBUTE_ASSIGNMENT;
            }
            else {
              this.reportError(`Syntax error in <${this.currentTag}>`);
              break;
            }
          }
          else {
            if (this.callbackOpenTagEnd)
              this.callbackOpenTagEnd(this.dom.getDepth(), this.collectedSpace, this.currentTag, end);
            else if (this.callbackUnhandled)
              this.callbackUnhandled(this.dom.getDepth(), this.collectedSpace, end);

            this.collectedSpace = '';
            this.pendingSource = '';

            if (end.length > 1 ||  VOID_ELEMENTS.has(this.currentTagLc)) {
              this.pop(null);
              this.state = State.OUTSIDE_MARKUP;
            }
            else if (this.currentTagLc === 'script')
              this.state = State.IN_SCRIPT_ELEMENT;
            else if (this.currentTagLc === 'style')
              this.state = State.IN_STYLE_ELEMENT;
            else if (this.currentTagLc === 'textarea')
              this.state = State.IN_TEXT_AREA_ELEMENT;
            else
              this.state = State.OUTSIDE_MARKUP;
          }
        break;

        case State.AT_ATTRIBUTE_ASSIGNMENT:
          if (ch === '=') {
            this.preEqualsSpace = this.collectedSpace;
            this.state = State.AT_ATTRIBUTE_VALUE;
          }
          else {
            this.doAttributeCallback();
            this.putBack(ch);
            this.dom.addAttribute(this.attribute, '');
            this.state = State.AT_ATTRIBUTE_START;
          }
        break;

        case State.AT_ATTRIBUTE_VALUE:
          if (ch === '>') {
            this.doAttributeCallback(this.preEqualsSpace + '=');
            this.dom.addAttribute(this.attribute, '');
            this.putBack(ch);
          }
          else {
            const quote = (ch === '"' || ch === "'") ? ch : '';
            const value = this.gatherAttributeValue(quote, quote ? '' : ch);

            this.doAttributeCallback(this.preEqualsSpace + '=' + this.collectedSpace, value, quote);
            this.dom.addAttribute(this.attribute, value);
            this.collectedSpace = '';
          }

          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_DECLARATION_START:
          if (this.collectedSpace.length === 0 && ch === '-') {
            const ch2 = this.getChar();

            if (ch2 === '-') {
              this.state = State.AT_COMMENT_START;
              break;
            }
            else
              this.putBack(ch2);
          }

          [content, terminated, isCData] = this.gatherDeclarationOrProcessing(this.collectedSpace + ch,
            this.dom.shouldParseCData());

          if (isCData) {
            this.dom.addChild(new CData(content), this.leadingSpace);

            if (!terminated)
              this.reportError('File ended in unterminated CDATA');
            else if (this.callbackCData)
              this.callbackCData(this.dom.getDepth() + 1, this.leadingSpace, content);
            else if (this.callbackUnhandled)
              this.callbackUnhandled(this.dom.getDepth() + 1, this.leadingSpace, '<![CDATA[' + content + ']]>');
          }
          else {
            this.dom.addChild(new DeclarationElement(content), this.leadingSpace);

            if (!terminated)
              this.reportError('File ended in unterminated declaration');
            else if (this.callbackDeclaration)
              this.callbackDeclaration(this.dom.getDepth() + 1, this.leadingSpace, content);
            else if (this.callbackUnhandled)
              this.callbackUnhandled(this.dom.getDepth() + 1, this.leadingSpace, '<!' + content + '>');
          }

          this.collectedSpace = '';
          this.pendingSource = '';
          this.leadingSpace = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.AT_PROCESSING_START:
          [content, terminated] = this.gatherDeclarationOrProcessing(this.collectedSpace + ch);

          this.dom.addChild(new ProcessingElement(content), this.leadingSpace);

          if (!terminated)
            this.reportError('File ended in unterminated processing instruction');
          else if (this.callbackProcessing)
            this.callbackProcessing(this.dom.getDepth() + 1, this.leadingSpace, content);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.dom.getDepth() + 1, this.leadingSpace, '<?' + content + '>');

          if (content.startsWith('xml ') && this.dom.canDoXmlMode()) {
            this.xmlMode = true;
            this.dom.setXmlMode(true);
          }

          this.collectedSpace = '';
          this.pendingSource = '';
          this.leadingSpace = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.AT_COMMENT_START:
          [content, terminated] = this.gatherComment(this.collectedSpace + ch);

          this.dom.addChild(new CommentElement(content), this.leadingSpace);

          if (!terminated)
            this.reportError('File ended in unterminated comment');
          else if (this.callbackComment)
            this.callbackComment(this.dom.getDepth() + 1, this.leadingSpace, content);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.dom.getDepth() + 1, this.leadingSpace, '<|--' + content + '-->');

          this.collectedSpace = '';
          this.pendingSource = '';
          this.leadingSpace = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.IN_STYLE_ELEMENT:
        case State.IN_SCRIPT_ELEMENT:
        case State.IN_TEXT_AREA_ELEMENT:
          const tag = tagForState[this.state];

          [content, closeTag, terminated] = this.gatherUntilEndTag(tag, ch);

          if (!terminated)
            this.reportError(`File ended in unterminated ${tag} section`);
          else {
            if (content) {
              let trailingWhiteSpace = '';
              const $ = /^(.*?)(\s*)$/.exec(content);

              if ($) {
                content = $[1];
                trailingWhiteSpace = $[2];
              }

              this.dom.addChild(new TextElement(content));

              if (this.callbackText) {
                this.callbackText(this.dom.getDepth() + 1, this.collectedSpace, content, trailingWhiteSpace);
                content = this.collectedSpace + content + trailingWhiteSpace;
              }

              this.collectedSpace = '';
              this.pendingSource = '';
            }

            const $$ = new RegExp('^<\\/(' + tag + ')(\\s*)>$', 'i').exec(closeTag);

            this.pop();
            this.doCloseTagCallback('', $$[1], $$[2]);
          }
        break;
      }

      if (this.parsingResolver && processMillis() >= startTime + this.yieldTime) {
        setTimeout(() => this.parseLoop());
        return;
      }
    }

    if (this.state !== State.OUTSIDE_MARKUP)
      this.callbackError('Unexpected end of file', this.lineNumber, this.column);

    this.callbackEnd(this.collectedSpace, this.dom.getRoot(), this.dom.getUnclosedTagCount());

    if (this.parsingResolver)
      this.parsingResolver(this.dom.getRoot());
  }

  private pop(tagLc?: string) {
    if (!this.dom.pop(tagLc) && this.callbackError)
       this.callbackError(`Mismatched closing tag </${tagLc}>`, this.lineNumber, this.column, '');
  }

  private reportError(message: string) {
    if (this.callbackError)
      this.callbackError(message, this.lineNumber, this.column, this.pendingSource);

    this.state = State.OUTSIDE_MARKUP;
    this.collectedSpace = '';
    this.pendingSource = '';
  }

  private doCloseTagCallback(leadingSpace: string, tag: string, trailing: string) {
    if (this.callbackCloseTag)
      this.callbackCloseTag(this.dom.getDepth() + 1, leadingSpace, tag, trailing);
    else if (this.callbackUnhandled)
      this.callbackUnhandled(this.dom.getDepth() + 1, this.leadingSpace, '</' + tag, trailing + '>');

    this.state = State.OUTSIDE_MARKUP;
    this.collectedSpace = '';
    this.pendingSource = '';
  }

  private doAttributeCallback(equalSign = '', value = '', quote = ''): void {
    if (this.callbackAttribute)
      this.callbackAttribute(this.leadingSpace, this.attribute, equalSign, value, quote);
    else if (this.callbackUnhandled)
      this.callbackUnhandled(this.dom.getDepth(), this.leadingSpace, this.attribute + equalSign + quote + value + quote);

    this.pendingSource = '';
  }

  private getChar(): string {
    let ch: string;

    if (this.putBacks.length > 0) {
      ch = this.putBacks.pop();
      this.pendingSource += ch;

      if (ch === '\n' || ch === '\r' || ch === '\r\n') {
        ++this.lineNumber;
        this.column = 0;
      }
      else
        ++this.column;

      return ch;
    }

    if (this.srcIndex >= this.htmlSource.length)
      return undefined;
    else {
      ch = this.htmlSource.charAt(this.srcIndex++);

      if (ch === '\r' && this.htmlSource.charAt(this.srcIndex) === '\n') {
        ++this.srcIndex;
        ch += '\n';
      }
    }

    if (ch === '\n' || ch === '\r' || ch === '\r\n') {
      ++this.lineNumber;
      this.column = 0;

      if (this.options.eol)
        ch = this.options.eol;
    }
    else {
      const cp = ch.charCodeAt(0);

      ++this.column;

      if (0xD800 <= cp && cp <= 0xDBFF) {
        const ch2 = this.htmlSource.charAt(this.srcIndex);
        const cp2 = (ch2 && ch2.charCodeAt(0)) || 0;

        if (0xDC00 <= cp2 && cp2 <= 0xDFFF) {
          ++this.srcIndex;
          ch += ch2;
        }
      }
    }

    this.pendingSource += ch;

    return ch;
  }

  private putBack(ch: string): void {
    this.putBacks.push(ch);
    this.pendingSource = this.pendingSource.substr(0, this.pendingSource.length - ch.length);

    if (ch === '\n' || ch === '\r' || ch === '\r\n')
      --this.lineNumber;
    else
      --this.column;
  }

  private getNonSpace(): string {
    let ch;

    while (isWhiteSpace(ch = this.getChar())) {
      this.collectedSpace += ch;
    }

    return ch;
  }

  private gatherText(): [string, number] {
    let text = '';
    let ch: string;
    let nextWSStart = -1;
    let mightNeedRepair = false;

    this.eatWhiteSpace();

    while ((ch = this.getChar()) !== undefined) {
      if (ch === '<') {
        const ch2 = this.getChar();

        if (ch2 === '/') {
          const ch3 = this.getChar();

          if (ch3 !== '/' && isMarkupStart(ch3)) {
            this.putBack(ch3);
            this.putBack(ch2);
            break;
          }
          else {
            text += ch + ch2 + (ch3 || '');
            mightNeedRepair = true;
          }
        }
        else if (isMarkupStart(ch2)) {
          this.putBack(ch2);
          break;
        }
        else {
          text += ch + (ch2 || '');
          mightNeedRepair = true;
        }
      }
      else {
        if (isWhiteSpace(ch)) {
          if (nextWSStart < 0)
            nextWSStart = text.length;
        }
        else
          nextWSStart = -1;

        text += ch;

        if (ch === '>' || ch === '&')
          mightNeedRepair = true;
      }
    }

    if (mightNeedRepair && this.options.fixBadChars)
      text = fixBadChars(text);

    return [text, nextWSStart];
  }

  private gatherTagName(init = ''): void {
    this.currentTag = init;

    let ch: string;

    while (isPCENChar(ch = this.getChar()))
      this.currentTag += ch;

    this.currentTagLc = this.currentTag.toLowerCase();
    this.putBack(ch);
  }

  private gatherAttributeName(init = ''): void {
    this.attribute = init;

    let ch: string;

    while (isAttributeNameChar(ch = this.getChar()))
      this.attribute += ch;

    this.putBack(ch);
  }

  private gatherAttributeValue(quote: string, init = ''): string {
    let value = init;

    let ch: string;
    let afterSlash = false;

    while ((ch = this.getChar()) && ch !== quote && (quote || (!isWhiteSpace(ch) && ch !== '>'))) {
      value += ch;
      afterSlash = ch === '/';
    }

    if (!quote) {
      this.putBack(ch);

      if (afterSlash) {
        this.putBack('/');
        value = value.substr(0, value.length - 1);
      }
    }

    return value;
  }

  private gatherComment(init = ''): [string, boolean] {
    let comment = init;
    let stage = (init === '-' ? 1 : 0);
    let ch: string;

    while ((ch = this.getChar())) {
      comment += ch;

      if (stage === 0 && ch === '-')
        stage = 1;
      else if (stage === 1 && ch === '-')
        stage = 2;
      else if (stage === 2 && ch === '>') {
        return [comment.substr(0, comment.length - 3), true];
      }
      else
        stage = 0;
    }

    return [comment, false];
  }

  private gatherDeclarationOrProcessing(init = '', checkForCData?: boolean): [string, boolean, boolean] {
    if (init === '>')
      return ['', true, false];

    let content = init;
    let ch: string;
    let cdataDetected = false;

    while ((ch = this.getChar())) {
      if (checkForCData && content.length === 7) {
        cdataDetected = (content === '[CDATA[');
      }

      if (ch === '>' && (!cdataDetected || content.endsWith(']]')))
        return [cdataDetected ? content.substring(7, content.length - 2) : content, true, cdataDetected];

      content += ch;
   }

    return [content, false, false];
  }

  private gatherUntilEndTag(endTag: string, init = ''): [string, string, boolean] {
    const ender = '</' + endTag;
    const len = ender.length;
    let content = init;
    let endStage = 0;
    let ch: string;

    while ((ch = this.getChar())) {
      content += ch;

      if (endStage >= len && ch === '>')
        return [content.substr(0, content.length - endStage - 1), content.substr(content.length - endStage - 1), true];
      else if (endStage >= len && isWhiteSpace(ch))
        ++endStage;
      else if (endStage < len && ch.toLowerCase() === ender.charAt(endStage))
        ++endStage;
      else
        endStage = 0;
    }

    return [content, '', false];
  }

  private eatWhiteSpace(init?: string): void {
    if (init)
      this.collectedSpace = init;

    let ch;

    while (isWhiteSpace(ch = this.getChar()))
      this.collectedSpace += ch;

    this.putBack(ch);
  }

  private adjustOptions(): void {
    if (this.options.eol) {
      switch (this.options.eol) {
        case '\n':
        case 'n': this.options.eol = '\n'; break;

        case '\r':
        case 'r': this.options.eol = '\r'; break;

        case '\r\n':
        case 'rn': this.options.eol = '\r\n'; break;

        default: this.options.eol = undefined;
      }
    }
  }
}
