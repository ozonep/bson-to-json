Directly and quickly converts a BSON buffer to a JSON string stored in a Buffer.
Useful for sending MongoDB database query results to a client over JSON+HTTP.

Benchmark with a ~2500-element array of medium objects (9MB BSON):

| Method | Time (ms) |
| ------ | --------: |
| `JSON.stringify(BSON.deserialize(arr))`<sup>1</sup> | 226.0 |
| this, JS | 39.7 |
| this, portable C++ | 20.6 |
| this, SSE2 | 15.2 |
| this, SSE4.2 | 11.5 |
| this, AVX2 | 10.6 |

<sup>1</sup> `BSON.deserialize` is the [official MongoDB js-bson implementation](https://github.com/mongodb/js-bson).

Major reasons it's fast:
* Direct UTF8 to JSON-escaped string transcoding.
* No waste temporary objects created for the GC to clean up.
* SSE2, SSE4.2 or AVX2-accelerated JSON string escaping.
* AVX2-accelerated ObjectId hex string encoding, using the technique from
  [zbjornson/fast-hex](https://github.com/zbjornson/fast-hex).
* Fast integer encoding, using the method from [`fmtlib/fmt`](https://github.com/fmtlib/fmt).
* Fast double encoding, using the same [double-conversion library](https://github.com/google/double-conversion)
  used in v8.
* Skips decoding array keys (which BSON stores as ASCII numbers) and instead
  advances by the known number of bytes in the key.

The output of this library should be identical to
`JSON.stringify(BSON.deserialize(v))`, with two exceptions:

1. This module writes full-precision (64-bit signed) BSON Longs to the JSON
   buffer. This is valid because JSON does not specify a maximum numeric
   precision, but js-bson instead writes an object with low and high bits.
2. This module does more/better input bounds checking than js-bson, so this
   module may throw different errors. (js-bson seems to rely, intentionally or
   not, on indexing past the end of a typed array returning `undefined`.)

TODO:
- [ ] Fix crash when using iterator interface.
- [ ] Refactor so it's usable as a C++ library?

## Benchmarks by BSON type (ops/sec):

| Type | js-bson | this, JS | this, CPP (AVX2) |
| ---- | ---: | ---: | ---: |
| long | 1,760 | 1,236 | 28,031
| int | 1,503 | 1,371 | 17,264
| ObjectId | 1,048 | 13,322 | 37,079
| date | 445 | 663 | 10,686
| number | 730 | 1,228 | 1,929
| boolean | 444 | 4,839 | 9,283
| null | 482 | 7,487 | 14,709
| string\<len=1000, esc=0.00><sup>1</sup> | 12,304 | 781 | 55,502
| string\<len=1000, esc=0.01> | 12,720 | 748 | 56,145
| string\<len=1000, esc=0.05> | 12,320 | 756 | 43,867

<sup>1</sup>String transcoding performance depends on the length of the string
(`len`) and the number of characters that must be escaped in the JSON output
(`esc`, a fraction from 0 to 1).

## Usage

### One-Shot

> ```ts
> bsonToJson(bson: Uint8Array, isArray?: boolean = true): Buffer
> // (note that Buffers extend Uint8Arrays, so `bson` can be a Buffer)
> ```

`isArray` specifies if the input is an array or not. BSON doesn't differentiate
between arrays and objects at the top level, so this must be provided.

* Pro: Easy to use.
* Con: May cause memory [reallocation](https://en.cppreference.com/w/c/memory/realloc)
  if the initial output buffer is too small. On Linux at least, this is usually
  an [efficient operation](http://blog.httrack.com/blog/2014/04/05/a-story-of-realloc-and-laziness/),
  however.
* Con: Entire output must fit in memory.

### (UNSTABLE) Iterator (Streaming) (C++ only)

> ```ts
> new Transcoder(bson: Uint8Array, isArray?: boolean = true,
>     options?: ({chunkSize: number}|{fixedBuffer: ArrayBuffer})): Iterator<Buffer>
> // (note that Buffers extend Uint8Arrays, so `bson` can be a Buffer)
> ```

`isArray` specifies if the input is an array or not. BSON doesn't differentiate
between arrays and objects at the top level, so this must be provided.

* `chunkSize` can be specified to limit memory usage. The default value is
  estimated based on the input size and typical BSON expansion ratios such that
  a single output buffer will likely fit all of the data (i.e. the iterator will
  usually yield a value once or a few times).
* `fixedBuffer` if set to an instance of an ArrayBuffer, will decode into that
  memory in each iteration (the Buffer yielded in each iteration will be backed
  by that same ArrayBuffer). This limits memory usage and can improve
  performance (exactly one dynamic memory allocation).

```js
const iterator = new Transcoder(data);
for (const jsonBuf of iterator)
    res.write(jsonBuf); // res is an http server response or other writable stream
```
With a chunk size to limit memory usage:
```js
const iterator = new Transcoder(data, true, {chunkSize: 4096});
for (const jsonBuf of iterator)
    res.write(jsonBuf);
```
With a fixed buffer to limit memory usage and potentially improve performance:
```js
const iterator = new Transcoder(data, true, {fixedBuffer: new ArrayBuffer(4096)});
// jsonBuf is backed by the same memory in each iteration.
for (const jsonBuf of iterator) {
    // Wait for res to consume the output buffer.
    await new Promise(resolve => res.write(jsonBuf, resolve));
}
```

* Pro: Never causes memory reallocation. When the output is full, it's yielded.
* Pro: Can avoid all but one memory allocation by using a fixed buffer.
* Pro: Can specify a chunk size or fixed buffer if you want to limit memory usage.
* Con: Slightly harder to use.
