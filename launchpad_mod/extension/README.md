# A3 Launchpad extension (`A3_LAUNCHPAD_EXT`)

Cross-platform Arma 3 extension for Launchpad: JSON `callExtension` API, async callbacks, TCP IPC to the local Launchpad process, and logging.

## Features

- `healthCheck` for diagnostics and tooling
- Launchpad IPC: `ipcConnect` / `ipcDisconnect` / `ipcSend` (length-prefixed JSON to the Python side); inbound frames surface as `ExtensionCallback` with function name `ipcInbound`
- Async callback-based replies (`functionName|callId|payload` — see `a3-launchpad-ext.cpp` header comment)
- Logging under the extension data directory

## Building

### Requirements

- CMake 3.21+
- C++17 compiler (MSVC, GCC, or Clang), 64-bit only
- Python 3 (optional: `scripts/invoker.py`)

### Build steps

```bash
cd launchpad_mod/extension
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release   # add --config Release on Visual Studio generators
```

Artifacts are copied next to the staged mod folder: `../../A3LaunchPad/A3_LAUNCHPAD_EXT_x64.(dll|so)` (POST_BUILD in `CMakeLists.txt`; PBOs live under `../../A3LaunchPad/mod/addons/`).

On **Linux**, `ctest` in the build directory runs `scripts/smoke_extension.py` against the built `.so` (same checks as [Extension CI](https://github.com/a3r0id/launchpad/actions/workflows/extension-ci.yml) when `launchpad_mod/extension/**` changes).

## Functions (native)

| Name | Data | Notes |
|------|------|--------|
| `healthCheck` | Optional JSON | Echo + runtime / library path fields |
| `ipcConnect` | `{"host":"127.0.0.1","port":8112}` | Starts TCP client + reader |
| `ipcDisconnect` | — | Closes IPC |
| `ipcSend` | Any JSON object | Sends one framed UTF-8 JSON message |

### Call format (from SQF)

`"functionName"` or `"functionName|callId|json..."` — only the first two `|` characters split the header; JSON may contain `|`.

Mission-side handling of `ipcInbound` (payload may contain `|`) is in `a3_launchpad_ext_main` (`fn_init.sqf` / `fn_onIpcInbound.sqf`).

## Testing

```bash
cd launchpad_mod/extension
python scripts/invoker.py "path/to/A3_LAUNCHPAD_EXT_x64.dll" healthCheck '{"client":"invoker"}'
```

## Dependencies

- **nlohmann/json** (CMake FetchContent)
- **ws2_32** (Windows only — sockets for IPC client)

## Logging

Logs are written under the extension data directory (see `classes/Logging.cpp`).

## Project structure

```
launchpad_mod/extension/
├── a3-launchpad-ext.cpp   # RVExtension entry points + dispatch
├── classes/
│   ├── IpcClient.cpp/h    # TCP framed JSON client
│   ├── Logging.cpp/h
│   └── ArmaParser.cpp/h
├── headers/
├── scripts/
│   ├── build.py           # Optional local copy / smoke (edit paths)
│   └── invoker.py
└── CMakeLists.txt
```
