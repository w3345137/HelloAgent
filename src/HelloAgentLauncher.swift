// HelloAgentLauncher.swift
import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let nodePath = Bundle.main.bundlePath + "/Contents/MacOS/node"
        let scriptPath = Bundle.main.bundlePath + "/Contents/Resources/Data/core/main.js"

        serverProcess = Process()
        serverProcess?.executableURL = URL(fileURLWithPath: nodePath)
        serverProcess?.arguments = [scriptPath]
        try? serverProcess?.run()

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.titled, .closable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Hello Agent"
        window.makeKeyAndOrderFront(nil)

        webView = WKWebView(frame: window.contentView!.bounds)
        window.contentView?.addSubview(webView)
        webView.load(URLRequest(url: URL(string: "http://localhost:3000")!))
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverProcess?.terminate()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
