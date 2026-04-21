a3_launchpad_ext_callbacks = createHashMap; // Format: [id, [callback_code, result_data, completed]]

// If we are in multiplayer and not the server, exit
if (isMultiplayer && !isServer) exitWith {};

// Connect extension to Launchpad's debug socket (Launchpad listens; extension is the TCP client).
// Defaults match launchpad_client DEBUG_SOCKET_DEFAULT_HOST / DEBUG_SOCKET_DEFAULT_PORT.
systemChat "Connecting extension to Launchpad's debug socket...";
private _fnCall = missionNamespace getVariable "a3_launchpad_ext_main_fnc_call";
if (!isNil "_fnCall") then {
    diag_log format ["Calling ipcConnect with fnCall: %1", str _fnCall];
    private _ipcPayload = "{""host"":""127.0.0.1"",""port"":8112}";
    diag_log format ["Calling ipcConnect with ipcPayload: %1", str _ipcPayload];
    private _connectResult = ["ipcConnect", _ipcPayload, 8] call _fnCall;
    diag_log format ["connectResult: %1", str _connectResult];
    if (_connectResult isEqualTo "") then {
        diag_log "[A3_LAUNCHPAD_EXT] ipcConnect timed out or empty; start the debug connection in Launchpad if you need it.";
    } else {
        if (_connectResult find "true" < 0 || _connectResult find "ok" < 0) then {
            diag_log format ["[A3_LAUNCHPAD_EXT] ipcConnect: %1", _connectResult];
        };
    };
} else {
    diag_log "fnCall is nil, so we can't connect to the debug socket";
};
