/**
 * Inbound framed JSON from the Launchpad IPC socket (Python). Extension invokes ExtensionCallback with function name "ipcInbound".
 * Payload is raw JSON and may contain "|" characters, so routing happens before the generic id|result split in fn_init.
 */
params ["_json"];

diag_log format ["[A3_LAUNCHPAD_EXT] ipcInbound: %1", _json];

