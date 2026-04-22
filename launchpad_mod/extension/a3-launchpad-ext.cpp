/**
	Cross-platform Arma 3 extension for the Arma 3 Launchpad Project.

	Native call format (from Arma): functionName|uid|{"json":"data"}
	- functionName: required
	- uid: optional, used for callback correlation (e.g. 12-char alphanumeric)
	- data: optional JSON string; may contain '|' (only first two delimiters are split)

	Baked-in functions:
	- healthCheck (echoes JSON payload + returns runtime/library info)
	- ipcConnect (JSON: host, port) — TCP client to Launchpad; inbound frames invoke ExtensionCallback as function "ipcInbound"
	- ipcDisconnect
	- ipcSend (JSON object) — length-prefixed UTF-8 JSON frame to server
*/

#include <iostream>
#include <fstream>
#include <string>
#include <cstring>
#include <algorithm>
#include <functional>
#include <sstream>
#include <thread>
#include <chrono>
#include <mutex>
#include <cstdlib>
#include <ctime>
#ifndef _WIN32
#include <unistd.h> // getpid
#endif
#include <filesystem>
#include "headers/RVExtensionUtil.h"
#include "classes/ArmaParser.h"
#include "classes/Logging.h"
#include "classes/IpcClient.h"
#include <nlohmann/json.hpp>
#include <atomic>
using json = nlohmann::json;

const char* EXTENSION_NAME = "A3_LAUNCHPAD_EXT";
const char* EXTENSION_VERSION = "0.0.1";
const char* DELIMITER = "|";

static std::atomic<uint64_t> g_totalCalls{0};
static std::mutex g_Mutex;

/** Write JSON to a file (thread-safe). Creates parent directory if needed. Returns true on success. */
static bool writeJsonToFile(const std::string& filePath, const json& j) {
	std::lock_guard<std::mutex> lock(g_Mutex);
	try {
		std::filesystem::path p(filePath);
		if (!p.parent_path().empty() && !std::filesystem::exists(p.parent_path()))
			std::filesystem::create_directories(p.parent_path());
	} catch (const std::filesystem::filesystem_error& e) {
		Logging::logError(("Failed to create directory for: " + filePath + " - " + e.what()).c_str());
		return false;
	}
	std::ofstream f(filePath);
	if (!f.is_open()) {
		Logging::logError(("Failed to open file for writing: " + filePath).c_str());
		return false;
	}
	f << j.dump(2);
	return true;
}

void CALL_CONVENTION RVExtensionVersion(char* output, unsigned int outputSize) {
	std::string version = EXTENSION_NAME + std::string(" v") + EXTENSION_VERSION;
	if (outputSize > 0) {
		size_t copyLen = std::min<size_t>(version.length(), static_cast<size_t>(outputSize - 1));
		std::copy_n(version.c_str(), copyLen, output);
		output[copyLen] = '\0';
	}
};

RVExtensionCallbackProc* callbackPtr = nullptr;
void CALL_CONVENTION RVExtensionRegisterCallback(RVExtensionCallbackProc* callbackProc)
{
	callbackPtr = callbackProc;
}

void CALL_CONVENTION RVExtension(char* output, unsigned int outputSize, const char* function)
{
	if (!callbackPtr)
		return;

	// Capture function in a local string to ensure its lifetime
	std::string fnc(function);
	// Start a new thread to handle the function
	std::thread([fnc]() {
		const auto callNumber = ++g_totalCalls;
		auto startTime = std::chrono::steady_clock::now();

		Logging::logDebug((std::string("[INCOMING] #") + std::to_string(callNumber) + " raw=\"" + fnc + "\"").c_str());

		std::string functionName = "";
		std::string callId = "";
		std::string data = "";
		json dataParsed;

		// Native call format: functionName|uid|{"json":"data"}
		// Split only on first two delimiters so JSON payload can contain '|'
		const char delim = DELIMITER[0];
		size_t first = fnc.find(delim);
		if (first == std::string::npos) {
			functionName = fnc;
		} else {
			functionName = fnc.substr(0, first);
			size_t second = fnc.find(delim, first + 1);
			if (second == std::string::npos) {
				// functionName|second — either uid (no data) or raw data (no uid)
				std::string secondPart = fnc.substr(first + 1);
				bool looksLikeId = secondPart.length() >= 8 && secondPart.length() <= 20 &&
					secondPart.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") == std::string::npos;
				if (looksLikeId)
					callId = secondPart;
				else
					data = secondPart;
			} else {
				// functionName|uid|data — data is everything after second delimiter
				callId = fnc.substr(first + 1, second - (first + 1));
				data = fnc.substr(second + 1);
			}
		}

		if (functionName.empty()) {
			std::string out = "RVExtension Error: Empty function name!";
			Logging::logError(out.c_str());
			callbackPtr(EXTENSION_NAME, "", out.c_str());
			return;
		}

		// Parse JSON data if present
		if (!data.empty()) {
			try {
				Logging::logDebug(("Data: " + data).c_str());
				dataParsed = json::parse(data);
			}
			catch (json::parse_error& e) {
				std::string out = "RVExtension Error: Invalid JSON data - " + std::string(e.what());
				Logging::logError(out.c_str());
				// Return error with ID if provided
				std::string callbackData = callId.empty() ? out : (callId + std::string(DELIMITER) + out);
				callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
				return;
			}
		}

		// -------------------------------------------------
		// -------Function Case Handling Starts Here -------
		// -------------------------------------------------
		
		std::string returnValue = "";
		if (functionName == "healthCheck") {
			// Basic self-test: echoes parsed JSON and returns runtime + shared-library info.
			// Example payload:
			// {"client":"github-actions","test":"healthCheck","nested":{"n":123}}
			auto jsonType = [&]() -> std::string {
				if (data.empty()) return "none";
				if (dataParsed.is_object()) return "object";
				if (dataParsed.is_array()) return "array";
				if (dataParsed.is_string()) return "string";
				if (dataParsed.is_boolean()) return "boolean";
				if (dataParsed.is_number_integer()) return "number_integer";
				if (dataParsed.is_number_float()) return "number_float";
				if (dataParsed.is_null()) return "null";
				return "unknown";
			};

			// IMPORTANT: Arma's dlopen can be strict about unresolved symbols.
			// Keep library introspection minimal and cross-platform; we accept the library path from the payload.
			// (Python healthcheck always sends `libraryPath`.)
			std::string libPath;
			if (dataParsed.is_object() && dataParsed.contains("libraryPath") && dataParsed["libraryPath"].is_string()) {
				libPath = dataParsed["libraryPath"].get<std::string>();
			}

			// UTC timestamp for easier correlation.
			std::time_t now = std::time(nullptr);
			std::tm tm_buf{};
#ifdef _WIN32
			gmtime_s(&tm_buf, &now);
#else
			gmtime_r(&now, &tm_buf);
#endif
			char iso[32]{};
			std::strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", &tm_buf);

			std::string hostname;
			const char* envHost = std::getenv("HOSTNAME");
			if (envHost && envHost[0] != '\0') hostname = envHost;
			if (hostname.empty()) {
				envHost = std::getenv("COMPUTERNAME");
				if (envHost && envHost[0] != '\0') hostname = envHost;
			}

#ifdef _WIN32
			uint64_t pid = static_cast<uint64_t>(GetCurrentProcessId());
#else
			uint64_t pid = static_cast<uint64_t>(getpid());
#endif

			json out;
			out["ok"] = true;
			out["function"] = "healthCheck";

			// Demonstrate sending data and parsing it by echoing the parsed JSON input.
			out["echo"] = dataParsed;
			out["receivedJsonType"] = jsonType();

			// Demonstrate parsing by pulling a few well-known fields.
			if (dataParsed.is_object()) {
				json parsedFields;
				parsedFields["client"] = dataParsed.value("client", "");
				parsedFields["test"] = dataParsed.value("test", "");
				parsedFields["hasNested"] = dataParsed.contains("nested");
				out["parsedFields"] = parsedFields;
			} else {
				out["parsedFields"] = json::object();
			}

			out["extension"] = {
				{"name", EXTENSION_NAME},
				{"version", EXTENSION_VERSION}
			};

			out["runtime"] = {
				{"platform",
#ifdef _WIN32
				 "windows"
#else
				 "linux"
#endif
				},
				{"pid", pid},
				{"hostname", hostname},
				{"timestampUtc", std::string(iso)},
				{"totalCalls", g_totalCalls.load()},
			};

			out["library"] = {
				{"path", libPath},
				{"basename", libPath.empty() ? "" : std::filesystem::path(libPath).filename().string()}
			};

			returnValue = out.dump();
		} else if (functionName == "ipcConnect") {
			if (data.empty() || !dataParsed.is_object()) {
				std::string out = "RVExtension Error: ipcConnect requires JSON object with host and port";
				Logging::logError(out.c_str());
				std::string callbackData = callId.empty() ? out : (callId + std::string(DELIMITER) + out);
				callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
				return;
			}
			if (!dataParsed.contains("host") || !dataParsed["host"].is_string() || !dataParsed.contains("port")) {
				std::string out = "RVExtension Error: ipcConnect requires string host and numeric port";
				Logging::logError(out.c_str());
				std::string callbackData = callId.empty() ? out : (callId + std::string(DELIMITER) + out);
				callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
				return;
			}
			const std::string host = dataParsed["host"].get<std::string>();
			int portNum = 0;
			if (dataParsed["port"].is_number_integer()) {
				portNum = dataParsed["port"].get<int>();
			} else if (dataParsed["port"].is_number_unsigned()) {
				portNum = static_cast<int>(dataParsed["port"].get<unsigned int>());
			} else {
				std::string out = "RVExtension Error: ipcConnect port must be an integer";
				Logging::logError(out.c_str());
				std::string callbackData = callId.empty() ? out : (callId + std::string(DELIMITER) + out);
				callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
				return;
			}
			if (portNum < 1 || portNum > 65535) {
				std::string out = "RVExtension Error: ipcConnect port out of range";
				Logging::logError(out.c_str());
				std::string callbackData = callId.empty() ? out : (callId + std::string(DELIMITER) + out);
				callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
				return;
			}

			auto onInbound = [](const std::string& json) {
				if (!callbackPtr)
					return;
				// SQF routes on function name "ipcInbound"; payload may contain '|' so do not prefix with callId.
				callbackPtr(EXTENSION_NAME, "ipcInbound", json.c_str());
			};

			std::string err;
			json out;
			if (!IpcClient::connect(host, static_cast<uint16_t>(portNum), onInbound, err)) {
				out["ok"] = false;
				out["error"] = err;
			} else {
				out["ok"] = true;
			}
			returnValue = out.dump();
		} else if (functionName == "ipcDisconnect") {
			IpcClient::disconnect();
			json out;
			out["ok"] = true;
			returnValue = out.dump();
		} else if (functionName == "ipcSend") {
			if (data.empty()) {
				std::string out = "RVExtension Error: ipcSend requires JSON payload";
				Logging::logError(out.c_str());
				std::string callbackData = callId.empty() ? out : (callId + std::string(DELIMITER) + out);
				callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
				return;
			}
			std::string err;
			const std::string wire = dataParsed.dump();
			json out;
			if (!IpcClient::sendJsonFramed(wire, err)) {
				out["ok"] = false;
				out["error"] = err;
			} else {
				out["ok"] = true;
			}
			returnValue = out.dump();
		} else {
			returnValue = "RVExtension Error: Function not found!";
		}
		
		// Return with ID prefix if ID was provided: "id|result" or just "result"
		std::string callbackData = callId.empty() ? returnValue : (callId + std::string(DELIMITER) + returnValue);

		auto endTime = std::chrono::steady_clock::now();
		auto durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime).count();
		Logging::logDebug(
			(std::string("[OUTGOING] #") + std::to_string(callNumber) +
			 " fn=\"" + functionName +
			 "\" id=\"" + callId +
			 "\" inLen=" + std::to_string(fnc.size()) +
			 " outLen=" + std::to_string(callbackData.size()) +
			 " durationMs=" + std::to_string(durationMs)).c_str());

		callbackPtr(EXTENSION_NAME, functionName.c_str(), callbackData.c_str());
	}).detach();
}