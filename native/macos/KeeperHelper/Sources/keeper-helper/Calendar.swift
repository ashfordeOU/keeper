// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Mac's own calendars for Keeper's Calendar and the Island, through
// EventKit: every account added in the Calendar app (iCloud, Google,
// Exchange, CalDAV, subscriptions) without signing in again in Keeper.
//
//   calendar.status   {}                            → {status, raw}   (never asks)
//   calendar.access   {request?: bool}              → {status}
//   calendar.events   {from, to}                    → {calendars: [...], events: [...], truncated}
//   calendar.watch    (streams "changed" whenever the Calendar database changes; runs until cancelled)
//   calendar.save     {calendar?, id?, occurrence?, all?, title, start, end, allDay, location?, notes?, url?, alarms?, rrule?} → {id}
//   calendar.delete   {id, occurrence?, all?}        → {ok}
//
// Times are milliseconds since 1970. status is granted, writeOnly, denied,
// restricted or notDetermined. raw is EventKit's own name for the state
// (fullAccess, authorized, writeOnly, denied, restricted, notDetermined).
//
// Keeper keeps one helper running for hours. The Permissions screen asks macOS
// from a helper of its own, so this one may have been started before access
// was given: its event store then sees no calendars until it is reset, and
// macOS may keep answering "notDetermined" to it. So the store is reset before
// the first read after access was given, and an answer this helper got itself
// ("allowed" or "not allowed") counts over a stale status.

import Foundation
import EventKit
import CoreGraphics

/// What this helper itself was told when it asked: nil (it did not ask), true (allowed) or false (not allowed).
final class CalendarAnswer: @unchecked Sendable {
    static let shared = CalendarAnswer()
    private let lock = NSLock()
    private var answer: Bool?
    /// the event store has been reset since access was given
    private var fresh = false
    var asked: Bool? { lock.lock(); defer { lock.unlock() }; return answer }
    func set(_ ok: Bool) { lock.lock(); answer = ok; if ok { fresh = false }; lock.unlock() }
    /// true once per access: the store must be reset before it is read
    func needsReset() -> Bool { lock.lock(); defer { lock.unlock() }; if fresh { return false }; fresh = true; return true }
}

/// EventKit's own name for the authorization state (macOS 14 and later split "authorized" into fullAccess and writeOnly).
func calendarRawStatus() -> String {
    let s = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        if s == .fullAccess { return "fullAccess" }
        if s == .writeOnly { return "writeOnly" }
    }
    switch s {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "authorized"
    default: return "unknown"
    }
}

func calendarStatus() -> String {
    let raw = calendarRawStatus()
    switch raw {
    case "fullAccess", "authorized": return "granted"
    case "writeOnly", "denied", "restricted": return raw
    case "notDetermined":
        // Asked from this helper already: its own answer counts (macOS may still say notDetermined here).
        if let a = CalendarAnswer.shared.asked { return a ? "granted" : "denied" }
        return "notDetermined"
    default: return "denied"
    }
}

func calendarAccess(_ p: [String: Any]) async -> [String: Any] {
    // Asked again even when this helper thinks it is still undecided: access given from
    // another helper (the Permissions screen) answers at once, without a prompt.
    if (p["request"] as? Bool) == true && calendarStatus() == "notDetermined" {
        let ok = (try? await ekAccess(.event)) ?? false
        CalendarAnswer.shared.set(ok)
        // A store made before access was given does not see the calendars until it is reset.
        if ok { eventStore.reset() }
    }
    return ["status": calendarStatus(), "raw": calendarRawStatus()]
}

private func hexColor(_ c: CGColor?) -> String? {
    guard let c = c, let space = CGColorSpace(name: CGColorSpace.sRGB),
          let rgb = c.converted(to: space, intent: .defaultIntent, options: nil),
          let comps = rgb.components, comps.count >= 3 else { return nil }
    let v = comps.prefix(3).map { Int(max(0, min(1, $0)) * 255 + 0.5) }
    return String(format: "#%02x%02x%02x", v[0], v[1], v[2])
}

private func calendarType(_ t: EKCalendarType) -> String {
    switch t {
    case .local: return "local"
    case .calDAV: return "caldav"
    case .exchange: return "exchange"
    case .subscription: return "subscription"
    case .birthday: return "birthday"
    @unknown default: return "other"
    }
}

private func email(_ p: EKParticipant) -> String? {
    let s = p.url.absoluteString
    return s.lowercased().hasPrefix("mailto:") ? String(s.dropFirst(7)) : nil
}

private func participantStatus(_ s: EKParticipantStatus) -> String {
    switch s {
    case .accepted: return "accepted"
    case .declined: return "declined"
    case .tentative: return "tentative"
    default: return "needs-action"
    }
}

private func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }

func calendarEvents(_ p: [String: Any]) async throws -> [String: Any] {
    guard calendarStatus() == "granted" else { throw ekDenied("Calendar") }
    // The first read after access was given: a store made before then shows no calendars.
    if CalendarAnswer.shared.needsReset() { eventStore.reset() }
    let now = Date().timeIntervalSince1970 * 1000
    let from = Date(timeIntervalSince1970: ((p["from"] as? Double) ?? (now - 86_400_000 * 14)) / 1000)
    let to = Date(timeIntervalSince1970: ((p["to"] as? Double) ?? (now + 86_400_000 * 60)) / 1000)
    let cals = eventStore.calendars(for: .event)
    let calendars: [[String: Any]] = cals.map { c in
        var o: [String: Any] = [
            "id": c.calendarIdentifier,
            "title": c.title,
            "writable": c.allowsContentModifications,
            "type": calendarType(c.type),
        ]
        if let hex = hexColor(c.cgColor) { o["color"] = hex }
        if let s = c.source?.title { o["source"] = s }
        return o
    }
    // EventKit searches at most four years at a time; Keeper asks for a few months.
    let pred = eventStore.predicateForEvents(withStart: from, end: to, calendars: nil)
    let all = eventStore.events(matching: pred)
    let limit = 3000
    let events: [[String: Any]] = all.prefix(limit).map { e in
        var o: [String: Any] = [
            "id": e.eventIdentifier ?? e.calendarItemIdentifier,
            "item": e.calendarItemIdentifier,
            "calendar": e.calendar?.calendarIdentifier ?? "",
            "title": e.title ?? "",
            "start": ms(e.startDate),
            "end": ms(e.endDate),
            "allDay": e.isAllDay,
            "recurring": e.hasRecurrenceRules || e.isDetached,
        ]
        switch e.status {
        case .confirmed: o["status"] = "confirmed"
        case .tentative: o["status"] = "tentative"
        case .canceled: o["status"] = "cancelled"
        default: break
        }
        if let tz = e.timeZone?.identifier { o["timeZone"] = tz }
        if let l = e.location, !l.isEmpty { o["location"] = l }
        if let u = e.url?.absoluteString { o["url"] = u }
        if let n = e.notes, !n.isEmpty { o["notes"] = String(n.prefix(4000)) }
        if let alarms = e.alarms, !alarms.isEmpty {
            o["alarms"] = alarms.compactMap { a -> Int? in a.absoluteDate == nil ? Int((-a.relativeOffset / 60).rounded()) : nil }
        }
        if let org = e.organizer {
            var x: [String: Any] = [:]
            if let n = org.name { x["name"] = n }
            if let m = email(org) { x["email"] = m }
            o["organizer"] = x
        }
        if let people = e.attendees, !people.isEmpty {
            o["attendees"] = people.prefix(100).map { a -> [String: Any] in
                var x: [String: Any] = ["status": participantStatus(a.participantStatus)]
                if let n = a.name { x["name"] = n }
                if let m = email(a) { x["email"] = m }
                return x
            }
        }
        return o
    }
    return ["calendars": calendars, "events": events, "truncated": all.count > limit]
}

/// Streams "changed" (a short pause after the last change) until the request is cancelled.
func calendarWatch(id: Int) async throws {
    final class Pending: @unchecked Sendable { var waiting = false }
    let pending = Pending()
    let queue = DispatchQueue(label: "keeper.calendar.watch")
    let token = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: eventStore, queue: nil) { _ in
        queue.async {
            if pending.waiting { return }
            pending.waiting = true
            queue.asyncAfter(deadline: .now() + 0.8) {
                pending.waiting = false
                Wire.shared.delta(id, "changed")
            }
        }
    }
    defer { NotificationCenter.default.removeObserver(token) }
    Wire.shared.delta(id, "ready")
    while !Task.isCancelled { try await Task.sleep(nanoseconds: 3_600_000_000_000) }
}

private func calendarError(_ text: String) -> NSError {
    NSError(domain: "keeper", code: 12, userInfo: [NSLocalizedDescriptionKey: text])
}

/// One event by its identifier; for a repeating event, the occurrence that starts at `occurrence`.
private func findEvent(_ id: String, occurrence: Double?) throws -> EKEvent {
    if let occ = occurrence {
        let at = Date(timeIntervalSince1970: occ / 1000)
        let pred = eventStore.predicateForEvents(withStart: at.addingTimeInterval(-60), end: at.addingTimeInterval(2 * 86_400), calendars: nil)
        if let e = eventStore.events(matching: pred).first(where: { $0.eventIdentifier == id && abs($0.startDate.timeIntervalSince(at)) < 1 }) { return e }
    }
    guard let e = eventStore.event(withIdentifier: id) else { throw calendarError("That event is gone from Calendar") }
    return e
}

private let weekdays: [String: EKWeekday] = ["SU": .sunday, "MO": .monday, "TU": .tuesday, "WE": .wednesday, "TH": .thursday, "FR": .friday, "SA": .saturday]

/// The common repeat rules ("FREQ=WEEKLY;BYDAY=MO,TU;COUNT=5") as EventKit's.
private func recurrence(_ text: String) -> EKRecurrenceRule? {
    var parts: [String: String] = [:]
    for p in text.split(separator: ";") {
        let kv = p.split(separator: "=", maxSplits: 1).map(String.init)
        if kv.count == 2 { parts[kv[0].uppercased()] = kv[1] }
    }
    let freq: EKRecurrenceFrequency
    switch parts["FREQ"] ?? "" {
    case "DAILY": freq = .daily
    case "WEEKLY": freq = .weekly
    case "MONTHLY": freq = .monthly
    case "YEARLY": freq = .yearly
    default: return nil
    }
    let interval = max(1, Int(parts["INTERVAL"] ?? "1") ?? 1)
    var end: EKRecurrenceEnd?
    if let c = parts["COUNT"], let n = Int(c), n > 0 { end = EKRecurrenceEnd(occurrenceCount: n) }
    else if let u = parts["UNTIL"] {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = u.count > 8 ? "yyyyMMdd'T'HHmmss'Z'" : "yyyyMMdd"
        if let d = f.date(from: u) { end = EKRecurrenceEnd(end: d) }
    }
    let days = (parts["BYDAY"] ?? "").split(separator: ",").compactMap { d -> EKRecurrenceDayOfWeek? in
        let code = String(d.suffix(2))
        return weekdays[code].map { EKRecurrenceDayOfWeek($0) }
    }
    return EKRecurrenceRule(recurrenceWith: freq, interval: interval, daysOfTheWeek: days.isEmpty ? nil : days, daysOfTheMonth: nil, monthsOfTheYear: nil, weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: nil, end: end)
}

func calendarSave(_ p: [String: Any]) async throws -> [String: Any] {
    let st = calendarStatus()
    guard st == "granted" || st == "writeOnly" else { throw ekDenied("Calendar") }
    let ev: EKEvent
    if let id = p["id"] as? String, !id.isEmpty {
        ev = try findEvent(id, occurrence: p["occurrence"] as? Double)
    } else {
        ev = EKEvent(eventStore: eventStore)
    }
    if let calId = p["calendar"] as? String, let cal = eventStore.calendar(withIdentifier: calId) {
        guard cal.allowsContentModifications else { throw calendarError("That calendar cannot be changed") }
        ev.calendar = cal
    } else if ev.calendar == nil {
        guard let def = eventStore.defaultCalendarForNewEvents else { throw calendarError("Calendar has no calendar to add events to") }
        ev.calendar = def
    }
    guard let start = p["start"] as? Double, let end = p["end"] as? Double else { throw calendarError("An event needs a start and an end") }
    let allDay = (p["allDay"] as? Bool) ?? false
    ev.title = (p["title"] as? String) ?? ""
    ev.isAllDay = allDay
    ev.startDate = Date(timeIntervalSince1970: start / 1000)
    // Keeper's all-day events end at midnight after the last day; EventKit's on that last day.
    ev.endDate = Date(timeIntervalSince1970: (allDay ? max(start, end - 1000) : max(start, end)) / 1000)
    if let tz = p["timeZone"] as? String, !allDay { ev.timeZone = TimeZone(identifier: tz) }
    ev.location = (p["location"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    ev.notes = (p["notes"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    ev.url = (p["url"] as? String).flatMap { URL(string: $0) }
    if let alarms = p["alarms"] as? [Double] {
        ev.alarms = alarms.map { EKAlarm(relativeOffset: -$0 * 60) }
    }
    if let r = p["rrule"] as? String, (p["id"] as? String ?? "").isEmpty, let rule = recurrence(r) {
        ev.recurrenceRules = [rule]
    }
    let span: EKSpan = (p["all"] as? Bool) == true ? .futureEvents : .thisEvent
    try eventStore.save(ev, span: span, commit: true)
    return ["id": ev.eventIdentifier ?? ev.calendarItemIdentifier]
}

func calendarDelete(_ p: [String: Any]) async throws -> [String: Any] {
    let st = calendarStatus()
    guard st == "granted" || st == "writeOnly" else { throw ekDenied("Calendar") }
    guard let id = p["id"] as? String else { throw calendarError("No event") }
    let all = (p["all"] as? Bool) == true
    // The whole series goes from its first occurrence on.
    let ev = try findEvent(id, occurrence: all ? nil : p["occurrence"] as? Double)
    try eventStore.remove(ev, span: all ? .futureEvents : .thisEvent, commit: true)
    return ["ok": true]
}

func calendarCall(id: Int, method: String, params: [String: Any]) async throws -> Any {
    switch method {
    case "calendar.status": return ["status": calendarStatus(), "raw": calendarRawStatus()]
    case "calendar.access": return await calendarAccess(params)
    case "calendar.events": return try await calendarEvents(params)
    case "calendar.watch":
        try await calendarWatch(id: id)
        return ["ended": true]
    case "calendar.save": return try await calendarSave(params)
    case "calendar.delete": return try await calendarDelete(params)
    default: throw calendarError("Unknown method \(method)")
    }
}
