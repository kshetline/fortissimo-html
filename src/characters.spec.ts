import { EntityStyle, escapeToEntities, ReencodeOptions, TargetEncoding, unescapeEntities } from './characters';
import { expect } from 'chai';

describe('characters', () => {
  let testStr = 'foo & bar < </ <a > &0';

  for (let i = 0x0A; i < 0x110; ++i)
    testStr += String.fromCharCode(i);

  it ('should properly encode entities', () => {
    let encoded;

    encoded = escapeToEntities(testStr, {reencode: ReencodeOptions.LOOSE_MINIMAL});
    expect(encoded).contains('<=>');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, {reencode: ReencodeOptions.MINIMAL});
    expect(encoded).contains('&lt;=&gt;');
    expect(unescapeEntities(encoded)).equals(testStr);

    encoded = escapeToEntities(testStr, {reencode: ReencodeOptions.NAMED_ENTITIES, entityStyle: EntityStyle.SHORTEST, target: TargetEncoding.EIGHT_BIT});
    expect(encoded).contains('&#271;');
    expect(testStr).equals(unescapeEntities(encoded));

    encoded = escapeToEntities(testStr, {reencode: ReencodeOptions.NAMED_ENTITIES, entityStyle: EntityStyle.NAMED_OR_SHORTEST, target: TargetEncoding.SEVEN_BIT});
    expect(encoded).contains('&dcaron;');
    expect(testStr).equals(unescapeEntities(encoded));
  });
});
