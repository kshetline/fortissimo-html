export const FORMATTING_ELEMENTS = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small',
                                            'strike', 'strong', 'tt', 'u]']);

export const MARKER_ELEMENTS = new Set(['applet', 'object', 'marquee', 'template', 'td', 'th', 'caption']);

export const VOID_ELEMENTS = new Set(['area', 'base', 'br',  'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
                                      'source', 'track', 'wbr', 'command', 'keygen', 'menuitem']);

export const SCOPE_ELEMENTS = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object',
                                       'template', 'mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml', 'foreignobject',
                                       'desc', 'title']);

export const SPECIAL_ELEMENTS = new Set(['address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound',
                                         'blockquote', 'body', 'br', 'button', 'caption', 'center', 'col', 'colgroup',
                                         'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset', 'figcaption',
                                         'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5',
                                         'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input',
                                         'keygen', 'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav',
                                         'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext',
                                         'pre', 'script', 'section', 'select', 'source', 'style', 'summary', 'table',
                                         'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr',
                                         'track', 'ul', 'wbr', 'xmp', 'mi', 'mo', 'mn', 'ms', 'mtext',
                                         'annotation-xml', 'foreignobject', 'desc', 'title']);

export const FOSTER_PARENT_SPECIAL_TARGETS = new Set(['table', 'tbody', 'tfoot', 'thead', 'tr']);

// FORM_TAGS, P_TAG, and OPEN_IMPLIES_CLOSE were taken from:
// https://github.com/fb55/htmlparser2/blob/master/src/Parser.ts (then modified slightly)

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
