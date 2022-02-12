import { expect } from 'chai';
import { addCopyListener, copyScriptAsIIFE } from './copy-script';

let clipboardText: string;
let throwCopyError = false;

// noinspection JSUnusedGlobalSymbols
const fakeCopyEvent = {
  preventDefault: function (): void {},
  clipboardData: {
    setData: function (type: string, text: string): void {
      clipboardText = text;
    }
  }
};

let callback: (event: any) => void;

// noinspection JSUnusedGlobalSymbols
const fakeElement = {
  addEventListener: function (eventType: string, aCallback: (event: any) => void): void {
    callback = aCallback;
  }
};

let docElement: any;

class FakeClassList {
  constructor(public data: string[]) {}

  contains(className: string): boolean {
    return this.data.indexOf(className) >= 0;
  }
}

// noinspection JSUnusedGlobalSymbols
const fakeDocument = {
  querySelector: function (): HTMLElement {
    return docElement;
  },
  getSelection: function (): any {
    return {
      anchorNode: true,
      getRangeAt: function (): any {
        return {
          cloneContents: function (): any {
            if (throwCopyError)
              throw new Error('fake copy error');

            return {
              childNodes: [
                {
                  classList: new FakeClassList(['fh-whitespace']),
                  innerText: '·\t•↵'
                },
                {
                  classList: new FakeClassList([]),
                  localName: 'span',
                  innerText: 'foo'
                },
                {
                  classList: new FakeClassList([]),
                  nodeValue: 'bar'
                },
                {
                  classList: new FakeClassList(['fh-invalid']),
                  innerText: '���'
                },
              ]
            };
          }
        };
      },
      toString: function (): string { return '·\t•↵foobar���'; }
    };
  }
};

describe('copy-script', () => {
  it('should handle copy event', () => {
    expect(copyScriptAsIIFE).to.contain('restoreWhitespaceStrict');

    let saveDocument: any;

    if (global && (global as any).document)
      saveDocument = (global as any).document;

    (global as any).document = fakeDocument;
    addCopyListener();
    expect(callback).to.not.be.ok;
    docElement = fakeElement;
    addCopyListener();
    expect(callback).to.be.ok;
    throwCopyError = true;
    callback(fakeCopyEvent);
    expect(clipboardText).equals(' \t\xA0foobar');
    throwCopyError = false;
    callback(fakeCopyEvent);
    expect(clipboardText).equals(' \t\xA0foobar');

    if (saveDocument)
      (global as any).document = saveDocument;
  });
});
