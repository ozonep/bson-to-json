{
  "targets": [
    {
      "target_name": "bsonToJson",
      "sources": [
        "src/bson-to-json.cc",
        "deps/double_conversion/double-to-string.cc",
        "deps/double_conversion/cached-powers.cc",
        "deps/double_conversion/bignum.cc",
        "deps/double_conversion/bignum-dtoa.cc",
        "deps/double_conversion/fast-dtoa.cc",
        "deps/double_conversion/fixed-dtoa.cc",
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags_cc!": [
        # Unset Node.js v8's std.
       "-std=gnu++1y"
      ],
      "cflags":[
        "-std=c++17",
        "-fvisibility=hidden",
        "-march=native",
        "-O3",
        "-Wno-unused-function",
        "-Wno-unused-const-variable"
      ],
      "cflags_cc":[
        "-std=c++17",
        "-fvisibility=hidden",
        "-march=native",
        "-O3",
        "-Wno-unused-function",
        "-Wno-unused-const-variable"
      ]
    }
  ]
}
