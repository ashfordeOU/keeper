// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dictation and meeting actions for the Shortcuts app and Spotlight (Voice).
// They go through keeper://dictation and keeper://meeting links, and the
// `keeper meeting` command for the transcript. Listed under Keeper in the
// Shortcuts app; Siri phrases stay in the shared AppShortcutsProvider.

import AppIntents
import Foundation

enum DictationAction: String, AppEnum {
    case toggle, start, stop, cancel, edit
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Dictation action" }
    static var caseDisplayRepresentations: [DictationAction: DisplayRepresentation] {
        [.toggle: "Start or stop", .start: "Start", .stop: "Stop and type", .cancel: "Cancel", .edit: "Edit the selected text by voice"]
    }
}

struct KeeperDictation: AppIntent {
    static var title: LocalizedStringResource { "Dictate with Keeper" }
    static var description: IntentDescription { IntentDescription("Starts or stops Keeper’s dictation. Speech is recognised on this Mac unless you chose a service in Keeper.") }
    @Parameter(title: "Action", default: .toggle) var action: DictationAction
    static var parameterSummary: some ParameterSummary { Summary("\(\.$action) dictation") }
    func perform() async throws -> some IntentResult {
        try Keeper.open("dictation", ["do": action.rawValue])
        return .result()
    }
}

enum MeetingAction: String, AppEnum {
    case start, pause, resume, stop
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Meeting action" }
    static var caseDisplayRepresentations: [MeetingAction: DisplayRepresentation] {
        [.start: "Start recording", .pause: "Pause", .resume: "Resume", .stop: "Stop and save"]
    }
}

struct KeeperMeeting: AppIntent {
    static var title: LocalizedStringResource { "Record a Meeting with Keeper" }
    static var description: IntentDescription { IntentDescription("Records your microphone and the Mac’s sound and writes them down on this Mac. Tell everyone in the call that it is recorded.") }
    @Parameter(title: "Action", default: .start) var action: MeetingAction
    @Parameter(title: "Title") var title: String?
    static var parameterSummary: some ParameterSummary { Summary("\(\.$action) the meeting recording") { \.$title } }
    func perform() async throws -> some IntentResult & ProvidesDialog {
        var q = ["do": action.rawValue]
        if let t = title, !t.isEmpty { q["title"] = t }
        try Keeper.open("meeting", q)
        return .result(dialog: action == .start ? "Recording. Remember to tell everyone." : "Done.")
    }
}

struct KeeperMeetingTranscript: AppIntent {
    static var title: LocalizedStringResource { "Get the Live Meeting Transcript" }
    static var description: IntentDescription { IntentDescription("Returns what has been said so far in the meeting Keeper is recording.") }
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let text = try await Keeper.cli(["meeting", "export", "--format", "txt"])
        return .result(value: text)
    }
}
