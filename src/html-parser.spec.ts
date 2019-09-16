import { expect } from 'chai';
import fs from 'fs';
import { HtmlParser } from './html-parser';

describe('html-parser', () => {
  it('should properly parse HTML', async () => {
    const content = fs.readFileSync('./test/sample.html', 'utf-8');
    const parser = new HtmlParser();
    const dom = await parser.parse(content);
    const reconstituted = dom.domRoot.toString();

    expect(content).equals(reconstituted);
  });

  it('should properly parse XHTML', async () => {
    const content = fs.readFileSync('./test/sample-w3c.html', 'utf-8');
    const parser = new HtmlParser();
    const dom = await parser.parse(content);
    const reconstituted = dom.domRoot.toString();

    expect(content).equals(reconstituted);
  });
});
