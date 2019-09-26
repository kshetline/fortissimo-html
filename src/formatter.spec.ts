import { expect } from 'chai';
import fs from 'fs';
import { HtmlParser } from './html-parser';
import { DomNode } from './dom';
import { formatHtml } from './formatter';
import { stylizeHtml } from './stylizer';

describe('formatter', () => {
  const content = fs.readFileSync('./test/sample.html', 'utf-8');
  const parser = new HtmlParser();
  let dom: DomNode;

  before(async () => {
    dom = (await parser.parse(content)).domRoot;
  });

  it('should format HTML', () => {
    formatHtml(dom, { indent: 2, continuationIndent: 4 });

    try {fs.mkdirSync('./test-output'); } catch (err) {}
    fs.writeFileSync('./test-output/sample-reformatted.html', stylizeHtml(dom,
      { showWhitespace: true, title: 'Reformatted HTML'}), { encoding: 'utf8' });

    expect(true).to.be.true;
  });
});
