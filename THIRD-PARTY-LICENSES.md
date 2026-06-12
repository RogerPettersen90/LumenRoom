# Third-party licenses

LumenRoom is licensed under GPL-3.0-or-later (see LICENSE). It incorporates
or downloads the following third-party components.

## Bundled data and assets

### lensfun lens calibration database
- Source: https://lensfun.github.io/ (database version 0.3.4, the
  interchangeable-lens XML files, embedded at build time)
- License: **CC-BY-SA 3.0** — © the lensfun project contributors
- Used for: lens distortion and chromatic-aberration correction profiles.

### DejaVu Sans font (`src-tauri/fonts/DejaVuSans.ttf`)
- Source: https://dejavu-fonts.github.io/
- License: Bitstream Vera Fonts license + public-domain additions
  (free to use, embed, and redistribute; full text at the project page)
- Used for: rasterizing export watermarks.

### Compact ICC profiles (`src-tauri/icc/`)
- Source: https://github.com/saucecontrol/Compact-ICC-Profiles
- License: **CC0 1.0** (public domain)
- Files: sRGB-v2-micro.icc, AdobeCompat-v2.icc (a clean-room profile
  compatible with Adobe RGB (1998); NOT Adobe's profile file).

## Downloaded at runtime (first use only)

### Silueta segmentation model (~43MB)
- Source: the rembg project's model distribution
  (https://github.com/danielgatis/rembg)
- Architecture: U²-Net (https://github.com/xuebinqin/U-2-Net, Apache-2.0);
  rembg is MIT-licensed.
- Used for: the local "Select Subject" AI mask. Runs entirely offline after
  download; no image data ever leaves the machine.

## npm packages (production)

React, React DOM, Zustand, @tauri-apps/api and plugins — MIT or
MIT/Apache-2.0 dual licensed. Full texts ship in each package's directory.

## Rust crates

549 crates, overwhelmingly MIT / Apache-2.0 dual-licensed. Notable:
**rawler (LGPL-2.1)** — the RAW decoding library; LumenRoom complies by
being GPL-3.0 licensed. Full list with SPDX identifiers:

| Crate | License |
|-------|---------|
| ab_glyph | Apache-2.0 |
| ab_glyph_rasterizer | Apache-2.0 |
| addr2line | Apache-2.0 OR MIT |
| adler2 | 0BSD OR MIT OR Apache-2.0 |
| adler32 | Zlib |
| ahash | MIT OR Apache-2.0 |
| aho-corasick | Unlicense OR MIT |
| alloc-no-stdlib | BSD-3-Clause |
| alloc-stdlib | BSD-3-Clause |
| allocator-api2 | MIT OR Apache-2.0 |
| android_system_properties | MIT/Apache-2.0 |
| anyhow | MIT OR Apache-2.0 |
| anymap2 | MIT/Apache-2.0 |
| anymap3 | BlueOak-1.0.0 OR MIT OR Apache-2.0 |
| arrayref | BSD-2-Clause |
| arrayvec | MIT OR Apache-2.0 |
| async-trait | MIT OR Apache-2.0 |
| atk | MIT |
| atk-sys | MIT |
| atomic-waker | Apache-2.0 OR MIT |
| autocfg | Apache-2.0 OR MIT |
| backtrace | MIT OR Apache-2.0 |
| base64 | MIT OR Apache-2.0 |
| bit-set | Apache-2.0 OR MIT |
| bit-set | MIT/Apache-2.0 |
| bit-vec | Apache-2.0 OR MIT |
| bit-vec | MIT/Apache-2.0 |
| bit_field | Apache-2.0/MIT |
| bitflags | MIT OR Apache-2.0 |
| bitflags | MIT/Apache-2.0 |
| bitstream-io | MIT/Apache-2.0 |
| blake3 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception |
| block-buffer | MIT OR Apache-2.0 |
| block2 | MIT |
| brotli | BSD-3-Clause AND MIT |
| brotli-decompressor | BSD-3-Clause/MIT |
| bumpalo | MIT OR Apache-2.0 |
| bytemuck | Zlib OR Apache-2.0 OR MIT |
| byteorder | Unlicense OR MIT |
| byteorder-lite | Unlicense OR MIT |
| bytes | MIT |
| cairo-rs | MIT |
| cairo-sys-rs | MIT |
| camino | MIT OR Apache-2.0 |
| cargo-platform | MIT OR Apache-2.0 |
| cargo_metadata | MIT |
| cargo_toml | Apache-2.0 OR MIT |
| cc | MIT OR Apache-2.0 |
| cesu8 | Apache-2.0/MIT |
| cfb | MIT |
| cfg-expr | MIT OR Apache-2.0 |
| cfg-if | MIT OR Apache-2.0 |
| chacha20 | MIT OR Apache-2.0 |
| chrono | MIT OR Apache-2.0 |
| color_quant | MIT |
| combine | MIT |
| constant_time_eq | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| cookie | MIT OR Apache-2.0 |
| core-foundation | MIT OR Apache-2.0 |
| core-foundation-sys | MIT OR Apache-2.0 |
| core-graphics | MIT OR Apache-2.0 |
| core-graphics-types | MIT OR Apache-2.0 |
| cpufeatures | MIT OR Apache-2.0 |
| crc32fast | MIT OR Apache-2.0 |
| crossbeam-channel | MIT OR Apache-2.0 |
| crossbeam-deque | MIT OR Apache-2.0 |
| crossbeam-epoch | MIT OR Apache-2.0 |
| crossbeam-utils | MIT OR Apache-2.0 |
| crunchy | MIT |
| crypto-common | MIT OR Apache-2.0 |
| cssparser | MPL-2.0 |
| cssparser-macros | MPL-2.0 |
| ctor | Apache-2.0 OR MIT |
| ctor-proc-macro | Apache-2.0 OR MIT |
| darling | MIT |
| darling_core | MIT |
| darling_macro | MIT |
| dary_heap | MIT OR Apache-2.0 |
| dbus | Apache-2.0/MIT |
| deranged | MIT OR Apache-2.0 |
| derive-new | MIT |
| derive_more | MIT |
| derive_more-impl | MIT |
| digest | MIT OR Apache-2.0 |
| directories | MIT OR Apache-2.0 |
| dirs | MIT OR Apache-2.0 |
| dirs-sys | MIT OR Apache-2.0 |
| dispatch2 | Zlib OR Apache-2.0 OR MIT |
| displaydoc | MIT OR Apache-2.0 |
| dlopen2 | MIT |
| dlopen2_derive | MIT |
| doc-comment | MIT |
| dom_query | MIT |
| downcast-rs | MIT/Apache-2.0 |
| dpi | Apache-2.0 AND MIT |
| dtoa | MIT OR Apache-2.0 |
| dtoa-short | MPL-2.0 |
| dtor | Apache-2.0 OR MIT |
| dtor-proc-macro | Apache-2.0 OR MIT |
| dunce | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| dyn-clone | MIT OR Apache-2.0 |
| dyn-hash | MIT OR Apache-2.0 |
| either | MIT OR Apache-2.0 |
| embed-resource | MIT |
| embed_plist | MIT OR Apache-2.0 |
| enumn | MIT OR Apache-2.0 |
| equivalent | Apache-2.0 OR MIT |
| erased-serde | MIT OR Apache-2.0 |
| errno | MIT OR Apache-2.0 |
| exr | BSD-3-Clause |
| fallible-iterator | MIT/Apache-2.0 |
| fallible-streaming-iterator | MIT/Apache-2.0 |
| fastrand | Apache-2.0 OR MIT |
| fax | MIT |
| fdeflate | MIT OR Apache-2.0 |
| field-offset | MIT OR Apache-2.0 |
| filetime | MIT/Apache-2.0 |
| find-msvc-tools | MIT OR Apache-2.0 |
| flate2 | MIT OR Apache-2.0 |
| fnv | Apache-2.0 / MIT |
| foldhash | Zlib |
| foreign-types | MIT/Apache-2.0 |
| foreign-types-macros | MIT/Apache-2.0 |
| foreign-types-shared | MIT/Apache-2.0 |
| form_urlencoded | MIT OR Apache-2.0 |
| fsevent-sys | MIT |
| futures | MIT OR Apache-2.0 |
| futures-channel | MIT OR Apache-2.0 |
| futures-core | MIT OR Apache-2.0 |
| futures-executor | MIT OR Apache-2.0 |
| futures-io | MIT OR Apache-2.0 |
| futures-macro | MIT OR Apache-2.0 |
| futures-sink | MIT OR Apache-2.0 |
| futures-task | MIT OR Apache-2.0 |
| futures-util | MIT OR Apache-2.0 |
| gdk | MIT |
| gdk-pixbuf | MIT |
| gdk-pixbuf-sys | MIT |
| gdk-sys | MIT |
| gdkwayland-sys | MIT |
| gdkx11 | MIT |
| gdkx11-sys | MIT |
| generic-array | MIT |
| getrandom | MIT OR Apache-2.0 |
| gif | MIT OR Apache-2.0 |
| gimli | MIT OR Apache-2.0 |
| gio | MIT |
| gio-sys | MIT |
| glib | MIT |
| glib-macros | MIT |
| glib-sys | MIT |
| glob | MIT OR Apache-2.0 |
| gobject-sys | MIT |
| gtk | MIT |
| gtk-sys | MIT |
| gtk3-macros | MIT |
| half | MIT OR Apache-2.0 |
| hashbrown | MIT OR Apache-2.0 |
| hashlink | MIT OR Apache-2.0 |
| heck | MIT OR Apache-2.0 |
| hex | MIT OR Apache-2.0 |
| html5ever | MIT OR Apache-2.0 |
| http | MIT OR Apache-2.0 |
| http-body | MIT |
| http-body-util | MIT |
| httparse | MIT OR Apache-2.0 |
| hyper | MIT |
| hyper-util | MIT |
| iana-time-zone | MIT OR Apache-2.0 |
| iana-time-zone-haiku | MIT OR Apache-2.0 |
| ico | MIT |
| icu_collections | Unicode-3.0 |
| icu_locale_core | Unicode-3.0 |
| icu_normalizer | Unicode-3.0 |
| icu_normalizer_data | Unicode-3.0 |
| icu_properties | Unicode-3.0 |
| icu_properties_data | Unicode-3.0 |
| icu_provider | Unicode-3.0 |
| id-arena | MIT/Apache-2.0 |
| ident_case | MIT/Apache-2.0 |
| idna | MIT OR Apache-2.0 |
| idna_adapter | Apache-2.0 OR MIT |
| image | MIT OR Apache-2.0 |
| image-webp | MIT OR Apache-2.0 |
| include_dir | MIT |
| include_dir_macros | MIT |
| indexmap | Apache-2.0 OR MIT |
| infer | MIT |
| inotify | ISC |
| inotify-sys | ISC |
| ipnet | MIT OR Apache-2.0 |
| itertools | MIT OR Apache-2.0 |
| itertools | MIT/Apache-2.0 |
| itoa | MIT OR Apache-2.0 |
| javascriptcore-rs | MIT |
| javascriptcore-rs-sys | MIT |
| jni | MIT/Apache-2.0 |
| jni-sys | MIT OR Apache-2.0 |
| jni-sys-macros | MIT OR Apache-2.0 |
| jpeg-decoder | MIT OR Apache-2.0 |
| js-sys | MIT OR Apache-2.0 |
| json-patch | MIT/Apache-2.0 |
| jsonptr | MIT OR Apache-2.0 |
| kamadak-exif | BSD-2-Clause |
| keyboard-types | MIT OR Apache-2.0 |
| kqueue | MIT |
| kqueue-sys | MIT |
| kstring | MIT OR Apache-2.0 |
| lazy_static | MIT OR Apache-2.0 |
| leb128fmt | MIT OR Apache-2.0 |
| lebe | BSD-3-Clause |
| libappindicator | Apache-2.0 OR MIT |
| libappindicator-sys | Apache-2.0 OR MIT |
| libc | MIT OR Apache-2.0 |
| libdbus-sys | Apache-2.0/MIT |
| libflate | MIT |
| libflate_lz77 | MIT |
| libloading | ISC |
| libm | MIT AND (MIT OR Apache-2.0) |
| libredox | MIT |
| libsqlite3-sys | MIT |
| linux-raw-sys | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| liquid | MIT OR Apache-2.0 |
| liquid-core | MIT OR Apache-2.0 |
| liquid-derive | MIT OR Apache-2.0 |
| liquid-lib | MIT OR Apache-2.0 |
| litemap | Unicode-3.0 |
| lock_api | MIT OR Apache-2.0 |
| log | MIT OR Apache-2.0 |
| maplit | MIT/Apache-2.0 |
| markup5ever | MIT OR Apache-2.0 |
| matrixmultiply | MIT/Apache-2.0 |
| md5 | Apache-2.0/MIT |
| memchr | Unlicense OR MIT |
| memmap2 | MIT OR Apache-2.0 |
| memoffset | MIT |
| mime | MIT OR Apache-2.0 |
| minimal-lexical | MIT/Apache-2.0 |
| miniz_oxide | MIT OR Zlib OR Apache-2.0 |
| mio | MIT |
| moxcms | BSD-3-Clause OR Apache-2.0 |
| muda | Apache-2.0 OR MIT |
| multiversion | MIT OR Apache-2.0 |
| multiversion-macros | MIT OR Apache-2.0 |
| mutate_once | BSD-2-Clause |
| ndarray | MIT OR Apache-2.0 |
| ndk | MIT OR Apache-2.0 |
| ndk-sys | MIT OR Apache-2.0 |
| new_debug_unreachable | MIT |
| no_std_io2 | Apache-2.0 OR MIT |
| nom | MIT |
| notify | CC0-1.0 |
| num-complex | MIT OR Apache-2.0 |
| num-conv | MIT OR Apache-2.0 |
| num-integer | MIT OR Apache-2.0 |
| num-traits | MIT OR Apache-2.0 |
| num_enum | BSD-3-Clause OR MIT OR Apache-2.0 |
| num_enum_derive | BSD-3-Clause OR MIT OR Apache-2.0 |
| objc2 | MIT |
| objc2-app-kit | Zlib OR Apache-2.0 OR MIT |
| objc2-cloud-kit | Zlib OR Apache-2.0 OR MIT |
| objc2-core-data | Zlib OR Apache-2.0 OR MIT |
| objc2-core-foundation | Zlib OR Apache-2.0 OR MIT |
| objc2-core-graphics | Zlib OR Apache-2.0 OR MIT |
| objc2-core-image | Zlib OR Apache-2.0 OR MIT |
| objc2-core-location | Zlib OR Apache-2.0 OR MIT |
| objc2-core-text | Zlib OR Apache-2.0 OR MIT |
| objc2-encode | MIT |
| objc2-exception-helper | Zlib OR Apache-2.0 OR MIT |
| objc2-foundation | MIT |
| objc2-io-surface | Zlib OR Apache-2.0 OR MIT |
| objc2-quartz-core | Zlib OR Apache-2.0 OR MIT |
| objc2-ui-kit | Zlib OR Apache-2.0 OR MIT |
| objc2-user-notifications | Zlib OR Apache-2.0 OR MIT |
| objc2-web-kit | Zlib OR Apache-2.0 OR MIT |
| object | Apache-2.0 OR MIT |
| once_cell | MIT OR Apache-2.0 |
| option-ext | MPL-2.0 |
| owned_ttf_parser | Apache-2.0 |
| pango | MIT |
| pango-sys | MIT |
| parking_lot | MIT OR Apache-2.0 |
| parking_lot_core | MIT OR Apache-2.0 |
| paste | MIT OR Apache-2.0 |
| percent-encoding | MIT OR Apache-2.0 |
| pest | MIT OR Apache-2.0 |
| pest_derive | MIT OR Apache-2.0 |
| pest_generator | MIT OR Apache-2.0 |
| pest_meta | MIT OR Apache-2.0 |
| phf | MIT |
| phf_codegen | MIT |
| phf_generator | MIT |
| phf_macros | MIT |
| phf_shared | MIT |
| pin-project-lite | Apache-2.0 OR MIT |
| pkg-config | MIT OR Apache-2.0 |
| plist | MIT |
| png | MIT OR Apache-2.0 |
| portable-atomic | Apache-2.0 OR MIT |
| portable-atomic-util | Apache-2.0 OR MIT |
| potential_utf | Unicode-3.0 |
| powerfmt | MIT OR Apache-2.0 |
| ppv-lite86 | MIT OR Apache-2.0 |
| precomputed-hash | MIT |
| prettyplease | MIT OR Apache-2.0 |
| primal-check | MIT OR Apache-2.0 |
| proc-macro-crate | MIT OR Apache-2.0 |
| proc-macro-error | MIT OR Apache-2.0 |
| proc-macro-error-attr | MIT OR Apache-2.0 |
| proc-macro2 | MIT OR Apache-2.0 |
| prost | Apache-2.0 |
| prost-derive | Apache-2.0 |
| pxfm | BSD-3-Clause OR Apache-2.0 |
| qoi | MIT/Apache-2.0 |
| quick-error | MIT/Apache-2.0 |
| quick-xml | MIT |
| quote | MIT OR Apache-2.0 |
| r-efi | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| r2d2 | MIT/Apache-2.0 |
| r2d2_sqlite | MIT |
| rand | MIT OR Apache-2.0 |
| rand_chacha | MIT OR Apache-2.0 |
| rand_core | MIT OR Apache-2.0 |
| rand_distr | MIT OR Apache-2.0 |
| raw-window-handle | MIT OR Apache-2.0 OR Zlib |
| rawler | LGPL-2.1 |
| rawpointer | MIT/Apache-2.0 |
| rayon | MIT OR Apache-2.0 |
| rayon-core | MIT OR Apache-2.0 |
| redox_syscall | MIT |
| redox_users | MIT |
| ref-cast | MIT OR Apache-2.0 |
| ref-cast-impl | MIT OR Apache-2.0 |
| regex | MIT OR Apache-2.0 |
| regex-automata | MIT OR Apache-2.0 |
| regex-syntax | MIT OR Apache-2.0 |
| reqwest | MIT OR Apache-2.0 |
| rfd | MIT |
| ring | Apache-2.0 AND ISC |
| rle-decode-fast | MIT OR Apache-2.0 |
| rusqlite | MIT |
| rustc-demangle | MIT/Apache-2.0 |
| rustc-hash | Apache-2.0 OR MIT |
| rustc_version | MIT OR Apache-2.0 |
| rustfft | MIT OR Apache-2.0 |
| rustix | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| rustls | Apache-2.0 OR ISC OR MIT |
| rustls-pki-types | MIT OR Apache-2.0 |
| rustls-webpki | ISC |
| rustversion | MIT OR Apache-2.0 |
| same-file | Unlicense/MIT |
| scan_fmt | MIT |
| scheduled-thread-pool | MIT/Apache-2.0 |
| schemars | MIT |
| schemars_derive | MIT |
| scopeguard | MIT OR Apache-2.0 |
| selectors | MPL-2.0 |
| semver | MIT OR Apache-2.0 |
| serde | MIT OR Apache-2.0 |
| serde-untagged | MIT OR Apache-2.0 |
| serde_core | MIT OR Apache-2.0 |
| serde_derive | MIT OR Apache-2.0 |
| serde_derive_internals | MIT OR Apache-2.0 |
| serde_json | MIT OR Apache-2.0 |
| serde_repr | MIT OR Apache-2.0 |
| serde_spanned | MIT OR Apache-2.0 |
| serde_with | MIT OR Apache-2.0 |
| serde_with_macros | MIT OR Apache-2.0 |
| serialize-to-javascript | MIT OR Apache-2.0 |
| serialize-to-javascript-impl | MIT OR Apache-2.0 |
| servo_arc | MIT OR Apache-2.0 |
| sha2 | MIT OR Apache-2.0 |
| shlex | MIT OR Apache-2.0 |
| signal-hook-registry | MIT OR Apache-2.0 |
| simd-adler32 | MIT |
| siphasher | MIT/Apache-2.0 |
| slab | MIT |
| smallvec | MIT OR Apache-2.0 |
| socket2 | MIT OR Apache-2.0 |
| softbuffer | MIT OR Apache-2.0 |
| soup3 | MIT |
| soup3-sys | MIT |
| stable_deref_trait | MIT OR Apache-2.0 |
| static_assertions | MIT OR Apache-2.0 |
| strength_reduce | MIT OR Apache-2.0 |
| string-interner | MIT/Apache-2.0 |
| string_cache | MIT OR Apache-2.0 |
| string_cache_codegen | MIT OR Apache-2.0 |
| strsim | MIT |
| subtle | BSD-3-Clause |
| swift-rs | MIT OR Apache-2.0 |
| syn | MIT OR Apache-2.0 |
| sync_wrapper | Apache-2.0 |
| synstructure | MIT |
| system-deps | MIT OR Apache-2.0 |
| tao | Apache-2.0 |
| tao-macros | MIT OR Apache-2.0 |
| tar | MIT OR Apache-2.0 |
| target-features | MIT OR Apache-2.0 |
| target-lexicon | Apache-2.0 WITH LLVM-exception |
| tauri | Apache-2.0 OR MIT |
| tauri-build | Apache-2.0 OR MIT |
| tauri-codegen | Apache-2.0 OR MIT |
| tauri-macros | Apache-2.0 OR MIT |
| tauri-plugin | Apache-2.0 OR MIT |
| tauri-plugin-dialog | Apache-2.0 OR MIT |
| tauri-plugin-fs | Apache-2.0 OR MIT |
| tauri-runtime | Apache-2.0 OR MIT |
| tauri-runtime-wry | Apache-2.0 OR MIT |
| tauri-utils | Apache-2.0 OR MIT |
| tauri-winres | MIT |
| tendril | MIT OR Apache-2.0 |
| thiserror | MIT OR Apache-2.0 |
| thiserror-impl | MIT OR Apache-2.0 |
| tiff | MIT |
| time | MIT OR Apache-2.0 |
| time-core | MIT OR Apache-2.0 |
| time-macros | MIT OR Apache-2.0 |
| tinystr | Unicode-3.0 |
| tinyvec | Zlib OR Apache-2.0 OR MIT |
| tinyvec_macros | MIT OR Apache-2.0 OR Zlib |
| tokio | MIT |
| tokio-macros | MIT |
| tokio-util | MIT |
| toml | MIT OR Apache-2.0 |
| toml_datetime | MIT OR Apache-2.0 |
| toml_edit | MIT OR Apache-2.0 |
| toml_parser | MIT OR Apache-2.0 |
| toml_writer | MIT OR Apache-2.0 |
| tower | MIT |
| tower-http | MIT |
| tower-layer | MIT |
| tower-service | MIT |
| tracing | MIT |
| tracing-core | MIT |
| tract-core | MIT OR Apache-2.0 |
| tract-data | MIT OR Apache-2.0 |
| tract-hir | MIT OR Apache-2.0 |
| tract-linalg | MIT OR Apache-2.0 |
| tract-nnef | MIT OR Apache-2.0 |
| tract-onnx | MIT OR Apache-2.0 |
| tract-onnx-opl | MIT OR Apache-2.0 |
| transpose | MIT OR Apache-2.0 |
| tray-icon | MIT OR Apache-2.0 |
| try-lock | MIT |
| ttf-parser | MIT OR Apache-2.0 |
| typeid | MIT OR Apache-2.0 |
| typenum | MIT OR Apache-2.0 |
| ucd-trie | MIT OR Apache-2.0 |
| unic-char-property | MIT/Apache-2.0 |
| unic-char-range | MIT/Apache-2.0 |
| unic-common | MIT/Apache-2.0 |
| unic-ucd-ident | MIT/Apache-2.0 |
| unic-ucd-version | MIT/Apache-2.0 |
| unicode-ident | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-normalization | MIT OR Apache-2.0 |
| unicode-segmentation | MIT OR Apache-2.0 |
| unicode-xid | MIT OR Apache-2.0 |
| untrusted | ISC |
| ureq | MIT OR Apache-2.0 |
| ureq-proto | MIT OR Apache-2.0 |
| url | MIT OR Apache-2.0 |
| urlpattern | MIT |
| utf-8 | MIT OR Apache-2.0 |
| utf8-zero | MIT OR Apache-2.0 |
| utf8_iter | Apache-2.0 OR MIT |
| uuid | Apache-2.0 OR MIT |
| vcpkg | MIT/Apache-2.0 |
| version-compare | MIT |
| version_check | MIT/Apache-2.0 |
| vswhom | MIT |
| vswhom-sys | MIT |
| walkdir | Unlicense/MIT |
| want | MIT |
| wasi | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip2 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip3 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-bindgen | MIT OR Apache-2.0 |
| wasm-bindgen-futures | MIT OR Apache-2.0 |
| wasm-bindgen-macro | MIT OR Apache-2.0 |
| wasm-bindgen-macro-support | MIT OR Apache-2.0 |
| wasm-bindgen-shared | MIT OR Apache-2.0 |
| wasm-encoder | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-metadata | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-streams | MIT OR Apache-2.0 |
| wasmparser | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| web-sys | MIT OR Apache-2.0 |
| web_atoms | MIT OR Apache-2.0 |
| webkit2gtk | MIT |
| webkit2gtk-sys | MIT |
| webpki-roots | CDLA-Permissive-2.0 |
| webview2-com | MIT |
| webview2-com-macros | MIT |
| webview2-com-sys | MIT |
| weezl | MIT OR Apache-2.0 |
| winapi | MIT/Apache-2.0 |
| winapi-i686-pc-windows-gnu | MIT/Apache-2.0 |
| winapi-util | Unlicense OR MIT |
| winapi-x86_64-pc-windows-gnu | MIT/Apache-2.0 |
| window-vibrancy | Apache-2.0 OR MIT |
| windows | MIT OR Apache-2.0 |
| windows-collections | MIT OR Apache-2.0 |
| windows-core | MIT OR Apache-2.0 |
| windows-future | MIT OR Apache-2.0 |
| windows-implement | MIT OR Apache-2.0 |
| windows-interface | MIT OR Apache-2.0 |
| windows-link | MIT OR Apache-2.0 |
| windows-numerics | MIT OR Apache-2.0 |
| windows-result | MIT OR Apache-2.0 |
| windows-strings | MIT OR Apache-2.0 |
| windows-sys | MIT OR Apache-2.0 |
| windows-targets | MIT OR Apache-2.0 |
| windows-threading | MIT OR Apache-2.0 |
| windows-version | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | MIT OR Apache-2.0 |
| windows_aarch64_msvc | MIT OR Apache-2.0 |
| windows_i686_gnu | MIT OR Apache-2.0 |
| windows_i686_gnullvm | MIT OR Apache-2.0 |
| windows_i686_msvc | MIT OR Apache-2.0 |
| windows_x86_64_gnu | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | MIT OR Apache-2.0 |
| windows_x86_64_msvc | MIT OR Apache-2.0 |
| winnow | MIT |
| winreg | MIT |
| wit-bindgen | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-core | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-rust | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-rust-macro | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-component | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-parser | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| writeable | Unicode-3.0 |
| wry | Apache-2.0 OR MIT |
| x11 | MIT |
| x11-dl | MIT |
| xattr | MIT OR Apache-2.0 |
| yoke | Unicode-3.0 |
| yoke-derive | Unicode-3.0 |
| zerocopy | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerocopy-derive | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerofrom | Unicode-3.0 |
| zerofrom-derive | Unicode-3.0 |
| zeroize | Apache-2.0 OR MIT |
| zerotrie | Unicode-3.0 |
| zerovec | Unicode-3.0 |
| zerovec-derive | Unicode-3.0 |
| zmij | MIT |
| zune-core | MIT OR Apache-2.0 OR Zlib |
| zune-inflate | MIT OR Apache-2.0 OR Zlib |
| zune-jpeg | MIT OR Apache-2.0 OR Zlib |
