import benchmark from 'htmlparser-benchmark';
import { HtmlParser } from '../src/html-parser';
import * as FastHtmlParser from 'fast-html-parser';

let speedFFF: number;
let speedFast: number;

function first(done: () => void) {
  const bench = benchmark((html: string, callback: any) => {
    const parser = new HtmlParser({ fast: true });

    parser
      .on('completion', () => callback())
      .on('error', err => {
        if (!/^(unmatched closing tag|syntax error)/i.test(err))
          callback(err);
      })
      .parse(html);
  });

  bench.on('result', (stat: any) => {
    speedFFF = stat.mean();
    console.log('fff-html: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

function second(done: () => void) {
  const bench = benchmark((html: string, callback: any) => {
    FastHtmlParser.parse(html);
    callback();
  });

  bench.on('result', (stat: any) => {
    speedFast = stat.mean();
    console.log('fast-html: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

first(() => second(() => console.log('fff-html is %s% of the speed of fast-html',
  (speedFFF / speedFast * 100).toPrecision(3))));
