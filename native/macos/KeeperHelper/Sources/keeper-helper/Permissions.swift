// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Permissions screen's questions to macOS (electron/services/permissions.ts
// starts a fresh helper for each, so answers given since Keeper started show).
//
//   permissions.status               {id: state} for Accessibility, Screen Recording,
//                                    Input Monitoring, Calendars, Reminders, Location,
//                                    Notifications and Automation of four apps
//   permissions.request {id}         shows macOS's own question for one of them
//
// States: authorized, denied, notDetermined, restricted, limited, notRunning, unknown.
// The helper sits inside Keeper.app, so macOS credits Keeper with every answer.

import Foundation
import ApplicationServices
import CoreGraphics
import CoreLocation
import EventKit
import UserNotifications

private let automationTargets: [String: String] = [
    "automation.systemevents": "com.apple.systemevents",
    "automation.finder": "com.apple.finder",
    "automation.music": "com.apple.Music",
    "automation.notes": "com.apple.Notes",
]

// MARK: - one by one

private func accessibilityState(prompt: Bool) -> String {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary) ? "authorized" : "notDetermined"
}

private func screenState(prompt: Bool) -> String {
    if #available(macOS 10.15, *) {
        if CGPreflightScreenCaptureAccess() { return "authorized" }
        if prompt { return CGRequestScreenCaptureAccess() ? "authorized" : "notDetermined" }
        return "notDetermined"
    }
    return "authorized"
}

private func inputState(prompt: Bool) -> String {
    if #available(macOS 10.15, *) {
        if CGPreflightListenEventAccess() { return "authorized" }
        if prompt { return CGRequestListenEventAccess() ? "authorized" : "notDetermined" }
        return "notDetermined"
    }
    return "authorized"
}

private func eventKitState(_ type: EKEntityType) -> String {
    let s = EKEventStore.authorizationStatus(for: type)
    if #available(macOS 14.0, *) {
        switch s {
        case .fullAccess: return "authorized"
        case .writeOnly: return "limited"
        default: break
        }
    }
    switch s {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "authorized"
    }
}

private func locationState() -> String {
    let s: CLAuthorizationStatus
    if #available(macOS 11.0, *) { s = CLLocationManager().authorizationStatus } else { s = CLLocationManager.authorizationStatus() }
    switch s {
    case .notDetermined: return CLLocationManager.locationServicesEnabled() ? "notDetermined" : "denied"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "authorized"
    }
}

/// UNUserNotificationCenter needs an app bundle; a helper run on its own (development) has none.
private func inAppBundle() -> Bool {
    Bundle.main.bundleIdentifier != nil && Bundle.main.bundlePath.hasSuffix(".app")
}

private func notificationState() async -> String {
    guard inAppBundle() else { return "unknown" }
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    switch settings.authorizationStatus {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    default: return "authorized"
    }
}

/// Apple events: the answer for one app (it must be running to be asked).
private func automationState(_ bundleId: String, ask: Bool) -> String {
    var target = AEAddressDesc()
    let bytes = Array(bundleId.utf8)
    let made = bytes.withUnsafeBufferPointer { buf in
        AECreateDesc(DescType(typeApplicationBundleID), buf.baseAddress, buf.count, &target)
    }
    guard made == noErr else { return "unknown" }
    defer { AEDisposeDesc(&target) }
    let status = AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
    switch status {
    case noErr: return "authorized"
    case OSStatus(errAEEventNotPermitted): return "denied"
    case OSStatus(errAEEventWouldRequireUserConsent): return "notDetermined"
    case OSStatus(procNotFound): return "notRunning"
    default: return "unknown"
    }
}

// MARK: - location needs a run loop of its own (the main thread reads requests)

private final class LocationAsker: NSObject, CLLocationManagerDelegate {
    private var manager: CLLocationManager?
    private var finish: ((String) -> Void)?
    private var finished = false
    private let lock = NSLock()

    func ask(_ done: @escaping (String) -> Void) {
        finish = done
        let m = CLLocationManager()
        manager = m
        m.delegate = self
        if #available(macOS 10.15, *) { m.requestWhenInUseAuthorization() }
        // Asking for a position is what shows the question on older macOS.
        m.startUpdatingLocation()
    }

    func end(_ state: String) {
        lock.lock(); defer { lock.unlock() }
        if finished { return }
        finished = true
        manager?.stopUpdatingLocation()
        finish?(state)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = locationState()
        if s != "notDetermined" { end(s) }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) { end("authorized") }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied { end("denied") }
    }
}

private func requestLocation() async -> String {
    await withCheckedContinuation { (c: CheckedContinuation<String, Never>) in
        let thread = Thread {
            let asker = LocationAsker()
            var answer: String?
            asker.ask { answer = $0 }
            let deadline = Date().addingTimeInterval(60)
            while answer == nil && Date() < deadline {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.25))
            }
            asker.end(locationState())
            c.resume(returning: answer ?? locationState())
        }
        thread.start()
    }
}

// MARK: - the two methods

func permissionsStatus() async -> [String: Any] {
    var out: [String: Any] = [
        "accessibility": accessibilityState(prompt: false),
        "screen": screenState(prompt: false),
        "input": inputState(prompt: false),
        "calendars": eventKitState(.event),
        "reminders": eventKitState(.reminder),
        "location": locationState(),
        "notifications": await notificationState(),
    ]
    for (id, bundle) in automationTargets { out[id] = automationState(bundle, ask: false) }
    return out
}

func permissionsRequest(_ params: [String: Any]) async throws -> [String: Any] {
    guard let id = params["id"] as? String else {
        throw NSError(domain: "keeper", code: 4, userInfo: [NSLocalizedDescriptionKey: "No permission id"])
    }
    let state: String
    switch id {
    case "accessibility": state = accessibilityState(prompt: true)
    case "screen": state = screenState(prompt: true)
    case "input": state = inputState(prompt: true)
    case "calendars": state = (try? await ekAccess(.event)) == true ? "authorized" : eventKitState(.event)
    case "reminders": state = (try? await ekAccess(.reminder)) == true ? "authorized" : eventKitState(.reminder)
    case "location": state = await requestLocation()
    case "notifications":
        guard inAppBundle() else { state = "unknown"; break }
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        state = ok ? "authorized" : await notificationState()
    case let a where automationTargets[a] != nil:
        state = automationState(automationTargets[a]!, ask: true)
    default:
        throw NSError(domain: "keeper", code: 6, userInfo: [NSLocalizedDescriptionKey: "Unknown permission \(id)"])
    }
    return ["id": id, "state": state]
}
