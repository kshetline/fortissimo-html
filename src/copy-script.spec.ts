import { expect } from 'chai';
import { addListener, copyScriptAsIIFE } from './copy-script';

let clipboardText: string;
let throwCopyError = false;

// noinspection JSUnusedGlobalSymbols
const fakeCopyEvent = {
  preventDefault: function () {},
  clipboardData: {
    setData: function (type: string, text: string) {
      clipboardText = text;
    }
  }
};

let callback: (event: any) => void;

// noinspection JSUnusedGlobalSymbols
const fakeElement = {
  addEventListener: function(eventType: string, aCallback: (event: any) => void) {
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
  querySelector: function () {
    return docElement;
  },
  getSelection: function () {
    return {
      anchorNode: true,
      getRangeAt: function () {
        return {
          cloneContents: function () {
            if (throwCopyError)
              throw new Error('fake copy error');

            return {
              childNodes: [
                {
                  classList: new FakeClassList(['xxx-whitespace']),
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
                  classList: new FakeClassList(['xxx-invalid']),
                  innerText: '���'
                },
              ]
            };
          }
        };
      },
      toString: function () { return '·\t•↵foobar���'; }
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
    addListener();
    expect(callback).to.not.be.ok;
    docElement = fakeElement;
    addListener();
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
