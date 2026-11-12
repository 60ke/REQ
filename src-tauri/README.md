# Native HTTP backend

Req uses Tauri 2 and Rust `reqwest` for real desktop HTTP requests. Nothing runs through a hosted relay. Request content is not sent to any service other than the URL the user sends it to. The HTTP stack respects standard system proxy environment variables. There is no analytics or account service.

## Build and test

Install the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), Rust, and the frontend dependencies. From the repository root:

```sh
npm install
npm run tauri dev
npm run tauri build
```

The native core deliberately compiles without GTK/WebKit desktop libraries. Run Rust unit and loopback HTTP integration tests with:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The `desktop` Cargo feature is enabled by `tauri.conf.json` when running through the Tauri CLI. Native builds require the platform-specific prerequisites. This environment initially had no `cargo` or `rustc`; native compilation must not be claimed without running these checks on a Rust-equipped machine.

## Command contract

- `execute_request({ request, environment })`: send one request. `environment` is a map of string keys to string values. Repeated in-flight IDs are rejected. HTTP error status codes return normal response objects.
- `cancel_request({ requestId })`: stop an active request and discard its partial response. Returns whether it was active.
- `import_curl({ curl })`: parse a single command. It never invokes a shell, expands shell expressions, or reads files.
- `export_curl({ request, environment })`: return a shell-quoted command. This explicit export resolves variables and can contain credentials. Treat the result as sensitive.
- `load_workspace()`: load local workspace JSON, or `null` if it does not exist.
- `save_workspace({ workspace })`: atomically persist a workspace object. Returns `{ saved: true, redactedFields: number }`.

Request and response types live in `src/model.rs`. All JSON field names use camelCase. Interpolation is one-pass `{{ variable }}` substitution. Missing values are errors; disabled rows are ignored. Query rows are URL-encoded and appended to existing query parameters.

## Security and honest limitations

- HTTP and HTTPS only. TLS certificates are always verified. Request URLs containing embedded credentials are rejected. Localhost/private-network APIs are intentionally supported; this is a desktop developer tool, not a hosted proxy.
- Redirects are off by default. When enabled, at most five same-origin redirects are followed. Cross-origin redirects return the original 3xx response so user-supplied headers and API keys are not leaked. cURL export uses cURL's normal redirect semantics, which differ.
- A request times out after 30 seconds by default, with an absolute maximum of five minutes and a maximum connection wait of ten seconds. Response and request bodies are capped at 10 MiB. A truncated response is explicitly marked; size means captured decompressed bytes, not wire bytes. Timing is total elapsed time, not DNS/TLS breakdown.
- Response bodies are shown as UTF-8 text with replacement characters for invalid bytes. There is no binary-download or charset decoding support yet. SSE/streaming responses are accumulated until completion, cancellation, timeout, or the size cap.
- Workspace data is stored in the OS app-data directory as `workspace.json`, using atomic replacement. On Unix the directory is mode 0700 and the file is mode 0600. This is **not encrypted** and there is **no OS keychain integration**.
- Literal bearer tokens, passwords, API-key values, known credential headers/query parameters, and secret-marked or credential-named environment values are excluded from persistence. `{{variable}}` references are retained. Credentials are session-only and need to be entered again after restarting.
- Request bodies and arbitrary field names can contain secrets that automatic filtering cannot recognize. Do not save sensitive body data; filtering is defense in depth, not a guarantee of secret detection. The frontend stores history metadata and request definitions, never response bodies.
- cURL supports common request, header, body, auth, query, timeout, and redirect options. Unknown options are rejected instead of silently ignored. File uploads, multipart, certificates, cookie jars, proxy options, `.curlrc`, and shell expansion are unsupported. Import is not a byte-perfect interpreter for every cURL combination.
- No OAuth browser flow, client certificates, WebSocket, gRPC, managed cookies, automatic retry, certificate bypass, code execution, or cloud AI provider is included in this version.

Cancellation cannot undo an HTTP request already received by the server. Sending a mutating request twice can have side effects even if the first is cancelled.
