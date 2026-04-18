a3_launchpad_ext_callbacks = createHashMap; // Format: [id, [callback_code, result_data, completed]]

// Handle extension callbacks
addMissionEventHandler ["ExtensionCallback", {
    params ["_extension", "_function", "_resultData"];
    if (_extension != "A3_LAUNCHPAD_EXT" || !isServer) exitWith {};

    if (_function == "ipcInbound") exitWith {
        [_resultData] call (missionNamespace getVariable "a3_launchpad_ext_main_fnc_onIpcInbound");
    };

    private _callId = "";
    private _result = _resultData;

    private _delimiterIndex = _resultData find "|";
    if (_delimiterIndex != -1) then {
        _callId = _resultData select [0, _delimiterIndex];
        _result = _resultData select [_delimiterIndex + 1];
    };

    if (_callId != "" && _callId in a3_launchpad_ext_callbacks) then {
        private _callbackData = a3_launchpad_ext_callbacks get _callId;
        _callbackData set [1, _result];
        _callbackData set [2, true];

        private _callbackCode = _callbackData select 0;
        if (!isNil "_callbackCode" && {typeName _callbackCode == "CODE"}) then {
            [_result] call _callbackCode;
        };
    }
}];

// Simple example of callback registration
/**
private _myUniqueId = "myUniqueId";
a3_launchpad_ext_callbacks set [_myUniqueId, [
    {
        params ["_result"];
        diag_log format ["Callback result: %1", _result];
    },
    "",
    false
]];
 */
