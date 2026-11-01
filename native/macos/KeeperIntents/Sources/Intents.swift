// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's actions for Siri, Spotlight and the Shortcuts app.

import AppIntents
import Foundation

// MARK: - asking and searching (return something)

struct AskKeeper: AppIntent {
    static var title: LocalizedStringResource { "Ask Keeper" }
    static var description: IntentDescription { IntentDescription("Ask about your files. Keeper answers from what it has read, with the AI you chose in Keeper.") }

    @Parameter(title: "Question", requestValueDialog: "What would you like to ask?")
    var question: String

    static var parameterSummary: some ParameterSummary { Summary("Ask Keeper \(\.$question)") }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let answer = try await Keeper.cli(["ask", "--plain", question])
        return .result(value: answer, dialog: IntentDialog(stringLiteral: answer.isEmpty ? "Keeper had no answer." : answer))
    }
}

struct SearchFiles: AppIntent {
    static var title: LocalizedStringResource { "Search Files with Keeper" }
    static var description: IntentDescription { IntentDescription("Find files by describing them, e.g. “pdfs from gmail last month”. Returns the files.") }

    @Parameter(title: "Search for", requestValueDialog: "What are you looking for?")
    var query: String

    @Parameter(title: "Up to", default: 10, inclusiveRange: (1, 50))
    var limit: Int

    static var parameterSummary: some ParameterSummary { Summary("Search Keeper for \(\.$query)") { \.$limit } }

    struct Hit: Decodable { let path: String }

    func perform() async throws -> some IntentResult & ReturnsValue<[IntentFile]> & ProvidesDialog {
        let json = try await Keeper.cli(["search", "--brain", "--json", "--limit", String(limit), query])
        let hits = (try? JSONDecoder().decode([Hit].self, from: Data(json.utf8))) ?? []
        let files = hits.map { IntentFile(fileURL: URL(fileURLWithPath: $0.path)) }
        let names = hits.prefix(3).map { ($0.path as NSString).lastPathComponent }.joined(separator: ", ")
        return .result(value: files, dialog: IntentDialog(stringLiteral: files.isEmpty ? "Nothing found." : "Found \(files.count): \(names)\(files.count > 3 ? "…" : "")"))
    }
}

// MARK: - doing something in Keeper

enum KeeperPage: String, AppEnum {
    case home, search, downloads, cleanup, duplicates, space, health, assistant, agents, graph, settings, terminal, sync, devices
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Keeper page" }
    static var caseDisplayRepresentations: [KeeperPage: DisplayRepresentation] {
        [
            .home: "Home", .search: "Search", .downloads: "Downloads", .cleanup: "Clean Up", .duplicates: "Duplicates",
            .space: "Space Map", .health: "Health", .assistant: "Assistant", .agents: "Agents", .graph: "Knowledge Graph",
            .settings: "Settings", .terminal: "Terminal", .sync: "Sync & Backup", .devices: "Devices",
        ]
    }
}

struct OpenKeeperPage: AppIntent {
    static var title: LocalizedStringResource { "Open a Keeper Page" }
    @Parameter(title: "Page") var page: KeeperPage
    static var parameterSummary: some ParameterSummary { Summary("Open \(\.$page) in Keeper") }
    func perform() async throws -> some IntentResult {
        try Keeper.open("go", ["page": page.rawValue])
        return .result()
    }
}

struct StartFocus: AppIntent {
    static var title: LocalizedStringResource { "Start a Focus Timer" }
    @Parameter(title: "Minutes", default: 25, inclusiveRange: (1, 240)) var minutes: Int
    static var parameterSummary: some ParameterSummary { Summary("Focus for \(\.$minutes) minutes") }
    func perform() async throws -> some IntentResult & ProvidesDialog {
        try Keeper.open("focus", ["minutes": String(minutes)])
        return .result(dialog: "Focus for \(minutes) minutes.")
    }
}

struct LockFolders: AppIntent {
    static var title: LocalizedStringResource { "Lock Folders" }
    static var description: IntentDescription { IntentDescription("Locks again every folder you unlocked in Keeper.") }
    func perform() async throws -> some IntentResult & ProvidesDialog {
        try Keeper.open("lock-all")
        return .result(dialog: "Locking your folders.")
    }
}

struct RunAutomation: AppIntent {
    static var title: LocalizedStringResource { "Run a Keeper Automation" }
    @Parameter(title: "Automation name") var name: String
    static var parameterSummary: some ParameterSummary { Summary("Run the automation \(\.$name)") }
    func perform() async throws -> some IntentResult {
        try Keeper.open("automation", ["name": name])
        return .result()
    }
}

struct SendToDevice: AppIntent {
    static var title: LocalizedStringResource { "Send to a Device with Keeper" }
    static var description: IntentDescription { IntentDescription("Sends files to one of your paired devices.") }
    @Parameter(title: "Files") var files: [IntentFile]
    @Parameter(title: "Device name") var device: String
    static var parameterSummary: some ParameterSummary { Summary("Send \(\.$files) to \(\.$device)") }
    func perform() async throws -> some IntentResult & ProvidesDialog {
        var sent = 0
        for f in files {
            guard let url = f.fileURL else { continue }
            _ = try await Keeper.cli(["link", "send", url.path, device])
            sent += 1
        }
        return .result(dialog: "Sent \(sent) file\(sent == 1 ? "" : "s") to \(device).")
    }
}

struct CopyTextFromScreen: AppIntent {
    static var title: LocalizedStringResource { "Copy Text from Screen" }
    func perform() async throws -> some IntentResult {
        try Keeper.open("capture")
        return .result()
    }
}

struct KeepAwake: AppIntent {
    static var title: LocalizedStringResource { "Keep the Mac Awake" }
    @Parameter(title: "Minutes", default: 60, inclusiveRange: (1, 1440)) var minutes: Int
    func perform() async throws -> some IntentResult {
        try Keeper.open("awake", ["on": "true", "minutes": String(minutes)])
        return .result()
    }
}

struct StopKeepingAwake: AppIntent {
    static var title: LocalizedStringResource { "Let the Mac Sleep Again" }
    func perform() async throws -> some IntentResult {
        try Keeper.open("awake", ["do": "off"])
        return .result()
    }
}

struct ToggleKeepAwake: AppIntent {
    static var title: LocalizedStringResource { "Turn Keep Awake On or Off" }
    func perform() async throws -> some IntentResult {
        try Keeper.open("awake", ["do": "toggle"])
        return .result()
    }
}

// MARK: - phrases Siri and Spotlight offer without any setup

struct KeeperShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskKeeper(), phrases: ["Ask \(.applicationName)", "Ask \(.applicationName) a question"], shortTitle: "Ask Keeper", systemImageName: "sparkles")
        AppShortcut(intent: SearchFiles(), phrases: ["Search files with \(.applicationName)", "Find files in \(.applicationName)"], shortTitle: "Search Files", systemImageName: "magnifyingglass")
        AppShortcut(intent: OpenKeeperPage(), phrases: ["Open \(\.$page) in \(.applicationName)", "Show \(\.$page) in \(.applicationName)"], shortTitle: "Open Page", systemImageName: "rectangle.stack")
        AppShortcut(intent: StartFocus(), phrases: ["Start focus with \(.applicationName)", "Focus with \(.applicationName)"], shortTitle: "Focus", systemImageName: "timer")
        AppShortcut(intent: LockFolders(), phrases: ["Lock my folders with \(.applicationName)", "\(.applicationName) lock folders"], shortTitle: "Lock Folders", systemImageName: "lock")
        AppShortcut(intent: KeepAwake(), phrases: ["Keep my Mac awake with \(.applicationName)", "\(.applicationName) keep awake"], shortTitle: "Keep Awake", systemImageName: "cup.and.saucer")
        AppShortcut(intent: StopKeepingAwake(), phrases: ["Let my Mac sleep with \(.applicationName)", "\(.applicationName) stop keeping awake"], shortTitle: "Allow Sleep", systemImageName: "moon.zzz")
        AppShortcut(intent: CopyTextFromScreen(), phrases: ["Copy text from the screen with \(.applicationName)"], shortTitle: "Copy Text", systemImageName: "text.viewfinder")
    }
}
