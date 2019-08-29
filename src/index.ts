import commander from 'commander';
import fg from 'fast-glob';
import fs from 'fs';
import { HtmlParser } from './html-parser';

commander
  .option('-x, --exclude <exclude>', 'pattern for files/directories to exclude')
  .arguments('<globs...>')
  .action((globs: string[]) => {
    const options = {
      ignore: commander.exclude ? [commander.exclude] : undefined,
    };
    const files = fg.sync(globs, options);

    files.forEach(file => processFile(file));
  })
  .parse(process.argv);

function processFile(file: string) {
  console.log(file);

  try {
    const content = fs.readFileSync(file, {encoding: 'utf8'});
    const parser = new HtmlParser(content);
    let rebuilt = '';

    parser
      .onAttribute((leading, name, equals, value, quote) => {
        console.log('attribute:', name + equals.trim() + quote + value + quote);
        rebuilt += leading + name + equals + quote + value + quote;
      })
      .onCloseTag((leading, tag, trailing) => {
        console.log('close:', '</' + tag + trailing + '>');
        rebuilt += leading + '</' + tag + trailing + '>';
      })
      .onComment((leading, comment) => {
        console.log('comment:', comment);
        rebuilt += leading + '<!--' + comment + '-->';
      })
      .onDeclaration((leading, declaration) => {
        console.log('declaration:', '<!' + declaration + '>');
        rebuilt += leading + '<!' + declaration + '>';
      })
      .onEnd(trailing => {
        console.log('*** Ta da! ***');
        rebuilt += trailing;
      })
      .onError((error, line, col, source) => {
        console.error('*** %s ***\n***%s: [%s, %s]', source, error, line, col);
        rebuilt += source;
      })
      .onOpenTagEnd((leading, tag, end) => {
        console.log('tag end:', end);
        rebuilt += leading + end;
      })
      .onOpenTagStart((leading, tag) => {
        console.log('tag:', tag);
        rebuilt += leading + '<' + tag;
      })
      .onProcessing((leading, processing) => {
        console.log('processing:', '<?' + processing + '>');
        rebuilt += leading + '<?' + processing + '>';
      })
      .onText((leading, text, trailing) => {
        console.log('text:', leading + text + trailing);
        rebuilt += leading + text + trailing;
      })
      .onUnhandled((leading, text, trailing = '') => {
        console.log('???:', leading + text + trailing);
        rebuilt += leading + text + trailing;
      })
      .parse();

      console.log('*** output matches input: ' + (rebuilt === content));
  }
  catch (err) {
    console.error('Error reading file "%s": %s', file, err.toString());
  }
}
