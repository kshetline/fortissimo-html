import commander from 'commander';
import fg from 'fast-glob';
import fs from 'fs';

import { DomElement } from './dom';
import { HtmlParser } from './html-parser';
import { processMillis } from './util';

const keepAlive = setInterval(() => {}, 100);

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
  console.log(file);

  try {
    const content = fs.readFileSync(file, {encoding: 'utf8'});
    const startTime = processMillis();
    const parser = new HtmlParser();
    let rebuilt = '';

    await parser
      .onAttribute((leading, name, equals, value, quote) => {
        console.log('attribute:', name + equals.trim() + quote + value + quote);
        rebuilt += leading + name + equals + quote + value + quote;
      })
      .onCData((depth, leading, cdata) => {
        console.log('CDATA:', '<![CDATA[' + cdata + ']]>' + ' (' + depth + ')');
        rebuilt += leading + '<![CDATA[' + cdata + ']]>';
      })
      .onCloseTag((depth, leading, tag, trailing) => {
        console.log('close:', '</' + tag + trailing + '>' + ' (' + depth + ')');
        rebuilt += leading + '</' + tag + trailing + '>';
      })
      .onComment((depth, leading, comment) => {
        console.log('comment:', comment + ' (' + depth + ')');
        rebuilt += leading + '<!--' + comment + '-->';
      })
      .onDeclaration((depth, leading, declaration) => {
        console.log('declaration:', '<!' + declaration + '>' + ' (' + depth + ')');
        rebuilt += leading + '<!' + declaration + '>';
      })
      .onEnd((trailing, domRoot, unclosed) => {
        rebuilt += trailing;

        const totalTime = processMillis() - startTime;
        const size = content.length / 1048576;
        const speed = (size / totalTime * 1000);

        console.log('*** Finished in %s msec (%s MB/sec)', totalTime.toFixed(1), speed.toFixed(2));
        console.log('*** output matches input: ' + (rebuilt === content));

        if (rebuilt !== content)
          console.log(rebuilt);

        console.log('*** unclosed tags: ' + unclosed);
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
          console.error('*** %s ***', source);

        console.error('*** %s: [%s, %s]', error, line, col);
        rebuilt += source || '';
      })
      .onOpenTagEnd((depth, leading, tag, end) => {
        console.log('tag end:', end + ' (' + depth + ')');
        rebuilt += leading + end;
      })
      .onOpenTagStart((depth, leading, tag) => {
        console.log('tag:', tag + ' (' + depth + ')');
        rebuilt += leading + '<' + tag;
      })
      .onProcessing((depth, leading, processing) => {
        console.log('processing:', '<?' + processing + '>' + ' (' + depth + ')');
        rebuilt += leading + '<?' + processing + '>';
      })
      .onText((depth, leading, text, trailing) => {
        console.log('text:', leading + text + trailing + ' (' + depth + ')');
        rebuilt += leading + text + trailing;
      })
      .onUnhandled((depth, leading, text, trailing = '') => {
        console.log('???:', leading + text + trailing + ' (' + depth + ')');
        rebuilt += leading + text + trailing;
      })
      .parse(content);
  }
  catch (err) {
    console.error('Error reading file "%s": %s', file, err.toString());
  }
}
