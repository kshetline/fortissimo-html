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

    parser
      .onAttribute((leading, name, equals, value, quote) => console.log('attribute:', name + equals.trim() + quote + value + quote))
      .onCloseTag((leading, tag, trailing) => console.log('close:', '</' + tag + trailing + '>'))
      .onComment((leading, comment) => console.log('comment:', comment))
      .onDeclaration((leading, declaration) => console.log('declaration:', '<!' + declaration + '>'))
      .onEnd(() => console.log('*** Ta da! ***'))
      .onError((error, line, col) => console.error('*** %s: [%s, %s]', error, line, col))
      .onOpenTagEnd((leading, tag, end) => console.log('tag end:', end))
      .onOpenTagStart((leading, tag) => console.log('tag:', tag))
      .onProcessing((leading, processing) => console.log('processing:', '<?' + processing + '>'))
      .onText((leading, text) => console.log('text:', leading + text))
      .onUnhandled((leading, text, trailing = '') => console.log('???:', leading + text + trailing))
      .parse();
  }
  catch (err) {
    console.error('Error reading file "%s": %s', file, err.toString());
  }
}
