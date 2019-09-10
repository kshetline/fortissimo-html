import commander from 'commander';
import fg from 'fast-glob';
import fs from 'fs';
import iconv from 'iconv-lite';

import { DomNode } from './dom';
import { HtmlParser, ParseResults } from './html-parser';
import { stylizeAsDocument } from './stylizer';

const keepAlive = setInterval(() => {}, 100);
const logDomTreeFlag = false;
const logErrorsFlag = true;
const logFilesFlag = true;
const logFromDomFlag = false;
const logProgressFlag = false;
const logRebuiltFlag = false;
const logStatsFlag = true;
const logWarningFlag = true;

commander
  .option('-x, --exclude <exclude>', 'pattern for files/directories to exclude')
  .arguments('<globs...>')
  .action(async (globs: string[]) => {
    const options = {
      ignore: commander.exclude ? [commander.exclude] : undefined,
    };
    const files = fg.sync(globs, options);

    for (const file of files)
      await processFile(file);

    clearInterval(keepAlive);
  })
  .parse(process.argv);

async function processFile(file: string): Promise<void> {
  if (logFilesFlag)
    console.log('\n\n' + file);

  let readEncoding = 'utf8';
  let tries = 0;
  let dom: DomNode;

  try {
    while (tries++ < 2 && !dom) {
      const rawStream = fs.createReadStream(file);
      const stream = rawStream.pipe(iconv.decodeStream(readEncoding, { stripBOM: true }));
      let content = '';
      const parser = new HtmlParser();
      let rebuilt = '';
      let done: () => void;
      let bytes = 0;

      parser
        .on('attribute', (leading, name, equals, value, quote) => {
          logProgress('attribute:', name + equals.trim() + quote + value + quote);
          rebuilt += leading + name + equals + quote + value + quote;
        })
        .on('cdata', (depth, cdata) => {
          logProgress('CDATA:', '<![CDATA[' + cdata + ']]>' + ' (' + depth + ')');
          rebuilt += '<![CDATA[' + cdata + ']]>';
        })
        .on('end-tag', (depth, tag, innerWhitespace: string) => {
          logProgress('end:', '</' + tag + innerWhitespace + '>' + ' (' + depth + ')');
          rebuilt += '</' + tag + innerWhitespace + '>';
        })
        .on('comment', (depth, comment) => {
          logProgress('comment:', comment + ' (' + depth + ')');
          rebuilt += '<!--' + comment + '-->';
        })
        .on('completion', results => {
          dom = results.domRoot;
          onCompletion(results, content, bytes, rebuilt);
          done();
        })
        .on('declaration', (depth, declaration) => {
          logProgress('declaration:', '<!' + declaration + '>' + ' (' + depth + ')');
          rebuilt += '<!' + declaration + '>';
        })
        .on('doctype', docType => {
          if (logStatsFlag)
            console.log('DOCTYPE: %s%s%s', docType.type.toUpperCase(), docType.variety ? ' ' + docType.variety : '',
              docType.version ? ' ' + docType.version : '');

          rebuilt += '<!' + docType.content + '>';
        })
        .on('encoding', (encoding, normalizedEncoding) => {
          if (logStatsFlag)
            console.log('*** Encoding: %s', encoding);

          if (readEncoding === normalizedEncoding)
            return false;

          logWarnings('*** Attempted encoding %s did not match declared encoding %s', readEncoding, normalizedEncoding);

          if (!iconv.encodingExists(normalizedEncoding)) {
            logErrors('*** Encoding %s is not supported', normalizedEncoding);
            tries = Number.MAX_SAFE_INTEGER;
          }

          readEncoding = normalizedEncoding;
          done();

          return true;
        })
        .on('error', (error, line, col, source) => {
          if (source)
            logErrors('*** %s ***', source);

          logErrors('*** %s: [%s, %s]', error, line, col);
          rebuilt += source || '';
        })
        .on('processing', (depth, processing) => {
          logProgress('processing:', '<?' + processing + '>' + ' (' + depth + ')');
          rebuilt += '<?' + processing + '>';
        })
        .on('start-tag-end', (depth, innerWhitespace, end) => {
          logProgress('tag end:', end + ' (' + depth + ')');
          rebuilt += innerWhitespace + end;
        })
        .on('start-tag-start', (depth, tag) => {
          logProgress('tag:', tag + ' (' + depth + ')');
          rebuilt += '<' + tag;
        })
        .on('text', (depth, text) => {
          logProgress('text:', text + ' (' + depth + ')');
          rebuilt += text;
        })
        .on('generic', (depth, text) => {
          logProgress('???:', text + '(' + depth + ')');
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
    }
  }
  catch (err) {
    console.error('Error reading file "%s": %s', file, err.toString());
  }
}

function logErrors(...args: any[]): void {
  if (logErrorsFlag)
    console.error(...args);
}

function logProgress(...args: any[]): void {
  if (logProgressFlag)
    console.log(...args);
}

function logWarnings(...args: any[]): void {
  if (logWarningFlag)
    console.warn(...args);
}

function onCompletion(results: ParseResults, content: string, bytes: number, rebuilt: string): void {
  content = content.replace(/\r\n|\n/g, '\n');

  const dom = results.domRoot;
  let size = bytes / 1048576;
  const speed = (size / results.totalTime * 1000);
  const rebuiltMatches = (rebuilt === content);
  const fromDom = dom ? dom.toString() : '';
  const fromDomMatches = (fromDom === content);

  if (logStatsFlag) {
    let unit = 'MB';

    if (size < 1) {
      unit = 'KB';
      size = bytes / 1024;
    }

    console.log('*** Finished %s%s in %s msec (%s MB/sec)', size.toFixed(2), unit, results.totalTime.toFixed(1), speed.toFixed(2));
    console.log('*** lines: %s, characters: %s', results.lines, results.characters);
    (results.unclosedTags > 0 ? console.warn : console.log)('*** unclosed tags: %s, implicitly closed: %s',
      results.unclosedTags, results.implicitlyClosedTags);
  }

  if (!logStatsFlag && results.unclosedTags > 0)
    logWarnings('*** unclosed tags: %s, implicitly closed: %s', results.unclosedTags, results.implicitlyClosedTags);

  if (results.errors > 0)
    logErrors('*** errors: %s', results.errors);

  if (logStatsFlag || (logErrorsFlag && !rebuiltMatches))
    (rebuiltMatches ? console.log : console.error)('*** original matches rebuilt: ' + rebuiltMatches);

  if (logStatsFlag || (logErrorsFlag && !fromDomMatches))
    (fromDomMatches ? console.log : console.error)('*** original matches from-dom: ' + fromDomMatches);

  if (!rebuiltMatches)
    logErrors('--- rebuilt ---\n' + rebuilt + '\n------');
  else if (logRebuiltFlag)
    console.log('--- rebuilt ---\n' + rebuilt + '\n------');

  if (!fromDomMatches)
    logErrors('--- from dom ---\n' + fromDom + '\n------');
  else if (logFromDomFlag)
    console.log('--- from dom ---\n' + fromDom + '\n------');

  if (logDomTreeFlag)
    console.log(JSON.stringify(dom, null, 2));

  fs.writeFileSync('/Users/kshetline/Desktop/sample.html', stylizeAsDocument(dom, {showWhitespace: true}), {encoding: 'utf8'});
}
