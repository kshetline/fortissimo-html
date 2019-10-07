import { processMillis } from './platform-specifics';
import { VOID_ELEMENTS } from './elements';
import { isAttributeNameChar, isEol, isMarkupStart, isPCENChar, isWhitespace } from './characters';
import { CData, ClosureState, CommentElement, CQ, DeclarationElement, DocType, DomModel, DomNode, OQ,
  ProcessingElement, TextElement, UnmatchedClosingTag } from './dom';

export interface HtmlParserOptions {
  emptyEndTag?: boolean;
  eol?: string | boolean;
  fast?: boolean;
  tabSize?: number;
  xmlMode?: boolean;
}

export class ParseResults {
  domRoot: DomNode;
  characters = 0;
  errors = 0;
  implicitlyClosedTags = 0;
  lines = 0;
  stopped = false;
  totalTime = 0;
  unclosedTags = 0;

  toString(): string {
    return this.domRoot && this.domRoot.toString() || '';
  }
}

const DEFAULT_YIELD_TIME = 50;

export enum State {
  OUTSIDE_MARKUP,

  AT_ATTRIBUTE_ASSIGNMENT,
  AT_ATTRIBUTE_START,
  AT_ATTRIBUTE_VALUE,
  AT_END_TAG_START,
  AT_MARKUP_START,
  AT_START_TAG_START,
  IN_END_TAG,
  // States below this point are subject to special unexpected EOF handling
  AT_COMMENT_START,
  AT_DECLARATION_START,
  AT_PROCESSING_START,
  IN_SCRIPT_ELEMENT,
  IN_STYLE_ELEMENT,
  IN_TEXT_AREA_ELEMENT,
}

const RE_WHITESPACE = /^([ \f]+)/;
const RE_TEXT = /^([^<\t\n\r\uD800-\uDFFF]+)/;
const RE_ATTRIB_NAME = /^([^=>\/\s\uD800-\uDFFF]+)/;
const RE_COMMENT = /^([^->\t\n\r\uD800-\uDFFF]+)/;
const RE_DECLARATION = /^([^>\t\n\r\uD800-\uDFFF]+)/;

const RE_ATTRIB_VALUE: Record<string, RegExp> = {
  '"': /^([^"\t\n\r\uD800-\uDFFF]+)/,
  "'": /^([^'\t\n\r\uD800-\uDFFF]+)/,
  '': /^([^=>\/\s\uD800-\uDFFF]+)/,
};

const RE_WHITESPACE_FAST = /^([ \t\n\f\r]+)/;
const RE_TEXT_FAST = /^([^<]+)/;
const RE_COMMENT_FAST = /^([^->]+)/;
const RE_DECLARATION_FAST = /^([^>]+)/;
const RE_TAG_FAST = /^([^>]+>)/;

type AttributeCallback = (leadingSpace: string, name: string, equalSign: string, value: string, quote: string) => void;
type BasicCallback = (depth: number, text: string, terminated: boolean) => void;
type CompletionCallback = (results?: ParseResults) => void;
type DocTypeCallback = (docType: DocType, terminated: boolean) => void;
type EncodingCallback = (encoding: string, normalizedEncoding?: string, explicit?: boolean) => boolean;
type EndTagCallback = (depth: number, tag: string, innerWhitespace: string) => void;
type ErrorCallback = (error: string, line?: number, column?: number, source?: string) => void;
type StartTagEndCallback = (depth: number, innerWhitespace: string, end: string) => void;
type TextCallback = (depth: number, text: string, possibleEntities: boolean) => void;

type ParserCallback = AttributeCallback | BasicCallback | CompletionCallback | DocTypeCallback | EncodingCallback |
                      EndTagCallback | ErrorCallback | StartTagEndCallback | TextCallback;

type EventType = 'attribute' | 'cdata' | 'comment' | 'completion' | 'declaration' | 'doctype' | 'encoding' |
                 'end-tag' | 'error' | 'generic' | 'processing' | 'request-data' | 'start-tag-end' |
                 'start-tag-start' | 'text';

const CAN_BE_HANDLED_GENERICALLY = new Set(['attribute', 'cdata', 'comment', 'declaration', 'end-tag', 'error',
                                            'processing', 'start-tag-end', 'start-tag-start', 'text']);

export class HtmlParser {
  private static TEXT_STARTERS =
    new Set<State>([State.OUTSIDE_MARKUP, State.IN_SCRIPT_ELEMENT, State.IN_STYLE_ELEMENT, State.IN_TEXT_AREA_ELEMENT]);

  private static DEFAULT_OPTIONS: HtmlParserOptions = {
    emptyEndTag: true,
    eol: '\n',
    fast: false,
    tabSize: 8,
    xmlMode: false
  };

  private static tagForState = {
    [State.IN_SCRIPT_ELEMENT]: 'script',
    [State.IN_STYLE_ELEMENT]: 'style',
    [State.IN_TEXT_AREA_ELEMENT]: 'textarea',
  };

  private attribute = '';
  private charset = '';
  private callbacks = new Map<EventType, ParserCallback>();
  private checkingCharset = false;
  private collectedSpace = '';
  private column = 0;
  private columnIncrement = 1;
  private contentType = false;
  private currentTag = '';
  private currentTagLc = '';
  private dom = new DomModel();
  private fast = HtmlParser.DEFAULT_OPTIONS.fast;
  private htmlSource: string;
  private leadingSpace = '';
  private line = 1;
  private markupColumn: number;
  private markupLine: number;
  readonly options: HtmlParserOptions;
  private parseResults: ParseResults;
  private parserRunning = false;
  private pendingCharset = '';
  private pendingSource = '';
  private pendingReset = false;
  private preEqualsSpace = '';
  private putBacks: string[] = [];
  private reWhitespace: RegExp;
  private reText: RegExp;
  private reComment: RegExp;
  private reDeclaration: RegExp;
  private reAttribValue = RE_ATTRIB_VALUE;
  private startTime: number;
  private state = State.OUTSIDE_MARKUP;
  private stopped = false;
  private tabSize = HtmlParser.DEFAULT_OPTIONS.tabSize;
  private textColumn: number;
  private textLine: number;
  private xmlMode = false;
  private yieldTime = 0;

  constructor(options?: HtmlParserOptions) {
    this.options = {};
    Object.assign(this.options, HtmlParser.DEFAULT_OPTIONS);

    if (options && options.fast)
      this.options.eol = false;

    Object.assign(this.options, options);
    this.adjustOptions();
    this.xmlMode = this.options.xmlMode;
  }

  on(event: 'attribute', callback: AttributeCallback): HtmlParser;
  on(event: 'cdata' | 'comment' | 'declaration' | 'generic' | 'processing' | 'start-tag-start',
     callback: BasicCallback): HtmlParser;
  on(event: 'completion', callback: CompletionCallback): HtmlParser;
  on(event: 'doctype', callback: DocTypeCallback): HtmlParser;
  on(event: 'encoding', callback: EncodingCallback): HtmlParser;
  on(event: 'end-tag', callback: EndTagCallback): HtmlParser;
  on(event: 'error', callback: ErrorCallback): HtmlParser;
  on(event: 'request-data', callback: () => void): HtmlParser;
  on(event: 'start-tag-end', callback: StartTagEndCallback): HtmlParser;
  on(event: 'text', callback: TextCallback): HtmlParser;

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

  private callback(event: EventType, ...args: any): boolean | void {
    if (!this.parserRunning && event !== 'completion')
      return false;

    let cb = this.callbacks.get(event) as (...args: any) => boolean | void;

    if (cb)
      return cb(...args);

    cb = this.callbacks.get('generic') as (...args: any) => boolean | void;

    if (!cb || !CAN_BE_HANDLED_GENERICALLY.has(event))
      return;

    switch (event) {
      case 'attribute':       return cb(-1, args[0] + args[1] + args[2] + OQ(args[4]) + args[3] + CQ(args[4]));
      case 'cdata':           return cb(args[0], '<![CDATA[' + args[1] + (args[2] ? ']]>' : ''));
      case 'comment':         return cb(args[0], '<!--' + args[1] + (args[2] ? '-->' : ''));
      case 'declaration':     return cb(args[0], '<!' + args[1] + (args[2] ? '>' : ''));
      case 'end-tag':         return cb(args[0], '</' + args[1] + args[2]);
      case 'error':           return cb(-1, args[3] || '');
      case 'processing':      return cb(args[0], '<?' + args[1] + (args[2] ? '>' : ''));
      case 'start-tag-end':   return cb(args[0], args[1] + args[2]);
      case 'start-tag-start': return cb(args[0], '<' + args[1]);
      case 'text':            return cb(args[0], args[1]);
    }
  }

  stop(): void {
    this.charset = '';
    this.checkingCharset = false;
    this.columnIncrement = 1;
    this.htmlSource = '';
    this.parserRunning = false;
    this.pendingCharset = '';
    this.putBacks = [];
    this.stopped = true;
  }

  reset(): void {
    this.charset = '';
    this.checkingCharset = false;
    this.collectedSpace = '';
    this.column = 0;
    this.columnIncrement = 1;
    this.contentType = false;
    this.dom = new DomModel();
    this.htmlSource = '';
    this.leadingSpace = '';
    this.line = 1;
    this.parseResults = undefined;
    this.parserRunning = false;
    this.pendingCharset = '';
    this.pendingReset = false;
    this.pendingSource = '';
    this.putBacks = [];
    this.stopped = false;
    this.state = State.OUTSIDE_MARKUP;
    this.xmlMode = this.options.xmlMode;
  }

  private startParsing(source: string): void {
    this.startTime = processMillis();

    if (this.fast && this.options.eol)
      source = source.replace(/\r\n|\r|\n/g, this.options.eol as string);

    this.parserRunning = true;
    this.htmlSource = source || '';
    this.pendingSource = '';
    this.putBacks = [];
    this.state = State.OUTSIDE_MARKUP;
    this.dom = new DomModel();
    this.parseResults = new ParseResults();
    this.parseResults.domRoot = this.dom.getRoot();

    this.checkEncoding(this.htmlSource);
  }

  parse(source: string): ParseResults {
    this.startParsing(source);
    this.yieldTime = 0;

    if (this.parseResults)
      this.parseLoop();

    return this.parseResults;
  }

  async parseAsync(source?: string, yieldTime = DEFAULT_YIELD_TIME): Promise<ParseResults> {
    this.startParsing(source);
    this.yieldTime = yieldTime;

    if (!this.parserRunning)
      return undefined;

    return new Promise<ParseResults>(resolve => {
      const parse = () => {
        this.parseLoop();

        if (this.pendingReset) {
          this.reset();
          this.callback('completion', null);
          resolve(undefined);
        }
        else if (this.stopped) {
          this.callback('completion', this.parseResults);
          resolve(this.parseResults);
        }
        else if (!this.parserRunning)
          resolve(this.parseResults);
        else
          setTimeout(parse);
      };

      parse();
    });
  }

  private checkEncoding(firstChars: string): void {
    let encoding: string;

    if (/^(\x00\x00\xFE\xFF|\x00\x00\x00[\x01-\xFF]\x00\x00\x00[\x01-\xFF])/.test(firstChars))
      encoding = 'UTF-32BE';
    else if (/^(\xFF\xFE\x00\x00|[\x01-\xFF]\x00\x00\x00[\x01-\xFF]\x00\x00\x00)/.test(firstChars))
      encoding = 'UTF-32LE';
    else if (/^(\xFE\xFF|\x00[\x01-\xFF]\x00[\x01-\xFF])/.test(firstChars))
      encoding = 'UTF-16BE';
    else if (/^(\xFF\xFE|[\x01-\xFF]\x00[\x01-\xFF]\x00)/.test(firstChars))
      encoding = 'UTF-16LE';

    if (encoding) {
      const bailout = this.callback('encoding', encoding, encoding.toLowerCase().replace('-', ''), false);

      if (bailout)
        this.reset();
    }
  }

  private parseLoop(): void {
    const loopStartTime = processMillis();
    let ch: string;
    let content: string;
    let terminated: boolean;
    let isCData: boolean;
    let endTag: string;

    while ((ch = this.getChar()) || this.state >= State.AT_COMMENT_START) {
      if (ch) {
        if (HtmlParser.TEXT_STARTERS.has(this.state)) {
          this.textLine = this.line;
          this.textColumn = this.column;
        }

        ch = this.gatherWhitespace(ch);
      }

     if (!ch && this.state < State.AT_COMMENT_START)
       break;

     switch (this.state) {
        case State.OUTSIDE_MARKUP:
          this.putBack(ch);
          this.handleText(this.collectedSpace + this.gatherText());
        break;

        case State.AT_MARKUP_START:
          this.handleMarkupStart(ch);
        break;

        case State.AT_START_TAG_START:
          if (this.fast)
            this.handleFullTag(ch);
          else {
            this.gatherTagName(ch);
            this.handleStartTagStart();
          }
        break;

        case State.AT_END_TAG_START:
          if (ch === '>') {
            this.currentTag = this.currentTagLc = '';
            this.putBack(ch);
          }
          else {
            this.gatherTagName(ch);
            this.collectedSpace = '';
          }

          this.state = State.IN_END_TAG;
        break;

        case State.IN_END_TAG:
         const invalidEnding = this.handleEndTag(ch);

         if (invalidEnding) {
           this.gatherInvalidEndTagEnding();
           this.pop(this.currentTagLc, `</${this.currentTag}${this.pendingSource}`);
           this.doEndTagCallback(this.currentTag, this.pendingSource);
         }
        break;

        case State.AT_ATTRIBUTE_START:
          let end = '>';

          if (ch === '/') {
            end = '/>';
            ch = this.getChar();

            if (ch !== '>') {
              this.putBack(ch);
              ch = '/';
            }
          }

          const getAttribName = this.handleAttributeStart(ch, end);

          if (getAttribName)
            this.gatherAttributeName(ch);
        break;

        case State.AT_ATTRIBUTE_ASSIGNMENT:
          this.handleAttributeAssignment(ch);
        break;

        case State.AT_ATTRIBUTE_VALUE:
          const quote = this.handleAttributeValueStepOne(ch);

          if (quote !== undefined) {
            let value;
            [value, terminated] = this.gatherAttributeValue(quote, quote ? '' : ch);

            if (this.handleAttributeValueStepTwo(quote, value, terminated))
              return;
          }

          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_DECLARATION_START:
          if (this.handleDeclarationStartStepOne(ch)) {
            [content, terminated, isCData] = this.gatherDeclarationOrProcessing(this.collectedSpace + ch,
              this.dom.shouldParseCData());

            this.handleDeclarationStartStepTwo(content, terminated, isCData);
          }
        break;

        case State.AT_PROCESSING_START:
          [content, terminated] = this.gatherDeclarationOrProcessing(this.collectedSpace + ch);
          this.handleProcessingStart(content, terminated);
        break;

        case State.AT_COMMENT_START:
          [content, terminated] = this.gatherComment(this.collectedSpace + ch);
          this.handleCommentStart(content, terminated);
        break;

        case State.IN_STYLE_ELEMENT:
        case State.IN_SCRIPT_ELEMENT:
        case State.IN_TEXT_AREA_ELEMENT:
          const tag = HtmlParser.tagForState[this.state];

          if (ch === '<') {
            this.markupLine = this.line;
            this.markupColumn = this.column;
          }

          [content, endTag, terminated] = this.gatherUntilEndTag(tag, ch);
          this.handleTextBlockElements(tag, content, endTag, terminated);
        break;
      }

      if (this.yieldTime && processMillis() >= loopStartTime + this.yieldTime)
        return;
    }

    this.parseLoopWrapUp();
  }

  private parseLoopWrapUp(): void {
    if (this.state !== State.OUTSIDE_MARKUP) {
      ++this.parseResults.errors;

      if (this.state <= State.AT_ATTRIBUTE_VALUE) {
        if (this.state === State.AT_ATTRIBUTE_ASSIGNMENT) {
          this.dom.addAttribute(this.attribute, '', this.leadingSpace, '', '');
          this.doAttributeCallback('', '', '');
        }
        else if (this.state === State.AT_ATTRIBUTE_VALUE) {
          const equals = this.preEqualsSpace + '=';

          this.dom.addAttribute(this.attribute, '', this.leadingSpace, equals, '');
          this.doAttributeCallback(equals, '', '');
        }

        this.dom.getCurrentNode().badTerminator = '';
        this.callback('error', `Unexpected end of <${this.currentTag}> tag`, this.line, this.column);
      }
      else if (this.state === State.AT_END_TAG_START || this.state === State.IN_END_TAG) {
        this.callback('error', 'Unexpected end of file in end tag', this.line, this.column, this.pendingSource);
        this.dom.addChild(new UnmatchedClosingTag(this.pendingSource, this.line, this.column));
        this.collectedSpace = '';
      }
      else
        this.callback('error', 'Unexpected end of file', this.line, this.column, this.pendingSource);
    }

    if (!this.parseResults) // In case parser reset while running.
      return;

    if (this.collectedSpace) {
      this.dom.addChild(new TextElement(this.collectedSpace, this.textLine, this.textColumn, true));
      this.callback('text', this.dom.getDepth() + 1, this.collectedSpace);
    }

    [this.parseResults.unclosedTags, this.parseResults.implicitlyClosedTags] =
      this.dom.getRoot().countUnclosed();
    this.parseResults.lines = this.line;
    this.parseResults.stopped = this.stopped;
    this.parseResults.totalTime = processMillis() - this.startTime;

    this.callback('completion', this.parseResults);
    this.parserRunning = false;
  }

  private handleText(text: string): void {
    if (text) {
      this.dom.addChild(new TextElement(text, this.textLine, this.textColumn, true));
      this.pendingSource = this.atEOF() && this.putBacks.length === 0 ? '' : '<';
      this.callback('text', this.dom.getDepth() + 1, text, true);
    }

    this.collectedSpace = '';
    this.currentTag = this.currentTagLc = '';
    this.state = State.AT_MARKUP_START;
  }

  private handleMarkupStart(ch: string): void {
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
  }

  private handleFullTag(init: string): void {
    let fullTag = init + this.getChar(RE_TAG_FAST);
    const end = (/(\/>|>)$/.exec(fullTag) || [''])[0];

    if (end)
      fullTag = fullTag.substr(0, fullTag.length - end.length);

    let $0, tag, attribs;
    // noinspection JSUnusedAssignment
    [$0, tag, attribs, this.collectedSpace] = /^(\S+)((?:.|\s)*?)(\s*)$/.exec(fullTag);
    this.currentTag = tag;
    this.currentTagLc = tag.toLowerCase();
    const node = new DomNode(this.currentTagLc, 0, 0);

    this.dom.prePush(node);
    this.dom.addChild(node);
    this.dom.push(node);
    this.callback('start-tag-start', this.dom.getDepth(), tag);

    const attribMatcher = /(\s+)([^=\s]+)(?:(\s*=\s*)("[^"]*"?|'[^']*'?|\S*)?)?/g;
    let $: string[];

    while (($ = attribMatcher.exec(attribs))) {
      // noinspection JSUnusedLocalSymbols
      let [_, lead, attrib, equals, value] = $;
      let quote: string;

      equals = equals || '';
      value = value || '';

      if (value.startsWith('"')) {
        quote = value.endsWith('"') ? '"' : '_"';
        value = value.replace(/"/g, '');
      }
      else if (value.startsWith("'")) {
        quote = value.endsWith("'") ? "'" : "_'";
        value = value.replace(/'/g, '');
      }

      this.dom.addAttribute(attrib, value, lead, equals, quote);
      this.attribute = attrib;
      this.doAttributeCallback(equals, value, quote);
    }

    this.handleAttributeStart('>', end);
  }

  private handleStartTagStart(): void {
    const node = new DomNode(this.currentTag, this.markupLine, this.markupColumn);

    this.dom.prePush(node);
    this.dom.addChild(node);
    this.dom.push(node);
    this.callback('start-tag-start', this.dom.getDepth(), this.currentTag);

    this.checkingCharset = (!this.charset && this.currentTagLc === 'meta');
    this.collectedSpace = '';
    this.pendingSource = '';
    this.state = State.AT_ATTRIBUTE_START;
  }

  private handleEndTag(ch: string): boolean {
    let invalidEnding = false;

    if (ch !== '>') {
      if (this.xmlMode) {
        this.putBack(ch);
        this.pop(this.currentTagLc, this.pendingSource);
        this.reportError('Syntax error in end tag');
      }
      else {
        if (this.atEOF())
          return false;

        ++this.parseResults.errors;
        this.callback('error', 'Syntax error in end tag', this.line, this.column, '');
        this.pendingSource = this.collectedSpace + ch;
        invalidEnding = true;
      }
    }
    else if (!this.currentTag) {
      ++this.parseResults.errors;
      this.callback('error', 'Empty end tag', this.line, this.column, this.pendingSource);
      this.dom.addChild(new UnmatchedClosingTag(this.pendingSource, this.line, this.column));
      this.collectedSpace = '';
      this.pendingSource = '';
      this.state = State.OUTSIDE_MARKUP;
    }
    else {
      this.pop(this.currentTagLc, `</${this.currentTag}${this.collectedSpace}>`);
      this.doEndTagCallback(this.currentTag, this.collectedSpace + '>');
    }

    return invalidEnding;
  }

  private handleAttributeStart(ch: string, end: string): boolean {
    let getAttribName = false;

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
        this.state = State.AT_ATTRIBUTE_ASSIGNMENT;
        getAttribName = true;
      }
      else {
        this.dom.addInnerWhitespace(this.collectedSpace);
        this.dom.getCurrentNode().badTerminator = ch;
        this.reportError(`Syntax error in <${this.currentTag}>`);
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
      else if (this.currentTagLc === 'script')
        this.state = State.IN_SCRIPT_ELEMENT;
      else if (this.currentTagLc === 'style')
        this.state = State.IN_STYLE_ELEMENT;
      else if (this.currentTagLc === 'textarea')
        this.state = State.IN_TEXT_AREA_ELEMENT;
      else
        this.state = State.OUTSIDE_MARKUP;
    }

    return getAttribName;
  }

  private handleAttributeAssignment(ch: string): void {
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
  }

  private handleAttributeValueStepOne(ch: string): string {
    if (ch === '>') {
      const equals = this.preEqualsSpace + '=';

      this.dom.addAttribute(this.attribute, '', this.leadingSpace, equals, '');
      this.doAttributeCallback(equals, '', '');
      this.putBack(ch);

      return undefined;
    }

    return (ch === '"' || ch === "'") ? ch : '';
  }

  private handleAttributeValueStepTwo(quote: string, value: string, terminated: boolean): boolean {
    const equals = this.preEqualsSpace + '=' + this.collectedSpace;

    quote = (terminated ? '' : '_') + quote;
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
        const bailout = this.callback('encoding', this.charset,
          this.charset.toLowerCase().replace(/:\d{4}$|[^0-9a-z]/g, ''), true);

        if (bailout) {
          this.parserRunning = false;
          this.pendingReset = true;

          return true;
        }
      }
    }

    return false;
  }

  private handleDeclarationStartStepOne(ch: string): boolean {
    if (this.collectedSpace.length === 0 && ch === '-') {
      const ch2 = this.getChar();

      if (ch2 === '-') {
        this.state = State.AT_COMMENT_START;

        return false;
      }
      else
        this.putBack(ch2);
    }

    return true;
  }


  private handleDeclarationStartStepTwo(content: string, terminated: boolean, isCData: boolean): void {
    if (isCData) {
      this.dom.addChild(new CData(content, this.markupLine, this.markupColumn, terminated));

      if (!terminated)
        this.reportError('File ended in unterminated CDATA', false);

      this.callback('cdata', this.dom.getDepth() + 1, content, terminated);
    }
    else if (/^doctype\b/i.test(content)) {
      const docType = new DocType(content, this.markupLine, this.markupColumn, terminated);

      this.dom.addChild(docType);

      if (!terminated)
        this.reportError('File ended in unterminated doctype', false);

      if (this.parserRunning && this.callbacks.has('doctype'))
        this.callback('doctype', docType, terminated);
      else
        this.callback('declaration', this.dom.getDepth() + 1, content, terminated);

      this.xmlMode = (docType.type === 'xhtml');
      this.dom.setXmlMode(this.xmlMode);
    }
    else {
      this.dom.addChild(new DeclarationElement(content, this.markupLine, this.markupColumn, terminated));

      if (!terminated)
        this.reportError('File ended in unterminated declaration', false);

      this.callback('declaration', this.dom.getDepth() + 1, content, terminated);
    }

    this.collectedSpace = '';
    this.pendingSource = '';
    this.leadingSpace = '';
    this.state = State.OUTSIDE_MARKUP;
  }

  private handleProcessingStart(content: string, terminated: boolean): void {
    this.dom.addChild(new ProcessingElement(content, this.markupLine, this.markupColumn, terminated));

    if (!terminated)
      this.reportError('File ended in unterminated processing instruction', false);

    this.callback('processing', this.dom.getDepth() + 1, content, terminated);

    if (content.startsWith('xml ') && this.dom.canDoXmlMode()) {
      this.xmlMode = true;
      this.dom.setXmlMode(true);
    }

    this.collectedSpace = '';
    this.pendingSource = '';
    this.leadingSpace = '';
    this.state = State.OUTSIDE_MARKUP;
  }

  private handleCommentStart(content: string, terminated: boolean): void {
    this.dom.addChild(new CommentElement(content, this.markupLine, this.markupColumn, terminated));

    if (!terminated)
      this.reportError('File ended in unterminated comment', false);

    this.callback('comment', this.dom.getDepth() + 1, content, terminated);

    this.collectedSpace = '';
    this.pendingSource = '';
    this.leadingSpace = '';
    this.state = State.OUTSIDE_MARKUP;
  }

  private handleTextBlockElements(tag: string, content: string, endTag: string, terminated: boolean): void {
    if (!terminated) {
      this.reportError(`File ended in unterminated <${tag}> section`, false);
      this.dom.getCurrentNode().closureState = ClosureState.UNCLOSED;
    }

    if (this.collectedSpace || content) {
      content = this.collectedSpace + content;
      this.dom.addChild(new TextElement(content, this.textLine, this.textColumn, tag === 'textarea'));

      this.callback('text', this.dom.getDepth() + 1, content, tag === 'textarea');

      this.collectedSpace = '';
      this.pendingSource = '';
    }

    if (terminated) {
      const $$ = new RegExp('^<\\/(' + tag + ')([ \\n\\r\\t\\f]*)>$', 'i').exec(endTag);

      this.pop(tag, `</${$$[1]}${$$[2]}>`);
      this.doEndTagCallback($$[1], $$[2] + '>');
    }

    this.state = State.OUTSIDE_MARKUP;
  }

  private pop(tagLc: string, endTagText = '') {
    if (!this.dom.pop(tagLc, endTagText, this.markupLine, this.markupColumn)) {
      ++this.parseResults.errors;
      this.callback('error', `Unmatched closing tag </${tagLc}>`, this.line, this.column, '');
    }
  }

  private reportError(message: string, reportPending = true) {
    ++this.parseResults.errors;
    this.callback('error', message, this.line, this.column, reportPending ? this.pendingSource : '');
    this.state = State.OUTSIDE_MARKUP;

    if (reportPending) {
      this.collectedSpace = '';
      this.pendingSource = '';
    }
  }

  private doEndTagCallback(tag: string, trailingContent: string) {
    this.callback('end-tag', this.dom.getDepth() + 1, tag, trailingContent);
    this.state = State.OUTSIDE_MARKUP;
    this.collectedSpace = '';
    this.pendingSource = '';
  }

  private doAttributeCallback(equalSign: string, value: string, quote: string): void {
    this.callback('attribute', this.leadingSpace, this.attribute, equalSign, value, quote);
    this.pendingSource = '';
  }

  private atEOF(): boolean {
    return !this.htmlSource;
  }

  private getChar(multi?: RegExp): string {
    let ch: string;

    if (this.putBacks.length > 0) {
      ch = this.putBacks.pop();

      this.pendingSource += ch;

      if (!this.fast) {
        if (isEol(ch)) {
          ++this.line;
          this.column = 0;
        }
        else {
          this.column += this.columnIncrement;
          this.columnIncrement = (ch === '\t' ? this.tabSize - (this.column - 1) % this.tabSize : 1);
        }
      }

      return ch;
    }

    if (this.htmlSource.length === 0)
      return '';
    else if (multi) {
      const $ = multi.exec(this.htmlSource);

      if ($) {
        this.htmlSource = this.htmlSource.slice($[1].length);
        this.parseResults.characters += $[1].length;
        this.column += this.columnIncrement + $[1].length - 1;

        return $[1];
      }
    }

    let skip = 1;

    ++this.parseResults.characters;
    ch = this.htmlSource.charAt(0);

    if (!this.fast && ch === '\r') {
      const ch2 = this.htmlSource.charAt(1);

      if (ch2 === '\n') {
        ++this.parseResults.characters;
        ch += '\n';
        skip = 2;
      }
    }

    if (!this.fast) {
      if (isEol(ch)) {
        ++this.line;
        this.column = 0;

        if (this.options.eol)
          ch = this.options.eol as string;
      }
      else {
        const cp = ch.charCodeAt(0);

        this.column += this.columnIncrement;
        this.columnIncrement = (ch === '\t' ? this.tabSize - (this.column - 1) % this.tabSize : 1);

        // Test for high surrogate
        if (0xD800 <= cp && cp <= 0xDBFF) {
          const ch2 = this.htmlSource.charAt(1);

          if (ch2) {
            const cp2 = ch2.charCodeAt(0);

            // Test for low surrogate
            if (0xDC00 <= cp2 && cp2 <= 0xDFFF) {
              ch += ch2;
              skip = 2;
            }
          }
        }
      }
    }

    this.pendingSource += ch;
    this.htmlSource = this.htmlSource.slice(skip);

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

  private gatherWhitespace(ch: string): string {
    while (ch.length > 1 || isWhitespace(ch)) {
      this.collectedSpace += ch;
      ch = this.getChar(this.reWhitespace);
    }

    return ch;
  }

  private gatherText(): string {
    const text: string[] = [];
    let ch: string;

    this.pendingSource = '';

    while ((ch = this.getChar(this.reText))) {
      if (ch === '<') {
        const ch2 = this.getChar();

        if (ch2 === '/' && !this.options.emptyEndTag) {
          const ch3 = this.getChar();

          if (ch3 !== '/' && isMarkupStart(ch3)) {
            this.putBack(ch3);
            this.putBack(ch2);
            break;
          }
          else
            text.push(ch + ch2 + ch3);
        }
        else if (isMarkupStart(ch2)) {
          this.putBack(ch2);
          break;
        }
        else
          text.push(ch + ch2);
      }
      else
        text.push(ch);
    }

    return text.join('');
  }

  private gatherTagName(init = ''): void {
    const tag = [init];

    let ch: string;

    while (isPCENChar(ch = this.getChar(), !this.xmlMode))
      tag.push(ch);

    this.currentTag = tag.join('');
    this.currentTagLc = this.xmlMode ? this.currentTag : this.currentTag.toLowerCase();
    this.putBack(ch);
  }

  private gatherInvalidEndTagEnding(): void {
    let ch: string;

    while ((ch = this.getChar()) && ch !== '>') {}
  }

  private gatherAttributeName(init = ''): void {
    this.attribute = init;

    let ch: string;

    while (isAttributeNameChar(ch = this.getChar(RE_ATTRIB_NAME), !this.xmlMode))
      this.attribute += ch;

    this.putBack(ch);
  }

  private gatherAttributeValue(quote: string, init = ''): [string, boolean] {
    let value = init;

    let ch: string;
    let afterSlash = false;

    while ((ch = this.getChar(this.reAttribValue[quote])) &&
           ch !== quote && (quote || (!isWhitespace(ch) && ch !== '>'))) {
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

    return [value, !quote || ch === quote];
  }

  private gatherComment(init = ''): [string, boolean] {
    const comment = [init];
    let stage = (init.endsWith('-') ? 1 : 0);
    let ch: string;

    while ((ch = this.getChar(stage === 0 ? this.reComment : undefined))) {
      comment.push(ch);

      if (stage === 0 && ch === '-')
        stage = 1;
      else if (stage === 1 && ch === '-')
        stage = 2;
      else if (stage === 2 && ch === '>') {
        const cmt = comment.join('');

        return [cmt.substr(0, cmt.length - 3), true];
      }
      else
        stage = 0;
    }

    return [comment.join(''), false];
  }

  private gatherDeclarationOrProcessing(init = '', checkForCData?: boolean): [string, boolean, boolean] {
    if (init === '>')
      return ['', true, false];

    let content = init;
    let ch: string;
    let cdataDetected = false;

    while ((ch = this.getChar(checkForCData ? undefined : this.reDeclaration))) {
      if (checkForCData && content.length === 7) {
        cdataDetected = (content === '[CDATA[');
        checkForCData = false;
      }

      if (ch === '>' && (!cdataDetected || content.endsWith(']]')))
        return [cdataDetected ? content.substring(7, content.length - 2) : content, true, cdataDetected];

      content += ch;
   }

    return [cdataDetected ? content.substr(7) : content, false, cdataDetected];
  }

  private gatherUntilEndTag(endTag: string, init = ''): [string, string, boolean] {
    const ender = '</' + endTag;
    const len = ender.length;
    let content = init;
    let endStage = ender.startsWith(init) ? init.length : 0;
    let ch: string;

    while ((ch = this.getChar(endStage === 0 ? this.reText : undefined))) {
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
        case 'n':
        case 'lf': this.options.eol = '\n'; break;

        case '\r':
        case 'r':
        case 'cr': this.options.eol = '\r'; break;

        case '\r\n':
        case 'rn':
        case 'crlf': this.options.eol = '\r\n'; break;

        default: this.options.eol = false;
      }
    }

    this.fast = this.options.fast;
    this.tabSize = this.options.tabSize;

    if (this.fast) {
      this.reWhitespace = RE_WHITESPACE_FAST;
      this.reText = RE_TEXT_FAST;
      this.reComment = RE_COMMENT_FAST;
      this.reDeclaration = RE_DECLARATION_FAST;
    }
    else {
      this.reWhitespace = RE_WHITESPACE;
      this.reText = RE_TEXT;
      this.reComment = RE_COMMENT;
      this.reDeclaration = RE_DECLARATION;
    }
  }
}
