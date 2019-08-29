import { processMillis } from './util';

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
type BasicCallback = (leadingSpace: string, text: string, trailing?: string) => void;
type EndCallback = (finalSpace?: string) => void;
type ErrorCallback = (error: string, line?: number, column?: number, source?: string) => void;

function isWhiteSpace(ch: string) {
  return ch !== undefined && ch <= ' ';
}

function isMarkupStart(ch: string) {
  return ch !== undefined && /[a-z\/!?]/i.test(ch);
}

const PCENCharRanges = new RegExp(
  '[\xB7\xC0-\xD6\xD8-\xF6\xF8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F' +
  '\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]'
);

function isPCENChar(ch: string) {
  if (ch <= 'z')
    return /[-._0-9a-z]/i.test(ch);
  else if (ch.length === 1)
    return PCENCharRanges.test(ch);

  const cp = ch.codePointAt(0);

  return 0x10000 <= cp && cp <= 0xEFFFF;
}

function isAttributeNameChar(ch: string): boolean {
  return ch > ' ' && !/["`>/=]/.test(ch) && (ch < '0x7F' || ch >= '0xA0');
}

function fixBadChars(s: string): string {
  s = s.replace(/</g, '&lt;');
  s = s.replace(/>/g, '&gt;');

  const parts = s.split('&');

  if (parts.length > 1) {
    s = parts.map((part, index) => {
      if (index > 0) {
        const $ = /^([a-z]+|#\d+|#x[0-9a-f]+)(;?)/i.exec(part);

        if (!$)
          part = 'amp;' + part;
        else if (!$[2])
          part = $[1] + ';' + part.substr($[1].length);
      }

      return part;
    }).join('&');
  }

  return s;
}

export class HtmlParser {
  private callbackAttribute: AttributeCallback;
  private callbackCloseTag: BasicCallback;
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
  private leadingSpace = '';
  private lineNumber  = 1;
  readonly options: HtmlParserOptions;
  private parsingResolver: () => void;
  private pendingSource = '';
  private preEqualsSpace = '';
  private putBacks: string[] = [];
  private srcIndex = 0;
  private state = State.OUTSIDE_MARKUP;
  private tagName = '';
  private yieldTime = DEFAULT_YIELD_TIME;

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

  parse(): void {
    if (!this.callbackEnd)
      throw new Error('onEnd callback must be specified');

    this.callbackCloseTag = this.callbackCloseTag || this.callbackUnhandled;
    this.callbackText = this.callbackText || this.callbackUnhandled;

    this.parseLoop();
  }

  async parseAsync(yieldTime = DEFAULT_YIELD_TIME): Promise<void> {
    this.yieldTime = yieldTime;
    setTimeout(() => this.parseLoop());

    return new Promise<void>(resolve => {
      this.parsingResolver = resolve;
    });
  }

  private parseLoop(): void {
    let ch: string;
    let content: string;
    let terminated: boolean;
    let closeTag: string;
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

            if (this.callbackText)
              this.callbackText(collected, text, '');

            this.pendingSource = '';
          }

          this.state = State.AT_MARKUP_START;
        break;

        case State.AT_MARKUP_START:
          switch (ch) {
            case '/':
              this.state = State.AT_CLOSE_TAG_START;
              ch = this.getChar();

              if (isWhiteSpace(ch)) {
                this.reportError('Syntax error in close tag');
                break;
              }
              else
                this.putBack(ch);
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

          if (this.callbackOpenTagStart)
            this.callbackOpenTagStart(this.collectedSpace, this.tagName);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.collectedSpace, '<' + this.tagName);

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
          else
            this.doCloseTagCallback(this.leadingSpace, this.tagName, this.collectedSpace);
        break;

        case State.AT_ATTRIBUTE_START:
          let end = '>';

          if (ch === '/') {
            end = '/>';
            ch = this.getChar();
          }

          if (ch !== '>') {
            if (end.length > 1) {
              this.reportError(`Syntax error in <${this.tagName}>`);
              break;
            }

            if (isAttributeNameChar(ch)) {
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
              this.gatherAttributeName(ch);
              this.state = State.AT_ATTRIBUTE_ASSIGNMENT;
            }
            else {
              this.reportError(`Syntax error in <${this.tagName}>`);
              break;
            }
          }
          else {
            if (this.callbackOpenTagEnd)
              this.callbackOpenTagEnd(this.collectedSpace, this.tagName, end);
            else if (this.callbackUnhandled)
              this.callbackUnhandled(this.collectedSpace, end);

            this.collectedSpace = '';
            this.pendingSource = '';

            if (this.tagName === 'script')
              this.state = State.IN_SCRIPT_ELEMENT;
            else if (this.tagName === 'style')
              this.state = State.IN_STYLE_ELEMENT;
            else if (this.tagName === 'textarea')
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
            this.state = State.AT_ATTRIBUTE_START;
          }
        break;

        case State.AT_ATTRIBUTE_VALUE:
          if (ch === '>') {
            this.doAttributeCallback(this.preEqualsSpace + '=');
            this.putBack(ch);
          }
          else {
            const quote = (ch === '"' || ch === "'") ? ch : '';
            const value = this.gatherAttributeValue(quote, quote ? '' : ch);

            this.doAttributeCallback(this.preEqualsSpace + '=' + this.collectedSpace, value, quote);
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

          [content, terminated] = this.gatherDeclarationOrProcessing(this.collectedSpace + ch);

          if (!terminated)
            this.reportError('File ended in unterminated declaration');
          else if (this.callbackDeclaration)
            this.callbackDeclaration(this.leadingSpace, content);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.leadingSpace, '<!' + content + '>');

          this.collectedSpace = '';
          this.pendingSource = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.AT_PROCESSING_START:
          [content, terminated] = this.gatherDeclarationOrProcessing(this.collectedSpace + ch);

          if (!terminated)
            this.reportError('File ended in unterminated processing instruction');
          else if (this.callbackProcessing)
            this.callbackProcessing(this.leadingSpace, content);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.leadingSpace, '<?' + content + '>');

          this.collectedSpace = '';
          this.pendingSource = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.AT_COMMENT_START:
          [content, terminated] = this.gatherComment(this.collectedSpace + ch);

          if (!terminated)
            this.reportError('File ended in unterminated comment');
          else if (this.callbackComment)
            this.callbackComment(this.leadingSpace, content);
          else if (this.callbackUnhandled)
            this.callbackUnhandled(this.leadingSpace, '<|--' + content + '-->');

          this.collectedSpace = '';
          this.pendingSource = '';
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

              if (this.callbackText)
                this.callbackText(this.collectedSpace, content, trailingWhiteSpace);

              this.collectedSpace = '';
              this.pendingSource = '';
            }

            const $$ = new RegExp('^<\\/(' + tag + ')(\\s*)>$', 'i').exec(closeTag);

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

    this.callbackEnd(this.collectedSpace);

    if (this.parsingResolver)
      this.parsingResolver();
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
      this.callbackCloseTag(leadingSpace, tag, trailing);
    else if (this.callbackUnhandled)
      this.callbackUnhandled(this.leadingSpace, '</' + tag, trailing + '>');

    this.state = State.OUTSIDE_MARKUP;
    this.collectedSpace = '';
    this.pendingSource = '';
  }

  private doAttributeCallback(equalSign = '', value = '', quote = ''): void {
    if (this.callbackAttribute)
      this.callbackAttribute(this.leadingSpace, this.attribute, equalSign, value, quote);
    else if (this.callbackUnhandled)
      this.callbackUnhandled(this.leadingSpace, this.attribute + equalSign + quote + value + quote);

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

        if (isMarkupStart(ch2)) {
          this.putBack(ch2);
          break;
        }
        else
          mightNeedRepair = true;
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
    this.tagName = init;

    let ch: string;

    while (isPCENChar(ch = this.getChar()))
      this.tagName += ch;

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

    while ((ch = this.getChar()) && ch !== quote && (quote || (!isWhiteSpace(ch) && ch !== '/' && ch !== '>')))
      value += ch;

    if (!quote)
      this.putBack(ch);

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

  private gatherDeclarationOrProcessing(init = ''): [string, boolean] {
    if (init === '>')
      return ['', true];

    let content = init;
    let ch: string;

    while ((ch = this.getChar())) {
      if (ch === '>')
        return [content, true];

      content += ch;
   }

    return [content, false];
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
