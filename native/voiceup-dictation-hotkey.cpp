#define WIN32_LEAN_AND_MEAN
#include <windows.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  // The focused textarea receives the Windows Voice Typing result. The short
  // delay lets Electron apply focus before the operating-system shortcut runs.
  Sleep(150);
  INPUT input[4]{};
  input[0].type = INPUT_KEYBOARD; input[0].ki.wVk = VK_LWIN;
  input[1].type = INPUT_KEYBOARD; input[1].ki.wVk = 'H';
  input[2].type = INPUT_KEYBOARD; input[2].ki.wVk = 'H'; input[2].ki.dwFlags = KEYEVENTF_KEYUP;
  input[3].type = INPUT_KEYBOARD; input[3].ki.wVk = VK_LWIN; input[3].ki.dwFlags = KEYEVENTF_KEYUP;
  return SendInput(4, input, sizeof(INPUT)) == 4 ? 0 : static_cast<int>(GetLastError() || 1);
}
