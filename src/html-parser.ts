import { processMillis } from './util';
import { VOID_ELEMENTS } from './elements';
import { fixBadChars, isAttributeNameChar, isEol, isMarkupStart, isPCENChar, isWhitespace } from './characters';
import { CData, CommentElement, DeclarationElement, DocType, DomModel, DomNode, ProcessingElement,
  TextElement } from './dom';

export interface HtmlParserOptions {
  eol?: string | boolean;
  fixBadChars?: boolean;
}

export class ParseResults {
  domRoot: DomNode;
  characters = 0;
  errors = 0;
  implicitlyClosedTags = 0;
  lines = 0;
  stopped = false;
  totalTime = processMillis();
  unclosedTags = 0;
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

const TEXT_STARTERS = new Set<State>([State.OUTSIDE_MARKUP, State.IN_SCRIPT_ELEMENT, State.IN_STYLE_ELEMENT,
                                      State.IN_TEXT_AREA_ELEMENT]);

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
type BasicCallback = (depth: number, text: string) => void;
type CompletionCallback = (results?: ParseResults) => void;
type DocTypeCallback = (docType: DocType) => void;
type EncodingCallback = (encoding: string, normalizedEncoding?: string, explicit?: boolean) => boolean;
type EndTagCallback = (depth: number, tag: string, innerWhitespace: string) => void;
type ErrorCallback = (error: string, line?: number, column?: number, source?: string) => void;
type StartTagEndCallback = (depth: number, innerWhitespace: string, end: string) => void;

type ParserCallback = AttributeCallback | BasicCallback | CompletionCallback | DocTypeCallback | EncodingCallback |
                      EndTagCallback | ErrorCallback | StartTagEndCallback;

type EventType = 'attribute' | 'cdata' | 'comment' | 'completion' | 'declaration' | 'doctype' | 'encoding' |
                 'end-tag' | 'error' | 'generic' | 'processing' | 'request-data' | 'start-tag-end' |
                 'start-tag-start' | 'text';

const CAN_BE_HANDLED_GENERICALLY = new Set(['attribute', 'cdata', 'comment', 'declaration', 'end-tag', 'processing',
                                            'start-tag-end', 'start-tag-start', 'text']);

export class HtmlParser {
  private attribute = '';
  private charset = '';
  private callbacks = new Map<EventType, ParserCallback>();
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
  private line = 1;
  private markupColumn: number;
  private markupLine: number;
  private nextChunk = '';
  private nextChunkIsFinal: boolean;
  readonly options: HtmlParserOptions;
  private parsingResolver: (results: ParseResults) => void;
  private parseResults: ParseResults;
  private parserRunning = false;
  private pendingCharset = '';
  private pendingSource = '';
  private preEqualsSpace = '';
  private putBacks: string[] = [];
  private resolveNextChunk: (gotMoreChars: string) => void;
  private sourceIndex = 0;
  private state = State.OUTSIDE_MARKUP;
  private stopped = false;
  private textColumn: number;
  private textLine: number;
  private yieldTime = DEFAULT_YIELD_TIME;
  private xmlMode = false;

  constructor(
    options = DEFAULT_OPTIONS
  ) {
    this.options = {};
    Object.assign(this.options, options);
    this.adjustOptions();
  }

  on(event: 'attribute', callback: AttributeCallback): HtmlParser;
  on(event: 'cdata' | 'comment' | 'declaration' | 'generic' | 'processing' | 'start-tag-start' | 'text',
     callback: BasicCallback): HtmlParser;
  on(event: 'completion', callback: CompletionCallback): HtmlParser;
  on(event: 'doctype', callback: DocTypeCallback): HtmlParser;
  on(event: 'encoding', callback: EncodingCallback): HtmlParser;
  on(event: 'end-tag', callback: EndTagCallback): HtmlParser;
  on(event: 'error', callback: ErrorCallback): HtmlParser;
  on(event: 'request-data', callback: () => void): HtmlParser;
  on(event: 'start-tag-end', callback: StartTagEndCallback): HtmlParser;

  on(event: EventType, callback: ParserCallback): HtmlParser {
    if (!callback)
      this.callbacks.delete(event);
    else
      this.callbacks.set(event, callback);

    return this;
  }

  off(event: EventType): HtmlParser {
    return this.on(event as any, null);
  }

  callback(event: EventType, ...args: any): boolean | void {
    if (!this.parserRunning && event !== 'completion')
      return false;

    let cb = this.callbacks.get(event) as (...args: any) => boolean | void;

    if (cb)
      return cb(...args);

    cb = this.callbacks.get('generic') as (...args: any) => boolean | void;

    if (!cb || !CAN_BE_HANDLED_GENERICALLY.has(event))
      return;

    switch (event) {
      case 'attribute':       return cb(-1, args[0] + args[1] + args[2] + args[4] + args[3] + args[4]);
      case 'cdata':           return cb(args[0], '<![CDATA[' + args[1] + ']]>');
      case 'comment':         return cb(args[0], '<!--' + args[1] + '-->');
      case 'declaration':     return cb(args[0], '<!' + args[1] + '>');
      case 'end-tag':         return cb(args[0], '</' + args[1] + args[2] + '>');
      case 'processing':      return cb(args[0], '<?' + args[1] + '>');
      case 'start-tag-end':   return cb(args[0], args[1] + args[2]);
      case 'start-tag-start': return cb(args[0], '<' + args[1]);
      case 'text':            return cb(args[0], args[1]);
    }
  }

  stop(): void {
    this.htmlSource = '';
    this.htmlSourceIsFinal = false;
    this.nextChunk = '';
    this.nextChunkIsFinal = false;
    this.parserRunning = false;
    this.putBacks = [];
    this.stopped = true;

    if (this.resolveNextChunk) {
      this.resolveNextChunk('');
      this.resolveNextChunk = undefined;
    }
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
    this.line  = 1;
    this.nextChunk = '';
    this.nextChunkIsFinal = false;
    this.parseResults = undefined;
    this.parserRunning = false;
    this.pendingCharset = '';
    this.pendingSource = '';
    this.putBacks = [];
    this.sourceIndex = 0;
    this.stopped = false;
    this.state = State.OUTSIDE_MARKUP;
    this.xmlMode = false;

    if (this.resolveNextChunk) {
      this.resolveNextChunk('');
      this.resolveNextChunk = undefined;
    }
  }

  async parse(source = '', yieldTime = DEFAULT_YIELD_TIME): Promise<ParseResults> {
    return this.parseAux(source, yieldTime, !!source);
  }

  parseChunk(chunk: string, isFinal = false, yieldTime = DEFAULT_YIELD_TIME) {
    if (!chunk && !this.parserRunning)
      return;

    chunk = chunk || '';

    if (!this.parserRunning) {
      // noinspection JSIgnoredPromiseFromCall
      this.parseAux(chunk, yieldTime, isFinal);

      return;
    }

    if (this.htmlSourceIsFinal || this.nextChunkIsFinal)
      throw new Error('Parser will no longer accept additional input');

    this.nextChunkIsFinal = isFinal || !chunk;

    if (this.resolveNextChunk) {
      this.htmlSource = (this.nextChunk || '') + chunk;
      this.htmlSourceIsFinal = this.nextChunkIsFinal;
      this.nextChunk = '';
      this.sourceIndex = 0;
      this.resolveNextChunk(this.getChar());
      this.resolveNextChunk = undefined;
    }
    else
      this.nextChunk = (this.nextChunk || '') + chunk;
  }

  private async parseAux(source = '', yieldTime = DEFAULT_YIELD_TIME, isFinal = !!source): Promise<ParseResults> {
    this.parserRunning = true;
    this.htmlSource = source || '';
    this.htmlSourceIsFinal = isFinal;
    this.parseResults = new ParseResults();
    this.parseResults.domRoot = this.dom.getRoot();

    return new Promise<ParseResults>(resolve => {
      this.yieldTime = yieldTime;
      this.parsingResolver = resolve;

      const parse = () => {
        this.parseLoop().then(() => {
          if (this.parserRunning)
            setTimeout(parse);
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

    while ((ch = this.getChar() || await this.getNextChunkChar())) {
      if (!ch)
        break;

      if (TEXT_STARTERS.has(this.state)) {
        this.textLine = this.line;
        this.textColumn = this.column;
      }

      while (isWhitespace(ch)) {
        this.collectedSpace += ch;
        ch = this.getChar() || await this.getNextChunkChar();
      }

     if (!ch)
      break;

     switch (this.state) {
        case State.OUTSIDE_MARKUP:
          this.putBack(ch);

          const text = this.collectedSpace + await this.gatherText();

          if (text) {
            this.dom.addChild(new TextElement(text, this.textLine, this.textColumn));
            this.pendingSource = '<';
            this.callback('text', this.dom.getDepth() + 1, text);
          }

          this.collectedSpace = '';
          this.state = State.AT_MARKUP_START;
        break;

        case State.AT_MARKUP_START:
          this.markupLine = this.line;
          this.markupColumn = this.column - 1;

          switch (ch) {
            case '/':
              this.state = State.AT_END_TAG_START;
            break;

            case '!':
            case '?':
              this.state = (ch === '!' ? State.AT_DECLARATION_START : State.AT_PROCESSING_START);
              this.collectedSpace = '';
            break;

            default:
              this.state = State.AT_START_TAG_START;
              this.putBack(ch);
          }
        break;

        case State.AT_START_TAG_START:
          await this.gatherTagName(ch);

          node = new DomNode(this.currentTag, this.markupLine, this.markupColumn);
          this.dom.prePush(node);
          this.dom.addChild(node);
          this.dom.push(node);
          this.callback('start-tag-start', this.dom.getDepth(), this.currentTag);

          this.checkingCharset = (!this.charset && this.currentTagLc === 'meta');
          this.collectedSpace = '';
          this.pendingSource = '';
          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_END_TAG_START:
          await this.gatherTagName(ch);
          this.state = State.IN_END_TAG;
          this.collectedSpace = '';
        break;

        case State.IN_END_TAG:
          if (ch !== '>') {
            this.putBack(ch);
            this.pop(this.currentTagLc, this.pendingSource);
            this.reportError('Syntax error in end tag');
            break;
          }
          else {
            this.pop(this.currentTagLc, `</${this.currentTag}${this.collectedSpace}>`);
            this.doEndTagCallback(this.currentTag, this.collectedSpace);
          }
        break;

        case State.AT_ATTRIBUTE_START:
          let end = '>';

          if (ch === '/') {
            end = '/>';
            ch = this.getChar() || await this.getNextChunkChar();

            if (ch !== '>') {
              this.putBack(ch);
              ch = '/';
            }
          }

          if (ch !== '>') {
            if (ch === '/' && !this.xmlMode) {
              // Most browsers seem to simply ignore stray slashes in tags which aren't followed by `>`.
              // Here will turn it into into its own valueless attribute.
              this.attribute = '/';
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
              this.dom.addAttribute('/', '', this.leadingSpace, '', '');
              this.doAttributeCallback('', '', '');
              this.state = State.AT_ATTRIBUTE_START;
            }
            else if (isAttributeNameChar(ch, !this.xmlMode)) {
              this.leadingSpace = this.collectedSpace;
              this.collectedSpace = '';
              await this.gatherAttributeName(ch);
              this.state = State.AT_ATTRIBUTE_ASSIGNMENT;
            }
            else {
              this.dom.addInnerWhitespace(this.collectedSpace);
              this.dom.getCurrentNode().badTerminator = ch;
              this.reportError(`Syntax error in <${this.currentTag}>`);
              break;
            }
          }
          else {
            this.dom.addInnerWhitespace(this.collectedSpace);
            this.callback('start-tag-end', this.dom.getDepth(), this.collectedSpace, end);

            this.collectedSpace = '';
            this.pendingSource = '';
            this.checkingCharset = false;
            this.contentType = false;
            this.pendingCharset = '';

            if (end.length > 1 || (!this.xmlMode && VOID_ELEMENTS.has(this.currentTagLc))) {
              this.pop(end.length > 1 ? null : undefined);
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
            this.collectedSpace = '';
            this.state = State.AT_ATTRIBUTE_VALUE;
          }
          else {
            this.dom.addAttribute(this.attribute, '', this.leadingSpace, '', '');
            this.doAttributeCallback('', '', '');
            this.putBack(ch);
            this.state = State.AT_ATTRIBUTE_START;
          }
        break;

        case State.AT_ATTRIBUTE_VALUE:
          if (ch === '>') {
            const equals = this.preEqualsSpace + '=';

            this.dom.addAttribute(this.attribute, '', this.leadingSpace, equals, '');
            this.doAttributeCallback(equals, '', '');
            this.putBack(ch);
          }
          else {
            const quote = (ch === '"' || ch === "'") ? ch : '';
            const value = await this.gatherAttributeValue(quote, quote ? '' : ch);
            const equals = this.preEqualsSpace + '=' + this.collectedSpace;

            this.dom.addAttribute(this.attribute, value, this.leadingSpace, equals, quote);
            this.doAttributeCallback(equals, value, quote);
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
                const charset = (/\bcharset[ \n\r\t\f]*=[ \n\r\t\f]*([\w\-]+)\b/i.exec(value) || [])[1];

                if (this.contentType)
                  this.charset = charset;
                else
                  this.pendingCharset = charset;
              }

              if (this.charset && this.parserRunning && this.callbacks.has('encoding')) {
                const bailout = this.callback('encoding', this.charset, this.charset.toLowerCase().replace(/:\d{4}$|[^0-9a-z]/g, ''), true);

                if (bailout) {
                  this.parserRunning = false;
                  this.parsingResolver(null);
                  setTimeout(() => this.reset());

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
            this.dom.addChild(new CData(content, this.markupLine, this.markupColumn));

            if (!terminated)
              this.reportError('File ended in unterminated CDATA');
            else
              this.callback('cdata', this.dom.getDepth() + 1, content);
          }
          else if (/^doctype\b/i.test(content)) {
            const docType = new DocType(content, this.markupLine, this.markupColumn);

            this.dom.addChild(docType);

            if (!terminated)
              this.reportError('File ended in unterminated doctype');
            else if (this.parserRunning && this.callbacks.has('doctype'))
              this.callback('doctype', docType);
            else
              this.callback('declaration', this.dom.getDepth() + 1, content);

            this.xmlMode = (docType.type === 'xhtml');
            this.dom.setXmlMode(this.xmlMode);
          }
          else {
            this.dom.addChild(new DeclarationElement(content, this.markupLine, this.markupColumn));

            if (!terminated)
              this.reportError('File ended in unterminated declaration');
            else
              this.callback('declaration', this.dom.getDepth() + 1, content);
          }

          this.collectedSpace = '';
          this.pendingSource = '';
          this.leadingSpace = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.AT_PROCESSING_START:
          [content, terminated] = await this.gatherDeclarationOrProcessing(this.collectedSpace + ch);

          this.dom.addChild(new ProcessingElement(content, this.markupLine, this.markupColumn));

          if (!terminated)
            this.reportError('File ended in unterminated processing instruction');
          else
            this.callback('processing', this.dom.getDepth() + 1, content);

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

          this.dom.addChild(new CommentElement(content, this.markupLine, this.markupColumn));

          if (!terminated)
            this.reportError('File ended in unterminated comment');
          else
            this.callback('comment', this.dom.getDepth() + 1, content);

          this.collectedSpace = '';
          this.pendingSource = '';
          this.leadingSpace = '';
          this.state = State.OUTSIDE_MARKUP;
        break;

        case State.IN_STYLE_ELEMENT:
        case State.IN_SCRIPT_ELEMENT:
        case State.IN_TEXT_AREA_ELEMENT:
          const tag = tagForState[this.state];

          if (ch === '<') {
            this.markupLine = this.line;
            this.markupColumn = this.column;
          }

          [content, endTag, terminated] = await this.gatherUntilEndTag(tag, ch);

          if (!terminated)
            this.reportError(`File ended in unterminated ${tag} section`);
          else {
            if (content || this.collectedSpace) {
              content = this.collectedSpace + content;
              this.dom.addChild(new TextElement(content, this.textLine, this.textColumn));

              this.callback('text', this.dom.getDepth() + 1, content);

              this.collectedSpace = '';
              this.pendingSource = '';
            }

            const $$ = new RegExp('^<\\/(' + tag + ')([ \\n\\r\\t\\f]*)>$', 'i').exec(endTag);

            this.pop(tag, `</${$$[1]}${$$[2]}>`);
            this.doEndTagCallback($$[1], $$[2]);
            this.state = State.OUTSIDE_MARKUP;
          }
        break;
      }

      if (processMillis() >= startTime + this.yieldTime)
        return;
    }

    if (this.state !== State.OUTSIDE_MARKUP)
      this.callback('error', 'Unexpected end of file', this.line, this.column);

    if (this.collectedSpace) {
      this.dom.addChild(new TextElement(this.collectedSpace, this.textLine, this.textColumn));
      this.callback('text', this.dom.getDepth() + 1, this.collectedSpace);
    }

    [this.parseResults.unclosedTags, this.parseResults.implicitlyClosedTags] =
      this.dom.getRoot().countUnclosed();
    this.parseResults.lines = this.line;
    this.parseResults.stopped = this.stopped;
    this.parseResults.totalTime = processMillis() - this.parseResults.totalTime;

    this.callback('completion', this.parseResults);
    this.parsingResolver(this.parseResults);
    this.parserRunning = false;
  }

  private pop(tagLc: string, endTagText = '') {
    if (!this.dom.pop(tagLc, endTagText, this.markupLine, this.markupColumn)) {
      ++this.parseResults.errors;
      this.callback('error', `Unmatched closing tag </${tagLc}>`, this.line, this.column, '');
    }
  }

  private reportError(message: string) {
    ++this.parseResults.errors;
    this.callback('error', message, this.line, this.column, this.pendingSource);
    this.state = State.OUTSIDE_MARKUP;
    this.collectedSpace = '';
    this.pendingSource = '';
  }

  private doEndTagCallback(tag: string, innerWhitespace: string) {
    this.callback('end-tag', this.dom.getDepth() + 1, tag, innerWhitespace);
    this.state = State.OUTSIDE_MARKUP;
    this.collectedSpace = '';
    this.pendingSource = '';
  }

  private doAttributeCallback(equalSign: string, value: string, quote: string): void {
    this.callback('attribute', this.leadingSpace, this.attribute, equalSign, value, quote);
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

        if (isEol(ch)) {
          ++this.line;
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
      ++this.parseResults.characters;
      ch = ch || this.htmlSource.charAt(this.sourceIndex++);

      if (ch === '\r') {
        const ch2 = this.htmlSource.charAt(this.sourceIndex);

        if (!ch2 && !this.htmlSourceIsFinal) {
          // Special chunk boundary case.
          this.putBacks.push('--' + ch);
          --this.parseResults.characters;
          return '';
        }
        else if (ch2 === '\n') {
          ++this.parseResults.characters;
          ++this.sourceIndex;
          ch += '\n';
        }
      }
    }

    if (isEol(ch)) {
      ++this.line;
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
          --this.parseResults.characters;
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

    if (isEol(ch))
      --this.line;
    else
      --this.column;
  }

  private async getNextChunkChar(): Promise<string> {
    if (this.htmlSourceIsFinal && (!this.htmlSource || this.sourceIndex >= this.htmlSource.length))
      return '';
    else if (this.nextChunk || this.nextChunkIsFinal) {
      this.htmlSource = this.nextChunk;
      this.htmlSourceIsFinal = this.nextChunkIsFinal;
      this.nextChunk = '';
      this.sourceIndex = 0;

      return this.getChar();
    }

    return await new Promise<string>(resolve => {
      if (!this.parserRunning) {
        resolve('');
        return;
      }
      else if (this.callbacks.has('request-data'))
        setTimeout(() => this.callback('request-data'));

      this.resolveNextChunk = resolve;
    });
  }

  private async gatherText(): Promise<string> {
    let text = '';
    let ch: string;
    let mightNeedRepair = false;

    while ((ch = this.getChar() || await this.getNextChunkChar())) {
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
        text += ch;

        if (ch === '>' || ch === '&')
          mightNeedRepair = true;
      }
    }

    if (mightNeedRepair && this.options.fixBadChars)
      text = fixBadChars(text);

    return text;
  }

  private async gatherTagName(init = ''): Promise<void> {
    this.currentTag = init;

    let ch: string;

    while (isPCENChar(ch = this.getChar() || await this.getNextChunkChar(), !this.xmlMode))
      this.currentTag += ch;

    this.currentTagLc = this.xmlMode ? this.currentTag : this.currentTag.toLowerCase();
    this.putBack(ch);
  }

  private async gatherAttributeName(init = ''): Promise<void> {
    this.attribute = init;

    let ch: string;

    while (isAttributeNameChar(ch = this.getChar() || await this.getNextChunkChar(), !this.xmlMode))
      this.attribute += ch;

    this.putBack(ch);
  }

  private async gatherAttributeValue(quote: string, init = ''): Promise<string> {
    let value = init;

    let ch: string;
    let afterSlash = false;

    while ((ch = this.getChar() || await this.getNextChunkChar()) && ch !== quote && (quote || (!isWhitespace(ch) && ch !== '>'))) {
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
      else if (endStage >= len && isWhitespace(ch))
        ++endStage;
      else if (endStage < len && ch.toLowerCase() === ender.charAt(endStage)) {
        if (endStage === 0) {
          this.markupLine = this.line;
          this.markupColumn = this.column;
        }

        ++endStage;
      }
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
