// swift-tools-version:5.9
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper-helper: gives Keeper macOS's own abilities (the on-device model,
// Live Text recognition, Spotlight). Keeper talks to it over stdin/stdout,
// one JSON message per line. Keeper works without it.
// keeper-launcher: the program in Keeper Mail, Keeper Calendar and Keeper Notes
// (separate app icons that open one page of Keeper; build/mac-launchers.cjs
// puts it in their bundles). Built by the same `swift build`.
import PackageDescription

let package = Package(
    name: "KeeperHelper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "keeper-helper",
            path: "Sources/keeper-helper",
            linkerSettings: [
                .linkedFramework("Vision"),
                .linkedFramework("CoreSpotlight"),
                .linkedFramework("NaturalLanguage"),
                .linkedFramework("ImageIO"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("EventKit"),
                .linkedFramework("CoreLocation"),
                .linkedFramework("UserNotifications"),
                .linkedFramework("CoreMediaIO"),
            ]
        ),
        .executableTarget(
            name: "keeper-launcher",
            path: "Sources/keeper-launcher",
            linkerSettings: [.linkedFramework("AppKit")]
        ),
    ]
)
