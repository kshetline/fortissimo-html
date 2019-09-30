import { processMillis } from './platform-specifics';
import { isAttributeNameChar, isMarkupStart, isPCENChar, isWhitespace } from './characters';
import { HtmlParser, HtmlParserOptions, ParseResults, State } from './html-parser';

const DEFAULT_YIELD_TIME = 50;

export class HtmlParserAsync extends HtmlParser {
  private nextChunk = '';
  private nextChunkIsFinal: boolean;
  private parsingResolver: (results: ParseResults) => void;
  private resolveNextChunk: (gotMoreChars: string) => void;
  private yieldTime = DEFAULT_YIELD_TIME;

  constructor(options?: HtmlParserOptions) {
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

  parse(source: string): ParseResults {
    throw new Error('Not implemented');
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

    if (this.fast && this.options.eol)
      chunk = chunk.replace(/\r\n|\r|\n/g, this.options.eol as string);

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
    this.startParsing(source, isFinal);
    this.nextChunk = '';
    this.nextChunkIsFinal = false;

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
    const loopStartTime = processMillis();

    while ((ch = this.getChar() || await this.getNextChunkChar()) || this.state >= State.AT_COMMENT_START) {
      if (ch) {
        if (HtmlParser.TEXT_STARTERS.has(this.state)) {
          this.textLine = this.line;
          this.textColumn = this.column;
        }

        ch = await this.gatherWhitespaceAsync(ch);
      }

     if (!ch && this.state < State.AT_COMMENT_START)
      break;

     switch (this.state) {
        case State.OUTSIDE_MARKUP:
          this.putBack(ch);
          this.handleText(this.collectedSpace + await this.gatherTextAsync());
        break;

        case State.AT_MARKUP_START:
          this.handleMarkupStart(ch);
        break;

        case State.AT_START_TAG_START:
          await this.gatherTagNameAsync(ch);
          this.handleStartTagStart();
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
         const invalidEnding = this.handleEndTag(ch);

         if (invalidEnding) {
           await this.gatherInvalidEndTagEndingAsync();
           this.pop(this.currentTagLc, `</${this.currentTag}${this.pendingSource}`);
           this.doEndTagCallback(this.currentTag, this.pendingSource);
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

          const getAttribName = this.handleAttributeStart(ch, end);

          if (getAttribName)
            await this.gatherAttributeNameAsync(ch);
        break;

        case State.AT_ATTRIBUTE_ASSIGNMENT:
          this.handleAttributeAssignment(ch);
        break;

        case State.AT_ATTRIBUTE_VALUE:
          const quote = this.handleAttributeValueStepOne(ch);

          if (quote !== undefined) {
            let value;
            [value, terminated] = await this.gatherAttributeValueAsync(quote, quote ? '' : ch);

            if (this.handleAttributeValueStepTwo(ch, quote, value, terminated)) {
              this.parsingResolver(null);

              return;
            }
          }

          this.state = State.AT_ATTRIBUTE_START;
        break;

        case State.AT_DECLARATION_START:
          if (this.handleDeclarationStartStepOne(ch)) {
            [content, terminated, isCData] = await this.gatherDeclarationOrProcessingAsync(this.collectedSpace + ch,
              this.dom.shouldParseCData());

            this.handleDeclarationStartStepTwo(content, terminated, isCData);
          }
        break;

        case State.AT_PROCESSING_START:
          [content, terminated] = await this.gatherDeclarationOrProcessingAsync(this.collectedSpace + ch);
          this.handleProcessingStart(content, terminated);
        break;

        case State.AT_COMMENT_START:
          [content, terminated] = await this.gatherCommentAsync(this.collectedSpace + ch);
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

          [content, endTag, terminated] = await this.gatherUntilEndTagAsync(tag, ch);
          this.handleTextBlockElements(tag, content, endTag, terminated);
        break;
      }

      if (processMillis() >= loopStartTime + this.yieldTime)
        return;
    }

    this.parseLoopWrapUp();

    if (this.parsingResolver)
      this.parsingResolver(this.parseResults);
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

  private async gatherWhitespaceAsync(ch: string): Promise<string> {
    while (ch.length > 1 || isWhitespace(ch)) {
      this.collectedSpace += ch;
      ch = this.getChar(this.reWhitespace) || await this.getNextChunkChar();
    }

    return ch;
  }

  private async gatherTextAsync(): Promise<string> {
    let text = '';
    let ch: string;

    this.pendingSource = '';

    while ((ch = this.getChar(this.reText) || await this.getNextChunkChar())) {
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

    while (isPCENChar(ch = this.getChar() || await this.getNextChunkChar(), this.fast || !this.xmlMode))
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

    while (isAttributeNameChar(ch = this.getChar(this.reAttribName) ||
           await this.getNextChunkChar(), this.fast || !this.xmlMode))
      this.attribute += ch;

    this.putBack(ch);
  }

  private async gatherAttributeValueAsync(quote: string, init = ''): Promise<[string, boolean]> {
    let value = init;

    let ch: string;
    let afterSlash = false;

    while ((ch = this.getChar(this.reAttribValue[quote]) ||
           await this.getNextChunkChar()) && ch !== quote && (quote || (!isWhitespace(ch) && ch !== '>'))) {
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
    const comment = [init];
    let stage = (init.endsWith('-') ? 1 : 0);
    let ch: string;

    // noinspection DuplicatedCode
    while ((ch = this.getChar(stage === 0 ? this.reComment : undefined) || await this.getNextChunkChar())) {
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

  private async gatherDeclarationOrProcessingAsync(init = '', checkForCData?: boolean):
    Promise<[string, boolean, boolean]> {
    if (init === '>')
      return ['', true, false];

    let content = init;
    let ch: string;
    let cdataDetected = false;

    // noinspection DuplicatedCode
    while ((ch = this.getChar(checkForCData ? undefined : this.reDeclaration) ||
           await this.getNextChunkChar())) {
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

    // noinspection DuplicatedCode
    while ((ch = this.getChar(endStage === 0 ? this.reText : undefined) || await this.getNextChunkChar())) {
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
