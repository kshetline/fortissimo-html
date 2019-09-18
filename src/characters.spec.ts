import { EntityStyle, escapeToEntities, isAllPCENChar, isInvalidCharacter, isOtherWhitespace, isPCENChar, ReencodeOptions, TargetEncoding, unescapeEntities } from './characters';
import { expect } from 'chai';

describe('characters', () => {
  let testStr = 'foo & bar < </ <a > &0';

  for (let i = 0x0A; i < 0x110; ++i)
    testStr += String.fromCharCode(i);

  it('should properly encode entities', () => {
    let encoded: string;

    encoded = escapeToEntities(testStr, { reencode: ReencodeOptions.LOOSE_MINIMAL });
    expect(encoded).contains('<=>');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, { reencode: ReencodeOptions.MINIMAL });
    expect(encoded).contains('&lt;=&gt;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, { reencode: ReencodeOptions.NAMED_ENTITIES, entityStyle: EntityStyle.SHORTEST,
      target: TargetEncoding.EIGHT_BIT });
    expect(encoded).contains('&#271;');
    expect(testStr).equals(unescapeEntities(encoded));

    encoded = escapeToEntities(testStr, { reencode: ReencodeOptions.NAMED_ENTITIES, entityStyle:
      EntityStyle.NAMED_OR_SHORTEST, target: TargetEncoding.SEVEN_BIT });
    expect(encoded).contains('&dcaron;');
    expect(testStr).equals(unescapeEntities(encoded));
  });

  it('should encode entities for 7- and 8-bit targets', () => {
    let encoded: string;

    encoded = escapeToEntities(testStr, {target: TargetEncoding.SEVEN_BIT});
    expect(encoded).contains('&nbsp;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, {target: TargetEncoding.SEVEN_BIT,
      entityStyle: EntityStyle.DECIMAL});
    expect(encoded).contains('&#160;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, { target: TargetEncoding.SEVEN_BIT });
    expect(encoded).contains('&nbsp;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, { target: TargetEncoding.EIGHT_BIT, entityStyle: EntityStyle.DECIMAL });
    expect(encoded).contains('\xA0');
    expect(encoded).contains('&#271;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, { target: TargetEncoding.EIGHT_BIT, entityStyle: EntityStyle.HEX });
    expect(encoded).contains('&#x10F;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, { target: TargetEncoding.EIGHT_BIT, entityStyle: EntityStyle.NAMED_OR_DECIMAL });
    expect(encoded).contains('&dcaron;');
    expect(unescapeEntities(encoded)).equals(testStr);
  });

  it('should encode entities for non-BMP Unicode and for special combining character pairs', () => {
    const encoded = escapeToEntities('\uD835\uDD22, \u22DB\uFE00',
      { target: TargetEncoding.EIGHT_BIT, entityStyle: EntityStyle.NAMED_OR_DECIMAL });
    expect(encoded).contains('&efr;');
    expect(encoded).contains('&gesl;');
  });

  it('should recognize non-HTML whitespace', () => {
    expect(isOtherWhitespace('\xA0')).to.be.true;
    expect(isOtherWhitespace('\u2003')).to.be.true;
    expect(isOtherWhitespace('q')).to.be.false;
  });

  it('should recognize invalid HTML characters', () => {
    expect(isInvalidCharacter('\x00')).to.be.true;
    expect(isInvalidCharacter('\x7F')).to.be.true;
    expect(isInvalidCharacter('q')).to.be.false;
  });

  it('should recognize valid tag name (PCEN) characters', () => {
    'abc_.-Дウ月'.split('').forEach(ch => expect(isPCENChar(ch)).to.be.true);
    expect(isAllPCENChar('abc_.-Дウ月🌎')).to.be.true;
    '<&;;\u2001\n\x1B\uDB80\uDC00'.split('').forEach(ch => expect(isPCENChar(ch)).to.be.false);
    expect(isAllPCENChar('abc_.-Дウ月🌎<')).to.be.false;
  });
});
