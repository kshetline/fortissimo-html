import { expect } from 'chai';
import fs from 'fs';
import { HtmlParser } from './html-parser';
import { stylizeHtml } from './stylizer';
import { DomNode, TextElement } from './dom';
import { unescapeEntities } from './characters';

describe('stylizer', () => {
  it('should stylize HTML and produce matching text content', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    const dom = (await parser.parse(content)).domRoot;
    const stylized = stylizeHtml(dom);

    parser.reset();

    const dom2 = (await parser.parse(stylized)).domRoot;
    const html = dom2.children.find(elem => elem instanceof DomNode && elem.tagLc === 'html') as DomNode;
    const body = html.children.find(elem => elem instanceof DomNode && elem.tagLc === 'body') as DomNode;
    const sb: string[] = [];

    body.children.forEach(elem => {
      if (elem instanceof DomNode && elem.tagLc === 'span')
        sb.push(unescapeEntities((elem.children[0] as TextElement).content));
      else if (elem instanceof TextElement)
        sb.push(unescapeEntities(elem.content));
    });

    const reconstituted = sb.join('').replace(/�/g, (match, index) => content.charAt(index));

    expect(content).equals(reconstituted);

    try { fs.mkdirSync('./test-output'); } catch (err) {}
    fs.writeFileSync('./test-output/sample.html', stylizeHtml(dom), { encoding: 'utf8' });

    fs.writeFileSync('./test-output/sample-ws.html', stylizeHtml(dom,
      { showWhitespace: true }), { encoding: 'utf8' });
  });
});
