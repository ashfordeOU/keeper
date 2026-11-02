// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio's screen recording on macOS, all through public APIs:
//
//   studio.support  can this Mac record with ScreenCaptureKit, and is Screen
//                   Recording allowed (asks nothing)
//   studio.record   records a display, an area of it or one window with
//                   ScreenCaptureKit (no pointer in the picture, up to 60 fps,
//                   full Retina pixels) into an MP4 with AVAssetWriter (H.264,
//                   or HEVC when asked), with the computer's sound as a second
//                   track when asked. Streams one JSON line when it is ready
//                   ({"t":"ready",…}) and one with the wall-clock time of the
//                   first frame ({"t":"first","wall":ms}); answers when the
//                   file is finished. Needs Screen Recording permission.
//   studio.stop     ends the recording with that token (the file is finished
//                   properly, then studio.record answers)
//
// Dispatch: one `case` in main.swift sends every "studio.*" method here.

@preconcurrency import Foundation
import AppKit
import AVFoundation
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

func studioCall(id: Int, method: String, params: [String: Any]) async throws -> [String: Any] {
    switch method {
    case "studio.support":
        if #available(macOS 13.0, *) { return ["available": true, "allowed": CGPreflightScreenCaptureAccess()] }
        return ["available": false, "allowed": CGPreflightScreenCaptureAccess()]
    case "studio.stop":
        StudioStops.shared.stop((params["token"] as? String) ?? "")
        return ["ok": true]
    case "studio.record":
        if #available(macOS 13.0, *) { return try await studioRecord(id: id, params) }
        throw NSError(domain: "keeper", code: 80, userInfo: [NSLocalizedDescriptionKey: "Studio recording needs macOS 13 or later"])
    default:
        throw NSError(domain: "keeper", code: 81, userInfo: [NSLocalizedDescriptionKey: "Unknown method \(method)"])
    }
}

/// Tokens of recordings asked to stop.
final class StudioStops: @unchecked Sendable {
    static let shared = StudioStops()
    private let lock = NSLock()
    private var tokens = Set<String>()
    func stop(_ t: String) { lock.lock(); tokens.insert(t); lock.unlock() }
    func take(_ t: String) -> Bool { lock.lock(); defer { lock.unlock() }; return tokens.remove(t) != nil }
}

private func studioSend(_ id: Int, _ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    Wire.shared.delta(id, s)
}

private func studioError(_ code: Int, _ text: String) -> NSError {
    NSError(domain: "keeper", code: code, userInfo: [NSLocalizedDescriptionKey: text])
}

@available(macOS 13.0, *)
final class StudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let id: Int
    let url: URL
    let width: Int
    let height: Int
    let fps: Int
    let hevc: Bool
    let wantAudio: Bool
    let queue = DispatchQueue(label: "keeper.studio.capture")
    var stream: SCStream?
    var writer: AVAssetWriter?
    var video: AVAssetWriterInput?
    var audio: AVAssetWriterInput?
    var started = false
    var frames = 0
    var failed: Error?

    init(id: Int, url: URL, width: Int, height: Int, fps: Int, hevc: Bool, audio: Bool) {
        self.id = id; self.url = url; self.width = width; self.height = height; self.fps = fps; self.hevc = hevc; self.wantAudio = audio
    }

    func start(filter: SCContentFilter, cfg: SCStreamConfiguration) async throws {
        try? FileManager.default.removeItem(at: url)
        let w = try AVAssetWriter(outputURL: url, fileType: .mp4)
        var props: [String: Any] = [
            AVVideoAverageBitRateKey: max(4_000_000, min(120_000_000, Int(Double(width * height * fps) * 0.12))),
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoAllowFrameReorderingKey: false,
        ]
        if !hevc { props[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
        let v = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: hevc ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: props,
        ])
        v.expectsMediaDataInRealTime = true
        guard w.canAdd(v) else { throw studioError(82, "The video writer refused the picture settings") }
        w.add(v)
        if wantAudio {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000,
            ])
            a.expectsMediaDataInRealTime = true
            if w.canAdd(a) { w.add(a); audio = a }
        }
        writer = w
        video = v
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if audio != nil { try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
        try await s.startCapture()
        stream = s
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sb.isValid, let w = writer, failed == nil else { return }
        if type == .screen {
            // only frames with new pixels (idle and blank ones carry no picture)
            guard let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let raw = atts.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw), status == .complete else { return }
            let pts = CMSampleBufferGetPresentationTimeStamp(sb)
            if !started {
                guard w.startWriting() else { failed = w.error ?? studioError(83, "The video file could not be started"); return }
                w.startSession(atSourceTime: pts)
                started = true
                // the frame's pts is on the host clock: its age now gives its wall-clock time
                let age = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())) - CMTimeGetSeconds(pts)
                studioSend(id, ["t": "first", "wall": (Date().timeIntervalSince1970 - max(0, age)) * 1000])
            }
            if let v = video, v.isReadyForMoreMediaData, v.append(sb) { frames += 1 }
        } else if type == .audio, started, let a = audio, a.isReadyForMoreMediaData {
            a.append(sb)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { failed = error }

    func finish() async -> [String: Any] {
        try? await stream?.stopCapture()
        // let frames already queued land first
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in queue.async { c.resume() } }
        guard let w = writer, started else { return ["frames": 0] }
        video?.markAsFinished()
        audio?.markAsFinished()
        await w.finishWriting()
        var out: [String: Any] = ["path": url.path, "frames": frames, "width": width, "height": height, "audio": audio != nil]
        if w.status != .completed { out["error"] = w.error?.localizedDescription ?? "The video file was not finished" }
        return out
    }
}

private func backingScale(_ displayID: CGDirectDisplayID) -> Double {
    for s in NSScreen.screens {
        if let n = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber, n.uint32Value == displayID { return Double(s.backingScaleFactor) }
    }
    return 2
}

private func even(_ v: Double) -> Int { max(2, Int((v / 2).rounded()) * 2) }

@available(macOS 13.0, *)
func studioRecord(id: Int, _ p: [String: Any]) async throws -> [String: Any] {
    guard let path = p["path"] as? String, let token = p["token"] as? String else { throw studioError(84, "No file to record into") }
    if !CGPreflightScreenCaptureAccess() {
        _ = CGRequestScreenCaptureAccess()
        throw studioError(85, "Allow Keeper in System Settings → Privacy & Security → Screen & System Audio Recording, then try again")
    }
    let fps = max(1, min(120, (p["fps"] as? Int) ?? 60))
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let cfg = SCStreamConfiguration()
    cfg.showsCursor = (p["showsCursor"] as? Bool) ?? false
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    cfg.queueDepth = 6
    let filter: SCContentFilter
    var frame: CGRect
    var scale: Double
    if let wid = p["windowId"] as? Int, wid > 0 {
        guard let win = content.windows.first(where: { Int($0.windowID) == wid }) else { throw studioError(86, "That window is no longer open") }
        filter = SCContentFilter(desktopIndependentWindow: win)
        frame = win.frame
        let d = content.displays.first(where: { $0.frame.intersects(win.frame) }) ?? content.displays.first
        scale = d.map { backingScale($0.displayID) } ?? 2
    } else {
        let want = (p["displayId"] as? Int) ?? Int(CGMainDisplayID())
        guard let d = content.displays.first(where: { Int($0.displayID) == want }) ?? content.displays.first else { throw studioError(87, "No display to record") }
        filter = SCContentFilter(display: d, excludingWindows: [])
        scale = backingScale(d.displayID)
        frame = d.frame
        if let r = p["rect"] as? [String: Any], let x = r["x"] as? Double, let y = r["y"] as? Double, let w = r["w"] as? Double, let h = r["h"] as? Double, w > 4, h > 4 {
            // the area, in points from the display's top-left corner
            cfg.sourceRect = CGRect(x: x, y: y, width: w, height: h)
            frame = CGRect(x: d.frame.minX + x, y: d.frame.minY + y, width: w, height: h)
        }
    }
    if let s = p["scale"] as? Double, s > 0 { scale = s }
    let width = even(frame.width * scale), height = even(frame.height * scale)
    cfg.width = width
    cfg.height = height
    let wantAudio = (p["systemAudio"] as? Bool) ?? false
    if wantAudio {
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 2
    }
    let rec = StudioRecorder(id: id, url: URL(fileURLWithPath: path), width: width, height: height, fps: fps, hevc: (p["codec"] as? String) == "hevc", audio: wantAudio)
    try await rec.start(filter: filter, cfg: cfg)
    studioSend(id, ["t": "ready", "width": width, "height": height, "scale": scale, "x": frame.minX, "y": frame.minY, "w": frame.width, "h": frame.height])
    while !Task.isCancelled && rec.failed == nil && !StudioStops.shared.take(token) {
        try? await Task.sleep(nanoseconds: 50_000_000)
    }
    let res = await rec.finish()
    if let e = rec.failed, ((res["frames"] as? Int) ?? 0) == 0 { throw e }
    return res
}
