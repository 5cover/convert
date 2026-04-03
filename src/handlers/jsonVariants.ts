// Format handler for JSON-like data formats.

/*
A JSON-like format is any format that encodes exactly one JavaScript value using the same structural model as JSON, without requiring interpretation or transformation beyond parsing.

A format F is JSON-like if

∃ total, deterministic functions:

  decode_F : bytes → V
  encode_F : V → bytes

such that:

1. V is a subset of JavaScript values
2. decode_F produces values in V without requiring external schema, heuristics, or structural reinterpretation.
3. encode_F and decode_F form a roundtrip on V:
   decode_F(encode_F(x)) = x   for all x ∈ V that F supports.
4. No structural normalization is required to fit V: the result of decode_F is already in the expected shape.

Not all JSON-like formats can represent the same set values without interpretation (JSON being the most restrictive), to determine compatibility, each format has a feature vector
*/

import { JSON5 } from 'bun';
import JSONC from 'tiny-jsonc';
import HJSON from 'hjson';
import UBJSON from '@shelacek/ubjson';
import MSGPACK from '@ably/msgpack-js';
import CBOR from 'cbor';
import RJSON from 'relaxed-json';
import CommonFormats from 'src/CommonFormats.ts';
import ION from 'ion-js';
import { FormatDefinition, type FileData, type FileFormat, type FormatHandler } from '../FormatHandler.ts';

export const enum Compat {
    ok,
    // Coerces to a baseline JSON-compatible value
    coerces,
    throws,
}
export const features = [
    'Infinity',
    'NaN',
    'undefined',
    'function',
    'symbol',
    'bigint',
    'Buffer',
    'Date',
    'URL',
    'minus0',
] as const;
export type Feature = (typeof features)[number];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
interface Parser {
    decode: (data: Uint8Array) => unknown;
    encode: (value: unknown) => Uint8Array;
}
export interface JsonVariantDefinition {
    name: string;
    extension: string;
    mime: string;
    lib: Parser;
    support: Record<Feature, Compat>;
}

const throwf = (x: unknown): never => {
    throw x;
};

// keyed by internal format name ref
export const JSON_VARIANTS = {
    json: {
        name: 'JSON',
        extension: 'json',
        mime: 'application/json',
        lib: {
            decode: data => JSON.parse(decoder.decode(data)),
            encode: x =>
                encoder.encode(
                    JSON.stringify(x) ??
                        throwf(
                            new Error('JSON stringify failed. JSON cannot stringify undefined, functions or symbols'),
                        ),
                ),
        },
        support: {
            bigint: Compat.throws,
            Buffer: Compat.coerces,
            Date: Compat.coerces,
            function: Compat.throws,
            Infinity: Compat.coerces,
            NaN: Compat.coerces,
            symbol: Compat.throws,
            undefined: Compat.throws,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    json5: {
        name: 'JSON5',
        extension: 'json5',
        mime: 'application/json5',
        lib: {
            decode: data => JSON5.parse(decoder.decode(data)),
            encode: x =>
                encoder.encode(
                    JSON5.stringify(x) ??
                        throwf(
                            new Error('JSON5 stringify failed. JSON5 cannot stringify undefined, functions or symbols'),
                        ),
                ),
        },
        support: {
            bigint: Compat.throws,
            Buffer: Compat.coerces,
            Date: Compat.coerces,
            function: Compat.throws,
            Infinity: Compat.ok,
            NaN: Compat.ok,
            symbol: Compat.throws,
            undefined: Compat.throws,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    jsonc: {
        name: 'JSONC',
        extension: 'jsonc',
        mime: 'application/jsonc',
        lib: {
            decode: data => JSONC.parse(decoder.decode(data)),
            encode: x => encoder.encode(JSON.stringify(x)),
        },
        support: {
            bigint: Compat.throws,
            Buffer: Compat.coerces,
            Date: Compat.coerces,
            function: Compat.throws,
            Infinity: Compat.coerces,
            NaN: Compat.coerces,
            symbol: Compat.throws,
            undefined: Compat.throws,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    hjson: {
        name: 'HJSON',
        extension: 'hjson',
        mime: 'application/hjson',
        lib: {
            decode: data => HJSON.parse(decoder.decode(data)),
            encode: x => encoder.encode(HJSON.stringify(x)),
        },
        support: {
            bigint: Compat.coerces,
            Buffer: Compat.coerces,
            Date: Compat.coerces,
            function: Compat.coerces,
            Infinity: Compat.coerces,
            NaN: Compat.coerces,
            symbol: Compat.coerces,
            undefined: Compat.coerces,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    ubjson: {
        name: 'UBJSON',
        extension: 'ubjson',
        mime: 'application/ubjson',
        lib: {
            decode: data => UBJSON.decode(data.buffer as ArrayBuffer),
            encode: x => new Uint8Array(UBJSON.encode(x)),
        },
        support: {
            bigint: Compat.throws,
            Buffer: Compat.coerces,
            Date: Compat.coerces,
            function: Compat.throws,
            Infinity: Compat.ok,
            NaN: Compat.ok,
            symbol: Compat.throws,
            undefined: Compat.coerces,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    msgpack: {
        name: 'MessagePack',
        extension: 'msgpack',
        mime: 'application/vnd.msgpack',
        lib: {
            decode: data => MSGPACK.decode(Buffer.from(data.buffer)),
            encode: x => MSGPACK.encode(x),
        },
        support: {
            bigint: Compat.throws,
            Buffer: Compat.ok,
            Date: Compat.coerces,
            function: Compat.throws,
            Infinity: Compat.ok,
            NaN: Compat.ok,
            symbol: Compat.throws,
            undefined: Compat.ok,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    cbor: {
        name: 'CBOR',
        extension: 'cbor',
        mime: 'application/cbor',
        lib: CBOR,
        support: {
            bigint: Compat.ok,
            Buffer: Compat.ok,
            Date: Compat.ok,
            function: Compat.throws,
            Infinity: Compat.ok,
            NaN: Compat.ok,
            symbol: Compat.throws,
            undefined: Compat.ok,
            URL: Compat.ok,
            minus0: Compat.ok,
        },
    },
    rjson: {
        // https://oleg.fi/relaxed-json/
        name: 'RJSON',
        extension: 'rjson',
        mime: 'application/rjson',
        lib: {
            decode: data => RJSON.parse(decoder.decode(data)),
            encode: x => encoder.encode(RJSON.stringify(x)),
        },
        support: {
            bigint: Compat.coerces,
            Buffer: Compat.coerces,
            Date: Compat.coerces,
            function: Compat.coerces,
            Infinity: Compat.coerces,
            NaN: Compat.coerces,
            symbol: Compat.coerces,
            undefined: Compat.coerces,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
    ion: {
        name: 'Amazon Ion',
        extension: 'ion',
        mime: 'application/ion',
        lib: {
            decode: data => ION.load(data),
            encode: x => encoder.encode(ION.dumpText(x)),
        },
        support: {
            bigint: Compat.coerces,
            Buffer: Compat.throws,
            Date: Compat.coerces,
            function: Compat.throws,
            Infinity: Compat.coerces,
            NaN: Compat.coerces,
            symbol: Compat.throws,
            undefined: Compat.throws,
            URL: Compat.coerces,
            minus0: Compat.coerces,
        },
    },
} as const satisfies Record<string, JsonVariantDefinition>;

export function getJsonVariant(ref: string) {
    if (ref in JSON_VARIANTS) return JSON_VARIANTS[ref as keyof typeof JSON_VARIANTS];
    throw new Error(`Unsupported JSON variant format: ${ref}`);
}

const jsonFormat = CommonFormats.JSON.supported('json', true, true, true);

const supportedFormats = [jsonFormat, ...Object.entries(JSON_VARIANTS).map(variantToFormat)];

function compatibility(variant: JsonVariantDefinition) {
    // Determine compatibility for each other format
    let compatibility: Compat;
    const supportedFeatures = features.filter(feature => variant.support[feature] === Compat.ok);
    // Map over the other formats
    return Object.values(JSON_VARIANTS)
        .filter(other => other.name !== variant.name)
        .map(other => {
            // For each of our supported features:
            const losses: Feature[] = [];
            const unsupported: Feature[] = [];
            for (const feature of supportedFeatures) {
                switch (other.support[feature]) {
                    case Compat.coerces:
                        losses.push(feature);
                        break;
                    case Compat.throws:
                        unsupported.push(feature);
                        break;
                }
            }
            const results = [
                losses.length && `lossy on: ${losses}`,
                unsupported.length && `throws on: ${unsupported}`,
            ].filter(x => x);
            return [other, results.length ? results.join(', ') : 'lossless'] as const;
        });
}
Object.values(JSON_VARIANTS).forEach(variant => {
    compatibility(variant).forEach(([other, compat]) => {
        console.log(`${variant.name} -> ${other.name} : ${compat}`);
    });
});

// todo:
// a single handler cannot express a graph of possible conversions, only inputs/outputs completly connected. multiple handlers?

export function variantToFormat([ref, variant]: [string, JsonVariantDefinition]) {
    return new FormatDefinition(variant.name, ref, variant.extension, variant.mime, 'data').supported(
        ref,
        true,
        true,
        true,
    );
}

const jsonParser: Parser = {
    decode: data => JSON.parse(decoder.decode(data)),
    encode: x => encoder.encode(JSON.stringify(x)),
};

function getParser(ref: string): JsonVariantDefinition['lib'] {
    return ref === jsonFormat.internal ? jsonParser : getJsonVariant(ref).lib;
}

export default class jsonVariantsHandler implements FormatHandler {
    public name: string = 'JSON variants';
    public ready: boolean = true;

    public supportedFormats = supportedFormats;

    async init(): Promise<void> {
        this.ready = true;
    }

    async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
        const inputVariant = getParser(inputFormat.internal);
        const outputVariant = getParser(outputFormat.internal);

        return inputFiles.map(file => {
            const baseName = file.name.replace(/\.[^.]+$/u, '');
            const value = inputVariant.decode(file.bytes);
            const output = outputVariant.encode(value);

            return {
                name: `${baseName}.${outputFormat.extension}`,
                bytes: output,
            };
        });
    }
}
