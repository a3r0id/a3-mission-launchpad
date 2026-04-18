/**
	Cross-platform tool to connect with the Arma 3 runtime process (BattleEye disabled - intended for development use only).

	Note:
	- I'm attempting to grab the arma 3 window and pull it into our Launchpad window, similar to Arma Reforger's Enfusion workbench.
	- Mem dump stuff is just experimental for now.

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
*/

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

static void logError(const std::string& msg) { std::cerr << msg << '\n'; }
static void logInfo(const std::string& msg) { std::cout << msg << '\n'; }

static std::mutex g_Mutex;

[[maybe_unused]] static bool writeJsonToFile(const std::string& filePath, const json& j) {
	std::lock_guard<std::mutex> lock(g_Mutex);
	try {
		std::filesystem::path p(filePath);
		if (!p.parent_path().empty() && !std::filesystem::exists(p.parent_path()))
			std::filesystem::create_directories(p.parent_path());
	} catch (const std::filesystem::filesystem_error& e) {
		logError("Failed to create directory for: " + filePath + " - " + e.what());
		return false;
	}
	std::ofstream f(filePath);
	if (!f.is_open()) {
		logError("Failed to open file for writing: " + filePath);
		return false;
	}
	f << j.dump(2);
	return true;
}

static void printHelp() {
	std::cout
	    << "a3hook (development only)\n"
	    << "  -h, --help              Show this help\n"
	    << "  <pid> memdump <file>    Write a minidump (.dmp). Windows: dbghelp. Optional env A3HOOK_FULL_MINIDUMP=1 for full memory (large file).\n"
		<< "  <pid> attach <ownPid>   Reparent the target main window into the owner main window (Windows; alias: hijack).\n"
	    << "\n"
	    << "Attach hints (borderless / ignored launcher window mode is common):\n"
	    << "  A3HOOK_LIST_WINDOWS=1   Log top-level HWNDs for each PID before picking.\n"
	    << "  A3HOOK_TARGET_HWND=0x..  Force target HWND (must belong to target PID).\n"
	    << "  A3HOOK_OWNER_HWND=0x..   Force owner host HWND (must belong to owner PID).\n";
}

static bool parsePid(const char* s, unsigned long& outPid) {
	if (!s || !*s) {
		return false;
	}
	char* end = nullptr;
	unsigned long v = std::strtoul(s, &end, 10);
	if (end == s || *end != '\0' || v == 0) {
		return false;
	}
	outPid = v;
	return true;
}

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <Windows.h>
#include <DbgHelp.h>
#include <TlHelp32.h>

#pragma comment(lib, "Dbghelp.lib")

static std::string winLastErrorString(const char* context) {
	const DWORD err = GetLastError();
	char buf[512];
	if (FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, err, 0, buf,
	        static_cast<DWORD>(sizeof(buf)), nullptr)) {
		return std::string(context) + " (Windows error " + std::to_string(err) + "): " + buf;
	}
	return std::string(context) + " (Windows error " + std::to_string(err) + ")";
}

/** Optional override: decimal or 0x hex, e.g. A3HOOK_TARGET_HWND=0x1A04B2 */
static HWND hwndFromEnvVar(const char* name) {
	const char* s = std::getenv(name);
	if (!s || !*s) {
		return nullptr;
	}
	char* end = nullptr;
	const unsigned long long v = std::strtoull(s, &end, 0);
	if (end == s || *end != '\0') {
		return nullptr;
	}
	if (v == 0) {
		return nullptr;
	}
	return reinterpret_cast<HWND>(static_cast<uintptr_t>(v));
}

static bool isTopLevelWin32Window(HWND hwnd) {
	return (GetWindowLongPtr(hwnd, GWL_STYLE) & WS_CHILD) == 0;
}

static std::string hwndToHex(HWND hwnd) {
	char buf[24];
	std::snprintf(buf, sizeof(buf), "0x%llX", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)));
	return std::string(buf);
}

static void logOneWindowLine(DWORD wantPid, HWND hwnd) {
	DWORD wpid = 0;
	GetWindowThreadProcessId(hwnd, &wpid);
	if (wpid != wantPid) {
		return;
	}
	char title[280]{};
	char cls[280]{};
	GetWindowTextA(hwnd, title, static_cast<int>(sizeof(title) - 1));
	GetClassNameA(hwnd, cls, static_cast<int>(sizeof(cls) - 1));
	RECT r{};
	GetWindowRect(hwnd, &r);
	const LONG_PTR st = GetWindowLongPtr(hwnd, GWL_STYLE);
	const LONG_PTR ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
	const BOOL vis = IsWindowVisible(hwnd);
	HWND owner = GetWindow(hwnd, GW_OWNER);
	HWND parent = GetParent(hwnd);
	const long area = static_cast<long>(r.right - r.left) * static_cast<long>(r.bottom - r.top);
	logInfo("  HWND=" + hwndToHex(hwnd) + " top=" + std::to_string(isTopLevelWin32Window(hwnd) ? 1 : 0) + " parent=" + hwndToHex(parent)
	        + " vis=" + std::to_string(vis) + " ws_vis=" + std::to_string((st & WS_VISIBLE) ? 1 : 0) + " area=" + std::to_string(area)
	        + " owner=" + std::to_string(owner != nullptr) + " tool=" + std::to_string((ex & WS_EX_TOOLWINDOW) != 0) + " class=\"" + cls
	        + "\" text=\"" + title + "\"");
}

struct DebugLogTreeCtx {
	DWORD pid = 0;
};

static BOOL CALLBACK enumDesktopTreeForLog(HWND hwnd, LPARAM lp) {
	auto* ctx = reinterpret_cast<DebugLogTreeCtx*>(lp);
	logOneWindowLine(ctx->pid, hwnd);
	EnumChildWindows(hwnd, enumDesktopTreeForLog, lp);
	return TRUE;
}

static void debugLogAllWindowsForPid(DWORD pid) {
	logInfo("--- All HWNDs under desktop tree for PID " + std::to_string(pid) + " (A3HOOK_LIST_WINDOWS) ---");
	DebugLogTreeCtx ctx;
	ctx.pid = pid;
	EnumChildWindows(GetDesktopWindow(), enumDesktopTreeForLog, reinterpret_cast<LPARAM>(&ctx));
}

struct PickLargestWindow {
	DWORD pid = 0;
	bool skipToolWindow = false;
	bool skipOwnedTopLevel = false;
	bool requireIsWindowVisible = true;
	HWND best = nullptr;
	LONG bestArea = -1;

	void consider(HWND hwnd) {
		DWORD wpid = 0;
		GetWindowThreadProcessId(hwnd, &wpid);
		if (wpid != pid) {
			return;
		}
		const BOOL iwv = IsWindowVisible(hwnd);
		if (requireIsWindowVisible && !iwv) {
			return;
		}
		if (!requireIsWindowVisible && !iwv) {
			const LONG_PTR st = GetWindowLongPtr(hwnd, GWL_STYLE);
			if (!(st & WS_VISIBLE)) {
				return;
			}
		}
		// Owned *top-level* only; children often have no owner and must not be filtered out.
		if (skipOwnedTopLevel && isTopLevelWin32Window(hwnd) && GetWindow(hwnd, GW_OWNER) != nullptr) {
			return;
		}
		if (skipToolWindow) {
			const LONG_PTR ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
			if (ex & WS_EX_TOOLWINDOW) {
				return;
			}
		}
		RECT r{};
		if (!GetWindowRect(hwnd, &r)) {
			return;
		}
		const LONG w = r.right - r.left;
		const LONG h = r.bottom - r.top;
		if (w < 8 || h < 8) {
			return;
		}
		const long long area64 = static_cast<long long>(w) * static_cast<long long>(h);
		const LONG area = area64 > INT_MAX ? INT_MAX : static_cast<LONG>(area64);
		if (area > bestArea) {
			bestArea = area;
			best = hwnd;
		}
	}

	static BOOL CALLBACK enumProc(HWND hwnd, LPARAM lp) {
		reinterpret_cast<PickLargestWindow*>(lp)->consider(hwnd);
		return TRUE;
	}

	/** Depth-first: every HWND under the desktop (captures render HWNDs that are not top-level). */
	static BOOL CALLBACK enumDesktopSubtree(HWND hwnd, LPARAM lp) {
		PickLargestWindow* pick = reinterpret_cast<PickLargestWindow*>(lp);
		pick->consider(hwnd);
		EnumChildWindows(hwnd, enumDesktopSubtree, lp);
		return TRUE;
	}
};

struct ThreadPickLargest {
	DWORD pid = 0;
	HWND best = nullptr;
	LONG bestArea = -1;
	bool requireStyleVisible = true;

	void consider(HWND hwnd) {
		DWORD wpid = 0;
		GetWindowThreadProcessId(hwnd, &wpid);
		if (wpid != pid) {
			return;
		}
		const LONG_PTR st = GetWindowLongPtr(hwnd, GWL_STYLE);
		if (requireStyleVisible && !(st & WS_VISIBLE)) {
			return;
		}
		RECT r{};
		if (!GetWindowRect(hwnd, &r)) {
			return;
		}
		const LONG w = r.right - r.left;
		const LONG h = r.bottom - r.top;
		const LONG minDim = requireStyleVisible ? 32 : 64;
		if (w < minDim || h < minDim) {
			return;
		}
		const long long area64 = static_cast<long long>(w) * static_cast<long long>(h);
		const LONG area = area64 > INT_MAX ? INT_MAX : static_cast<LONG>(area64);
		if (area > bestArea) {
			bestArea = area;
			best = hwnd;
		}
	}

	static BOOL CALLBACK enumThreadWnd(HWND hwnd, LPARAM lp) {
		reinterpret_cast<ThreadPickLargest*>(lp)->consider(hwnd);
		return TRUE;
	}
};

static HWND findLargestWindowViaThreadEnumeration(DWORD pid) {
	ThreadPickLargest acc;
	acc.pid = pid;
	const HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
	if (snap == INVALID_HANDLE_VALUE) {
		return nullptr;
	}
	THREADENTRY32 te{};
	te.dwSize = sizeof(te);
	if (Thread32First(snap, &te)) {
		do {
			if (te.th32OwnerProcessID != pid) {
				continue;
			}
			EnumThreadWindows(te.th32ThreadID, ThreadPickLargest::enumThreadWnd, reinterpret_cast<LPARAM>(&acc));
		} while (Thread32Next(snap, &te));
	}
	CloseHandle(snap);
	return acc.best;
}

static HWND findLargestWindowViaThreadEnumerationLoose(DWORD pid) {
	ThreadPickLargest acc;
	acc.pid = pid;
	acc.requireStyleVisible = false;
	const HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
	if (snap == INVALID_HANDLE_VALUE) {
		return nullptr;
	}
	THREADENTRY32 te{};
	te.dwSize = sizeof(te);
	if (Thread32First(snap, &te)) {
		do {
			if (te.th32OwnerProcessID != pid) {
				continue;
			}
			EnumThreadWindows(te.th32ThreadID, ThreadPickLargest::enumThreadWnd, reinterpret_cast<LPARAM>(&acc));
		} while (Thread32Next(snap, &te));
	}
	CloseHandle(snap);
	return acc.best;
}

/**
 * Borderless / "fullscreen" titles often use WS_EX_TOOLWINDOW; some setups never report
 * IsWindowVisible() the same as windowed mode. Try progressively looser rules, then per-thread HWNDs.
 * Full desktop subtree search finds HWNDs that are not top-level (common for some D3D paths).
 */
static HWND findHostableWindowForProcess(DWORD pid) {
	if (const char* dbg = std::getenv("A3HOOK_LIST_WINDOWS"); dbg && dbg[0] == '1' && dbg[1] == '\0') {
		debugLogAllWindowsForPid(pid);
	}

	static const struct {
		bool skipTool;
		bool skipOwned;
		bool reqIsWinVis;
	} passes[] = {
	    // Strict (classic windowed)
	    {true, true, true},
	    // Borderless desktop / many "fullscreen windowed" builds use WS_EX_TOOLWINDOW
	    {false, true, true},
	    // Owned top-level (launcher / shell relationships)
	    {false, false, true},
	    // Exclusive fullscreen: sometimes WS_VISIBLE without IsWindowVisible
	    {false, false, false},
	};

	for (const auto& p : passes) {
		PickLargestWindow pick;
		pick.pid = pid;
		pick.skipToolWindow = p.skipTool;
		pick.skipOwnedTopLevel = p.skipOwned;
		pick.requireIsWindowVisible = p.reqIsWinVis;
		EnumWindows(PickLargestWindow::enumProc, reinterpret_cast<LPARAM>(&pick));
		if (!pick.best) {
			EnumChildWindows(GetDesktopWindow(), PickLargestWindow::enumDesktopSubtree, reinterpret_cast<LPARAM>(&pick));
		}
		if (pick.best) {
			return pick.best;
		}
	}

	if (HWND w = findLargestWindowViaThreadEnumeration(pid)) {
		return w;
	}
	if (HWND w = findLargestWindowViaThreadEnumerationLoose(pid)) {
		return w;
	}
	return nullptr;
}

static HWND resolveTargetWindow(DWORD pid) {
	if (HWND forced = hwndFromEnvVar("A3HOOK_TARGET_HWND")) {
		DWORD wpid = 0;
		GetWindowThreadProcessId(forced, &wpid);
		if (wpid != pid) {
			logError("A3HOOK_TARGET_HWND does not belong to the target PID.");
			return nullptr;
		}
		logInfo("Using A3HOOK_TARGET_HWND override.");
		return forced;
	}
	return findHostableWindowForProcess(pid);
}

static HWND resolveOwnerWindow(DWORD pid) {
	if (HWND forced = hwndFromEnvVar("A3HOOK_OWNER_HWND")) {
		DWORD wpid = 0;
		GetWindowThreadProcessId(forced, &wpid);
		if (wpid != pid) {
			logError("A3HOOK_OWNER_HWND does not belong to the owner PID.");
			return nullptr;
		}
		logInfo("Using A3HOOK_OWNER_HWND override.");
		return forced;
	}
	return findHostableWindowForProcess(pid);
}

static MINIDUMP_TYPE minidumpTypeFromEnv() {
	MINIDUMP_TYPE t = static_cast<MINIDUMP_TYPE>(
	    MiniDumpWithPrivateReadWriteMemory | MiniDumpWithDataSegs | MiniDumpWithHandleData | MiniDumpWithThreadInfo
	    | MiniDumpWithUnloadedModules | MiniDumpWithFullMemoryInfo | MiniDumpWithProcessThreadData);
	const char* full = std::getenv("A3HOOK_FULL_MINIDUMP");
	if (full && full[0] == '1' && full[1] == '\0') {
		t = static_cast<MINIDUMP_TYPE>(t | MiniDumpWithFullMemory);
		logInfo("A3HOOK_FULL_MINIDUMP=1: including MiniDumpWithFullMemory (file may be very large).");
	}
	return t;
}

static bool writeMemoryMinidump(unsigned long pid, const std::filesystem::path& outPath) {
	const DWORD access = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ;
	HANDLE hProcess = OpenProcess(access, FALSE, static_cast<DWORD>(pid));
	if (!hProcess) {
		logError("OpenProcess failed: " + winLastErrorString("memdump"));
		logInfo("Tip: run from an elevated shell if the target is protected, or use the same user session.");
		return false;
	}

	std::error_code ec;
	std::filesystem::create_directories(outPath.parent_path(), ec);

	const std::wstring wnative = outPath.wstring();
	HANDLE hFile = CreateFileW(wnative.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
	if (hFile == INVALID_HANDLE_VALUE) {
		logError("CreateFileW failed: " + winLastErrorString(outPath.string().c_str()));
		CloseHandle(hProcess);
		return false;
	}

	const MINIDUMP_TYPE dumpType = minidumpTypeFromEnv();
	const BOOL ok = MiniDumpWriteDump(hProcess, static_cast<DWORD>(pid), hFile, dumpType, nullptr, nullptr, nullptr);
	if (!ok) {
		logError("MiniDumpWriteDump failed: " + winLastErrorString("memdump"));
		CloseHandle(hFile);
		CloseHandle(hProcess);
		return false;
	}
	CloseHandle(hFile);
	CloseHandle(hProcess);
	logInfo("Wrote minidump: " + outPath.string());
	return true;
}

static bool attachWindow(unsigned long targetPid, unsigned long ownerPid) {
	if (targetPid == ownerPid) {
		logError("attach: target and owner PIDs need to be different.");
		return false;
	}

	HWND targetHw = resolveTargetWindow(static_cast<DWORD>(targetPid));
	HWND parentHw = resolveOwnerWindow(static_cast<DWORD>(ownerPid));
	if (!targetHw) {
		logError("Couldn't find a suitable window for target PID " + std::to_string(targetPid) + ".");
		logInfo("Confirm the PID is the game (e.g. arma3_x64.exe), not a launcher. "
		        "Try A3HOOK_LIST_WINDOWS=1 for a full HWND list, or A3HOOK_TARGET_HWND=0x...");
		return false;
	}
	if (!parentHw) {
		logError("Couldn't find a suitable window for owner PID " + std::to_string(ownerPid) + ".");
		logInfo("Try: A3HOOK_OWNER_HWND=0x... for the host window.");
		return false;
	}

	// Reparent: make target a child of owner's main window; adjust style so layout is consistent.
	SetLastError(0);
	const LONG_PTR styleRaw = GetWindowLongPtr(targetHw, GWL_STYLE);
	if (styleRaw == 0 && GetLastError() != 0) {
		logError("GetWindowLongPtr(GWL_STYLE) failed: " + winLastErrorString("hijack"));
		return false;
	}
	LONG_PTR style = styleRaw;
	style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
	style |= WS_CHILD | WS_VISIBLE;
	if (!SetWindowLongPtr(targetHw, GWL_STYLE, style)) {
		logError("SetWindowLongPtr failed: " + winLastErrorString("hijack"));
		return false;
	}

	if (!SetParent(targetHw, parentHw)) {
		logError("SetParent failed: " + winLastErrorString("hijack"));
		return false;
	}

	RECT client{};
	GetClientRect(parentHw, &client);
	const int width = client.right - client.left;
	const int height = client.bottom - client.top;
	SetWindowPos(targetHw, nullptr, 0, 0, width, height, SWP_NOZORDER | SWP_FRAMECHANGED);
	ShowWindow(targetHw, SW_SHOW);

	logInfo("Attached target window to owner. Resize the owner window manually if needed.");
	return true;
}

#else

static bool writeMemoryMinidump(unsigned long pid, const std::filesystem::path& outPath) {
	(void)pid;
	(void)outPath;
	logError("memdump is only implemented on Windows (minidump via dbghelp).");
	return false;
}

static bool attachWindow(unsigned long targetPid, unsigned long ownerPid) {
	(void)targetPid;
	(void)ownerPid;
	logError("attach is only implemented on Windows.");
	return false;
}

#endif

int main(int argc, char** argv) {
	if (argc <= 1) {
		printHelp();
		return 1;
	}
	const std::string a1(argv[1]);
	if (a1 == "-h" || a1 == "--help") {
		printHelp();
		return 0;
	}

	if (argc < 4) {
		logError("Not enough arguments. Use -h or --help.");
		return 2;
	}

	unsigned long targetPid = 0;
	if (!parsePid(argv[1], targetPid)) {
		logError("Invalid process id: " + std::string(argv[1]));
		return 2;
	}

	const std::string cmd(argv[2]);
	if (cmd == "memdump") {
		const std::filesystem::path outPath(argv[3]);
		return writeMemoryMinidump(targetPid, outPath) ? 0 : 3;
	}
	if (cmd == "attach" || cmd == "hijack") {
		unsigned long ownerPid = 0;
		if (!parsePid(argv[3], ownerPid)) {
			logError("Invalid owner process id: " + std::string(argv[3]));
			return 2;
		}
		return attachWindow(targetPid, ownerPid) ? 0 : 3;
	}

	logError("Unrecognized subcommand: " + cmd);
	return 3;
}
