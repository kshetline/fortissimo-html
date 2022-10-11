import { expect } from 'chai';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
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
  it('should properly parse HTML', () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    let docType: DocType;
    let errors = 0;
    const results = parser
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

  it('should properly reconstruct damaged HTML', () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8').replace('<style>', '<style');
    const parser = new HtmlParser();
    const results = parser.parse(content).domRoot;

    expect(content).equals(results.toString());
  });

  it('should properly parse XHTML in fast mode', () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParser({ fast: true, eol: false });
    let docType: DocType;
    const results = parser.on('doctype', dt => docType = dt).parse(content);
    const reconstituted = results.domRoot.toString();

    expect(content).equals(reconstituted);
    expect(docType && docType.type).equals('xhtml');
    expect(docType && docType.version).equals('1.0');
    expect(docType && docType.variety).equals('strict');
  });

  it('should properly reconstruct HTML from specific callbacks', () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParser();
    let rebuilt = '';
    let completed = false;

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
        completed = true;
      })
      .on('declaration', (depth, declaration, terminated) => {
        rebuilt += '<!' + declaration + (terminated ? '>' : '');
      })
      .on('doctype', (docType, terminated) => {
        // docType.type.toUpperCase(), docType.variety ? ' ' + docType.variety : '',
        rebuilt += '<!' + docType.content + (terminated ? '>' : '');
      })
      // eslint-disable-next-line n/handle-callback-err
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
      })
      .parse(content);

    expect(content).equals(rebuilt);
    expect(completed).to.be.true;
  });

  it('should properly reconstruct HTML from generic callbacks using parseAsync()', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    let rebuilt = '';

    await parser
      .on('generic', (depth, text) => {
        rebuilt += text;
      })
      .parseAsync(content);

    expect(content).equals(rebuilt);
  });

  it('should handle switch from wrong encoding to correct encoding', () => {
    let content = fs.readFileSync('./test/sample-iso-8859-1.html', 'utf-8');
    const parser = new HtmlParser();
    let encoding = 'utf8';

    parser.on('encoding', enc => { encoding = enc; return true; }).parse(content);
    parser.off('encoding');
    content = iconv.decode(fs.readFileSync('./test/sample-iso-8859-1.html'), encoding);

    const results = parser.parse(content);
    const reconstituted = results.toString();

    expect(content).equals(reconstituted);
    expect(reconstituted).contains('Mañana');
  });

  it('should detect incorrect decoding by character patterns', () => {
    const encodings = ['utf-16be', 'utf-16le', 'utf-32be', 'utf-32le'];

    for (const encoding of encodings) {
      const content = fs.readFileSync(`./test/sample-${encoding}.html`, 'utf-8');
      const parser = new HtmlParser();

      parser.on('encoding', (enc, normalized, explicit) => {
        expect(normalized).equals(encoding.replace('-', ''));
        expect(explicit).to.be.false;
        return true;
      }).parse(content);
    }
  });

  it('can stop the parser', async () => {
    let parser = new HtmlParser();
    let results: ParseResults;

    results = parser
      .on('generic', () => parser.stop())
      .parse(SMALL_SAMPLE);

    expect(results.stopped).to.be.true;
    expect(results.toString()).equals('<!DOCTYPE html>');
    expect(new ParseResults().toString()).equals('');

    parser = new HtmlParser();

    results = await parser
      .on('generic', () => parser.stop())
      .parseAsync(SMALL_SAMPLE);

    expect(results.stopped).to.be.true;
    expect(results.toString()).equals('<!DOCTYPE html>');
    expect(new ParseResults().toString()).equals('');
  });

  it('can reset the parser', async () => {
    const parser = new HtmlParser();
    let results: ParseResults;

    results = parser
      .on('generic', () => parser.reset())
      .parse(SMALL_SAMPLE);
    expect(results).to.be.undefined;

    parser.off('generic');
    results = await parser
      .on('encoding', () => true)
      .parseAsync(SMALL_SAMPLE);
    expect(results).to.be.undefined;
  });

  it('should allow </ as plain text', () => {
    const endBody = SMALL_SAMPLE.indexOf('</body>');
    const content = SMALL_SAMPLE.substr(0, endBody) + '</> </ >' + SMALL_SAMPLE.substr(endBody);
    const parser = new HtmlParser({ emptyEndTag: false });
    let rebuilt = '';

    const results = parser
      .on('generic', (depth, text) => {
        rebuilt += text;
      })
      .parse(content);

    expect(rebuilt).equals(content);
    expect(results.errors).equals(0);
  });

  it('should handle a variety of unexpected EOF conditions', () => {
    const endings = [
      '<!--', '<!--x', '<!someth..', '<?php', '<math><annotation><![CDATA[stuff', '<div',
      '<span foo', '<span  foo =', '<span foo= "bar', '<', '</', '</a', '</a ', '</a b'
    ];

    for (const ending of endings) {
      const content = SMALL_SAMPLE + ending;
      const parser = new HtmlParser();
      let rebuilt = '';

      const results = parser
        .on('generic', (depth, text) => {
          rebuilt += text;
        })
        .parse(content);

      expect(rebuilt).equals(content);
      expect(results.toString()).equals(content);
      expect(results.errors).equals(1);
    }
  });

  it('should handle all eol options', () => {
    const content = 'a\nb\rc\r\nd';
    let results: ParseResults;

    results = new HtmlParser({ eol: false }).parse(content);
    expect(results.domRoot.toString()).equals(content);
    results = new HtmlParser({ eol: '?' }).parse(content);
    expect(results.domRoot.toString()).equals(content);

    results = new HtmlParser({ eol: true }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = new HtmlParser({ eol: 'n' }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = new HtmlParser({ eol: '\n' }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');
    results = new HtmlParser({ eol: 'lf' }).parse(content);
    expect(results.domRoot.toString()).equals('a\nb\nc\nd');

    results = new HtmlParser({ eol: 'r' }).parse(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');
    results = new HtmlParser({ eol: '\r' }).parse(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');
    results = new HtmlParser({ eol: 'cr' }).parse(content);
    expect(results.domRoot.toString()).equals('a\rb\rc\rd');

    results = new HtmlParser({ eol: 'rn' }).parse(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
    results = new HtmlParser({ eol: '\r\n' }).parse(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
    results = new HtmlParser({ eol: 'crlf' }).parse(content);
    expect(results.domRoot.toString()).equals('a\r\nb\r\nc\r\nd');
  });

  it('should determine tabbed column positions correctly', () => {
    const dom = new HtmlParser({ tabSize: 4 }).parse(
`
<div id=do></div>
\t<div id=re></div>
 \t<div id=me></div>
  \t<div id=fa></div>
   \t<div id=so></div>
    \t<div id=la></div>
\t\t<div id=ti></div>
`).domRoot;

    expect(dom.querySelector('#do').column).equals(1);
    expect(dom.querySelector('#re').column).equals(5);
    expect(dom.querySelector('#me').column).equals(5);
    expect(dom.querySelector('#fa').column).equals(5);
    expect(dom.querySelector('#so').column).equals(5);
    expect(dom.querySelector('#la').column).equals(9);
    expect(dom.querySelector('#ti').column).equals(9);
  });
});
