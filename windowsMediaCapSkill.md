# Windows Media Capture Skill

## Goal
Add system-audio capture to the existing Windows native video recorder by using:

- **Windows Graphics Capture / existing recorder path** for video frames.
- **WASAPI loopback capture** for system/output audio.
- **Media Foundation Sink Writer** to encode/mux video + audio into MP4.

## Best Windows API for system audio

Use **WASAPI loopback recording**.

Official docs:

- Loopback Recording: https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- `IAudioClient`: https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudioclient
- `IAudioCaptureClient`: https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudiocaptureclient
- `IMMDeviceEnumerator::GetDefaultAudioEndpoint`: https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdeviceenumerator-getdefaultaudioendpoint
- `IAudioClient::Initialize`: https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize

## WASAPI loopback summary

WASAPI loopback captures the audio stream being played by a render endpoint device.

Required setup:

1. Initialize COM on the audio thread.
2. Create `IMMDeviceEnumerator`.
3. Get the default render endpoint:
   ```cpp
   GetDefaultAudioEndpoint(eRender, eConsole, &device)
   ```
4. Activate `IAudioClient` from that render endpoint:
   ```cpp
   device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, ...)
   ```
5. Get the shared mix format:
   ```cpp
   audioClient->GetMixFormat(&waveFormat)
   ```
6. Initialize in shared loopback mode:
   ```cpp
   audioClient->Initialize(
     AUDCLNT_SHAREMODE_SHARED,
     AUDCLNT_STREAMFLAGS_LOOPBACK,
     bufferDuration,
     0,
     waveFormat,
     nullptr
   );
   ```
7. Get `IAudioCaptureClient`:
   ```cpp
   audioClient->GetService(__uuidof(IAudioCaptureClient), ...)
   ```
8. Start capture:
   ```cpp
   audioClient->Start();
   ```
9. In a loop:
   - `GetNextPacketSize`
   - `GetBuffer`
   - copy/process packet data
   - `ReleaseBuffer`

Important notes from Microsoft docs:

- Loopback requires **shared mode**: `AUDCLNT_SHAREMODE_SHARED`.
- Use `AUDCLNT_STREAMFLAGS_LOOPBACK`.
- Get endpoint with `eRender`, not `eCapture`.
- `IAudioCaptureClient` reads packets from the endpoint buffer.
- Packet length is expressed in audio frames.
- Frame byte size comes from `WAVEFORMATEX/WAVEFORMATEXTENSIBLE.nBlockAlign`.
- DRM/protected audio may not be capturable.
- WASAPI loopback captures system mix, not microphone.

## Encoding/muxing API

Use **Media Foundation Sink Writer**.

Official docs:

- `IMFSinkWriter`: https://learn.microsoft.com/en-us/windows/win32/api/mfreadwrite/nn-mfreadwrite-imfsinkwriter
- `MFCreateSinkWriterFromURL`: https://learn.microsoft.com/en-us/windows/win32/api/mfreadwrite/nf-mfreadwrite-mfcreatesinkwriterfromurl
- Sink Writer encode tutorial: https://learn.microsoft.com/en-us/windows/win32/medfound/tutorial--using-the-sink-writer-to-encode-video
- Sink Writer overview: https://learn.microsoft.com/en-us/windows/win32/medfound/sink-writer

Sink Writer flow:

1. `CoInitializeEx`
2. `MFStartup(MF_VERSION)`
3. `MFCreateSinkWriterFromURL(L"output.mp4", NULL, attributes, &writer)`
4. Add video output stream.
5. Set video input media type.
6. Add audio output stream.
7. Set audio input media type.
8. `writer->BeginWriting()`
9. Write video samples with timestamps.
10. Write audio samples with timestamps.
11. `writer->Finalize()`
12. `MFShutdown()`
13. `CoUninitialize()`

## Recommended output formats

For MP4:

### Video

- Output subtype: `MFVideoFormat_H264`
- Input subtype depends on current capture path, commonly:
  - `MFVideoFormat_NV12`, or
  - `MFVideoFormat_RGB32`, if converting through Media Foundation
- Attributes:
  - `MF_MT_MAJOR_TYPE = MFMediaType_Video`
  - `MF_MT_SUBTYPE = MFVideoFormat_H264`
  - `MF_MT_AVG_BITRATE = videoBitrate`
  - `MF_MT_INTERLACE_MODE = MFVideoInterlace_Progressive`
  - `MF_MT_FRAME_SIZE`
  - `MF_MT_FRAME_RATE`
  - `MF_MT_PIXEL_ASPECT_RATIO = 1:1`

### Audio

- Output subtype: `MFAudioFormat_AAC`
- Input subtype: usually PCM from WASAPI mix format
- Recommended output:
  - sample rate: use WASAPI mix rate, often `48000`
  - channels: use WASAPI mix channel count, often `2`
  - bitrate: `128000` or `192000`
- Attributes:
  - `MF_MT_MAJOR_TYPE = MFMediaType_Audio`
  - `MF_MT_SUBTYPE = MFAudioFormat_AAC`
  - `MF_MT_AUDIO_SAMPLES_PER_SECOND`
  - `MF_MT_AUDIO_NUM_CHANNELS`
  - `MF_MT_AUDIO_AVG_BYTES_PER_SECOND`
  - `MF_MT_AUDIO_BITS_PER_SAMPLE` where appropriate

## Timestamp model

Media Foundation timestamps are in **100-nanosecond units**.

Video frame duration:

```cpp
LONGLONG frameDuration = 10'000'000 / fps;
```

Audio duration from frame count:

```cpp
LONGLONG duration = audioFrames * 10'000'000 / sampleRate;
```

For each audio packet:

- Create an `IMFSample`.
- Add an `IMFMediaBuffer` containing PCM audio.
- Set sample time to accumulated audio timestamp.
- Set sample duration based on frame count.
- Call `writer->WriteSample(audioStreamIndex, sample)`.

## Integration plan for BetterSnip native recorder

Current JS starts native recorder with:

```ts
startNativeRecording({ filePath, rect, monitorIndex, fps, bitrate })
```

Add:

```ts
audio: boolean
```

Then pass CLI args in `src/nativeRecorder.ts`:

```txt
--audio true
--audio-bitrate 128000
```

Native `win-recorder.exe` should:

1. Parse `--audio`.
2. Initialize Media Foundation sink writer with video stream as today.
3. If audio enabled:
   - initialize WASAPI loopback capture
   - add AAC output stream
   - set PCM input stream
4. Start video capture and audio capture together.
5. Write both streams into the same `IMFSinkWriter`.
6. On stop, stop WASAPI, stop video capture, finalize sink writer.

## Threading recommendation

Use separate threads:

- Video thread: captures frames and writes video samples.
- Audio thread: reads WASAPI packets and writes audio samples.

Protect `IMFSinkWriter::WriteSample` with a mutex unless the existing implementation guarantees safe serialized access.

## Silence / sync handling

If no audio packets arrive but recording continues:

- Either allow gaps with `SendStreamTick`, or
- Generate silent PCM samples to keep A/V duration aligned.

For simple implementation, generating silence is usually easier for predictable MP4 playback.

## Caveats

- Captures system output audio only, not microphone.
- Microphone capture requires separate WASAPI capture endpoint: `eCapture`.
- App-specific loopback capture exists on newer Windows builds via `AUDIOCLIENT_ACTIVATION_PARAMS`, but default system mix is simpler.
- DRM/protected audio may be silent.
- Default output device changes during recording can break capture; handle device invalidation later.
- WASAPI event-driven loopback works on Windows 10 1703+, older versions need workaround.

## Useful headers/libs

Likely headers:

```cpp
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
```

Likely libs:

```cpp
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "avrt.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
```

## Minimal pseudocode

```cpp
StartRecording() {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  MFStartup(MF_VERSION);

  CreateSinkWriter(outputMp4);
  AddH264VideoStream();

  if (audioEnabled) {
    InitWasapiLoopback();
    AddAacAudioStream();
  }

  writer->BeginWriting();

  StartVideoCaptureThread();
  if (audioEnabled) StartAudioCaptureThread();
}

AudioThread() {
  audioClient->Start();
  while (!stopRequested) {
    UINT32 packetFrames = 0;
    captureClient->GetNextPacketSize(&packetFrames);
    while (packetFrames > 0) {
      BYTE* data;
      UINT32 frames;
      DWORD flags;
      captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);

      WritePcmAudioSampleToSinkWriter(data, frames, flags);

      captureClient->ReleaseBuffer(frames);
      captureClient->GetNextPacketSize(&packetFrames);
    }
    Sleep(5);
  }
  audioClient->Stop();
}

StopRecording() {
  stopRequested = true;
  JoinThreads();
  writer->Finalize();
  MFShutdown();
  CoUninitialize();
}
```
