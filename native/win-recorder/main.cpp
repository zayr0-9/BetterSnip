#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <codecapi.h>
#include <wincodec.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using winrt::com_ptr;
using winrt::event_token;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgdx = winrt::Windows::Graphics::DirectX;
namespace d3d11rt = winrt::Windows::Graphics::DirectX::Direct3D11;

static void check(HRESULT hr, const char* what) { if (FAILED(hr)) { std::cerr << "ERR " << what << " 0x" << std::hex << hr << std::dec << "\n"; exit(2); } }
static std::wstring arg(int argc, wchar_t** argv, const wchar_t* name, const wchar_t* def=L"") { for (int i=1;i+1<argc;i++) if (!_wcsicmp(argv[i], name)) return argv[i+1]; return def; }
static int argi(int argc, wchar_t** argv, const wchar_t* name, int def) { auto s=arg(argc,argv,name,L""); return s.empty()?def:_wtoi(s.c_str()); }
static bool hasArg(int argc, wchar_t** argv, const wchar_t* name) { for (int i=1;i<argc;i++) if (!_wcsicmp(argv[i], name)) return true; return false; }

struct NativeCapture {
  com_ptr<ID3D11Device> d3d;
  com_ptr<ID3D11DeviceContext> ctx;
  d3d11rt::IDirect3DDevice winrtDevice{nullptr};
  wgc::GraphicsCaptureItem item{nullptr};
  wgc::Direct3D11CaptureFramePool pool{nullptr};
  wgc::GraphicsCaptureSession session{nullptr};
  int width = 0, height = 0;

  void initD3D() {
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
#ifdef _DEBUG
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif
    D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    D3D_FEATURE_LEVEL level{};
    check(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels, 2, D3D11_SDK_VERSION, d3d.put(), &level, ctx.put()), "D3D11CreateDevice");
    com_ptr<IDXGIDevice> dxgi; check(d3d->QueryInterface(dxgi.put()), "IDXGIDevice");
    com_ptr<::IInspectable> insp; check(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), insp.put()), "CreateDirect3D11DeviceFromDXGIDevice");
    winrtDevice = insp.as<d3d11rt::IDirect3DDevice>();
  }

  void initCaptureMonitor(int monitorIndex) {
    if (!wgc::GraphicsCaptureSession::IsSupported()) { std::cerr << "ERR Windows.Graphics.Capture unsupported\n"; exit(3); }
    com_ptr<IGraphicsCaptureItemInterop> interop = winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    com_ptr<IDXGIDevice> dxgi; check(d3d->QueryInterface(dxgi.put()), "Q IDXGIDevice");
    com_ptr<IDXGIAdapter> adapter; check(dxgi->GetAdapter(adapter.put()), "GetAdapter");
    com_ptr<IDXGIOutput> output; check(adapter->EnumOutputs((UINT)monitorIndex, output.put()), "EnumOutputs");
    DXGI_OUTPUT_DESC desc{}; check(output->GetDesc(&desc), "GetDesc");
    check(interop->CreateForMonitor(desc.Monitor, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item)), "CreateForMonitor");
    auto size = item.Size(); width = size.Width; height = size.Height;
    pool = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(winrtDevice, wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    session = pool.CreateCaptureSession(item);
  }

  com_ptr<ID3D11Texture2D> copyFrame(wgc::Direct3D11CaptureFrame const& frame, int x, int y, int w, int h) {
    auto surface = frame.Surface();
    com_ptr<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess> access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    com_ptr<ID3D11Texture2D> tex; check(access->GetInterface(__uuidof(ID3D11Texture2D), tex.put_void()), "GetInterface texture");
    D3D11_TEXTURE2D_DESC srcDesc{}; tex->GetDesc(&srcDesc);
    x = std::max(0, std::min(x, (int)srcDesc.Width - 1));
    y = std::max(0, std::min(y, (int)srcDesc.Height - 1));
    w = std::max(1, std::min(w, (int)srcDesc.Width - x));
    h = std::max(1, std::min(h, (int)srcDesc.Height - y));
    D3D11_TEXTURE2D_DESC desc = srcDesc;
    desc.Width = (UINT)w; desc.Height = (UINT)h; desc.MipLevels = 1; desc.ArraySize = 1;
    desc.Usage = D3D11_USAGE_STAGING; desc.BindFlags = 0; desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ; desc.MiscFlags = 0;
    com_ptr<ID3D11Texture2D> staging; check(d3d->CreateTexture2D(&desc, nullptr, staging.put()), "CreateTexture2D staging");
    D3D11_BOX box{ (UINT)x, (UINT)y, 0, (UINT)(x + w), (UINT)(y + h), 1 };
    ctx->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, tex.get(), 0, &box);
    return staging;
  }

  void closeCapture() { if (session) session.Close(); if (pool) pool.Close(); item = nullptr; }
};

struct Recorder : NativeCapture {
  com_ptr<IMFSinkWriter> writer;
  DWORD stream = 0;
  int fps = 30, bitrate = 8000000;
  int cropX = 0, cropY = 0, cropW = 0, cropH = 0, outW = 0, outH = 0;
  std::atomic<bool> running{true};
  std::mutex writeMutex;
  LONGLONG frameIndex = 0;
  com_ptr<ID3D11Texture2D> staging;

  void prepareCrop() {
    cropX = std::max(0, std::min(cropX, width - 1));
    cropY = std::max(0, std::min(cropY, height - 1));
    outW = cropW > 0 ? std::min(cropW, width - cropX) : width;
    outH = cropH > 0 ? std::min(cropH, height - cropY) : height;
    outW = std::max(2, outW & ~1);
    outH = std::max(2, outH & ~1);
  }

  void initWriter(const std::wstring& out) {
    check(MFStartup(MF_VERSION), "MFStartup");
    com_ptr<IMFAttributes> attrs; check(MFCreateAttributes(attrs.put(), 4), "MFCreateAttributes");
    attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
    attrs->SetUINT32(MF_LOW_LATENCY, TRUE);
    check(MFCreateSinkWriterFromURL(out.c_str(), nullptr, attrs.get(), writer.put()), "MFCreateSinkWriterFromURL");
    com_ptr<IMFMediaType> output; check(MFCreateMediaType(output.put()), "MFCreateMediaType out");
    output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); output->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    output->SetUINT32(MF_MT_AVG_BITRATE, bitrate); output->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    MFSetAttributeSize(output.get(), MF_MT_FRAME_SIZE, outW, outH); MFSetAttributeRatio(output.get(), MF_MT_FRAME_RATE, fps, 1); MFSetAttributeRatio(output.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    output->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main);
    check(writer->AddStream(output.get(), &stream), "AddStream");
    com_ptr<IMFMediaType> input; check(MFCreateMediaType(input.put()), "MFCreateMediaType in");
    input->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); input->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
    input->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    MFSetAttributeSize(input.get(), MF_MT_FRAME_SIZE, outW, outH); MFSetAttributeRatio(input.get(), MF_MT_FRAME_RATE, fps, 1); MFSetAttributeRatio(input.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    check(writer->SetInputMediaType(stream, input.get(), nullptr), "SetInputMediaType"); check(writer->BeginWriting(), "BeginWriting");
  }

  void writeFrame(wgc::Direct3D11CaptureFrame const& frame) {
    auto surface = frame.Surface();
    com_ptr<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess> access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    com_ptr<ID3D11Texture2D> tex; check(access->GetInterface(__uuidof(ID3D11Texture2D), tex.put_void()), "GetInterface texture");
    D3D11_TEXTURE2D_DESC desc{}; tex->GetDesc(&desc);
    if (!staging) { desc.Width = outW; desc.Height = outH; desc.Usage = D3D11_USAGE_STAGING; desc.BindFlags = 0; desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ; desc.MiscFlags = 0; desc.MipLevels = 1; desc.ArraySize = 1; check(d3d->CreateTexture2D(&desc, nullptr, staging.put()), "CreateTexture2D staging"); }
    D3D11_BOX box{ (UINT)cropX, (UINT)cropY, 0, (UINT)(cropX + outW), (UINT)(cropY + outH), 1 };
    ctx->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, tex.get(), 0, &box);
    D3D11_MAPPED_SUBRESOURCE mapped{}; HRESULT hr = ctx->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped);
    if (FAILED(hr)) { std::cerr << "ERR Map staging 0x" << std::hex << hr << std::dec << "\n"; running=false; return; }
    com_ptr<IMFMediaBuffer> buffer; hr = MFCreateMemoryBuffer(outW * outH * 4, buffer.put());
    if (FAILED(hr)) { ctx->Unmap(staging.get(), 0); std::cerr << "ERR MFCreateMemoryBuffer\n"; running=false; return; }
    BYTE* dst = nullptr; DWORD maxLen = 0; buffer->Lock(&dst, &maxLen, nullptr);
    BYTE* src = static_cast<BYTE*>(mapped.pData); const DWORD rowBytes = outW * 4;
    for (int y = 0; y < outH; y++) memcpy(dst + y * rowBytes, src + y * mapped.RowPitch, rowBytes);
    buffer->Unlock(); buffer->SetCurrentLength(rowBytes * outH); ctx->Unmap(staging.get(), 0);
    com_ptr<IMFSample> sample; check(MFCreateSample(sample.put()), "MFCreateSample"); check(sample->AddBuffer(buffer.get()), "AddBuffer");
    LONGLONG dur = 10'000'000LL / fps; sample->SetSampleTime(frameIndex * dur); sample->SetSampleDuration(dur);
    std::lock_guard<std::mutex> lock(writeMutex); hr = writer->WriteSample(stream, sample.get());
    if (SUCCEEDED(hr)) { frameIndex++; if (frameIndex == 1) std::cerr << "FRAME first\n"; } else std::cerr << "ERR WriteSample 0x" << std::hex << hr << std::dec << "\n";
  }

  void start() {
    auto frameToken = pool.FrameArrived([this](auto const& sender, auto const&) {
      while (auto frame = sender.TryGetNextFrame()) {
        auto cs = frame.ContentSize();
        if (cs.Width != width || cs.Height != height) { width = cs.Width; height = cs.Height; pool.Recreate(winrtDevice, wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, cs); return; }
        writeFrame(frame);
      }
    });
    session.StartCapture(); std::cerr << "READY " << outW << "x" << outH << " crop=" << cropX << "," << cropY << " source=" << width << "x" << height << "\n";
    std::string line; while (running && std::getline(std::cin, line)) if (line == "stop") break; running = false;
    pool.FrameArrived(frameToken);
  }

  void stop() { closeCapture(); std::cerr << "FRAMES " << frameIndex << "\n"; if (writer) { writer->Finalize(); writer = nullptr; } MFShutdown(); }
};

static void saveWic(ID3D11DeviceContext* ctx, ID3D11Texture2D* staging, const std::wstring& out, bool jpg) {
  D3D11_TEXTURE2D_DESC desc{}; staging->GetDesc(&desc);
  D3D11_MAPPED_SUBRESOURCE mapped{}; check(ctx->Map(staging, 0, D3D11_MAP_READ, 0, &mapped), "Map screenshot");
  const UINT stride = desc.Width * 4; std::vector<BYTE> pixels(stride * desc.Height);
  BYTE* src = static_cast<BYTE*>(mapped.pData);
  for (UINT y = 0; y < desc.Height; y++) memcpy(pixels.data() + y * stride, src + y * mapped.RowPitch, stride);
  ctx->Unmap(staging, 0);

  com_ptr<IWICImagingFactory> factory; check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())), "WIC factory");
  com_ptr<IWICStream> stream; check(factory->CreateStream(stream.put()), "WIC stream");
  check(stream->InitializeFromFilename(out.c_str(), GENERIC_WRITE), "WIC stream file");
  com_ptr<IWICBitmapEncoder> encoder; check(factory->CreateEncoder(jpg ? GUID_ContainerFormatJpeg : GUID_ContainerFormatPng, nullptr, encoder.put()), "WIC encoder");
  check(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache), "WIC encoder init");
  com_ptr<IWICBitmapFrameEncode> frame; com_ptr<IPropertyBag2> props; check(encoder->CreateNewFrame(frame.put(), props.put()), "WIC frame");
  if (jpg && props) {
    PROPBAG2 opt{}; opt.pstrName = const_cast<LPOLESTR>(L"ImageQuality"); VARIANT val; VariantInit(&val); val.vt = VT_R4; val.fltVal = 0.92f; props->Write(1, &opt, &val); VariantClear(&val);
  }
  check(frame->Initialize(props.get()), "WIC frame init"); check(frame->SetSize(desc.Width, desc.Height), "WIC size");
  WICPixelFormatGUID fmt = jpg ? GUID_WICPixelFormat24bppBGR : GUID_WICPixelFormat32bppBGRA; check(frame->SetPixelFormat(&fmt), "WIC pixel format");
  if (jpg) {
    com_ptr<IWICBitmap> bitmap; check(factory->CreateBitmapFromMemory(desc.Width, desc.Height, GUID_WICPixelFormat32bppBGRA, stride, (UINT)pixels.size(), pixels.data(), bitmap.put()), "WIC bitmap");
    com_ptr<IWICFormatConverter> conv; check(factory->CreateFormatConverter(conv.put()), "WIC converter");
    check(conv->Initialize(bitmap.get(), GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom), "WIC convert init");
    check(frame->WriteSource(conv.get(), nullptr), "WIC write jpg");
  } else {
    check(frame->WritePixels(desc.Height, stride, (UINT)pixels.size(), pixels.data()), "WIC write png");
  }
  check(frame->Commit(), "WIC frame commit"); check(encoder->Commit(), "WIC commit");
}

static int screenshot(int argc, wchar_t** argv) {
  auto out = arg(argc, argv, L"--out"); if (out.empty()) { std::cerr << "usage: win-recorder.exe --screenshot --out file.png [--monitor 0] [--x 0 --y 0 --w 100 --h 100] [--format png|jpg]\n"; return 1; }
  NativeCapture cap; cap.initD3D(); cap.initCaptureMonitor(argi(argc, argv, L"--monitor", 0));
  int x = argi(argc, argv, L"--x", 0), y = argi(argc, argv, L"--y", 0), w = argi(argc, argv, L"--w", cap.width), h = argi(argc, argv, L"--h", cap.height);
  std::mutex m; std::condition_variable cv; bool done = false; com_ptr<ID3D11Texture2D> captured;
  auto token = cap.pool.FrameArrived([&](auto const& sender, auto const&) {
    if (done) return;
    if (auto frame = sender.TryGetNextFrame()) { captured = cap.copyFrame(frame, x, y, w, h); { std::lock_guard<std::mutex> lock(m); done = true; } cv.notify_one(); }
  });
  cap.session.StartCapture();
  { std::unique_lock<std::mutex> lock(m); if (!cv.wait_for(lock, std::chrono::seconds(5), [&]{ return done; })) { std::cerr << "ERR screenshot timeout\n"; return 4; } }
  cap.pool.FrameArrived(token); cap.closeCapture();
  bool jpg = !_wcsicmp(arg(argc, argv, L"--format", L"png").c_str(), L"jpg") || !_wcsicmp(arg(argc, argv, L"--format", L"png").c_str(), L"jpeg");
  saveWic(cap.ctx.get(), captured.get(), out, jpg);
  std::cerr << "DONE\n"; return 0;
}

int wmain(int argc, wchar_t** argv) {
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  if (hasArg(argc, argv, L"--screenshot")) return screenshot(argc, argv);
  auto out = arg(argc, argv, L"--out");
  if (out.empty()) { std::cerr << "usage: win-recorder.exe --out file.mp4 [--monitor 0] [--x 0 --y 0 --width 1280 --height 720] [--fps 30] [--bitrate 8000000]\n"; return 1; }
  Recorder r; r.fps = argi(argc, argv, L"--fps", 30); r.bitrate = argi(argc, argv, L"--bitrate", 8000000);
  r.cropX = argi(argc, argv, L"--x", 0); r.cropY = argi(argc, argv, L"--y", 0);
  r.cropW = argi(argc, argv, L"--width", 0); r.cropH = argi(argc, argv, L"--height", 0);
  r.initD3D(); r.initCaptureMonitor(argi(argc, argv, L"--monitor", 0)); r.prepareCrop(); r.initWriter(out); r.start(); r.stop();
  std::cerr << "DONE\n"; return 0;
}
