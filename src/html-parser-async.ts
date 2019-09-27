import { processMillis } from './platform-specifics';
import { VOID_ELEMENTS } from './elements';
import { isAttributeNameChar, isMarkupStart, isPCENChar, isWhitespace } from './characters';
import { CData, ClosureState, CommentElement, DeclarationElement, DocType, DomModel, DomNode, ProcessingElement,
  TextElement, UnmatchedClosingTag } from './dom';
import { DEFAULT_OPTIONS, HtmlParser, ParseResults, State, tagForState, TEXT_STARTERS } from './html-parser';

const DEFAULT_YIELD_TIME = 50;

export class HtmlParserAsync extends HtmlParser {
  private nextChunk = '';
  private nextChunkIsFinal: boolean;
  private parsingResolver: (results: ParseResults) => void;
  private resolveNextChunk: (gotMoreChars: string) => void;
  private yieldTime = DEFAULT_YIELD_TIME;

  constructor(
    options = DEFAULT_OPTIONS
  ) {
    super(options);
  }

  stop(): void {
    super.stop();

    this.nextChunk = '';
    this.nextChunkIsFinal = false;

    if (this.resolveNextChunk) {
      this.resolveNextChunk('');
      this.resolveNextChunk = undefined;
    }
  }

  reset(): void {
    super.reset();

    this.nextChunk = '';
    this.nextChunkIsFinal = false;

    if (this.parsingResolver) {
      this.parsingResolver(null);
      this.parsingResolver = null;
    }

    if (this.resolveNextChunk) {
      this.resolveNextChunk('');
      this.resolveNextChunk = undefined;
    }
  }

  async parseAsync(source = '', yieldTime = DEFAULT_YIELD_TIME): Promise<ParseResults> {
    return this.parseAux(source, yieldTime, !!source);
  }

  parseChunk(chunk: string, isFinal = false, yieldTime = DEFAULT_YIELD_TIME): void {
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
      this.resolveNextChunk(this.getChar() || (this.atEOF() ? '' : '---'));
    }
    else
      this.nextChunk = (this.nextChunk || '') + chunk;
  }

  private async parseAux(source = '', yieldTime = DEFAULT_YIELD_TIME, isFinal = !!source): Promise<ParseResults> {
    this.startTime = processMillis();
    this.parserRunning = true;
    this.htmlSource = source || '';
    this.htmlSourceIsFinal = isFinal;
    this.pendingSource = '';
    this.putBacks = [];
    this.sourceIndex = 0;
    this.state = State.OUTSIDE_MARKUP;
    this.dom = new DomModel();
    this.parseResults = new ParseResults();
    this.parseResults.domRoot = this.dom.getRoot();

    this.checkEncoding(this.htmlSource);

    if (this.stopped)
      return Promise.resolve(null);

    return new Promise<ParseResults>(resolve => {
      this.yieldTime = yieldTime;
      this.parsingResolver = results => {
        if (this.pendingReset)
          this.reset();

        resolve(results);
      };

      const parse = () => {
        this.parseLoopAsync().then(() => {
          if (this.parserRunning)
            setTimeout(parse);
        });
      };

      setTimeout(parse);
    });
  }

  private async parseLoopAsync(): Promise<void> {
    let ch: string;
    let content: string;
    let terminated: boolean;
    let isCData: boolean;
    let endTag: string;
    let node: DomNode;
    const loopStartTime = processMillis();

    while ((ch = this.getChar() || await this.getNextChunkChar()) || this.state >= State.AT_COMMENT_START) {
      if (ch) {
        if (TEXT_STARTERS.has(this.state)) {
          this.textLine = this.line;
          this.textColumn = this.column;
        }

        while (isWhitespace(ch)) {
          this.collectedSpace += ch;
          ch = this.getChar() || await this.getNextChunkChar();
        }
      }

     if (!ch && this.state < State.AT_COMMENT_START)
      break;

     switch (this.state) {
        case State.OUTSIDE_MARKUP:
          this.putBack(ch);

          const text = this.collectedSpace + await this.gatherTextAsync();

          if (text) {
            this.dom.addChild(new TextElement(text, this.textLine, this.textColumn, true));
            this.pendingSource = this.atEOF() && this.putBacks.length === 0 ? '' : '<';
            this.callback('text', this.dom.getDepth() + 1, text, true);
          }

          this.collectedSpace = '';
          this.currentTag = this.currentTagLc = '';
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
          await this.gatherTagNameAsync(ch);

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
          if (ch === '>') {
            this.currentTag = this.currentTagLc = '';
            this.putBack(ch);
          }
          else {
            await this.gatherTagNameAsync(ch);
            this.collectedSpace = '';
          }

          this.state = State.IN_END_TAG;
        break;

        case State.IN_END_TAG:
          if (ch !== '>') {
            if (this.xmlMode) {
              this.putBack(ch);
              this.pop(this.currentTagLc, this.pendingSource);
              this.reportError('Syntax error in end tag');
              break;
            }
            else {
              if (this.atEOF())
                break;

              ++this.parseResults.errors;
              this.callback('error', 'Syntax error in end tag', this.line, this.column, '');
              this.pendingSource = this.collectedSpace + ch;
              this.gatherInvalidEndTagEndingAsync();
              this.pop(this.currentTagLc, `</${this.currentTag}${this.pendingSource}`);
              this.doEndTagCallback(this.currentTag, this.pendingSource);
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
              await this.gatherAttributeNameAsync(ch);
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
            let quote = (ch === '"' || ch === "'") ? ch : '';
            let value;
            [value, terminated] = await this.gatherAttributeValueAsync(quote, quote ? '' : ch);
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
                const bailout = this.callback('encoding', this.charset, this.charset.toLowerCase().replace(/:\d{4}$|[^0-9a-z]/g, ''), true);

                if (bailout) {
                  this.parserRunning = false;
                  this.pendingReset = true;
                  this.parsingResolver(null);

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

          [content, terminated, isCData] = await this.gatherDeclarationOrProcessingAsync(this.collectedSpace + ch,
            this.dom.shouldParseCData());

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
        break;

        case State.AT_PROCESSING_START:
          [content, terminated] = await this.gatherDeclarationOrProcessingAsync(this.collectedSpace + ch);

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
        break;

        case State.AT_COMMENT_START:
          [content, terminated] = await this.gatherCommentAsync(this.collectedSpace + ch);

          this.dom.addChild(new CommentElement(content, this.markupLine, this.markupColumn, terminated));

          if (!terminated)
            this.reportError('File ended in unterminated comment', false);

          this.callback('comment', this.dom.getDepth() + 1, content, terminated);

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

          [content, endTag, terminated] = await this.gatherUntilEndTagAsync(tag, ch);

          if (!terminated) {
            this.reportError(`File ended in unterminated <${tag}> section`, false);
            this.dom.getCurrentNode().closureState = ClosureState.UNCLOSED;
          }

          if (content || this.collectedSpace) {
            content = this.collectedSpace + content;
            this.dom.addChild(new TextElement(content, this.textLine, this.textColumn, tag === 'textarea'));

            this.callback('text', this.dom.getDepth() + 1, content, tag === 'textarea');

            this.collectedSpace = '';
            this.pendingSource = '';
          }

          const $$ = new RegExp('^<\\/(' + tag + ')([ \\n\\r\\t\\f]*)>$', 'i').exec(endTag);

          this.pop(tag, `</${$$[1]}${$$[2]}>`);
          this.doEndTagCallback($$[1], $$[2] + '>');
          this.state = State.OUTSIDE_MARKUP;
        break;
      }

      if (processMillis() >= loopStartTime + this.yieldTime)
        return;
    }

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
    this.parsingResolver(this.parseResults);
    this.parserRunning = false;
  }

  private async getNextChunkChar(): Promise<string> {
    if (this.atEOF())
      return '';
    else if (this.nextChunk || this.nextChunkIsFinal) {
      this.htmlSource = this.nextChunk || '';
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

      this.resolveNextChunk = (ch: string) => {
        if (ch !== '---')
          resolve(ch);
        else
          setTimeout(() => this.callback('request-data'));
      };
    });
  }

  private async gatherTextAsync(): Promise<string> {
    let text = '';
    let ch: string;

    this.pendingSource = '';

    while ((ch = this.getChar() || await this.getNextChunkChar())) {
      if (ch === '<') {
        const ch2 = this.getChar() || await this.getNextChunkChar();

        if (ch2 === '/' && !this.options.emptyEndTag) {
          const ch3 = this.getChar() || await this.getNextChunkChar();

          if (ch3 !== '/' && isMarkupStart(ch3)) {
            this.putBack(ch3);
            this.putBack(ch2);
            break;
          }
          else
            text += ch + ch2 + ch3;
        }
        else if (isMarkupStart(ch2)) {
          this.putBack(ch2);
          break;
        }
        else
          text += ch + ch2;
      }
      else
        text += ch;
    }

    return text;
  }

  private async gatherTagNameAsync(init = ''): Promise<void> {
    this.currentTag = init;

    let ch: string;

    while (isPCENChar(ch = this.getChar() || await this.getNextChunkChar(), !this.xmlMode))
      this.currentTag += ch;

    this.currentTagLc = this.xmlMode ? this.currentTag : this.currentTag.toLowerCase();
    this.putBack(ch);
  }

  private async gatherInvalidEndTagEndingAsync(): Promise<void> {
    let ch: string;

    while ((ch = this.getChar() || await this.getNextChunkChar()) && ch !== '>') {}
  }

  private async gatherAttributeNameAsync(init = ''): Promise<void> {
    this.attribute = init;

    let ch: string;

    while (isAttributeNameChar(ch = this.getChar() || await this.getNextChunkChar(), !this.xmlMode))
      this.attribute += ch;

    this.putBack(ch);
  }

  private async gatherAttributeValueAsync(quote: string, init = ''): Promise<[string, boolean]> {
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

    return [value, !quote || ch === quote];
  }

  private async gatherCommentAsync(init = ''): Promise<[string, boolean]> {
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

  private async gatherDeclarationOrProcessingAsync(init = '', checkForCData?: boolean):
    Promise<[string, boolean, boolean]> {
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

    return [cdataDetected ? content.substr(7) : content, false, cdataDetected];
  }

  private async gatherUntilEndTagAsync(endTag: string, init = ''): Promise<[string, string, boolean]> {
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
}
