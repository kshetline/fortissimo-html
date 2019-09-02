export const FORMATTING_ELEMENTS = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small',
                                            'strike', 'strong', 'tt', 'u]']);

export const MARKER_ELEMENTS = new Set(['applet', 'object', 'marquee', 'template', 'td', 'th', 'caption']);

export const VOID_ELEMENTS = new Set(['area', 'base', 'br',  'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
                               'source', 'track', 'wbr', 'command', 'keygen', 'menuitem']);

// FORM_TAGS, P_TAG, and OPEN_IMPLIES_CLOSE were taken from (then modified slightly):
// https://github.com/fb55/htmlparser2/blob/master/src/Parser.ts

export const FORM_TAGS = new Set([
    'input',
    'option',
    'optgroup',
    'select',
    'button',
    'datalist',
    'textarea'
]);

const P_TAG = new Set(['p']);

export const OPEN_IMPLIES_CLOSE: Record<string, Set<string>> = {
    tr: new Set(['tr', 'th', 'td', 'caption']),
    th: new Set(['th', 'caption']),
    td: new Set(['thead', 'th', 'td', 'caption']),
    body: new Set(['head', 'link', 'script']),
    li: new Set(['li']),
    p: P_TAG,
    h1: P_TAG,
    h2: P_TAG,
    h3: P_TAG,
    h4: P_TAG,
    h5: P_TAG,
    h6: P_TAG,
    select: FORM_TAGS,
    input: FORM_TAGS,
    output: FORM_TAGS,
    button: FORM_TAGS,
    datalist: FORM_TAGS,
    textarea: FORM_TAGS,
    option: new Set(['option']),
    optgroup: new Set(['optgroup', 'option']),
    dd: new Set(['dt', 'dd']),
    dt: new Set(['dt', 'dd']),
    address: P_TAG,
    article: P_TAG,
    aside: P_TAG,
    blockquote: P_TAG,
    details: P_TAG,
    div: P_TAG,
    dl: P_TAG,
    fieldset: P_TAG,
    figcaption: P_TAG,
    figure: P_TAG,
    footer: P_TAG,
    form: P_TAG,
    header: P_TAG,
    hr: P_TAG,
    main: P_TAG,
    nav: P_TAG,
    ol: P_TAG,
    pre: P_TAG,
    section: P_TAG,
    table: P_TAG,
    ul: P_TAG,
    rt: new Set(['rt', 'rp']),
    rp: new Set(['rt', 'rp']),
    tbody: new Set(['thead', 'tbody', 'caption', 'tr', 'td', 'th']),
    tfoot: new Set(['thead', 'tbody', 'caption', 'tr', 'td', 'th'])
};
