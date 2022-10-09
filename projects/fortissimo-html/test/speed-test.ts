import benchmark from 'htmlparser-benchmark';
import { HtmlParser } from '../src';
import * as FastHtmlParser from 'fast-html-parser';

let speedFortFast: number;
let speedFortStd: number;
let speedFortAsync: number;
let speedFast: number;

function first(done: () => void): void {
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

function second(done: () => void): void {
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

  bench.on('result', (stat: any): void => {
    speedFortStd = stat.mean();
    console.log('fortissimo, std mode: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

function third(done: () => void): void {
  const bench = benchmark((html: string, callback: any) => {
    const parser = new HtmlParser();

    return parser
      .on('completion', () => callback())
      .on('error', err => {
        if (!/^(unmatched closing tag|syntax error)/i.test(err))
          callback(err);
      })
      .parseAsync(html);
  });

  bench.on('result', (stat: any) => {
    speedFortAsync = stat.mean();
    console.log('fortissimo, async: ' + stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
    done();
  });
}

function fast(done: () => void): void {
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

function prec3(n: number): string {
  let s = n.toPrecision(3);

  if (s.includes('e+'))
    s = parseFloat(s).toFixed(0);

  return s;
}

first(() => second(() => third(() => fast(() => {
  console.log('\nfortissimo fast is  %s% of the speed of fast-html', prec3(speedFortFast / speedFast * 100));
  console.log('fortissimo std is   %s% of the speed of fast-html', prec3(speedFortStd / speedFast * 100));
  console.log('fortissimo async is %s% of the speed of fast-html', prec3(speedFortAsync / speedFast * 100));
  console.log('fortissimo std is   %s% of the speed of fortissimo fast', prec3(speedFortStd / speedFortFast * 100));
  console.log('fortissimo async is %s% of the speed of fortissimo fast', prec3(speedFortAsync / speedFortFast * 100));
}))));
