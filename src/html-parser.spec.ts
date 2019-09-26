import { expect } from 'chai';
import fs from 'fs';
import iconv from 'iconv-lite';
import { HtmlParser, ParseResults } from './html-parser';
import { DocType } from './dom';

export const SMALL_SAMPLE =
`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sample</title></head>
<body>Sample<img src="/foo.jpg" width="32" height="32" alt="can't"/></body>
</html>
`;

describe('html-parser', () => {
  it('should properly parse HTML', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    let docType: DocType;
    let errors = 0;
    const results = await parser
      .on('doctype', dt => docType = dt)
      .on('error', () => ++errors)
      .parse(content);

    const reconstituted = results.domRoot.toString();
    const fromJSON = results.domRoot.toJSON();

    expect(content).equals(reconstituted);
    expect(fromJSON && fromJSON.children).to.be.ok;
    expect(fromJSON.children[1].content).equals('DOCTYPE html');
    expect(docType && docType.type).equals('html');
    expect(errors).equals(results.errors);
  });

  it('should properly parse XHTML', async () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParser();
    let docType: DocType;
    const results = await parser.on('doctype', dt => docType = dt).parse(content);
    const reconstituted = results.domRoot.toString();

    expect(content).equals(reconstituted);
    expect(docType && docType.type).equals('xhtml');
    expect(docType && docType.version).equals('1.0');
    expect(docType && docType.variety).equals('strict');
  });

  it('should properly reconstruct HTML from specific callbacks', async () => {
    const rawStream = fs.createReadStream('./test/sample.html');
    const stream = rawStream.pipe(iconv.decodeStream('utf-8', { stripBOM: true }));
    const parser = new HtmlParser();
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

  it('should properly reconstruct HTML from generic callbacks', async () => {
    const rawStream = fs.createReadStream('./test/sample.html');
    const stream = rawStream.pipe(iconv.decodeStream('utf-8', { stripBOM: true }));
    const parser = new HtmlParser();
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

  it('should handle switch from wrong encoding to correct encoding', async () => {
    let content = fs.readFileSync('./test/sample-iso-8859-1.html', 'utf-8');
    const parser = new HtmlParser();
    let results: ParseResults;
    let encoding = 'utf8';
    let reconstituted: string;

    await parser.on('encoding', enc => { encoding = enc; return true; }).parse(content);
    parser.off('encoding');
    content = iconv.decode(fs.readFileSync('./test/sample-iso-8859-1.html'), encoding);
    results = await parser.parse(content);
    reconstituted = results.toString();

    expect(content).equals(reconstituted);
    expect(reconstituted).contains('Mañana');
  });

  it('can stop the parser', async () => {
    const parser = new HtmlParser();
    let results: ParseResults;

    setTimeout(() => parser.stop(), 100);
    results = await parser.parse();
    expect(results.stopped).to.be.true;
    expect(results.toString()).equals('');
    expect(new ParseResults().toString()).equals('');
  });

  it('can reset the parser', async () => {
    const parser = new HtmlParser();
    let results: ParseResults;

    setTimeout(() => parser.reset(), 100);
    results = await parser.parse();
    expect(results).to.be.null;

    parser.stop();
    expect(true).to.be.ok;
  });

  it('should handle waiting for input and characters split between chunks', async () => {
    const content = fs.readFileSync('./test/sample-iso-8859-1.html', 'utf-8') +
      '@😀\r\n\r';
    const parser = new HtmlParser({ eol: false });
    let results: ParseResults;
    let reconstituted: string;
    let index = 0;

    results = await parser.on('request-data', () => {
      parser.parseChunk(content.charAt(index++), index === content.length);
    }).parse();
    reconstituted = results.domRoot.toString();

    expect(content).equals(reconstituted);
  });

  it('should allow </ as plain text', async () => {
    const endBody = SMALL_SAMPLE.indexOf('</body>');
    const content = SMALL_SAMPLE.substr(0, endBody) + '</> </ >' + SMALL_SAMPLE.substr(endBody);
    const parser = new HtmlParser({ emptyEndTag: false });
    let rebuilt = '';
    let results: ParseResults;

    results = await parser
      .on('generic', (depth, text) => {
        rebuilt += text;
      })
      .parse(content);

    expect(rebuilt).equals(content);
    expect(results.errors).equals(0);
  });

  it('should handle a variety of unexpected EOF conditions', async () => {
    const endings = [
      '<!--', '<!--x', '<!someth..', '<?php', '<math><annotation><![CDATA[stuff', '<div',
      '<span foo', '<span  foo =', '<span foo= "bar', '<', '</', '</a', '</a ', '</a b'
    ];

    for (const ending of endings)  {
      const content = SMALL_SAMPLE + ending;
      const parser = new HtmlParser();
      let rebuilt = '';
      let results: ParseResults;

      results = await parser
        .on('generic', (depth, text) => {
          rebuilt += text;
        })
        .parse(content);

      expect(rebuilt).equals(content);
      expect(results.toString()).equals(content);
      expect(results.errors).equals(1);
    }
  });

  it('should handle all eol options', async () => {
    const content = 'a\nb\rc\r\nd';
    let results: ParseResults;

    results = await new HtmlParser({ eol: false }).parse(content);
    expect(results.domRoot.toString()).equals(content);
    results = await new HtmlParser({ eol: '?' }).parse(content);
    expect(results.domRoot.toString()).equals(content);

    results = await new HtmlParser({ eol: true }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = await new HtmlParser({ eol: 'n' }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = await new HtmlParser({ eol: '\n' }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');

    results = await new HtmlParser({ eol: 'r' }).parse(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');
    results = await new HtmlParser({ eol: '\r' }).parse(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');

    results = await new HtmlParser({ eol: 'rn' }).parse(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
    results = await new HtmlParser({ eol: '\r\n' }).parse(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
  });
});
