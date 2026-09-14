#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

static pid_t server_pid = -1;

static void stop_server(int signal_number) {
    (void)signal_number;
    if (server_pid > 0) {
        kill(server_pid, SIGTERM);
    }
}

static int executable_path(char *buffer, size_t size) {
#ifdef __APPLE__
    uint32_t raw_size = (uint32_t)size;
    if (_NSGetExecutablePath(buffer, &raw_size) != 0) {
        return -1;
    }
    char resolved[PATH_MAX];
    if (realpath(buffer, resolved) == NULL) {
        return -1;
    }
    if (strlen(resolved) + 1 > size) {
        return -1;
    }
    strcpy(buffer, resolved);
    return 0;
#else
    ssize_t count = readlink("/proc/self/exe", buffer, size - 1);
    if (count < 0 || (size_t)count >= size - 1) {
        return -1;
    }
    buffer[count] = '\0';
    return 0;
#endif
}

static int configured_port(void) {
    const char *raw = getenv("OFFICE_PORT");
    if (raw == NULL || raw[0] == '\0') {
        return 8787;
    }
    char *end = NULL;
    errno = 0;
    long value = strtol(raw, &end, 10);
    if (errno != 0 || end == raw || *end != '\0' || value < 1024 || value > 65535) {
        fprintf(stderr, "The Office: OFFICE_PORT must be an integer from 1024 to 65535\n");
        return -1;
    }
    return (int)value;
}

static bool port_available(int port) {
    int descriptor = socket(AF_INET, SOCK_STREAM, 0);
    if (descriptor < 0) {
        return false;
    }
    struct sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons((uint16_t)port);
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    int result = bind(descriptor, (struct sockaddr *)&address, sizeof(address));
    close(descriptor);
    return result == 0;
}

static bool server_ready(int port) {
    int descriptor = socket(AF_INET, SOCK_STREAM, 0);
    if (descriptor < 0) {
        return false;
    }
    struct timeval timeout = {.tv_sec = 0, .tv_usec = 200000};
    setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    struct sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons((uint16_t)port);
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    if (connect(descriptor, (struct sockaddr *)&address, sizeof(address)) != 0) {
        close(descriptor);
        return false;
    }

    char request[256];
    int request_size = snprintf(
        request,
        sizeof(request),
        "GET /api/state HTTP/1.0\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n\r\n",
        port
    );
    if (request_size < 0 || write(descriptor, request, (size_t)request_size) != request_size) {
        close(descriptor);
        return false;
    }
    char response[8192];
    ssize_t count = read(descriptor, response, sizeof(response) - 1);
    close(descriptor);
    if (count <= 0) {
        return false;
    }
    response[count] = '\0';
    return strstr(response, " 200 ") != NULL && strstr(response, "\"agents\"") != NULL;
}

static void open_browser(int port) {
#ifdef __APPLE__
    char url[128];
    snprintf(url, sizeof(url), "http://127.0.0.1:%d", port);
    pid_t opener = fork();
    if (opener == 0) {
        execl("/usr/bin/open", "open", url, (char *)NULL);
        _exit(127);
    }
    if (opener > 0) {
        (void)waitpid(opener, NULL, 0);
    }
#else
    (void)port;
#endif
}

int main(void) {
    signal(SIGPIPE, SIG_IGN);

    int port = configured_port();
    if (port < 0) {
        return 2;
    }
    if (!port_available(port)) {
        fprintf(stderr, "The Office: loopback port %d is already in use\n", port);
        return 1;
    }

    char launcher[PATH_MAX];
    if (executable_path(launcher, sizeof(launcher)) != 0) {
        fprintf(stderr, "The Office: cannot resolve the app launcher path\n");
        return 1;
    }
    char *separator = strrchr(launcher, '/');
    if (separator == NULL) {
        fprintf(stderr, "The Office: malformed app launcher path\n");
        return 1;
    }
    *separator = '\0';

    char server[PATH_MAX];
    if (snprintf(server, sizeof(server), "%s/office-server", launcher) >= (int)sizeof(server)) {
        fprintf(stderr, "The Office: app path is too long\n");
        return 1;
    }
    if (access(server, X_OK) != 0) {
        fprintf(stderr, "The Office: bundled server is missing or not executable\n");
        return 1;
    }

    const char *temporary = getenv("TMPDIR");
    if (temporary == NULL || temporary[0] == '\0') {
        temporary = "/tmp";
    }
    char log_path[PATH_MAX];
    if (snprintf(log_path, sizeof(log_path), "%s/the-office-server-log-XXXXXX", temporary)
        >= (int)sizeof(log_path)) {
        fprintf(stderr, "The Office: temporary path is too long\n");
        return 1;
    }
    int log_file = mkstemp(log_path);
    if (log_file < 0) {
        perror("The Office: cannot create the server log");
        return 1;
    }

    server_pid = fork();
    if (server_pid < 0) {
        close(log_file);
        perror("The Office: fork");
        return 1;
    }
    if (server_pid == 0) {
        dup2(log_file, STDOUT_FILENO);
        dup2(log_file, STDERR_FILENO);
        close(log_file);
        char port_text[16];
        snprintf(port_text, sizeof(port_text), "%d", port);
        execl(server, server, "--demo", "--host", "127.0.0.1", "--port", port_text,
              (char *)NULL);
        _exit(127);
    }
    close(log_file);

    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = stop_server;
    sigemptyset(&action.sa_mask);
    sigaction(SIGTERM, &action, NULL);
    sigaction(SIGINT, &action, NULL);
    sigaction(SIGHUP, &action, NULL);

    const struct timespec pause = {.tv_sec = 0, .tv_nsec = 50000000};
    for (int attempt = 0; attempt < 300; attempt++) {
        int status = 0;
        pid_t result = waitpid(server_pid, &status, WNOHANG);
        if (result == server_pid) {
            fprintf(stderr, "The Office: server exited before it became ready; see %s\n", log_path);
            return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
        }
        if (server_ready(port)) {
            open_browser(port);
            int status = 0;
            while (waitpid(server_pid, &status, 0) < 0 && errno == EINTR) {
            }
            int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;
            if (exit_code == 0) {
                (void)unlink(log_path);
            }
            return exit_code;
        }
        nanosleep(&pause, NULL);
    }

    kill(server_pid, SIGTERM);
    (void)waitpid(server_pid, NULL, 0);
    fprintf(stderr, "The Office: server did not become ready; see %s\n", log_path);
    return 1;
}
