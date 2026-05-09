# Capture Skill: Native Windows GPU Recorder Pipeline

## Goal

Implement a high-performance Windows screen recorder by moving capture and encoding out of Electron and into a native GPU-first backend.

```text
Windows.Graphics.Capture
        ↓
Direct3D11 texture
        ↓
optional GPU scale/crop/convert
        ↓
hardware encoder: Media Foundation / NVENC / Quick Sync / AMF
        ↓
MP4/MKV output
```

Recommended architecture: Electron UI controls a separate native recorder process via IPC. The native process owns capture, D3D11 resources, encoding, muxing, audio capture, and crash recovery.

---

## Primary capture API: Windows.Graphics.Capture

Use this for Windows 10/11 when possible.

### Why

- Modern Windows capture API for displays and application windows.
- Captures compositor output into Direct3D surfaces.
- Good fit for monitor, window, and region capture.
- Can keep frames on GPU and avoid Electron/JS CPU copies.
- Works well with Direct3D11 and Media Foundation hardware encoders.

### Availability

- `Windows.Graphics.Capture` starts in Windows 10 version 1803.
- Practical production target should be Windows 10 1903+; example project `mmozeiko/wcap` uses Windows 10 1903+.
- Screen capture APIs are supported on Windows devices and Windows Mixed Reality immersive headsets.

### User consent / picker

The normal API path invokes secure system UI so the user picks a display or application window. Windows draws a capture notification border around actively captured content.

Key types:

- `GraphicsCapturePicker`
- `GraphicsCaptureItem`
- `GraphicsCaptureSession`
- `Direct3D11CaptureFramePool`
- `Direct3D11CaptureFrame`

Basic flow:

1. Check support:
   - `GraphicsCaptureSession::IsSupported()`
2. Ask user to pick target:
   - `GraphicsCapturePicker::PickSingleItemAsync()`
3. Create frame pool:
   - `Direct3D11CaptureFramePool::Create(...)`
4. Create session:
   - `framePool.CreateCaptureSession(item)`
5. Start:
   - `session.StartCapture()`
6. Consume frames through:
   - `framePool.FrameArrived`
   - or `framePool.TryGetNextFrame()` polling

### Frame pool setup

Create the frame pool from the selected `GraphicsCaptureItem`:

```cpp
Direct3D11CaptureFramePool::Create(
    d3dDevice,
    DirectXPixelFormat::B8G8R8A8UIntNormalized,
    2,              // buffer count
    item.Size());   // initial buffer size
```

Important:

- Use `DXGI_FORMAT_B8G8R8A8_UNORM` / `B8G8R8A8UIntNormalized` for SDR.
- For HDR / Windows HD Color, consider `DXGI_FORMAT_R16G16B16A16_FLOAT` across the full pipeline to avoid washed-out overclipping. Then either save HDR or tone-map to SDR.
- `Direct3D11CaptureFrame.Surface` is the GPU surface to process/encode.
- `Direct3D11CaptureFrame.SystemRelativeTime` is QPC time and can sync with audio.
- Do not do frame handling on the UI thread. `FrameArrived` fires frequently.
- Dispose/release each `Direct3D11CaptureFrame` promptly; disposal returns it to the pool.
- Do not retain the frame object or underlying surface after returning it to the pool. Copy/submit it first.
- While processing native frames, take the `ID3D11Multithread` lock on the associated D3D11 device if needed.

### Resize/device-lost handling

- Use `Direct3D11CaptureFramePool::Recreate(...)` when size, buffer count, or D3D device changes.
- `Recreate` discards existing frames, so drain/process pending frames first if possible.
- Frame pool surfaces are always the size specified at creation/recreation.
- Use `frame.ContentSize` to copy only valid content; if content is smaller than the surface, the rest is undefined.

### Cursor/border notes

- Cursor inclusion controls depend on Windows version. `wcap` notes cursor exclusion is available on Windows 10 2004+.
- Windows 11 can disable recording indication borders in supported cases.
- Rounded-corner/window-secondary capture behavior has Windows-version-specific APIs; feature-detect.

---

## Fallback capture API: Desktop Duplication API

Use as fallback or for older/full-monitor capture.

### Why

- Available since Windows 8.
- Uses DXGI surfaces and supports GPU processing.
- Good for full monitor capture.

### Limitations

- Monitor/output oriented, not as convenient for per-window capture.
- Requires explicit handling for dirty rects, move rects, pointer shape, rotation, multi-monitor, and access-loss recovery.
- `AcquireNextFrame` can return `DXGI_ERROR_ACCESS_LOST` or `DXGI_ERROR_WAIT_TIMEOUT`; recover/reinitialize as needed.

### Key interfaces/functions

- `IDXGIOutputDuplication`
- `IDXGIOutputDuplication::AcquireNextFrame(timeout, &frameInfo, &resource)`
- Query returned `IDXGIResource` for `ID3D11Texture2D`
- `IDXGIOutputDuplication::GetFrameMoveRects(...)`
- `IDXGIOutputDuplication::GetFrameDirtyRects(...)`
- `IDXGIOutputDuplication::GetFramePointerShape(...)`
- `IDXGIOutputDuplication::ReleaseFrame()`

Desktop image format from Desktop Duplication is always:

```cpp
DXGI_FORMAT_B8G8R8A8_UNORM
```

Process update metadata in this order:

1. Move rects
2. Dirty rects

Rotation: surfaces returned by `AcquireNextFrame` are unrotated, with rotated desktop content inside. Apply per-monitor rotation before encoding/display.

Pointer: pointer may already be baked into the desktop image or supplied separately. Use `DXGI_OUTDUPL_FRAME_INFO::PointerPosition` and `GetFramePointerShape` when the pointer is separate.

---

## D3D11 GPU processing stage

Keep all video frames as GPU textures until encoder input.

Responsibilities:

- Crop selected region/window/client area.
- Scale down to max recording width/height.
- Frame-rate throttle/drop to target FPS.
- Convert RGB/BGRA to encoder-friendly YUV, usually NV12/P010.
- Optional color management / HDR tone map.
- Optional cursor composition if capture API does not provide cursor in frame.

Recommended D3D resources:

- Capture texture: usually BGRA8 or FP16 HDR.
- Intermediate render target for crop/scale.
- Compute/pixel shader conversion to NV12/P010.
- Encoder input texture/surface if using GPU path.

Performance rules:

- Avoid `Map`/CPU readback for every frame.
- Avoid copying frames into JS/Electron buffers.
- Prefer shader-based scale/convert.
- Use timestamps from capture frames, not wall-clock guessing.
- Bound frame queue size; drop late frames instead of growing latency.

---

## Encoding: Media Foundation first

Use Media Foundation for broad Windows support and container output.

### Sink Writer

`IMFSinkWriter` is the high-level component for encoding audio/video files. It:

- Loads a media sink.
- Finds and loads encoders.
- Manages flow to encoders and muxer/sink.

Typical setup:

1. `CoInitializeEx(...)`
2. `MFStartup(MF_VERSION)`
3. `MFCreateSinkWriterFromURL(outputPath, NULL, attributes, &writer)`
4. Create output `IMFMediaType`
5. `writer->AddStream(outputType, &streamIndex)`
6. Create input `IMFMediaType`
7. `writer->SetInputMediaType(streamIndex, inputType, encoderAttributes)`
8. `writer->BeginWriting()`
9. For each frame:
   - create/reuse `IMFSample`
   - set sample buffer/texture
   - `sample->SetSampleTime(...)`
   - `sample->SetSampleDuration(...)`
   - `writer->WriteSample(streamIndex, sample)`
10. `writer->Finalize()`
11. `MFShutdown()`

### H.264 encoder MFT

Microsoft H.264 encoder:

- Interfaces: `ICodecAPI`, `IMFTransform`
- Output subtype: `MFVideoFormat_H264`
- Input subtypes include:
  - `MFVideoFormat_I420`
  - `MFVideoFormat_IYUV`
  - `MFVideoFormat_NV12`
  - `MFVideoFormat_YUY2`
  - `MFVideoFormat_YV12`

Set output type before input type, otherwise `SetInputType` can return `MF_E_TRANSFORM_TYPE_NOT_SET`.

Required output media type attributes:

- `MF_MT_MAJOR_TYPE = MFMediaType_Video`
- `MF_MT_SUBTYPE = MFVideoFormat_H264`
- `MF_MT_AVG_BITRATE` > 0
- `MF_MT_FRAME_RATE`
- `MF_MT_FRAME_SIZE`
- `MF_MT_INTERLACE_MODE = MFVideoInterlace_Progressive`
- `MF_MT_MPEG2_PROFILE`
- Optional: `MF_MT_MPEG2_LEVEL`, usually let encoder choose
- Optional: `MF_MT_PIXEL_ASPECT_RATIO = 1:1`

Useful `ICodecAPI` properties:

- `CODECAPI_AVEncCommonRateControlMode`
- `CODECAPI_AVEncCommonMeanBitRate`
- `CODECAPI_AVEncCommonMaxBitRate`
- `CODECAPI_AVEncCommonQuality`
- `CODECAPI_AVEncCommonQualityVsSpeed`
- `CODECAPI_AVEncMPVGOPSize`
- `CODECAPI_AVEncMPVDefaultBPictureCount`
- `CODECAPI_AVEncVideoForceKeyFrame`
- `CODECAPI_AVLowLatencyMode`
- `CODECAPI_AVEncVideoEncodeQP`

Rate-control modes:

- CBR: `eAVEncCommonRateControlMode_CBR`
- Peak constrained VBR: `eAVEncCommonRateControlMode_PeakConstrainedVBR`
- Quality VBR: `eAVEncCommonRateControlMode_Quality`
- Unconstrained VBR: default in older paths

### Hardware acceleration

Media Foundation can use hardware MFTs when available. Hardware MFT concepts:

- Hardware MFTs are asynchronous.
- Hardware MFTs support dynamic format changes.
- Key attributes include:
  - `MF_TRANSFORM_ASYNC = TRUE`
  - `MFT_ENUM_HARDWARE_URL_Attribute`
  - `MFT_SUPPORT_DYNAMIC_FORMAT_CHANGE = TRUE`

Implementation strategy:

- Try hardware encoder first.
- Fall back to Microsoft software encoder if hardware fails.
- Expose user settings for codec and hardware/software choice.
- Tell users to update GPU drivers when hardware encode fails.

For maximum control or codecs beyond what MF exposes, use vendor SDKs:

- NVIDIA NVENC
- Intel Quick Sync / oneVPL / Media SDK
- AMD AMF

But for simplest Windows-native implementation, start with Media Foundation Sink Writer and hardware transforms.

---

## Containers and file output

Recommended:

- MP4 via Media Foundation for H.264/H.265/AV1 where supported.
- Consider fragmented MP4 for crash-resilient recordings. Fragmented MP4 may be larger and seek slower but can remain playable if the process/GPU/disk fails before finalize.
- MKV is not a strong native Media Foundation target; use FFmpeg/libavformat or another muxer if MKV is required.

Call `IMFSinkWriter::Finalize()` for normal MP4 output. Without finalization, normal MP4 may be unplayable.

---

## Audio capture

For system audio:

- Use WASAPI loopback capture.
- Encode AAC with Media Foundation.
- Synchronize audio/video using QPC-based timestamps; `Direct3D11CaptureFrame.SystemRelativeTime` is QPC.

For app-local audio capture, investigate Windows app audio capture APIs where available, otherwise WASAPI loopback records system mix.

---

## Recommended implementation plan

1. Build a native C++ recorder process.
2. Initialize D3D11 device with BGRA support.
3. Use `Windows.Graphics.Capture` to select/capture monitor/window.
4. Create `Direct3D11CaptureFramePool` with 2-3 buffers.
5. On frame arrival, immediately dequeue frame and hand the surface to a bounded GPU pipeline.
6. Crop/scale/convert on GPU to encoder input format, preferably NV12/P010.
7. Encode using Media Foundation hardware encoder through Sink Writer or direct MFT path.
8. Capture audio using WASAPI loopback and encode AAC.
9. Mux to MP4; optionally use fragmented MP4.
10. Expose Electron IPC commands: `start`, `stop`, `pause`, `resume`, `setRegion`, `setFps`, `setBitrate`, `status`.
11. Log dropped frames, encoder latency, queue depth, GPU/device-lost events.
12. Add Desktop Duplication fallback for monitor capture if WGC unsupported.

---

## References

- Microsoft Learn: Screen capture / `Windows.Graphics.Capture`  
  https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture
- Microsoft Learn: Desktop Duplication API  
  https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api
- Microsoft Learn: Media Foundation Sink Writer  
  https://learn.microsoft.com/en-us/windows/win32/medfound/sink-writer
- Microsoft Learn: Using Sink Writer to Encode Video  
  https://learn.microsoft.com/en-us/windows/win32/medfound/tutorial--using-the-sink-writer-to-encode-video
- Microsoft Learn: H.264 Video Encoder  
  https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder
- Microsoft Learn: Hardware MFTs  
  https://learn.microsoft.com/en-us/windows/win32/medfound/hardware-mfts
- Example implementation: `mmozeiko/wcap`  
  https://github.com/mmozeiko/wcap
