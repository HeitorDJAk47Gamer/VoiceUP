#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <wrl.h>
#include <wrl/implements.h>

#include <cstdint>
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;

namespace {
constexpr DWORD kSampleRate = 48000;
constexpr WORD kChannels = 2;
constexpr WORD kBitsPerSample = 16;
constexpr DWORD kActivationTimeoutMs = 10000;

void PrintError(const wchar_t* stage, HRESULT result) {
  std::fwprintf(stderr, L"VOICEUP_ERROR %ls 0x%08lX\n", stage, static_cast<unsigned long>(result));
  std::fflush(stderr);
}

class ActivationHandler final :
    public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivationHandler() : completed_(CreateEventW(nullptr, FALSE, FALSE, nullptr)) {}
  ~ActivationHandler() override {
    if (completed_) CloseHandle(completed_);
  }

  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activationResult = E_UNEXPECTED;
    ComPtr<IUnknown> activated;
    HRESULT result = operation->GetActivateResult(&activationResult, &activated);
    if (SUCCEEDED(result)) result = activationResult;
    if (SUCCEEDED(result)) result = activated.As(&audioClient_);
    result_ = result;
    SetEvent(completed_);
    return S_OK;
  }

  HANDLE completed() const { return completed_; }
  HRESULT result() const { return result_; }
  IAudioClient* audioClient() const { return audioClient_.Get(); }

 private:
  HANDLE completed_ = nullptr;
  HRESULT result_ = E_PENDING;
  ComPtr<IAudioClient> audioClient_;
};

bool WriteAll(HANDLE output, const BYTE* data, DWORD byteCount) {
  while (byteCount > 0) {
    DWORD written = 0;
    if (!WriteFile(output, data, byteCount, &written, nullptr) || written == 0) return false;
    data += written;
    byteCount -= written;
  }
  return true;
}

DWORD ProcessIdFromWindowText(const wchar_t* rawHandle) {
  if (!rawHandle || !*rawHandle) return 0;
  wchar_t* end = nullptr;
  const unsigned long long value = wcstoull(rawHandle, &end, 0);
  if (!value || !end || *end != L'\0') return 0;
  const HWND window = reinterpret_cast<HWND>(static_cast<uintptr_t>(value));
  if (!IsWindow(window)) return 0;
  DWORD processId = 0;
  GetWindowThreadProcessId(window, &processId);
  return processId;
}

HRESULT ActivateProcessLoopback(DWORD processId, bool includeProcessTree, ComPtr<IAudioClient>& audioClient) {
  AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
  parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parameters.ProcessLoopbackParams.TargetProcessId = processId;
  parameters.ProcessLoopbackParams.ProcessLoopbackMode = includeProcessTree
      ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
      : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activation{};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(parameters);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);

  auto handler = Make<ActivationHandler>();
  if (!handler || !handler->completed()) return E_OUTOFMEMORY;
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  HRESULT result = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &activation,
      handler.Get(),
      &operation);
  if (FAILED(result)) return result;
  if (WaitForSingleObject(handler->completed(), kActivationTimeoutMs) != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  result = handler->result();
  if (FAILED(result)) return result;
  audioClient = handler->audioClient();
  return audioClient ? S_OK : E_NOINTERFACE;
}

int CaptureProcess(DWORD processId, bool includeProcessTree) {
  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
    PrintError(L"com", comResult);
    return 20;
  }

  ComPtr<IAudioClient> audioClient;
  HRESULT result = ActivateProcessLoopback(processId, includeProcessTree, audioClient);
  if (FAILED(result)) {
    PrintError(L"activate", result);
    if (SUCCEEDED(comResult)) CoUninitialize();
    return 21;
  }

  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBitsPerSample;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
      AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  result = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &format, nullptr);
  if (FAILED(result)) {
    PrintError(L"initialize", result);
    if (SUCCEEDED(comResult)) CoUninitialize();
    return 22;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  result = audioClient->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(result)) {
    PrintError(L"capture-client", result);
    if (SUCCEEDED(comResult)) CoUninitialize();
    return 23;
  }

  HANDLE sampleReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!sampleReady) {
    PrintError(L"event", HRESULT_FROM_WIN32(GetLastError()));
    if (SUCCEEDED(comResult)) CoUninitialize();
    return 24;
  }
  result = audioClient->SetEventHandle(sampleReady);
  if (FAILED(result)) {
    PrintError(L"event-handle", result);
    CloseHandle(sampleReady);
    if (SUCCEEDED(comResult)) CoUninitialize();
    return 25;
  }

  _setmode(_fileno(stdout), _O_BINARY);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  result = audioClient->Start();
  if (FAILED(result)) {
    PrintError(L"start", result);
    CloseHandle(sampleReady);
    if (SUCCEEDED(comResult)) CoUninitialize();
    return 26;
  }

  std::fprintf(stderr, "VOICEUP_READY %lu %u %lu\n", kSampleRate, kChannels, processId);
  std::fflush(stderr);

  bool outputOpen = true;
  while (outputOpen) {
    const DWORD waitResult = WaitForSingleObject(sampleReady, 2000);
    if (waitResult == WAIT_FAILED) break;
    if (waitResult == WAIT_TIMEOUT) continue;

    UINT32 framesAvailable = 0;
    while (SUCCEEDED(captureClient->GetNextPacketSize(&framesAvailable)) && framesAvailable > 0) {
      BYTE* data = nullptr;
      DWORD captureFlags = 0;
      UINT64 devicePosition = 0;
      UINT64 qpcPosition = 0;
      result = captureClient->GetBuffer(
          &data, &framesAvailable, &captureFlags, &devicePosition, &qpcPosition);
      if (FAILED(result)) {
        outputOpen = false;
        break;
      }
      const DWORD bytes = framesAvailable * format.nBlockAlign;
      if (captureFlags & AUDCLNT_BUFFERFLAGS_SILENT) {
        std::vector<BYTE> silence(bytes, 0);
        outputOpen = WriteAll(output, silence.data(), bytes);
      } else {
        outputOpen = WriteAll(output, data, bytes);
      }
      captureClient->ReleaseBuffer(framesAvailable);
      if (!outputOpen) break;
    }
  }

  audioClient->Stop();
  CloseHandle(sampleReady);
  if (SUCCEEDED(comResult)) CoUninitialize();
  return 0;
}
}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc != 3) {
    std::fwprintf(stderr, L"Usage: voiceup-process-audio <resolve-window|capture-window|capture-pid|capture-exclude-pid> <value>\n");
    return 2;
  }

  const std::wstring mode = argv[1];
  DWORD processId = 0;
  bool includeProcessTree = true;
  if (mode == L"resolve-window" || mode == L"capture-window") {
    processId = ProcessIdFromWindowText(argv[2]);
  } else if (mode == L"capture-pid" || mode == L"capture-exclude-pid") {
    wchar_t* end = nullptr;
    const unsigned long value = wcstoul(argv[2], &end, 0);
    if (value && end && *end == L'\0') processId = static_cast<DWORD>(value);
    includeProcessTree = mode != L"capture-exclude-pid";
  }
  if (!processId) {
    PrintError(L"window-or-process", E_INVALIDARG);
    return 3;
  }
  if (mode == L"resolve-window") {
    std::printf("%lu\n", processId);
    return 0;
  }
  if (mode != L"capture-window" && mode != L"capture-pid" && mode != L"capture-exclude-pid") return 4;
  return CaptureProcess(processId, includeProcessTree);
}
