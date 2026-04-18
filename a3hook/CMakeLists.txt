cmake_minimum_required(VERSION 3.21)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

project(A3_HOOK)

# Standalone command-line tool (not an Arma extension module).
add_executable(A3_HOOK "s3hook.cpp")

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
	message(FATAL_ERROR "Only 64-bit builds are supported")
endif()

# Enable Hot Reload for MSVC compilers if supported.
if (POLICY CMP0141)
  cmake_policy(SET CMP0141 NEW)
  set(CMAKE_MSVC_DEBUG_INFORMATION_FORMAT "$<IF:$<AND:$<C_COMPILER_ID:MSVC>,$<CXX_COMPILER_ID:MSVC>>,$<$<CONFIG:Debug,RelWithDebInfo>:EditAndContinue>,$<$<CONFIG:Debug,RelWithDebInfo>:ProgramDatabase>>")
endif()

if (CMAKE_VERSION VERSION_GREATER 3.12)
  set_property(TARGET A3_HOOK PROPERTY CXX_STANDARD 20)
endif()

set_target_properties(A3_HOOK PROPERTIES OUTPUT_NAME "a3hook")
set_target_properties(A3_HOOK PROPERTIES CXX_STANDARD 17)

# Dependencies via FetchContent
include(FetchContent)

# Nlohmann JSON
find_package(nlohmann_json 3.11.3 QUIET)
if (NOT nlohmann_json_FOUND)
    FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
    FetchContent_MakeAvailable(json)
endif()
target_link_libraries(A3_HOOK PRIVATE nlohmann_json::nlohmann_json)

if (WIN32)
  target_link_libraries(A3_HOOK PRIVATE dbghelp user32 gdi32)
endif()

if (UNIX)
    if(DEFINED A3_HOOK_INSTALL_DIR)
        set_target_properties(A3_HOOK PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${A3_HOOK_INSTALL_DIR}")
        install(TARGETS A3_HOOK RUNTIME DESTINATION "${A3_HOOK_INSTALL_DIR}")
    endif()
endif()
