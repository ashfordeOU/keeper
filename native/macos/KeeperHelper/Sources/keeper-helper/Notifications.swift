// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Other apps' notifications for the Island (opt-in). macOS has no public way
// to read another app's notifications, so this reads the banners Notification
// Centre puts on screen through Accessibility — the same text VoiceOver reads —
// and can close a banner after Keeper has shown it. It needs the Accessibility
// permission and may stop working when macOS changes how banners are drawn;
// Keeper then says so and carries on without it.
//
//   notifications.status   { trusted, running }
//   notifications.watch    a long call: one delta per banner (JSON), until cancelled
//                          params: { dismiss: Bool } closes each banner after reading it

import Foundation
import ApplicationServices
import AppKit

private func axValue(_ el: AXUIElement, _ attr: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success ? v : nil
}

private func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    (axValue(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

/// The visible texts of a banner, top to bottom (app name, title, subtitle, body).
private func bannerTexts(_ el: AXUIElement, depth: Int = 0, into out: inout [String]) {
    if depth > 12 || out.count > 12 { return }
    let role = axValue(el, kAXRoleAttribute as String) as? String ?? ""
    if role == kAXStaticTextRole as String, let s = axValue(el, kAXValueAttribute as String) as? String {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty && !out.contains(t) { out.append(t) }
    }
    for c in axChildren(el) { bannerTexts(c, depth: depth + 1, into: &out) }
}

/// Elements that look like single notifications (groups of texts with a Close action).
private func banners(in el: AXUIElement, depth: Int = 0, into out: inout [AXUIElement]) {
    if depth > 10 { return }
    var names: CFArray?
    if AXUIElementCopyActionNames(el, &names) == .success, let list = names as? [String],
       list.contains(where: { $0.localizedCaseInsensitiveContains("close") || $0 == "AXPress" }) {
        let role = axValue(el, kAXRoleAttribute as String) as? String ?? ""
        let sub = axValue(el, kAXSubroleAttribute as String) as? String ?? ""
        if role == "AXGroup" || sub.contains("Notification") {
            out.append(el)
            return
        }
    }
    for c in axChildren(el) { banners(in: c, depth: depth + 1, into: &out) }
}

private func closeBanner(_ el: AXUIElement) {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success, let list = names as? [String] else { return }
    if let close = list.first(where: { $0.localizedCaseInsensitiveContains("close") }) {
        AXUIElementPerformAction(el, close as CFString)
    }
}

private func notificationCentrePid() -> pid_t? {
    NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.notificationcenterui").first?.processIdentifier
}

func notificationsStatus() -> [String: Any] {
    ["trusted": AXIsProcessTrusted(), "running": notificationCentrePid() != nil]
}

/// Reads banners as they appear. Looks once a second while a watch is open (cheap
/// Accessibility reads of one small window), and only then.
func notificationsWatch(id: Int, params: [String: Any]) async throws {
    guard AXIsProcessTrusted() else {
        throw NSError(domain: "keeper", code: 40, userInfo: [NSLocalizedDescriptionKey: "Keeper needs the Accessibility permission to read notifications (System Settings → Privacy & Security → Accessibility)"])
    }
    let dismiss = (params["dismiss"] as? Bool) ?? false
    var seen: [String: Date] = [:]
    while !Task.isCancelled {
        if let pid = notificationCentrePid() {
            let app = AXUIElementCreateApplication(pid)
            for win in (axValue(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? [] {
                var found: [AXUIElement] = []
                banners(in: win, into: &found)
                for b in found {
                    var texts: [String] = []
                    bannerTexts(b, into: &texts)
                    if texts.isEmpty { continue }
                    let key = texts.joined(separator: "\u{1F}")
                    if seen[key] != nil { continue }
                    seen[key] = Date()
                    let o: [String: Any] = ["texts": texts, "id": String(key.hashValue, radix: 36)]
                    if let data = try? JSONSerialization.data(withJSONObject: o), let s = String(data: data, encoding: .utf8) {
                        Wire.shared.delta(id, s)
                    }
                    if dismiss { closeBanner(b) }
                }
            }
        }
        // Forget old ones so the same message later shows again.
        let cutoff = Date().addingTimeInterval(-60)
        seen = seen.filter { $0.value > cutoff }
        try await Task.sleep(nanoseconds: 1_000_000_000)
    }
}
