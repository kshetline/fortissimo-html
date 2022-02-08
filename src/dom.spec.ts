import { expect } from 'chai';
import fs from 'fs';
import { HtmlParser } from './html-parser';
import { SMALL_SAMPLE } from './html-parser.spec';
import { CData, DomNode } from './dom';

describe('dom', () => {
  const content = fs.readFileSync('./test/sample.html', 'utf-8');
  const parser = new HtmlParser();
  let results: DomNode;

  before(async () => {
    results = (await parser.parse(content)).domRoot;
  });

  it('should produce searchable DOM tree', () => {
    const svg = results.querySelector('svg');
    const th = results.querySelectorAll('th')[1];

    expect(svg.tagLc).equals('svg');
    expect(svg.valuesLookup.width).equals('300');

    expect(th.depth).equals(3);
    expect(th.syntheticDepth).equals(5);

    expect(results.querySelector('#list').tagLc).equals('ul');
    expect(results.querySelectorAll('li').length).equals(6);
    expect(results.querySelector('.content').tagLc).equals('div');
  });

  it('should be able to retrieve textContent and innerHTML', () => {
    expect(results.querySelector('div.sizer').textContent).equals('\xA0');
    expect(results.querySelector('annotation').textContent).equals('Second CDATA example &amp; entities ignored');
    expect(results.querySelector('ul').textContent.trim().replace(/\s+/g, ' '))
      .equals('One thing afteranother after another ·↵·');
    expect(results.querySelector('script').textContent).contains('function foo(value)');

    expect(results.querySelector('#inner-test').innerHTML).equals('innerHTML <em>test</em>');
    expect(results.querySelector('table').innerHTML.replace(/\s+/g, ' '))
      .equals(' <caption>A Table <th>foo <tbody> <tr><td> 4 </td><td>5 <tr><td>6<td>7 ');
  });

  it('should convert DOM to JSON useful for debugging', async () => {
    const body = results.querySelector('body');
    const table = results.querySelector('table');
    const json = JSON.stringify(results);
    let $;

    $ = /"body".*?"line":(\d+).*?"column":(\d+).*?"depth":(\d+)/.exec(json);
    expect($ && parseInt($[1], 10)).equals(body.line);
    expect($ && parseInt($[2], 10)).equals(body.column);
    expect($ && parseInt($[3], 10)).equals(body.depth);

    $ = /"table".*?"line":(\d+).*?"column":(\d+).*?"depth":(\d+)/.exec(json);
    expect($ && parseInt($[1], 10)).equals(table.line);
    expect($ && parseInt($[2], 10)).equals(table.column);
    expect($ && parseInt($[3], 10)).equals(table.depth);

    parser.reset();
    expect(JSON.stringify((await parser.parse(SMALL_SAMPLE + '<p')).domRoot)).contains('badTerminator');

    parser.reset();
    expect(JSON.stringify((await parser.parse(SMALL_SAMPLE + '<!--')).domRoot)).contains(')!');

    expect(JSON.stringify(new CData('yeti', 0, 0, false))).does.not.contain('line').and.does.not.contain(']]>');
  });

  it('should properly manipulate element attributes', async () => {
    const node = DomNode.createNode('a');

    expect(node.toString(true)).equals('<a></a>')
    node.addAttribute('href', '#foo');
    expect(node.toString(true)).equals('<a href="#foo"></a>')
    node.addAttribute('disabled');
    expect(node.toString(true)).equals('<a href="#foo" disabled></a>')
    expect(node.attributeCount).equals(2)
    node.setAttribute('href', '#bar');
    expect(node.toString(true)).equals('<a href="#bar" disabled></a>')
    node.deleteAttribute(1);
    expect(node.toString(true)).equals('<a href="#bar"></a>')
    node.clearAttributes()
    expect(node.toString(true)).equals('<a></a>')
   });
});
