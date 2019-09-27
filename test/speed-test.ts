import benchmark from 'htmlparser-benchmark';
import { HtmlParser } from '../src/html-parser';

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
  console.log(stat.mean().toPrecision(6) + ' ms/file ± ' + stat.sd().toPrecision(6));
});
