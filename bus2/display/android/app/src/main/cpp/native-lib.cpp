// JNI wrapper around libnode's node::Start() entrypoint, following the pattern used by
// JaneaSystems' nodejs-mobile-android "native-gradle-node-folder" sample (see
// display/LIBNODE-SETUP.md for where libnode's headers/binaries this file needs come from).
// Exposes AdKeralaNodeRunner.startNodeWithArguments(String[]) to Java and mirrors stdout/stderr
// into logcat so `adb logcat` shows the embedded server's own console.log/console.error output
// (the same lines you'd see from `node server/prod.js` on a dev machine).
#include <jni.h>
#include <string>
#include <vector>
#include <thread>
#include <unistd.h>
#include <android/log.h>
#include "node.h"

#define ADKERALA_TAG "AdKeralaNode"

static void pumpStreamToLogcat(int fd, android_LogPriority priority) {
    char buffer[1024];
    ssize_t n;
    while ((n = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[n] = '\0';
        // __android_log_write already appends a newline — strip trailing ones so log lines
        // don't come out double-spaced.
        while (n > 0 && (buffer[n - 1] == '\n' || buffer[n - 1] == '\r')) {
            buffer[--n] = '\0';
        }
        if (n > 0) {
            __android_log_write(priority, ADKERALA_TAG, buffer);
        }
    }
}

static void redirectStreamToLogcat(int standardStreamFd, android_LogPriority priority) {
    int pipeFds[2];
    if (pipe(pipeFds) != 0) return;
    dup2(pipeFds[1], standardStreamFd);
    close(pipeFds[1]);
    setvbuf(standardStreamFd == STDOUT_FILENO ? stdout : stderr, nullptr, _IOLBF, 0);
    std::thread(pumpStreamToLogcat, pipeFds[0], priority).detach();
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_adkerala_display_AdKeralaNodeRunner_startNodeWithArguments(
        JNIEnv *env, jobject /* this */, jobjectArray argsArray) {
    redirectStreamToLogcat(STDOUT_FILENO, ANDROID_LOG_INFO);
    redirectStreamToLogcat(STDERR_FILENO, ANDROID_LOG_ERROR);

    int argc = env->GetArrayLength(argsArray);
    std::vector<std::string> argStrings;
    std::vector<char *> argv;
    argStrings.reserve(argc);
    argv.reserve(argc);

    // libuv requires argv's strings to sit in contiguous memory, so copy each Java string into
    // a std::string we own for the lifetime of this call before handing raw char* to node::Start.
    for (int i = 0; i < argc; i++) {
        auto jstr = (jstring) env->GetObjectArrayElement(argsArray, i);
        const char *chars = env->GetStringUTFChars(jstr, nullptr);
        argStrings.emplace_back(chars);
        env->ReleaseStringUTFChars(jstr, chars);
        env->DeleteLocalRef(jstr);
    }
    for (auto &s : argStrings) {
        argv.push_back(const_cast<char *>(s.c_str()));
    }

    __android_log_print(ANDROID_LOG_INFO, ADKERALA_TAG, "starting embedded node, argc=%d", argc);
    int ret = node::Start(argc, argv.data());
    __android_log_print(ANDROID_LOG_ERROR, ADKERALA_TAG,
                         "embedded node process exited with code %d (this should never happen "
                         "while the display app is running — server/androidMain.js's HTTP server "
                         "should stay up for the app's lifetime)", ret);
    return ret;
}
