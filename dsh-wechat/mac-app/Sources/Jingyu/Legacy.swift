import Foundation

struct CharacterPreset: Codable, Identifiable {
    let id: String
    let name: String
    let fields: [String: String]
}

struct LegacySticker {
    let url: URL
    let name: String
    let tags: String
}

struct LegacyProfile {
    let fields: [String: String]
    let diaryEnabled: Bool?
    let diaryTime: String?
    let stickers: [LegacySticker]
    let presets: [CharacterPreset]

    private static let personaKeys = ["name", "ownerName", "age", "job", "appearance",
                                      "personality", "background", "aliases"]
    private static let promptKeys = ["role": "rolePrompt", "style": "stylePrompt",
                                     "private": "privatePrompt", "group": "groupPrompt", "boundaries": "boundaries"]

    static func read() throws -> LegacyProfile? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let directory = home.appendingPathComponent("Library/Application Support/Whale Isle", isDirectory: true)
        guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
        let dashboard = try json(directory.appendingPathComponent("isle.json"))
        let localPersona = try json(directory.appendingPathComponent("data/persona.json"))
        let config = try json(directory.appendingPathComponent("data/config.json"))
        guard !dashboard.isEmpty || !localPersona.isEmpty || !config.isEmpty else { return nil }
        let configured = config["persona"] as? [String: Any] ?? [:]
        let persona = configured.merging(localPersona) { _, latest in latest }
        let prompts = dashboard["prompts"] as? [String: Any] ?? [:]
        let fields = convert(persona: persona, prompts: prompts)
        let diary = config["diary"] as? [String: Any] ?? [:]
        let presetRows = dashboard["presets"] as? [[String: Any]] ?? []
        let presets = presetRows.compactMap { row -> CharacterPreset? in
            guard let name = row["name"] as? String else { return nil }
            let persona = row["persona"] as? [String: Any] ?? [:]
            let prompts = row["prompts"] as? [String: Any] ?? [:]
            return CharacterPreset(
                id: row["id"] as? String ?? UUID().uuidString, name: name,
                fields: convert(persona: persona, prompts: prompts)
            )
        }
        return LegacyProfile(
            fields: fields, diaryEnabled: diary["enabled"] as? Bool, diaryTime: diary["time"] as? String,
            stickers: try readStickers(directory.appendingPathComponent("data/stickers", isDirectory: true)),
            presets: presets
        )
    }

    private static func json(_ url: URL) throws -> [String: Any] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let limit = 4 * 1024 * 1024
        let data = try handle.read(upToCount: limit + 1) ?? Data()
        guard data.count <= limit, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BridgeError.rejected("旧鲸屿的角色配置格式无法识别。")
        }
        return value
    }

    private static func convert(persona: [String: Any], prompts: [String: Any]) -> [String: String] {
        var fields: [String: String] = [:]
        for key in personaKeys {
            if let value = persona[key] as? String {
                fields[key] = value
            }
        }
        if let age = persona["age"] as? Int, age > 0 { fields["age"] = String(age) }
        if let aliases = persona["aliases"] as? [String] { fields["aliases"] = aliases.joined(separator: "、") }
        for (source, target) in promptKeys {
            fields[target] = prompts[source] as? String
        }
        if fields["rolePrompt", default: ""].isEmpty, let custom = persona["customPrompt"] as? String {
            fields["rolePrompt"] = custom
        }
        if let emoji = persona["emoji"] as? String, !emoji.isEmpty {
            let style = fields["stylePrompt", default: ""]
            fields["stylePrompt"] = [style, "文字表情使用习惯：" + emoji].filter { !$0.isEmpty }.joined(separator: "\n")
        }
        return fields
    }

    private static func readStickers(_ directory: URL) throws -> [LegacySticker] {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: directory.path) else { return [] }
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey]
        let extensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp"]
        guard let listing = fileManager.enumerator(at: directory, includingPropertiesForKeys: keys,
                                                   options: [.skipsHiddenFiles]) else { return [] }
        return try listing.compactMap { item -> LegacySticker? in
            guard let url = item as? URL, extensions.contains(url.pathExtension.lowercased()) else { return nil }
            let values = try url.resourceValues(forKeys: Set(keys))
            guard values.isRegularFile == true, values.isSymbolicLink != true else { return nil }
            let category = url.deletingLastPathComponent().lastPathComponent
            let tags = category == directory.lastPathComponent ? "" : category
            let name = tags.isEmpty ? url.lastPathComponent : tags + " · " + url.lastPathComponent
            return LegacySticker(url: url, name: name, tags: tags)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

struct MigrationResult: Codable {
    let profile: Bool
    let presets: Int
    let stickers: Int
    let skipped: Int
}

struct AppFiles {
    private let folder = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Jingyu Settings", isDirectory: true)

    func load<Value: Decodable>(_ type: Value.Type, from name: String) -> Value? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    func save<Value: Encodable>(_ data: Value, to name: String) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let file = folder.appendingPathComponent(name)
        try JSONEncoder().encode(data).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
