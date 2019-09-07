import { processMillis } from './util';
import { VOID_ELEMENTS } from './elements';
import { fixBadChars, isAttributeNameChar, isMarkupStart, isPCENChar, isWhiteSpace } from './characters';
import { CData, CommentElement, DeclarationElement, DocType, DomModel, DomNode, ProcessingElement,
  TextElement } from './dom';

export interface HtmlParserOptions {
  eol?: string | boolean;
  fixBadChars?: boolean;
}

enum State {
  OUTSIDE_MARKUP,
  AT_MARKUP_START,
  AT_END_TAG_START,
  IN_END_TAG,
  AT_DECLARATION_START,
  AT_COMMENT_START,
  AT_PROCESSING_START,
  AT_START_TAG_START,
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
type DocTypeCallback = (leadingSpace: string, docType: DocType) => void;
type EncodingCallback = (encoding: string, normalizedEncoding?: string, explicit?: boolean) => boolean;
type EndCallback = (finalSpace?: string, dom?: DomNode, unclosedTagCount?: number) => void;
type ErrorCallback = (error: string, line?: number, column?: number, source?: string) => void;

export class HtmlParser {
  private callbackAttribute: AttributeCallback;
  private callbackCData: BasicCallback;
  private callbackComment: BasicCallback;
  private callbackDeclaration: BasicCallback;
  private callbackDocType: DocTypeCallback;
  private callbackEncoding: EncodingCallback;
  private callbackEnd: EndCallback;
  private callbackEndTag: BasicCallback;
  private callbackError: ErrorCallback;
  private callbackProcessing: BasicCallback;
  private callbackRequestData: () => void;
  private callbackStartTagEnd: BasicCallback;
  private callbackStartTagStart: BasicCallback;
  private callbackText: BasicCallback;
  private callbackUnhandled: BasicCallback;

  private attribute = '';
  private charset = '';
  private checkingCharset = false;
  private collectedSpace = '';
  private column = 0;
  private contentType = false;
  private currentTag = '';
  private currentTagLc = '';
  private dom = new DomModel();
  private htmlSource: string;
  private htmlSourceIsFinal: boolean;
  private leadingSpace = '';
  private lineNumber  = 1;
  private nextChunk = '';
  private nextChunkIsFinal: boolean;
  readonly options: HtmlParserOptions;
  private parserFinished = false;
  private parsingResolver: (node: DomNode) => void;
  private parserStarted = false;
  private pendingCharset = '';
  private pendingSource = '';
  private preEqualsSpace = '';
  private putBacks: string[] = [];
  private resolveNextChunk: (gotMoreChars: string) => void;
  private sourceIndex = 0;
  private state = State.OUTSIDE_MARKUP;
  private yieldTime = DEFAULT_YIELD_TIME;
  private xmlMode = false;

  constructor(
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

  onComment(callback: BasicCallback): HtmlParser {
    this.callbackComment = callback;
    return this;
  }

  onDeclaration(callback: BasicCallback): HtmlParser {
    this.callbackDeclaration = callback;
    return this;
  }

  onDocType(callback: DocTypeCallback): HtmlParser {
    this.callbackDocType = callback;
    return this;
  }

  onEncoding(callback: EncodingCallback): HtmlParser {
    this.callbackEncoding = callback;
    return this;
  }

  onEnd(callback: EndCallback): HtmlParser {
    this.callbackEnd = callback;
    return this;
  }

  onEndTag(callback: BasicCallback): HtmlParser {
    this.callbackEndTag = callback;
    return this;
  }

  onError(callback: ErrorCallback): HtmlParser {
    this.callbackError = callback;
    return this;
  }

  onProcessing(callback: BasicCallback): HtmlParser {
    this.callbackProcessing = callback;
    return this;
  }

  onRequestData(callback: () => void): HtmlParser {
    this.callbackRequestData = callback;
    return this;
  }

  onStartTagEnd(callback: BasicCallback): HtmlParser {
    this.callbackStartTagEnd = callback;
    return this;
  }

  onStartTagStart(callback: BasicCallback): HtmlParser {
    this.callbackStartTagStart = callback;
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

  async parse(source = '', yieldTime = DEFAULT_YIELD_TIME): Promise<DomNode> {
    return this.parseAux(source, yieldTime, !!source);
  }

  parseChunk(chunk: string, isFinal = false, yieldTime = DEFAULT_YIELD_TIME) {
    if (!this.parserStarted) {
      // noinspection JSIgnoredPromiseFromCall
      this.parseAux(chunk, yieldTime, isFinal);

      return;
    }

    if (this.htmlSourceIsFinal)
      throw new Error('Parse will no longer accept addition input');

    this.htmlSourceIsFinal = isFinal || !chunk;

    if (this.resolveNextChunk) {
      if (!chunk)
        this.resolveNextChunk('');
      else {
        this.htmlSource = (this.nextChunk || '') + chunk;
        this.sourceIndex = 0;
        this.resolveNextChunk(this.getChar());
      }
    }
    else
      this.nextChunk = (this.nextChunk || '') + chunk;
  }

  reset(): void {
    this.charset = '';
    this.checkingCharset = false;
    this.collectedSpace = '';
    this.column = 0;
    this.contentType = false;
    this.dom = new DomModel();
    this.htmlSource = '';
    this.htmlSourceIsFinal = false;
    this.leadingSpace = '';
    this.lineNumber  = 1;
    this.nextChunk = '';
    this.nextChunkIsFinal = false;
    this.parserFinished = false;
    this.parserStarted = false;
    this.pendingCharset = '';
    this.pendingSource = '';
    this.putBacks = [];
    this.resolveNextChunk = null;
    this.sourceIndex = 0;
    this.state = State.OUTSIDE_MARKUP;
    this.xmlMode = false;
  }

  private async parseAux(source = '', yieldTime = DEFAULT_YIELD_TIME, isFinal = !!source): Promise<DomNode> {
    this.parserStarted = true;
    this.htmlSource = source || '';
    this.htmlSourceIsFinal = isFinal;

    this.callbackEndTag = this.callbackEndTag || this.callbackUnhandled;
    this.callbackText = this.callbackText || this.callbackUnhandled;

    return new Promise<DomNode>(resolve => {
      this.yieldTime = yieldTime;
      this.parsingResolver = resolve;

      const parse = () => {
        this.parseLoop().then(() => {
          if (!this.parserFinished)
            setTimeout(parse);
          else
            resolve();
        });
      };

      setTimeout(parse);
    });
  }

  private async parseLoop(): Promise<void> {
    let ch: string;
    let content: string;
    let terminated: boolean;
    let isCData: boolean;
    let endTag: string;
    let node: DomNode;
    const startTime = processMillis();

    while (true) {
      ch = this.getChar() || await this.getNextChunkChar();

      if (!ch)
        break;
      else if (isWhiteSpace(ch)) {
        this.collectedSpace += ch;
        continue;
      }

      switch (this.state) {
        case State.OUTSIDE_MARKUP:
          this.putBack(ch);

          let [text, nextWSStart] = await this.gatherText();
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
              this.state = State.AT_END_TAG_START;
            break;

            case '!':
            case '?':
              this.state = (ch === '!' ? State.AT_DECLARATION_START : State.AT_PROCESSING_START);
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
            break;

            default:
              this.state = State.AT_START_TAG_START;
              this.putBack(ch);
          }
        break;

        case State.AT_START_TAG_START:
          await this.gatherTagName(ch);

          node = new DomNode(this.currentTag);
          this.dom.prePush(node);
          this.dom.addChild(node, this.collectedSpace);
          this.dom.push(node);
          this.checkingCharset = (!this.charset && this.currentTagLc === 'meta');

          if (this.callbackStartTagStart)
            this.callbackStartTagStart(this.dom.getDepth(), this.collectedSpace, this.currentTag);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.dom.getDepth(), this.collectedSpace, '<' + this.currentTag);

          this.collectedSpace = '';
          this.pendingSource = '';
          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_END_TAG_START:
          await this.gatherTagName(ch);
          this.state = State.IN_END_TAG;
          this.leadingSpace = this.collectedSpace;
          this.collectedSpace = '';
        break;

        case State.IN_END_TAG:
          if (ch !== '>') {
            this.putBack(ch);
            this.pop(this.currentTagLc);
            this.reportError('Syntax error in end tag');
            break;
          }
          else {
            this.pop(this.currentTagLc);
            this.doEndTagCallback(this.leadingSpace, this.currentTag, this.collectedSpace);
          }
        break;

        case State.AT_ATTRIBUTE_START:
          let end = '>';

          if (ch === '/') {
            end = '/>';
            ch = this.getChar() || await this.getNextChunkChar();
          }

          if (ch !== '>') {
            if (end.length > 1) {
              this.reportError(`Syntax error in <${this.currentTag}>`);
              break;
            }

            if (isAttributeNameChar(ch)) {
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
              await this.gatherAttributeName(ch);
              this.state = State.AT_ATTRIBUTE_ASSIGNMENT;
            }
            else {
              this.reportError(`Syntax error in <${this.currentTag}>`);
              break;
            }
          }
          else {
            if (this.callbackStartTagEnd)
              this.callbackStartTagEnd(this.dom.getDepth(), this.collectedSpace, this.currentTag, end);
            else if (this.callbackUnhandled)
              this.callbackUnhandled(this.dom.getDepth(), this.collectedSpace, end);

            this.collectedSpace = '';
            this.pendingSource = '';
            this.checkingCharset = false;
            this.contentType = false;
            this.pendingCharset = '';

            if (end.length > 1 || (!this.xmlMode && VOID_ELEMENTS.has(this.currentTagLc))) {
              this.pop(null);
              this.state = State.OUTSIDE_MARKUP;
            }
            else if (this.xmlMode)
              this.state = State.OUTSIDE_MARKUP;
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
            const value = await this.gatherAttributeValue(quote, quote ? '' : ch);

            this.doAttributeCallback(this.preEqualsSpace + '=' + this.collectedSpace, value, quote);
            this.dom.addAttribute(this.attribute, value);
            this.collectedSpace = '';

            if (this.checkingCharset) {
              const attribLc = this.attribute.toLowerCase();

              if (attribLc === 'charset')
                this.charset = value.trim();
              else if (attribLc === 'http-equiv' && value.toLowerCase() === 'content-type') {
                this.contentType = true;
                this.charset = this.pendingCharset;
              }
              else if (attribLc === 'content') {
                const charset = (/\bcharset\s*=\s*([\w\-]+)\b/i.exec(value) || [])[1];

                if (this.contentType)
                  this.charset = charset;
                else
                  this.pendingCharset = charset;
              }

              if (this.charset && this.callbackEncoding) {
                const bailout = this.callbackEncoding(this.charset, this.charset.toLowerCase().replace(/:\d{4}$|[^0-9a-z]/g, ''), true);

                if (bailout) {
                  this.parsingResolver(null);
                  this.reset();
                  this.parserFinished = true;
                  return;
                }
              }
            }
          }

          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_DECLARATION_START:
          if (this.collectedSpace.length === 0 && ch === '-') {
            const ch2 = this.getChar() || await this.getNextChunkChar();

            if (ch2 === '-') {
              this.state = State.AT_COMMENT_START;
              break;
            }
            else
              this.putBack(ch2);
          }

          [content, terminated, isCData] = await this.gatherDeclarationOrProcessing(this.collectedSpace + ch,
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
          else if (/^doctype\b/i.test(content)) {
            const docType = new DocType(content);

            this.dom.addChild(docType, this.leadingSpace);

            if (!terminated)
              this.reportError('File ended in unterminated doctype');
            else if (this.callbackDocType)
              this.callbackDocType(this.leadingSpace, docType);
            else if (this.callbackDeclaration)
              this.callbackDeclaration(this.dom.getDepth() + 1, this.leadingSpace, content);
            else if (this.callbackUnhandled)
              this.callbackUnhandled(this.dom.getDepth() + 1, this.leadingSpace, '<!' + content + '>');

            this.xmlMode = (docType.type === 'xhtml');
            this.dom.setXmlMode(this.xmlMode);
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
          [content, terminated] = await this.gatherDeclarationOrProcessing(this.collectedSpace + ch);

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
          [content, terminated] = await this.gatherComment(this.collectedSpace + ch);

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

          [content, endTag, terminated] = await this.gatherUntilEndTag(tag, ch);

          if (!terminated)
            this.reportError(`File ended in unterminated ${tag} section`);
          else {
            if (content || this.collectedSpace) {
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

            const $$ = new RegExp('^<\\/(' + tag + ')(\\s*)>$', 'i').exec(endTag);

            this.pop();
            this.doEndTagCallback('', $$[1], $$[2]);
          }
        break;
      }

      if (processMillis() >= startTime + this.yieldTime)
        return;
    }

    if (this.state !== State.OUTSIDE_MARKUP)
      this.callbackError('Unexpected end of file', this.lineNumber, this.column);

    this.callbackEnd(this.collectedSpace, this.dom.getRoot(), this.dom.getUnclosedTagCount());
    this.parserFinished = true;
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

  private doEndTagCallback(leadingSpace: string, tag: string, trailing: string) {
    if (this.callbackEndTag)
      this.callbackEndTag(this.dom.getDepth() + 1, leadingSpace, tag, trailing);
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

      if (ch.length > 2)
        // Retrieve character saved from the previous chunk, which might need to be combined
        // with a character from the current chunk.
        ch = ch.substr(2);
      else {
        this.pendingSource += ch;

        if (ch === '\n' || ch === '\r' || ch === '\r\n') {
          ++this.lineNumber;
          this.column = 0;
        }
        else
          ++this.column;

        return ch;
      }
    }

    if (!ch && this.sourceIndex >= this.htmlSource.length)
      return '';
    else {
      ch = ch || this.htmlSource.charAt(this.sourceIndex++);

      if (ch === '\r') {
        const ch2 = this.htmlSource.charAt(this.sourceIndex);

        if (!ch2 && !this.htmlSourceIsFinal) {
          // Special chunk boundary case.
          this.putBacks.push('--' + ch);
          return '';
        }
        else if (ch2 === '\n') {
          ++this.sourceIndex;
          ch += '\n';
        }
      }
    }

    if (ch === '\n' || ch === '\r' || ch === '\r\n') {
      ++this.lineNumber;
      this.column = 0;

      if (this.options.eol)
        ch = this.options.eol as string;
    }
    else {
      const cp = ch.charCodeAt(0);

      ++this.column;

      // Test for high surrogate
      if (0xD800 <= cp && cp <= 0xDBFF) {
        const ch2 = this.htmlSource.charAt(this.sourceIndex);

        if (!ch2 && !this.htmlSourceIsFinal) {
          // Special chunk boundary case.
          this.putBacks.push('--' + ch);
          return '';
        }
        else {
          const cp2 = ch2.charCodeAt(0);

          // Test for low surrogate
          if (0xDC00 <= cp2 && cp2 <= 0xDFFF) {
            ++this.sourceIndex;
            ch += ch2;
          }
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

  private async getNextChunkChar(): Promise<string> {
    if (this.htmlSourceIsFinal && (!this.htmlSource || this.sourceIndex >= this.htmlSource.length))
      return '';
    else if (this.nextChunk) {
      this.htmlSource = this.nextChunk;
      this.htmlSourceIsFinal = this.nextChunkIsFinal;
      this.sourceIndex = 0;
      return this.getChar();
    }

    return new Promise<string>(resolve => {
      if (this.callbackRequestData)
        setTimeout(() => this.callbackRequestData());

      this.resolveNextChunk = resolve;
    });
  }

  private async gatherText(): Promise<[string, number]> {
    let text = '';
    let ch: string;
    let nextWSStart = -1;
    let mightNeedRepair = false;

    while (isWhiteSpace(ch = this.getChar() || await this.getNextChunkChar()))
      this.collectedSpace += ch;

    this.putBack(ch);

    while (true) {
      ch = this.getChar() || await this.getNextChunkChar();

      if (ch === '<') {
        const ch2 = this.getChar() || await this.getNextChunkChar();

        if (ch2 === '/') {
          const ch3 = this.getChar() || await this.getNextChunkChar();

          if (ch3 !== '/' && isMarkupStart(ch3)) {
            this.putBack(ch3);
            this.putBack(ch2);
            break;
          }
          else {
            text += ch + ch2 + ch3;
            mightNeedRepair = true;
          }
        }
        else if (isMarkupStart(ch2)) {
          this.putBack(ch2);
          break;
        }
        else {
          text += ch + ch2;
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

  private async gatherTagName(init = ''): Promise<void> {
    this.currentTag = init;

    let ch: string;

    while (isPCENChar(ch = this.getChar() || await this.getNextChunkChar()))
      this.currentTag += ch;

    this.currentTagLc = this.xmlMode ? this.currentTag : this.currentTag.toLowerCase();
    this.putBack(ch);
  }

  private async gatherAttributeName(init = ''): Promise<void> {
    this.attribute = init;

    let ch: string;

    while (isAttributeNameChar(ch = this.getChar() || await this.getNextChunkChar()))
      this.attribute += ch;

    this.putBack(ch);
  }

  private async gatherAttributeValue(quote: string, init = ''): Promise<string> {
    let value = init;

    let ch: string;
    let afterSlash = false;

    while ((ch = this.getChar() || await this.getNextChunkChar()) && ch !== quote && (quote || (!isWhiteSpace(ch) && ch !== '>'))) {
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

  private async gatherComment(init = ''): Promise<[string, boolean]> {
    let comment = init;
    let stage = (init.endsWith('-') ? 1 : 0);
    let ch: string;

    while ((ch = this.getChar() || await this.getNextChunkChar())) {
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

  private async gatherDeclarationOrProcessing(init = '', checkForCData?: boolean): Promise<[string, boolean, boolean]> {
    if (init === '>')
      return ['', true, false];

    let content = init;
    let ch: string;
    let cdataDetected = false;

    while ((ch = this.getChar() || await this.getNextChunkChar())) {
      if (checkForCData && content.length === 7) {
        cdataDetected = (content === '[CDATA[');
      }

      if (ch === '>' && (!cdataDetected || content.endsWith(']]')))
        return [cdataDetected ? content.substring(7, content.length - 2) : content, true, cdataDetected];

      content += ch;
   }

    return [content, false, false];
  }

  private async gatherUntilEndTag(endTag: string, init = ''): Promise<[string, string, boolean]> {
    const ender = '</' + endTag;
    const len = ender.length;
    let content = init;
    let endStage = ender.startsWith(init) ? init.length : 0;
    let ch: string;

    while ((ch = this.getChar() || await this.getNextChunkChar())) {
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

  private adjustOptions(): void {
    if (this.options.eol) {
      switch (this.options.eol) {
        case true:
        case '\n':
        case 'n': this.options.eol = '\n'; break;

        case '\r':
        case 'r': this.options.eol = '\r'; break;

        case '\r\n':
        case 'rn': this.options.eol = '\r\n'; break;

        default: this.options.eol = false;
      }
    }
  }
}
