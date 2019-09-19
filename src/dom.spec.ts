import { expect } from 'chai';
import fs from 'fs';
import { HtmlParser } from './html-parser';

describe('dom', () => {
  it('should produce searchable DOM tree', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    const results = (await parser.parse(content)).domRoot;
    const svg = results.querySelector('svg');
    const th = results.querySelectorAll('th')[1];

    expect(svg.tagLc).equals('svg');
    expect(svg.valuesLookup.width).equals('300');

    expect(th.depth).equals(6);
    expect(th.syntheticDepth).equals(7);

    expect(results.querySelector('#list').tagLc).equals('ul');
    expect(results.querySelectorAll('li').length).equals(6);
    expect(results.querySelector('.content').tagLc).equals('div');
    expect(results.querySelector('div.sizer').textContent).equals('\xA0');
    expect(results.querySelector('annotation').textContent).equals('Second CDATA example &amp; entities ignored');
    expect(results.querySelector('ul').textContent.trim().replace(/\s+/g, ' '))
      .equals('One thing after another after another ·↵·');
    expect(results.querySelector('script').textContent).contains('function foo(value)');
  });
});
