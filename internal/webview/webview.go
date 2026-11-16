// Package webview checks that Microsoft Edge WebView2 is installed before
// the app creates a window. Without it the window would stay blank; PRD §8.1
// requires a clear installation prompt instead.
package webview

import (
	"syscall"
	"unsafe"
)

// clientGUID identifies the Evergreen WebView2 Runtime in EdgeUpdate.
const clientGUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

// locations are the three places EdgeUpdate records the runtime: system-wide
// 32/64-bit views and the per-user install.
var locations = []struct {
	root syscall.Handle
	path string
}{
	{syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + clientGUID},
	{syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\Microsoft\EdgeUpdate\Clients\` + clientGUID},
	{syscall.HKEY_CURRENT_USER, `Software\Microsoft\EdgeUpdate\Clients\` + clientGUID},
}

// Available reports whether a WebView2 Runtime is installed.
func Available() bool {
	for _, location := range locations {
		if version(location.root, location.path) != "" {
			return true
		}
	}
	return false
}

// version reads the "pv" value of a client key, or "" when it is absent.
func version(root syscall.Handle, path string) string {
	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	var key syscall.Handle
	if err := syscall.RegOpenKeyEx(root, pathPtr, 0, syscall.KEY_READ, &key); err != nil {
		return ""
	}
	defer syscall.RegCloseKey(key)

	namePtr, err := syscall.UTF16PtrFromString("pv")
	if err != nil {
		return ""
	}
	buf := make([]uint16, 128)
	size := uint32(len(buf) * 2)
	var kind uint32
	if err := syscall.RegQueryValueEx(key, namePtr, nil, &kind, (*byte)(unsafe.Pointer(&buf[0])), &size); err != nil {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

// installURL is Microsoft's WebView2 download page. The prompt shows it
// because a message box cannot open a browser by itself.
const installURL = "https://developer.microsoft.com/microsoft-edge/webview2/"

// ShowPrompt tells the user what to install. It is a native message box, so
// it works before any mygo window exists.
func ShowPrompt() {
	text := "Mile Typora 需要 Microsoft Edge WebView2 运行时。\n\n" +
		"请安装 WebView2 Runtime 后重新打开应用：\n" + installURL
	title := "需要 WebView2 运行时"
	textPtr, _ := syscall.UTF16PtrFromString(text)
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	const mbOK = 0x00000000
	const mbIconWarning = 0x00000030
	messageBox.Call(0, uintptr(unsafe.Pointer(textPtr)), uintptr(unsafe.Pointer(titlePtr)), mbOK|mbIconWarning)
}

var messageBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
