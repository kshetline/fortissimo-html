import commander from 'commander';
import fg from 'fast-glob';
import fs from 'fs';
import iconv from 'iconv-lite';

import { DomElement, DomNode } from './dom';
import { HtmlParser } from './html-parser';
import { processMillis } from './util';

const keepAlive = setInterval(() => {}, 100);
const logDomTreeFlag = false;
const logErrorsFlag = true;
const logFilesFlag = true;
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
      const stream = fs.createReadStream(file).pipe(iconv.decodeStream(readEncoding, { stripBOM: true }));
      let content = '';
      const startTime = processMillis();
      const parser = new HtmlParser();
      let rebuilt = '';
      let done: () => void;

      parser
        .onAttribute((leading, name, equals, value, quote) => {
          logProgress('attribute:', name + equals.trim() + quote + value + quote);
          rebuilt += leading + name + equals + quote + value + quote;
        })
        .onCData((depth, cdata) => {
          logProgress('CDATA:', '<![CDATA[' + cdata + ']]>' + ' (' + depth + ')');
          rebuilt += '<![CDATA[' + cdata + ']]>';
        })
        .onEndTag((depth, tag, innerWhiteSpace: string) => {
          logProgress('end:', '</' + tag + innerWhiteSpace + '>' + ' (' + depth + ')');
          rebuilt += '</' + tag + innerWhiteSpace + '>';
        })
        .onComment((depth, comment) => {
          logProgress('comment:', comment + ' (' + depth + ')');
          rebuilt += '<!--' + comment + '-->';
        })
        .onCompletion((domRoot, unclosed) => {
          dom = domRoot;

          const totalTime = processMillis() - startTime;
          let size = content.length / 1048576;
          const speed = (size / totalTime * 1000);
          const contentMatches = (rebuilt === content || rebuilt === (content = content.replace(/\r\n|\n/g, '\n')));

          if (logStatsFlag) {
            let unit = 'MB';

            if (size < 1) {
              unit = 'KB';
              size = content.length / 1024;
            }

            console.log('*** Finished %s%s in %s msec (%s MB/sec)', size.toFixed(2), unit, totalTime.toFixed(1), speed.toFixed(2));
            console.log('*** output matches input: ' + contentMatches);
            console.log('*** unclosed tags: ' + unclosed);
          }

          if (!contentMatches)
            logErrors(rebuilt);
          else if (logRebuiltFlag)
            console.log(rebuilt);

          if (logDomTreeFlag)
            console.log(JSON.stringify(domRoot, (name, value) => {
              if (name === 'parent')
                return undefined;
              else if (value instanceof DomElement && value.content !== null)
                return value.toString();
              else
                return value;
            }, 2));

          done();
        })
        .onDeclaration((depth, declaration) => {
          logProgress('declaration:', '<!' + declaration + '>' + ' (' + depth + ')');
          rebuilt += '<!' + declaration + '>';
        })
        .onDocType(docType => {
          if (logStatsFlag)
            console.log('DOCTYPE: %s%s%s', docType.type.toUpperCase(), docType.variety ? ' ' + docType.variety : '',
              docType.version ? ' ' + docType.version : '');

          rebuilt += '<!' + docType.content + '>';
        })
        .onEncoding((encoding, normalizedEncoding) => {
          if (logStatsFlag)
            console.log('*** Encoding: %s', encoding);

          if (readEncoding === normalizedEncoding)
            return false;

          if (logWarningFlag)
            console.warn('*** Attempted encoding %s did not match declared encoding %s', readEncoding, normalizedEncoding);

          if (!iconv.encodingExists(normalizedEncoding)) {
            logErrors('*** Encoding %s is not supported', normalizedEncoding);
            tries = Number.MAX_SAFE_INTEGER;
          }

          readEncoding = normalizedEncoding;
          done();

          return true;
        })
        .onError((error, line, col, source) => {
          if (source)
            logErrors('*** %s ***', source);

          logErrors('*** %s: [%s, %s]', error, line, col);
          rebuilt += source || '';
        })
        .onProcessing((depth, processing) => {
          logProgress('processing:', '<?' + processing + '>' + ' (' + depth + ')');
          rebuilt += '<?' + processing + '>';
        })
        .onStartTagEnd((depth, innerWhiteSpace, end) => {
          logProgress('tag end:', end + ' (' + depth + ')');
          rebuilt += innerWhiteSpace + end;
        })
        .onStartTagStart((depth, tag) => {
          logProgress('tag:', tag + ' (' + depth + ')');
          rebuilt += '<' + tag;
        })
        .onText((depth, text) => {
          logProgress('text:', text + ' (' + depth + ')');
          rebuilt += text;
        })
        .onUnhandled((depth, text) => {
          logProgress('???:', text + '(' + depth + ')');
          rebuilt += text;
        });

      await new Promise<void>(resolve => {
        done = () => {
          stream.end();
          resolve();
        };

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
