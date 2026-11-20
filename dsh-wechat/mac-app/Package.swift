// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Jingyu",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "Jingyu", targets: ["Jingyu"])],
    targets: [.executableTarget(name: "Jingyu")]
)
