import commander from 'commander';
import fg from 'fast-glob';
import fs from 'fs';
import iconv from 'iconv-lite';

import { DomNode } from './dom';
import { HtmlParser } from './html-parser';

const logErrorsFlag = true;
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
  })
  .parse(process.argv);

async function processFile(file: string): Promise<void> {
  let readEncoding = 'utf8';
  let tries = 0;
  let dom: DomNode;

  try {
    while (tries++ < 2 && !dom) {
      const content = fs.readFileSync(file, { encoding: readEncoding as BufferEncoding });
      const parser = new HtmlParser();

      dom = parser
        .on('encoding', (encoding, normalizedEncoding) => {
          if (readEncoding === normalizedEncoding)
            return false;

          logWarnings('*** Attempted encoding %s did not match declared encoding %s', readEncoding, normalizedEncoding);

          if (!iconv.encodingExists(normalizedEncoding)) {
            logErrors('*** Encoding %s is not supported', normalizedEncoding);
            tries = Number.MAX_SAFE_INTEGER;
          }

          readEncoding = normalizedEncoding;

          return true;
        })
        .on('error', (error, line, col) => {
          logErrors('*** %s: [%s, %s]', error, line, col);
        })
        .parse(content).domRoot;
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

function logWarnings(...args: any[]): void {
  if (logWarningFlag)
    console.warn(...args);
}
