import benchmark from 'htmlparser-benchmark';
import { HtmlParser } from '../src/html-parser';
import * as FastHtmlParser from 'fast-html-parser';

let speedFortFast: number;
let speedFortStd: number;
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
    speedFortFast = stat.mean();
    console.log('fortissimo, fast mode: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

function second(done: () => void) {
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

  bench.on('result', (stat: any) => {
    speedFortStd = stat.mean();
    console.log('fortissimo, std mode: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

function third(done: () => void) {
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

first(() => second(() => third(() => {
  console.log('\nfortissimo fast is %s% of the speed of fast-html', (speedFortFast / speedFast * 100).toPrecision(3));
  console.log('fortissimo std is %s% of the speed of fast-html', (speedFortStd / speedFast * 100).toPrecision(3));
  console.log('fortissimo std is %s% of the speed of fortissimo fast', (speedFortStd / speedFortFast * 100).toPrecision(3));
})));
