## Cross-platform tool to connect with the Arma 3 runtime process (BattleEye disabled - intended for development use only).

Note:
- I'm attempting to grab the arma 3 window and pull it into our Launchpad window, similar to Arma Reforger's Enfusion workbench.
- Mem dump stuff is just experimental for now.

```bash
Usage: ./a3hook -h or ./a3hook --help
Flags Examples:
    - General:
        -h, --help: Show help message and exit

    - Memory Dump:
        memdump: Write a minidump (.dmp) of the process (Windows: dbghelp). Set A3HOOK_FULL_MINIDUMP=1 for MiniDumpWithFullMemory (very large).
        Example: ./a3hook {arma 3 process id} memdump {output file path}

    - Attach Window:
        attach: Reparent the target's largest visible top-level window into the owner process's main window (SetParent). Windows only.
        Example: ./a3hook {arma 3 process id} attach {our process id}
```