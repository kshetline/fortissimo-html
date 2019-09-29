import benchmark from 'htmlparser-benchmark';
import { HtmlParser } from '../src/html-parser';
import * as HTMLParser from 'fast-html-parser';

function first(done: () => void) {
  const bench = benchmark((html: string, callback: any) => {
    const parser = new HtmlParser();

    parser
      .on('completion', () => callback())
      .on('error', err => {
        if (!/^(unmatched closing tag|syntax error)/i.test(err))
          callback(err);
      })
      .parse(html);
  });

  bench.on('progress', (key: string) => {
    // console.log('finished parsing ' + key + '.html');
  });

  bench.on('result', (stat: any) => {
    console.log('fff-html: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

function second() {
  const bench = benchmark((html: string, callback: any) => {
    const root = HTMLParser.parse(html);
    callback();
  });

  bench.on('progress', (key: string) => {
    // console.log('finished parsing ' + key + '.html');
  });

  bench.on('result', (stat: any) => {
    console.log('fast-html: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
  });
}

first(second);
