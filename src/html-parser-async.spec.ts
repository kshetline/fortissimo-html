import { expect } from 'chai';
import fs from 'fs';
import iconv from 'iconv-lite';
import { ParseResults } from './html-parser';
import { HtmlParserAsync } from './html-parser-async';
import { DocType } from './dom';
import { SMALL_SAMPLE } from './html-parser.spec';

describe('html-parser-async', () => {
  it('should properly parse HTML - async', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParserAsync();
    let docType: DocType;
    let errors = 0;
    const results = await parser
      .on('doctype', dt => docType = dt)
      .on('error', () => ++errors)
      .parseAsync(content);

    const reconstituted = results.domRoot.toString();
    const fromJSON = results.domRoot.toJSON();

    expect(content).equals(reconstituted);
    expect(fromJSON && fromJSON.children).to.be.ok;
    expect(fromJSON.children[1].content).equals('DOCTYPE html');
    expect(docType && docType.type).equals('html');
    expect(errors).equals(results.errors);
  });

  it('should properly parse XHTML - async', async () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParserAsync();
    let docType: DocType;
    const results = await parser.on('doctype', dt => docType = dt).parseAsync(content);
    const reconstituted = results.domRoot.toString();

    expect(content).equals(reconstituted);
    expect(docType && docType.type).equals('xhtml');
    expect(docType && docType.version).equals('1.0');
    expect(docType && docType.variety).equals('strict');
  });

  it('should properly reconstruct HTML from specific callbacks - async', async () => {
    const rawStream = fs.createReadStream('./test/sample.html');
    const stream = rawStream.pipe(iconv.decodeStream('utf-8', { stripBOM: true }));
    const parser = new HtmlParserAsync();
    let content = '';
    let rebuilt = '';
    let streamDone: () => void;
    let bytes = 0;

    parser
      .on('attribute', (leading, name, equals, value, quote) => {
        rebuilt += leading + name + equals + quote + value + quote;
      })
      .on('cdata', (depth, cdata, terminated) => {
        rebuilt += '<![CDATA[' + cdata + (terminated ? ']]>' : '');
      })
      .on('end-tag', (depth, tag, trailingContent: string) => {
        rebuilt += '</' + tag + trailingContent;
      })
      .on('comment', (depth, comment, terminated) => {
        rebuilt += '<!--' + comment + (terminated ? '-->' : '');
      })
      .on('completion', () => {
        streamDone();
      })
      .on('declaration', (depth, declaration, terminated) => {
        rebuilt += '<!' + declaration + (terminated ? '>' : '');
      })
      .on('doctype', (docType, terminated) => {
        // docType.type.toUpperCase(), docType.variety ? ' ' + docType.variety : '',
        rebuilt += '<!' + docType.content + (terminated ? '>' : '');
      })
      .on('error', (error, line, col, source) => {
        rebuilt += source || '';
      })
      .on('processing', (depth, processing, terminated) => {
        rebuilt += '<?' + processing + (terminated ? '>' : '');
      })
      .on('start-tag-end', (depth, innerWhitespace, end) => {
        rebuilt += innerWhitespace + end;
      })
      .on('start-tag-start', (depth, tag) => {
        rebuilt += '<' + tag;
      })
      .on('text', (depth, text) => {
        rebuilt += text;
      });

    await new Promise<void>(resolve => {
      streamDone = () => {
        stream.end();
        resolve();
      };

      rawStream.on('data', data => bytes += data.length);

      stream.on('data', data => {
        content += data;
        parser.parseChunk(data);
      });
      stream.on('end', () => parser.parseChunk(null));
    });

    expect(content).equals(rebuilt);
  });

  it('should properly reconstruct HTML from generic callbacks - async', async () => {
    const rawStream = fs.createReadStream('./test/sample.html');
    const stream = rawStream.pipe(iconv.decodeStream('utf-8', { stripBOM: true }));
    const parser = new HtmlParserAsync();
    let content = '';
    let rebuilt = '';
    let streamDone: () => void;
    let bytes = 0;

    parser
      .on('completion', () => {
        streamDone();
      })
      .on('generic', (depth, text) => {
        rebuilt += text;
      });

    await new Promise<void>(resolve => {
      streamDone = () => {
        stream.end();
        resolve();
      };

      rawStream.on('data', data => bytes += data.length);

      stream.on('data', data => {
        content += data;
        parser.parseChunk(data);
      });
      stream.on('end', () => parser.parseChunk(null));
    });

    expect(content).equals(rebuilt);
  });

  it('should handle switch from wrong encoding to correct encoding - async', async () => {
    let content = fs.readFileSync('./test/sample-iso-8859-1.html', 'utf-8');
    const parser = new HtmlParserAsync();
    let results: ParseResults;
    let encoding = 'utf8';
    let reconstituted: string;

    await parser.on('encoding', enc => { encoding = enc; return true; }).parseAsync(content);
    parser.off('encoding');
    content = iconv.decode(fs.readFileSync('./test/sample-iso-8859-1.html'), encoding);
    results = await parser.parseAsync(content);
    reconstituted = results.toString();

    expect(content).equals(reconstituted);
    expect(reconstituted).contains('Mañana');
  });

  it('should detect incorrect decoding by character patterns - async', async () => {
    const encodings = ['utf-16be', 'utf-16le', 'utf-32be', 'utf-32le'];

    for (const encoding of encodings) {
      const content = fs.readFileSync(`./test/sample-${encoding}.html`, 'utf-8');
      const parser = new HtmlParserAsync();

      await parser.on('encoding', (enc, normalized, explicit) => {
        expect(normalized).equals(encoding.replace('-', ''));
        expect(explicit).to.be.false;
        return true;
      }).parseAsync(content);
    }
  });

  it('can stop the parser - async', async () => {
    const parser = new HtmlParserAsync();
    let results: ParseResults;

    setTimeout(() => parser.stop(), 100);
    results = await parser.parseAsync();
    expect(results.stopped).to.be.true;
    expect(results.toString()).equals('');
    expect(new ParseResults().toString()).equals('');
  });

  it('can reset the parser - async', async () => {
    const parser = new HtmlParserAsync();
    let results: ParseResults;

    setTimeout(() => parser.reset(), 100);
    results = await parser.parseAsync();
    expect(results).to.be.null;

    parser.stop();
    expect(true).to.be.ok;
  });

  it('should handle waiting for input and characters split between chunks - async', async () => {
    const content = fs.readFileSync('./test/sample-iso-8859-1.html', 'utf-8') +
      '@😀\r\n\r';
    const parser = new HtmlParserAsync({ eol: false });
    let results: ParseResults;
    let reconstituted: string;
    let index = 0;

    results = await parser.on('request-data', () => {
      parser.parseChunk(content.charAt(index++), index === content.length);
    }).parseAsync();
    reconstituted = results.domRoot.toString();

    expect(content).equals(reconstituted);
  });

  it('should allow </ as plain text - async', async () => {
    const endBody = SMALL_SAMPLE.indexOf('</body>');
    const content = SMALL_SAMPLE.substr(0, endBody) + '</> </ >' + SMALL_SAMPLE.substr(endBody);
    const parser = new HtmlParserAsync({ emptyEndTag: false });
    let rebuilt = '';
    let results: ParseResults;

    results = await parser
      .on('generic', (depth, text) => {
        rebuilt += text;
      })
      .parseAsync(content);

    expect(rebuilt).equals(content);
    expect(results.errors).equals(0);
  });

  it('should handle a variety of unexpected EOF conditions - async', async () => {
    const endings = [
      '<!--', '<!--x', '<!someth..', '<?php', '<math><annotation><![CDATA[stuff', '<div',
      '<span foo', '<span  foo =', '<span foo= "bar', '<', '</', '</a', '</a ', '</a b'
    ];

    for (const ending of endings)  {
      const content = SMALL_SAMPLE + ending;
      const parser = new HtmlParserAsync();
      let rebuilt = '';
      let results: ParseResults;

      results = await parser
        .on('generic', (depth, text) => {
          rebuilt += text;
        })
        .parseAsync(content);

      expect(rebuilt).equals(content);
      expect(results.toString()).equals(content);
      expect(results.errors).equals(1);
    }
  });

  it('should handle all eol options - async', async () => {
    const content = 'a\nb\rc\r\nd';
    let results: ParseResults;

    results = await new HtmlParserAsync({ eol: false }).parseAsync(content);
    expect(results.domRoot.toString()).equals(content);
    results = await new HtmlParserAsync({ eol: '?' }).parseAsync(content);
    expect(results.domRoot.toString()).equals(content);

    results = await new HtmlParserAsync({ eol: true }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = await new HtmlParserAsync({ eol: 'n' }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = await new HtmlParserAsync({ eol: '\n' }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');

    results = await new HtmlParserAsync({ eol: 'r' }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');
    results = await new HtmlParserAsync({ eol: '\r' }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');

    results = await new HtmlParserAsync({ eol: 'rn' }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
    results = await new HtmlParserAsync({ eol: '\r\n' }).parseAsync(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
  });
});
