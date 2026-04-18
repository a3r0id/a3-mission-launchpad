/**
 * Function: A3_LAUNCHPAD_EXT_fnc_call
 * Description: Calls a function on the extension synchronously (blocking) using waitUntil.
 * This will block the current thread until the callback is received.
 * Parameters:
 *     _functionName: String - The name of the function to call (e.g., "healthCheck", "ipcConnect").
 *     _data: Any (optional) - Data to pass to the function. Can be a string, array, or hashmap (will be converted to JSON).
 *     _timeout: Number (optional) - Timeout in seconds. Default: 30 seconds.
 * Returns:
 *     String - The result from the extension, or empty string on timeout/error
 */
params ["_functionName", ["_data", ""], ["_timeout", 30]];

// Generate unique ID for this call
private _callId = [12] call (missionNamespace getVariable "a3_launchpad_ext_main_fnc_genId");

// Store callback in hashmap: [callback_code, result_data, completed_flag]
// For blocking calls, we use a simple marker
a3_launchpad_ext_callbacks set [_callId, [{}, nil, false]];

// Build the function call string
private _functionCall = _functionName;

// Convert data to JSON string if needed
private _dataString = "";
if (_data isEqualType "") then {
    _dataString = _data;
} else {
    // Convert array/hashmap to JSON string
    if (_data isEqualType [] || _data isEqualType createHashMap) then {
        _dataString = str _data;
    } else {
        _dataString = str _data;
    }
};

// Build call string: "functionName|id|data" or "functionName|id" if no data
if (_dataString != "") then {
    _functionCall = format["%1|%2|%3", _functionName, _callId, _dataString];
} else {
    _functionCall = format["%1|%2", _functionName, _callId];
};

// Call extension asynchronously
"A3_LAUNCHPAD_EXT" callExtension _functionCall;

// Wait for callback to complete (blocking)
private _startTime = diag_tickTime;
private _result = "";
private _timedOut = false;
waitUntil {
    if (!(_callId in a3_launchpad_ext_callbacks)) then {
        // Callback was removed (shouldn't happen, but handle it)
        _timedOut = true;
        true
    } else {
        private _callbackData = a3_launchpad_ext_callbacks get _callId;
        private _completed = _callbackData select 2;
        
        if (_completed) then {
            _result = _callbackData select 1;
            if (isNil "_result") then { _result = ""; };
            true
        } else {
            // Check timeout
            _timedOut = (diag_tickTime - _startTime) > _timeout;
            _timedOut
        };
    };
};

// Clean up
a3_launchpad_ext_callbacks deleteAt _callId;

// Return result (empty string if timeout)
_result

