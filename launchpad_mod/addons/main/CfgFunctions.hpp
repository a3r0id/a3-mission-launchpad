class CfgFunctions {
    class a3_launchpad_ext_main {
        // file = "\z\a3_launchpad_ext\addons\main\functions";
        class init {
            file = "\z\a3_launchpad_ext\addons\main\functions\fn_init.sqf";
            postInit = 1;
        };
        class genId {
            file = "\z\a3_launchpad_ext\addons\main\functions\fn_genId.sqf";
        };
        class call {
            file = "\z\a3_launchpad_ext\addons\main\functions\fn_call.sqf";
        };
        class asyncCall {
            file = "\z\a3_launchpad_ext\addons\main\functions\fn_asyncCall.sqf";
        };
        class getCallbackStatus {
            file = "\z\a3_launchpad_ext\addons\main\functions\fn_getCallbackStatus.sqf";
        };
        class onIpcInbound {
            file = "\z\a3_launchpad_ext\addons\main\functions\fn_onIpcInbound.sqf";
        };
    };
};
