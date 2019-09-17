import { expect } from 'chai';
import fs from 'fs';
import iconv from 'iconv-lite';
import { HtmlParser, ParseResults } from './html-parser';
import { DocType } from './dom';

describe('html-parser', () => {
  it('should properly parse HTML', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    let docType: DocType;
    const dom = await parser.on('doctype', dt => docType = dt).parse(content);
    const reconstituted = dom.domRoot.toString();
    const fromJSON = dom.domRoot.toJSON();

    expect(content).equals(reconstituted);
    expect(fromJSON && fromJSON.children).to.be.ok;
    expect(fromJSON.children[1].content).equals('DOCTYPE html');
    expect(docType && docType.type).equals('html');
  });

  it('should properly parse XHTML', async () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParser();
    let docType: DocType;
    const dom = await parser.on('doctype', dt => docType = dt).parse(content);
    const reconstituted = dom.domRoot.toString();

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

  it('should handle switch from wrong encoding to correct encoding', async () => {
    let content = fs.readFileSync('./test/sample-iso-8859-1.html', 'utf-8');
    const parser = new HtmlParser();
    let dom: ParseResults;
    let encoding = 'utf8';
    let reconstituted: string;

    await parser.on('encoding', enc => { encoding = enc; return true; }).parse(content);
    parser.off('encoding');
    content = iconv.decode(fs.readFileSync('./test/sample-iso-8859-1.html'), encoding);
    dom = await parser.parse(content);
    reconstituted = dom.domRoot.toString();

    expect(content).equals(reconstituted);
    expect(reconstituted).contains('Mañana');
  });

  it('can stop the parser', async () => {
    const parser = new HtmlParser();
    let results: ParseResults;

    setTimeout(() => parser.stop(), 100);
    results = await parser.parse();
    expect(results.stopped).to.be.true;
  });
});
