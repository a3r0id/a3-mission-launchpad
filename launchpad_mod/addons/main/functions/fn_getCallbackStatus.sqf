/**
 * Function: A3_LAUNCHPAD_EXT_fnc_getCallbackStatus
 * Description: Checks the status of an async extension call by its ID.
 * Parameters:
 *     _callId: String - The unique call ID returned from A3_LAUNCHPAD_EXT_fnc_asyncCall.
 * Returns:
 *     Array - [completed: Boolean, result: Any, hasCallback: Boolean]
 *             - completed: Whether the callback has been received
 *             - result: The result data (nil if not completed)
 *             - hasCallback: Whether the call ID exists in the callbacks map
 */
params ["_callId"];

if (isNil "a3_launchpad_ext_callbacks") then { a3_launchpad_ext_callbacks = createHashMap; };
if (!(_callId in a3_launchpad_ext_callbacks)) then {
    [false, nil, false]
} else {
    private _callbackData = a3_launchpad_ext_callbacks get _callId;
    private _completed = _callbackData select 2;
    private _result = _callbackData select 1;
    [_completed, _result, true]
}

