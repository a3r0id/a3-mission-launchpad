/**
 * Function: A3_LAUNCHPAD_EXT_fnc_genId
 * Description: Generates a unique ID for a callback.
 * Parameters:
 *     _length: Number - The length of the ID.
 * Returns:
 *     String - The unique ID.
 */
params ["_length"];

private _id = "";
for "_i" from 0 to _length - 1 do {
    _id = _id + selectRandom ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
};
_id
