#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <iostream>
#include <string>
#include <vector>

static void printLastError(const wchar_t* what) {
  DWORD err = GetLastError();
  std::wcerr << L"ERR " << what << L" Win32Error=" << err << L"\n";
}

static HGLOBAL hglobalFromBytes(const void* data, SIZE_T bytes) {
  HGLOBAL mem = GlobalAlloc(GHND, bytes);
  if (!mem) return nullptr;
  void* ptr = GlobalLock(mem);
  if (!ptr) {
    GlobalFree(mem);
    return nullptr;
  }
  memcpy(ptr, data, bytes);
  GlobalUnlock(mem);
  return mem;
}

static HGLOBAL makeDropFiles(const std::wstring& filePath) {
  const std::wstring fileList = filePath + L'\0' + L'\0';
  const SIZE_T fileListBytes = fileList.size() * sizeof(wchar_t);
  const SIZE_T totalBytes = sizeof(DROPFILES) + fileListBytes;

  HGLOBAL mem = GlobalAlloc(GHND, totalBytes);
  if (!mem) return nullptr;

  void* ptr = GlobalLock(mem);
  if (!ptr) {
    GlobalFree(mem);
    return nullptr;
  }

  auto* drop = static_cast<DROPFILES*>(ptr);
  ZeroMemory(drop, sizeof(DROPFILES));
  drop->pFiles = sizeof(DROPFILES);
  drop->fWide = TRUE;

  auto* fileListPtr = reinterpret_cast<BYTE*>(ptr) + sizeof(DROPFILES);
  memcpy(fileListPtr, fileList.data(), fileListBytes);

  GlobalUnlock(mem);
  return mem;
}

static bool copyFileToClipboard(const std::wstring& filePath) {
  DWORD attrs = GetFileAttributesW(filePath.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES || (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
    std::wcerr << L"ERR file does not exist or is a directory: " << filePath << L"\n";
    return false;
  }

  HGLOBAL hDrop = makeDropFiles(filePath);
  if (!hDrop) {
    printLastError(L"GlobalAlloc/GlobalLock CF_HDROP");
    return false;
  }

  DWORD copyEffect = DROPEFFECT_COPY;
  HGLOBAL hDropEffect = hglobalFromBytes(&copyEffect, sizeof(copyEffect));
  if (!hDropEffect) {
    printLastError(L"GlobalAlloc/GlobalLock Preferred DropEffect");
    GlobalFree(hDrop);
    return false;
  }

  UINT preferredDropEffectFormat = RegisterClipboardFormatW(L"Preferred DropEffect");
  if (!preferredDropEffectFormat) {
    printLastError(L"RegisterClipboardFormat Preferred DropEffect");
    GlobalFree(hDrop);
    GlobalFree(hDropEffect);
    return false;
  }

  bool opened = false;
  for (int i = 0; i < 20 && !opened; ++i) {
    opened = OpenClipboard(nullptr) != FALSE;
    if (!opened) Sleep(50);
  }
  if (!opened) {
    printLastError(L"OpenClipboard");
    GlobalFree(hDrop);
    GlobalFree(hDropEffect);
    return false;
  }

  bool ok = false;
  do {
    if (!EmptyClipboard()) {
      printLastError(L"EmptyClipboard");
      break;
    }

    if (!SetClipboardData(CF_HDROP, hDrop)) {
      printLastError(L"SetClipboardData CF_HDROP");
      break;
    }
    hDrop = nullptr; // Clipboard owns the handle after successful SetClipboardData.

    if (!SetClipboardData(preferredDropEffectFormat, hDropEffect)) {
      printLastError(L"SetClipboardData Preferred DropEffect");
      break;
    }
    hDropEffect = nullptr; // Clipboard owns the handle after successful SetClipboardData.

    ok = true;
  } while (false);

  CloseClipboard();
  if (hDrop) GlobalFree(hDrop);
  if (hDropEffect) GlobalFree(hDropEffect);

  if (ok) std::wcerr << L"DONE copied file to clipboard: " << filePath << L"\n";
  return ok;
}

int wmain(int argc, wchar_t** argv) {
  std::wstring filePath;
  for (int i = 1; i < argc; ++i) {
    if (!_wcsicmp(argv[i], L"--file") && i + 1 < argc) {
      filePath = argv[++i];
    } else if (filePath.empty()) {
      filePath = argv[i];
    }
  }

  if (filePath.empty()) {
    std::wcerr << L"usage: clipboard-file.exe --file <path>\n";
    return 1;
  }

  return copyFileToClipboard(filePath) ? 0 : 2;
}
