// HelloAgent-shell.m — Hello Agent 原生窗口壳
// 编译: clang -fobjc-arc -framework Cocoa -framework WebKit -o "Hello Agent" hello-agent-shell.m

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <signal.h>

static pid_t g_nodePid = 0;

@interface HelloAgentAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@end

@implementation HelloAgentAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self startNodeServer];

    NSRect screenFrame = [[NSScreen mainScreen] visibleFrame];
    NSUInteger style = NSWindowStyleMaskTitled
                     | NSWindowStyleMaskClosable
                     | NSWindowStyleMaskMiniaturizable
                     | NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:screenFrame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    [self.window setTitle:@"Hello Agent"];
    [self.window setDelegate:self];
    [self.window setMinSize:NSMakeSize(480, 360)];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKUserContentController *ucc = [[WKUserContentController alloc] init];
    [ucc addScriptMessageHandler:self name:@"selectFolder"];
    config.userContentController = ucc;
    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds
                                      configuration:config];
    [self.webView setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
    [self.window.contentView addSubview:self.webView];

    [self waitAndLoad:0];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)startNodeServer {
    NSString *execPath = [[NSBundle mainBundle] executablePath];
    NSString *macosDir = [execPath stringByDeletingLastPathComponent];
    NSString *nodePath = [macosDir stringByAppendingPathComponent:@"node"];
    NSString *resourcesDir = [[macosDir stringByDeletingLastPathComponent]
                               stringByAppendingPathComponent:@"Resources"];
    NSString *dataDir = [resourcesDir stringByAppendingPathComponent:@"Data"];
    NSString *mainJs = [[dataDir stringByAppendingPathComponent:@"core"]
                         stringByAppendingPathComponent:@"main.js"];
    NSString *nmPath = [dataDir stringByAppendingPathComponent:@"node_modules"];
    NSString *logDir = [dataDir stringByAppendingPathComponent:@"logs"];

    [[NSFileManager defaultManager] createDirectoryAtPath:logDir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];

    pid_t pid = fork();
    if (pid == 0) {
        setenv("NODE_PATH", [nmPath UTF8String], 1);
        setenv("HELLO_AGENT_PORT", "3000", 1);

        NSString *logFile = [logDir stringByAppendingPathComponent:@"hello-agent.log"];
        int fd = open([logFile UTF8String], O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (fd >= 0) {
            dup2(fd, STDOUT_FILENO);
            dup2(fd, STDERR_FILENO);
            close(fd);
        }

        execl([nodePath UTF8String], "node", [mainJs UTF8String], NULL);
        _exit(1);
    } else if (pid > 0) {
        g_nodePid = pid;
        NSLog(@"[HelloAgent] Node.js started with PID: %d", pid);
    } else {
        NSLog(@"[HelloAgent] Failed to fork Node.js process");
    }
}

- (void)waitAndLoad:(int)attempt {
    if (attempt > 50) {
        NSLog(@"[HelloAgent] Node.js server did not start in time");
        [self.webView loadHTMLString:@"<h1 style='color:red;font-family:sans-serif;padding:40px'>服务启动超时，请检查日志</h1>"
                             baseURL:nil];
        return;
    }

    NSURL *url = [NSURL URLWithString:@"http://localhost:3000"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
    [req setTimeoutInterval:0.5];

    NSURLSession *session = [NSURLSession sharedSession];
    [[session dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *error) {
        if (error) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC),
                           dispatch_get_main_queue(), ^{
                [self waitAndLoad:attempt + 1];
            });
        } else {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
            });
        }
    }] resume];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.name isEqualToString:@"selectFolder"]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSOpenPanel *panel = [NSOpenPanel openPanel];
            [panel setCanChooseFiles:NO];
            [panel setCanChooseDirectories:YES];
            [panel setAllowsMultipleSelection:NO];
            [panel setTitle:@"选择工作文件夹"];
            [panel setPrompt:@"选择"];

            [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
                if (result == NSModalResponseOK) {
                    NSString *folderPath = [[panel URL] path];
                    NSString *escaped = [folderPath stringByReplacingOccurrencesOfString:@"'" withString:@"\\'"];
                    NSString *js = [NSString stringWithFormat:@"onNativeFolderSelected('%@')", escaped];
                    [self.webView evaluateJavaScript:js completionHandler:nil];
                }
            }];
        });
    }
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self killNodeServer];
}

- (void)killNodeServer {
    if (g_nodePid > 0) {
        NSLog(@"[HelloAgent] Killing Node.js (PID: %d)", g_nodePid);
        kill(g_nodePid, SIGTERM);
        usleep(500000);
        int status;
        pid_t result = waitpid(g_nodePid, &status, WNOHANG);
        if (result == 0) {
            kill(g_nodePid, SIGKILL);
            waitpid(g_nodePid, &status, 0);
        }
        g_nodePid = 0;
    }
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];

        NSMenu *menuBar = [[NSMenu alloc] init];

        NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
        [menuBar addItem:appMenuItem];
        NSMenu *appMenu = [[NSMenu alloc] init];
        [appMenu addItemWithTitle:@"关于 Hello Agent"
                           action:@selector(orderFrontStandardAboutPanel:)
                    keyEquivalent:@""];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:@"隐藏 Hello Agent"
                           action:@selector(hide:)
                    keyEquivalent:@"h"];
        [appMenu addItemWithTitle:@"退出 Hello Agent"
                           action:@selector(terminate:)
                    keyEquivalent:@"q"];
        [appMenuItem setSubmenu:appMenu];

        NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
        [menuBar addItem:editMenuItem];
        NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
        [editMenu addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
        [editMenu addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"Z"];
        [editMenu addItem:[NSMenuItem separatorItem]];
        [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
        [editMenu addItemWithTitle:@"拷贝" action:@selector(copy:) keyEquivalent:@"c"];
        [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
        [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
        [editMenuItem setSubmenu:editMenu];

        [app setMainMenu:menuBar];

        HelloAgentAppDelegate *delegate = [[HelloAgentAppDelegate alloc] init];
        [app setDelegate:delegate];
        [app run];
    }
    return 0;
}
