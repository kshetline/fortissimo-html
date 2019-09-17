import { expect } from 'chai';
import fs from 'fs';
import iconv from 'iconv-lite';
import { HtmlParser } from './html-parser';

describe('html-parser', () => {
  it('should properly parse HTML', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    const dom = await parser.parse(content);
    const reconstituted = dom.domRoot.toString();

    expect(content).equals(reconstituted);
  });

  it('should properly parse XHTML', async () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParser();
    const dom = await parser.parse(content);
    const reconstituted = dom.domRoot.toString();

    expect(content).equals(reconstituted);
  });

  it('should properly reconstruct HTML from specific callbacks', async () => {
    const rawStream = fs.createReadStream('./test/sample.html');
    const stream = rawStream.pipe(iconv.decodeStream('utf-8', { stripBOM: true }));
    const parser = new HtmlParser();
    let content = '';
    let rebuilt = '';
    let done: () => void;
    let bytes = 0;

    parser
      .on('attribute', (leading, name, equals, value, quote) => {
        rebuilt += leading + name + equals + quote + value + quote;
      })
      .on('cdata', (depth, cdata) => {
        rebuilt += '<![CDATA[' + cdata + ']]>';
      })
      .on('end-tag', (depth, tag, trailingContent: string) => {
        rebuilt += '</' + tag + trailingContent;
      })
      .on('comment', (depth, comment) => {
        rebuilt += '<!--' + comment + '-->';
      })
      .on('completion', () => {
        done();
      })
      .on('declaration', (depth, declaration) => {
        rebuilt += '<!' + declaration + '>';
      })
      .on('doctype', docType => {
        // docType.type.toUpperCase(), docType.variety ? ' ' + docType.variety : '',
        rebuilt += '<!' + docType.content + '>';
      })
      .on('encoding', (encoding, normalizedEncoding) => {
        return false;
      })
      .on('error', (error, line, col, source) => {
        rebuilt += source || '';
      })
      .on('processing', (depth, processing) => {
        rebuilt += '<?' + processing + '>';
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
      done = () => {
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
    let done: () => void;
    let bytes = 0;

    parser
      .on('completion', () => {
        done();
      })
      .on('generic', (depth, text) => {
        rebuilt += text;
      });

    await new Promise<void>(resolve => {
      done = () => {
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
});
