# Builds native-lib.so, the JNI wrapper around libnode's node::Start() — see
# src/main/cpp/native-lib.cpp and display/LIBNODE-SETUP.md for where libnode/include and
# libnode/bin/<abi>/libnode.so (referenced below) come from; they are not committed to this repo.
cmake_minimum_required(VERSION 3.4.1)

include_directories(libnode/include/node)

add_library(native-lib SHARED src/main/cpp/native-lib.cpp)

# Explicit 16 KB page-size alignment for this library's LOAD segments (see
# developer.android.com/16kb-page-size) — belt-and-suspenders alongside app/build.gradle's
# pinned ndkVersion (r27+ already defaults to this), so native-lib.so's alignment doesn't
# regress silently if the NDK default ever changes. libnode.so (imported below, not built by
# this project) is unaffected by anything here — see display/LIBNODE-SETUP.md.
target_link_options(native-lib PRIVATE "-Wl,-z,max-page-size=16384")

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)

target_link_libraries(native-lib libnode ${log-lib})
