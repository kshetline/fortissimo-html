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
      const contentBuffer = fs.readFileSync(file);
      const content = iconv.decode(contentBuffer, readEncoding, { stripBOM: true });
      const startTime = processMillis();
      const parser = new HtmlParser();
      let rebuilt = '';

      dom = await parser
        .onAttribute((leading, name, equals, value, quote) => {
          logProgress('attribute:', name + equals.trim() + quote + value + quote);
          rebuilt += leading + name + equals + quote + value + quote;
        })
        .onCData((depth, leading, cdata) => {
          logProgress('CDATA:', '<![CDATA[' + cdata + ']]>' + ' (' + depth + ')');
          rebuilt += leading + '<![CDATA[' + cdata + ']]>';
        })
        .onEndTag((depth, leading, tag, trailing) => {
          logProgress('end:', '</' + tag + trailing + '>' + ' (' + depth + ')');
          rebuilt += leading + '</' + tag + trailing + '>';
        })
        .onComment((depth, leading, comment) => {
          logProgress('comment:', comment + ' (' + depth + ')');
          rebuilt += leading + '<!--' + comment + '-->';
        })
        .onDeclaration((depth, leading, declaration) => {
          logProgress('declaration:', '<!' + declaration + '>' + ' (' + depth + ')');
          rebuilt += leading + '<!' + declaration + '>';
        })
        .onDocType((leading, docType) => {
          if (logStatsFlag)
            console.log('DOCTYPE: %s%s%s', docType.type.toUpperCase(), docType.variety ? ' ' + docType.variety : '',
              docType.version ? ' ' + docType.version : '');

          rebuilt += leading + '<!' + docType.content + '>';
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
          return true;
        })
        .onEnd((trailing, domRoot, unclosed) => {
          rebuilt += trailing;

          const totalTime = processMillis() - startTime;
          let size = content.length / 1048576;
          const speed = (size / totalTime * 1000);

          if (logStatsFlag) {
            let unit = 'MB';

            if (size < 1) {
              unit = 'KB';
              size = content.length / 1024;
            }

            console.log('*** Finished %s%s in %s msec (%s MB/sec)', size.toFixed(2), unit, totalTime.toFixed(1), speed.toFixed(2));
            console.log('*** output matches input: ' + (rebuilt === content));
            console.log('*** unclosed tags: ' + unclosed);
          }

          if (rebuilt !== content && rebuilt !== content.replace(/\r\n|\n/g, '\n'))
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
        })
        .onError((error, line, col, source) => {
          if (source)
            logErrors('*** %s ***', source);

          logErrors('*** %s: [%s, %s]', error, line, col);
          rebuilt += source || '';
        })
        .onProcessing((depth, leading, processing) => {
          logProgress('processing:', '<?' + processing + '>' + ' (' + depth + ')');
          rebuilt += leading + '<?' + processing + '>';
        })
        .onStartTagEnd((depth, leading, tag, end) => {
          logProgress('tag end:', end + ' (' + depth + ')');
          rebuilt += leading + end;
        })
        .onStartTagStart((depth, leading, tag) => {
          logProgress('tag:', tag + ' (' + depth + ')');
          rebuilt += leading + '<' + tag;
        })
        .onText((depth, leading, text, trailing) => {
          logProgress('text:', leading + text + trailing + ' (' + depth + ')');
          rebuilt += leading + text + trailing;
        })
        .onUnhandled((depth, leading, text, trailing = '') => {
          logProgress('???:', leading + text + trailing + ' (' + depth + ')');
          rebuilt += leading + text + trailing;
        })
        .parse(content);
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
