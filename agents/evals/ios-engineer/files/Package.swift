// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Tidepool",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "Features", targets: ["Features"]),
    ],
    targets: [
        .target(name: "Abstractions"),
        .target(name: "Core", dependencies: ["Abstractions"]),
        .target(name: "Application", dependencies: ["Abstractions", "Core"]),
        .target(name: "Features", dependencies: ["Abstractions", "Core", "Application"]),
        .target(name: "Integrations", dependencies: ["Abstractions", "Core"]),
        .testTarget(name: "ArchitectureTests", dependencies: ["Features"]),
    ]
)
