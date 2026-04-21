-- HelloAgent Launcher (AppleScript)
-- 启动后台 Node 服务并打开 Web 控制台

property serverPid : 0

on run
    set nodePath to (POSIX path of (path to me)) & "Contents/MacOS/node"
    set scriptPath to (POSIX path of (path to me)) & "Contents/Resources/Data/core/main.js"

    set serverPid to do shell script "export NODE_PATH=" & (POSIX path of (path to me)) & "Contents/Resources/node_modules; " & nodePath & " " & scriptPath & " > /dev/null 2>&1 & echo $!"

    delay 1
    open location "http://localhost:3000"
end run

on quit
    if serverPid is not 0 then
        do shell script "kill " & serverPid
    end if
    continue quit
end quit
