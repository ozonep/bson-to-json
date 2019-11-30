//@ts-check
'use strict';

const Buffer = require("buffer").Buffer;
const Long = require("long");

const BSON_DATA_NUMBER = 1;
const BSON_DATA_STRING = 2;
const BSON_DATA_OBJECT = 3;
const BSON_DATA_ARRAY = 4;
const BSON_DATA_BINARY = 5;
const BSON_DATA_UNDEFINED = 6;
const BSON_DATA_OID = 7;
const BSON_DATA_BOOLEAN = 8;
const BSON_DATA_DATE = 9;
const BSON_DATA_NULL = 10;
const BSON_DATA_REGEXP = 11;
const BSON_DATA_DBPOINTER = 12;
const BSON_DATA_CODE = 13;
const BSON_DATA_SYMBOL = 14;
const BSON_DATA_CODE_W_SCOPE = 15;
const BSON_DATA_INT = 16;
const BSON_DATA_TIMESTAMP = 17;
const BSON_DATA_LONG = 18;
const BSON_DATA_DECIMAL128 = 19;
const BSON_DATA_MIN_KEY = 0xff;
const BSON_DATA_MAX_KEY = 0x7f;

const QUOTE = '"'.charCodeAt(0);
const COLON = ':'.charCodeAt(0);
const COMMA = ','.charCodeAt(0);
const OPENSQ = '['.charCodeAt(0);
const OPENCURL = '{'.charCodeAt(0);
const CLOSESQ = ']'.charCodeAt(0);
const CLOSECURL = '}'.charCodeAt(0);
const BACKSLASH = '\\'.charCodeAt(0);

const TRUE = Buffer.from('true');
const FALSE = Buffer.from('false');
const NULL = Buffer.from('null');
const NOTHING = Buffer.alloc(0);

const ESCAPES = {
	8: 'b'.charCodeAt(0),
	9: 't'.charCodeAt(0),
	10: 'n'.charCodeAt(0),
	12: 'f'.charCodeAt(0),
	13: 'r'.charCodeAt(0),
	34: 34, // "
	47: 47, // /
	92: 92 // \
};

function readInt32LE(buffer, index) {
	return buffer[index] |
		(buffer[index + 1] << 8) |
		(buffer[index + 2] << 16) |
		(buffer[index + 3] << 24);
}

const tb = Buffer.allocUnsafeSlow(8);
const ta = new Float64Array(tb.buffer, tb.byteOffset, 1);
function readDoubleLE(buffer, index) {
	tb[0] = buffer[index];
	tb[1] = buffer[index + 1];
	tb[2] = buffer[index + 2];
	tb[3] = buffer[index + 3];
	tb[4] = buffer[index + 4];
	tb[5] = buffer[index + 5];
	tb[6] = buffer[index + 6];
	tb[7] = buffer[index + 7];
	return ta[0];
}

function addQuotedStringRangeArr(out, buffer, nameStart, nameEnd, valStart, valEnd) {
	out[this.outIdx++] = QUOTE;
	this.writeStringRange(out, buffer, valStart, valEnd);
	out[this.outIdx++] = QUOTE;
}
function addQuotedStringRangeObj(out, buffer, nameStart, nameEnd, valStart, valEnd) {
	out[this.outIdx++] = QUOTE;
	this.writeStringRange(out, buffer, nameStart, nameEnd);
	out[this.outIdx++] = QUOTE;
	out[this.outIdx++] = COLON;
	out[this.outIdx++] = QUOTE;
	this.writeStringRange(out, buffer, valStart, valEnd);
	out[this.outIdx++] = QUOTE;
}

function addQuotedValArr(out, buffer, nameStart, nameEnd, val) {
	out[this.outIdx++] = QUOTE;
	for (let i = 0; i < val.length; i++) out[this.outIdx++] = val[i];
	out[this.outIdx++] = QUOTE;
}
function addQuotedValObj(out, buffer, nameStart, nameEnd, val) {
	out[this.outIdx++] = QUOTE;
	this.writeStringRange(out, buffer, nameStart, nameEnd);
	out[this.outIdx++] = QUOTE;
	out[this.outIdx++] = COLON;
	out[this.outIdx++] = QUOTE;
	for (let i = 0; i < val.length; i++) out[this.outIdx++] = val[i];
	out[this.outIdx++] = QUOTE;
}

function addValArr(out, buffer, nameStart, nameEnd, val) {
	for (let i = 0; i < val.length; i++) out[this.outIdx++] = val[i];
}
function addValObj(out, buffer, nameStart, nameEnd, val) {
	out[this.outIdx++] = QUOTE;
	this.writeStringRange(out, buffer, nameStart, nameEnd);
	out[this.outIdx++] = QUOTE;
	out[this.outIdx++] = COLON;
	for (let i = 0; i < val.length; i++) out[this.outIdx++] = val[i];
}

class Transcoder {
	constructor() {
		this.outIdx = 0;
	}

	/**
	 * @param {Buffer} buffer
	 */
	transcode(buffer, options = {}, isArray = true) {
		const index = options.index || 0;

		const size = readInt32LE(buffer, index);

		if (size + index > buffer.length)
			throw new Error(`(bson size ${size} + options.index ${index} must be <= buffer length ${buffer.length})`);

		// Illegal end value
		if (buffer[index + size - 1] !== 0) {
			throw new Error("One object, sized correctly, with a spot for an EOO, but the EOO isn't 0x00");
		}

		const out = Buffer.alloc(1e8); // TODO overrun protection
		this.outIdx = 0;
		this.transcodeObject(out, buffer, index, options, isArray);
		return out.slice(0, this.outIdx);
	}

	/**
	 * Writes the bytes in `str` from `start` to `end` (exclusive) into `out`,
	 * escaping per JSON spec.
	 * TODO \uXXXX are not escaped
	 * @param {Buffer} out
	 * @param {Buffer} str
	 * @param {number} start
	 * @param {number} end
	 * @private
	 */
	writeStringRange(out, str, start, end) {
		for (let i = start; i < end; i++) {
			const c = str[i];
			let xc;
			if (c > 47 && c !== 92) {
				out[this.outIdx++] = c;
			} else if ((xc = ESCAPES[c])) {
				out[this.outIdx++] = BACKSLASH;
				out[this.outIdx++] = xc;
			} else {
				out[this.outIdx++] = c;
			}
		}
	}

	/**
	 * @param {Buffer} out
	 * @param {Buffer} buffer
	 * @param {number} index
	 * @param {boolean} isArray
	 * @private
	 */
	transcodeObject(out, buffer, index, options, isArray) {
		const bufLen = buffer.length;
		const size = readInt32LE(buffer, index);
		index += 4;

		if (size < 5 || size > bufLen)
			throw new Error('corrupt bson message');

		let first = true;

		let addQuotedStringRange, addQuotedVal, addVal;
		let nameStart, nameEnd;

		if (isArray) {
			out[this.outIdx++] = OPENSQ;
			addQuotedStringRange = addQuotedStringRangeArr.bind(this);
			addQuotedVal = addQuotedValArr.bind(this);
			addVal = addValArr.bind(this);
		} else {
			out[this.outIdx++] = OPENCURL;
			addQuotedStringRange = addQuotedStringRangeObj.bind(this);
			addQuotedVal = addQuotedValObj.bind(this);
			addVal = addValObj.bind(this);
		}

		while (true) {
			const elementType = buffer[index++];

			// If we get a zero it's the last byte, exit
			if (elementType === 0) break;

			// Name is a null-terminated string.
			nameStart = nameEnd = index;
			while (buffer[nameEnd] !== 0x00 && nameEnd < bufLen) {
				nameEnd++;
			}

			if (nameEnd >= bufLen) throw new Error('Bad BSON Document: illegal CString');

			if (first) {
				first = false;
			} else {
				out[this.outIdx++] = COMMA;
			}

			index = nameEnd + 1;

			switch (elementType) {
				case BSON_DATA_STRING: {
					const stringSize = readInt32LE(buffer, index);
					index += 4;
					if (
						stringSize <= 0 ||
						stringSize > bufLen - index ||
						buffer[index + stringSize - 1] !== 0
					)
						throw new Error('bad string length in bson');

					// if (!validateUtf8(buffer, index, index + stringSize - 1))
					// 	throw new Error('Invalid UTF-8 string in BSON document');

					addQuotedStringRange(out, buffer, nameStart, nameEnd, index, index + stringSize - 1);

					index += stringSize;
					break;
				}
				case BSON_DATA_OID: {
					const value = Buffer.from(buffer.toString('hex', index, index + 12)); // TODO transcode
					addQuotedVal(out, buffer, nameStart, nameEnd, value);

					index += 12;
					break;
				}
				case BSON_DATA_INT: {
					const value = readInt32LE(buffer, index);
					addVal(out, buffer, nameStart, nameEnd, Buffer.from(value.toString()));
					index += 4;
					break;
				}
				case BSON_DATA_NUMBER: {
					// const value = buffer.readDoubleLE(index); // not sure which is faster TODO
					const value = readDoubleLE(buffer, index);
					addVal(out, buffer, nameStart, nameEnd, Buffer.from(value.toString()));
					index += 8;
					break;
				}
				case BSON_DATA_DATE: {
					const lowBits = readInt32LE(buffer, index);
					index += 4;
					const highBits = readInt32LE(buffer, index);
					index += 4;
					const value = Buffer.from(new Date(new Long(lowBits, highBits).toNumber()).toISOString());
					addQuotedVal(out, buffer, nameStart, nameEnd, value);
					break;
				}
				case BSON_DATA_BOOLEAN: {
					if (buffer[index] !== 0 && buffer[index] !== 1)
						throw new Error('illegal boolean type value');
					const value = buffer[index++] === 1;
					addVal(out, buffer, nameStart, nameEnd, value ? TRUE : FALSE);
					break;
				}
				case BSON_DATA_OBJECT: {
					const objectSize = readInt32LE(buffer, index);
					if (objectSize <= 0 || objectSize > bufLen - index)
						throw new Error('bad embedded document length in bson');

					addVal(out, buffer, nameStart, nameEnd, NOTHING);
					this.transcodeObject(out, buffer, index, options, false);

					index += objectSize;
					break;
				}
				case BSON_DATA_ARRAY: {
					const objectSize = readInt32LE(buffer, index);
					const stopIndex = index + objectSize;

					addVal(out, buffer, nameStart, nameEnd, NOTHING);
					this.transcodeObject(out, buffer, index, options, true);

					index += objectSize;

					if (buffer[index - 1] !== 0)
						throw new Error('invalid array terminator byte');
					if (index !== stopIndex)
						throw new Error('corrupted array bson');
					break;
				}
				case BSON_DATA_NULL: {
					addVal(out, buffer, nameStart, nameEnd, NULL);
					break;
				}
				case BSON_DATA_LONG: {
					const lowBits = readInt32LE(buffer, index);
					index += 4;
					const highBits = readInt32LE(buffer, index);
					index += 4;
					let vx;
					if (highBits === 0) {
						vx = lowBits;
					} else {
						const long = new Long(lowBits, highBits);
						const inJsRange = long.lte(Number.MAX_SAFE_INTEGER) && long.gte(Number.MIN_SAFE_INTEGER);
						vx = inJsRange ? long.toNumber() : long;
					}
					const value = Buffer.from(vx.toString());
					addVal(out, buffer, nameStart, nameEnd, value);
					break;
				}
				case BSON_DATA_UNDEFINED: // noop
				case BSON_DATA_DECIMAL128:
				case BSON_DATA_BINARY:
				case BSON_DATA_REGEXP:
				case BSON_DATA_SYMBOL:
				case BSON_DATA_TIMESTAMP:
				case BSON_DATA_MIN_KEY:
				case BSON_DATA_MAX_KEY:
				case BSON_DATA_CODE:
				case BSON_DATA_CODE_W_SCOPE:
				case BSON_DATA_DBPOINTER:
					// incompatible JSON type
					break;
				default:
					throw new Error('Detected unknown BSON type ' + elementType.toString(16));
			}
		}

		out[this.outIdx++] = isArray ? CLOSESQ : CLOSECURL;
	}
}

module.exports = Transcoder;

const x = new Transcoder();
const fs = require("fs");
const data = fs.readFileSync("./data.bson");
let json;
console.time("transcode");
for (let i = 0; i < 10; i++)
	json = x.transcode(data);
console.timeEnd("transcode");
fs.writeFileSync("./data.json", json);
require("./data.json");