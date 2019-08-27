#!/usr/local/bin/node

import commander from 'commander';
import glob from 'glob';
import fs from 'fs';
import { HtmlParser } from './html-parser';

commander
  .option('-x, --exclude <exclude>', 'pattern for files/directories to exclude')
  .arguments('<globs...>')
  .action((globs: string[]) => {
    const options = {
      ignore: commander.exclude,
    };

    globs.forEach(aGlob => {
      glob(aGlob, options, (err, files) => {
        if (err)
          console.error(err);
        else if (!files || files.length === 0)
          console.error('No match for "' + aGlob + '".');
        else
          files.forEach(file => processFile(file));
      });
    });
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
      .onEnd(() => console.log('*** Ta da! ***'))
      .onError((error, line, col) => console.error('*** %s: [%s, %s]', error, line, col))
      .onOpenTagEnd((leading, tag, end) => console.log('tag end:', end))
      .onOpenTagStart((leading, tag) => console.log('tag:', tag))
      .onText((leading, text) => console.log('text:', leading + text))
      .onUnhandled((leading, text, trailing) => console.log('???:', leading + text + (trailing ? trailing : '')))
      .parse();
  }
  catch (err) {
    console.error('Error reading file "%s": %s', file, err.toString());
  }
}
