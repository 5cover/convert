/* 
JSON Variants Testing

Applies to: JSON variant formats. JSON variant formats are formats that express data in the same valuespace as JSON, but with a different syntax or mode (text/binary). Those formats are therefore 1:1 compatible with JavaScript values.

Tests:

- Supports. Ensure supports record matches reality by testing with example values for each feature.
    Multiple example values; result must match, otherwise the feature is actually two features merged
- Format resolution. For each variant, expect the proper format to be retrived
- Common : JSON-compatible values, including empty keys, roundtrip for all formats

1. Formats defined by functions. A codec:
    encode(unknown) => Uint8Array
    decode(Uint8Array) => unknown

    encode and decode are pure.
    encode's input may be any JS value. encode may throw Error for values it doesn't support.
    decode's output must 

    Exemple : formats may represent runtime JS values, but may not hydrate them  during decoding. For instance: a format may encode Function into a representation that pulls in globals and captures, but it may not hydrate that serialization into a Function object on decoding.

2. Invariants.
    roundtrip: 
        y := encode(x)
        y = encode(x) // encode purity
        z := decode(y)
        z = decode(y) // decode purity
        z = x // roundtrip
3. Common cases. For each format, cases for (positive or negative)
    - null, boolean, number (finite), string, arrays, plain objects, big and small
4. Specific cases
    High level format-specific cases that test features of the format independently of the library. Extract from format's specification/readme. 
    Specific abilities
    - undefined
    - property order
    - are cycles supported
    - Infinity/NaN
    - functions
    - symbols
    - Special constructs (Date, Map, Set)

*/

import { expect, describe, it } from 'bun:test';
import {
    Compat,
    Feature,
    getJsonVariant,
    JSON_VARIANTS,
    JsonVariantDefinition,
    variantToFormat,
} from '../../src/handlers/jsonVariants.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Variant = keyof typeof JSON_VARIANTS;

type Content = string | Uint8Array;
// JSON.parse(JSON.stringify(x)) deeply equal to x
// Meaning: No NaN, no infinity, no cycles

type HasValue = { readonly value: unknown };
type HasContent = { readonly content: Content };

/** Test cases for particular syntax features of formats */
type FeatureTests = {
    /** decode(encode(content)) = value */
    positive: Record<string, HasContent & HasValue>;
    /** encode(content) throws */
    negative: Record<string, HasContent>;
    /** transform the expected value of roundtrip tests */
    transform?: (value: unknown) => unknown;
};

// Expected values that must roundtrip through JSON-compatible formats.
const common: Record<string, unknown> = {
    null: null,
    true: true,
    false: false,
    'empty array': [],
    'empty object': {},
    'empty string': '',
    string: 'hello',
    object: { test: 1 },
    'singleton array': [1],
    array: ['a', 'b', 'c'],
    '0': 0,
    integer: 234,
    number: 14.345,
    'empty key': { a: 'hello', '': 114 },
    'number boundaries': [
        Number.EPSILON,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_VALUE,
        Number.MIN_SAFE_INTEGER,
        Number.MIN_VALUE,
    ],
    constants: [Math.PI, Math.LN10, Math.E],
    'number props': { 1: '1', 1.1: '1.1' },
    'object 2': {
        unquoted: 'value',
        trailing: [1, 2],
    },
    'object 3': {
        enabled: {
            a: 1,
            b: {
                a: 1,
                b: [1, 2],
            },
        },
        nested: { value: 3 },
    },
    'null props': { a: null, b: [null], c: { a: null } },
    'nested emptiness': [{ '': [[{ '': [{}] }, {}]] }],
    //'lone surrogates': '\uD800', // https://github.com/tc39/proposal-well-formed-stringify
};
type FeatureTest<T> = {
    values: T[];
    equal?: (x: T, y: unknown) => boolean;
};
const featureTests = {
    Buffer: {
        values: [Buffer.from([1, 2, 3, 4]), Buffer.from([])],
        equal: (x, y) => y instanceof Buffer && x.equals(y),
    } satisfies FeatureTest<Buffer>,
    Date: {
        values: [new Date(2007, 12, 12, 13, 38, 47)],
        equal: (x, y) => y instanceof Date && x.valueOf() === y.valueOf(),
    } satisfies FeatureTest<Date>,
    Infinity: { values: [Infinity, -Infinity] },
    NaN: { values: [NaN], equal: Object.is },
    URL: {
        values: [new URL('https://example.com')],
        equal: (x, y) => y instanceof URL && x.toString() === y.toString(),
    } satisfies FeatureTest<URL>,
    bigint: { values: [0n, 999n, -0n, -746n] },
    function: { values: [() => {}, function () {}, (arg: unknown) => {}, parseInt] },
    minus0: { values: [-0], equal: Object.is },
    symbol: { values: [Symbol.toStringTag, Symbol.toPrimitive, Symbol.hasInstance, Symbol.for('testing')] },
    undefined: { values: [undefined] },
} satisfies Record<Feature, FeatureTest<any>>;

const testCases: Record<Variant, FeatureTests> = {
    json: { positive: {}, negative: {} },
    json5: {
        positive: {
            'kitchen sink': {
                content: `{
  // comments
  unquoted: 'and you can quote me on that',
  singleQuotes: 'I can use "double quotes" here',
  lineBreaks: "Look, Mom! \\
No \\\\n's!",
  hexadecimal: 0xdecaf,
  leadingDecimalPoint: .8675309, andTrailing: 8675309.,
  positiveSign: +1,
  trailingComma: 'in objects', andIn: ['arrays',],
  "backwardsCompatible": "with JSON",
}`,
                value: {
                    unquoted: 'and you can quote me on that',
                    singleQuotes: 'I can use "double quotes" here',
                    lineBreaks: "Look, Mom! No \\n's!",
                    hexadecimal: 912559,
                    leadingDecimalPoint: 0.8675309,
                    andTrailing: 8675309,
                    positiveSign: 1,
                    trailingComma: 'in objects',
                    andIn: ['arrays'],
                    backwardsCompatible: 'with JSON',
                },
            },
            'basic object 1': {
                content: `{
        // comment
        unquoted: 'value',
        trailing: [1, 2,],
        }`,
                value: {
                    unquoted: 'value',
                    trailing: [1, 2],
                },
            },
            'basic object 2': {
                content: '{"enabled":true,"nested":{"value":3}}',
                value: {
                    enabled: true,
                    nested: { value: 3 },
                },
            },
        },
        negative: {
            empty: { content: '' },
            invalid1: { content: 'not valid json' },
            invalid2: { content: '][' },
        },
    },
    jsonc: {
        positive: {
            'object with line comment': {
                content: `{
        // enabled flag
        "enabled": true,
        "nested": {
            // value comment
            "value": 3
        }
    }`,
                value: {
                    enabled: true,
                    nested: { value: 3 },
                },
            },
            'object with block comment': {
                content: `{
        /* comment */
        "a": 1,
        "b": [1, 2]
    }`,
                value: {
                    a: 1,
                    b: [1, 2],
                },
            },

            'comments inside strings': {
                content: `[// commennt1
"//comment2",/*comment 3*/"/*comment 4*/"]`,
                value: ['//comment2', '/*comment 4*/'],
            },
        },
        negative: {
            empty: { content: '' },
            'just a block comment': { content: '/* foo */' },
            'just a line comment': { content: '/// foo' },
            invalid1: { content: 'not valid json' },
            invalid2: { content: '{"a": }' },
            'unclosed comment': { content: '{}/*' },
            'not a comment': { content: '{}/*/' },
            'recursive comments': {
                content: `{
        /* comment /* i/*n*/ner */ */
        "a": 1,
        "b": [1, 2]
        // foo // bar
        /**/
        /*aaa//bbb */
    }`,
            },
        },
    },
    hjson: {
        positive: {
            'unquoted keys and quoteless string': {
                content: `
enabled: true
message: hello world
nested: {value: 3}
`,
                value: {
                    enabled: true,
                    message: 'hello world',
                    nested: { value: 3 },
                },
            },
            empty: {
                content: '',
                value: {},
            },
            'comments and trailing commas': {
                content: `{
# comment
list: [
1
2
]
}`,
                value: {
                    list: [1, 2],
                },
            },
            number: {
                content: '6',
                value: 6,
            },
            string: {
                content: 'abc',
                value: 'abc',
            },
            null: {
                content: 'null',
                value: null,
            },
        },
        negative: {
            invalid1: { content: '{' },
            invalid2: { content: '][' },
        },
    },

    ubjson: {
        positive: {
            'basic object': {
                content: '{i\x07enabledTi\u0006nested{i\u0005valuei\u0003}}',
                value: {
                    enabled: true,
                    nested: { value: 3 },
                },
            },
            array: {
                content: '[i\u0001i\u0002i\u0003]',
                value: [1, 2, 3],
            },
            number: {
                content: 'i\u0006',
                value: 6,
            },
            string: {
                content: 'Si\u0003abc',
                value: 'abc',
            },
            null: {
                content: 'Z',
                value: null,
            },
        },
        negative: {
            invalid1: { content: encoder.encode('not ubjson') },
            invalid2: { content: new Uint8Array([0xff, 0x00, 0x7f]) },
        },
    },
    msgpack: {
        positive: {
            'basic object': {
                content: new Uint8Array([
                    130, 167, 101, 110, 97, 98, 108, 101, 100, 195, 166, 110, 101, 115, 116, 101, 100, 129, 165, 118,
                    97, 108, 117, 101, 3,
                ]),
                value: {
                    enabled: true,
                    nested: { value: 3 },
                },
            },
            array: {
                content: new Uint8Array([147, 1, 2, 3]),
                value: [1, 2, 3],
            },
            number: {
                content: new Uint8Array([6]),
                value: 6,
            },
            string: {
                content: new Uint8Array([163, 97, 98, 99]),
                value: 'abc',
            },
            null: {
                content: new Uint8Array([192]),
                value: null,
            },
        },
        negative: {
            invalid1: { content: encoder.encode('not msgpack') },
            invalid2: { content: new Uint8Array([0xc1]) }, // reserved / invalid in many decoders
        },
    },
    cbor: {
        positive: {
            'basic object': {
                content: new Uint8Array([
                    162, 103, 101, 110, 97, 98, 108, 101, 100, 245, 102, 110, 101, 115, 116, 101, 100, 161, 101, 118,
                    97, 108, 117, 101, 3,
                ]),
                value: {
                    enabled: true,
                    nested: { value: 3 },
                },
            },
            array: {
                content: new Uint8Array([131, 1, 2, 3]),
                value: [1, 2, 3],
            },
            number: {
                content: new Uint8Array([6]),
                value: 6,
            },
            string: {
                content: new Uint8Array([99, 97, 98, 99]),
                value: 'abc',
            },
            null: {
                content: new Uint8Array([246]),
                value: null,
            },
        },
        negative: {
            invalid1: { content: encoder.encode('not cbor') },
            invalid2: { content: new Uint8Array([0xff]) }, // break stop code on its own
        },
    },
    rjson: {
        positive: {
            'object with line comment + trailing comma': {
                content: `{
        // enabled flag
        "enabled": true,
        "nested": {
            // value comment
            "value": 3,
        },
    }`,
                value: {
                    enabled: true,
                    nested: { value: 3 },
                },
            },
            'object with block comment + ident keys and values': {
                content: `{
        /* comment */
        a: A,
        b: B,
        c: C,
        -: +,
        $: *,
    }`,
                value: {
                    a: 'A',
                    b: 'B',
                    c: 'C',
                    '-': '+',
                    $: '*',
                },
            },

            'comments inside singe quoted strings': {
                content: `[// commennt1
'//comment2',/*comment 3*/'/*comment 4*/']`,
                value: ['//comment2', '/*comment 4*/'],
            },
            'plain string': { content: 'notvalidjson', value: 'notvalidjson' },
            'plain number': { content: '63', value: 63 },
        },
        negative: {
            empty: { content: '' },

            'just a block comment': { content: '/* foo */' },
            'just a line comment': { content: '/// foo' },
            invalid1: { content: 'not json' },
            invalid2: { content: '{"a": }' },
            'unclosed comment': { content: '{}/*' },
            'not a comment': { content: '{}/*/' },
            'recursive comments': {
                content: `{
        /* comment /* i/*n*/ner */ */
        "a": 1,
        "b": [1, 2]
        // foo // bar
        /**/
        /*aaa//bbb */
    }`,
            },
        },
    },
    ion: {
        negative: {},
        positive: {}
    }
};

describe('jsonVariants', () =>
    Object.entries(testCases).forEach(([variantKey, testCase], i) =>
        describe(variantKey, () => {
            const variant = JSON_VARIANTS[variantKey as Variant];
            const variantFormat = variantToFormat([variantKey, getJsonVariant(variantKey)]);
            it('retrieves the correct variant', () => expect(variantFormat.internal).toBe(variantKey));

            describe('features', () =>
                Object.entries(featureTests).forEach(([feature, values]) =>
                    it(feature, () => {
                        const actual = checkSupport<any>(variant, values);
                        const expected = new Array(values.values.length).fill(variant.support[feature as Feature]);
                        expect(actual).toEqual(expected);
                    }),
                ));
        }),
    ));

function checkSupport<T>(variantDef: JsonVariantDefinition, featureTest: FeatureTest<T>) {
    return featureTest.values.map(value => {
        const rt = roundtrip(variantDef, featureTest, value, value, d => d);
        const rtArray = roundtrip(variantDef, featureTest, value, [value], d => d.length === 1 ? d[0] : d);
        const rtObject = roundtrip(variantDef, featureTest, value, { value }, d => 'value' in d ? d.value : d);
        return Math.max(rt, rtArray, rtObject);
    });
}

function roundtrip<const T, const U>(
    variantDef: JsonVariantDefinition,
    featureTest: FeatureTest<T>,
    unwrapped: T,
    value: U,
    unwrap: (decoded: U) => unknown,
): Compat {
    try {
        const encoded = variantDef.lib.encode(value);
        const decoded = variantDef.lib.decode(encoded);
        const actual = unwrap(decoded as U);
        return (featureTest.equal ? featureTest.equal(unwrapped, actual) : unwrapped === actual) ? Compat.ok : Compat.coerces;
    } catch {
        return Compat.throws;
    }
}

function content2bytes(content: Uint8Array | string) {
    return typeof content === 'string' ? encoder.encode(content) : content;
}

function bytes2content(content: Uint8Array | string) {
    return typeof content === 'string' ? content : decoder.decode(content);
}
