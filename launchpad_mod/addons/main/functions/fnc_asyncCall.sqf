/**
 * Function: A3_LAUNCHPAD_EXT_fnc_asyncCall
 * Description: Calls a function on the extension asynchronously with a unique ID for callback coordination.
 * Parameters:
 *     _functionName: String - The name of the function to call (e.g., "healthCheck", "ipcConnect").
 *     _data: Any (optional) - Data to pass to the function. Can be a string, array, or hashmap (will be converted to JSON).
 *     _callback: Code - The code to execute when the function returns. Receives the result as parameter: [_result] call _callback.
 * Returns:
 *     String - The unique call ID (can be used to check status or cancel)
 */
params ["_functionName", ["_data", ""], ["_callback", {}]];

// Ensure callbacks map exists (in case fn_asyncCall runs before A3_LAUNCHPAD_EXT_fnc_init)
if (isNil "a3_launchpad_ext_callbacks") then { a3_launchpad_ext_callbacks = createHashMap; };

// Generate unique ID for this call
private _callId = [12] call (missionNamespace getVariable "a3_launchpad_ext_main_fnc_genId");

// Store callback in hashmap: [callback_code, result_data, completed_flag]
a3_launchpad_ext_callbacks set [_callId, [_callback, nil, false]];

// Build the function call string
private _functionCall = _functionName;

// Convert data to JSON string if needed
private _dataString = "";
if (_data isEqualType "") then {
    _dataString = _data;
} else {
    // Convert array/hashmap to JSON string
    if (_data isEqualType [] || _data isEqualType createHashMap) then {
        // Use str to convert, which will create a proper representation
        // For proper JSON, you might want to use a JSON library, but str works for simple cases
        _dataString = str _data;
        // Remove leading/trailing brackets/braces if needed for JSON compatibility
        if (_dataString find "[[" == 0) then {
            // It's already a string representation, use as-is
        };
    } else {
        _dataString = str _data;
    };
};

// Build call string: "functionName|id|data" or "functionName|id" if no data
if (_dataString != "") then {
    _functionCall = format["%1|%2|%3", _functionName, _callId, _dataString];
} else {
    _functionCall = format["%1|%2", _functionName, _callId];
};

// Call extension asynchronously (returns immediately)
"A3_LAUNCHPAD_EXT" callExtension _functionCall;

// Return the call ID for tracking
_callId
