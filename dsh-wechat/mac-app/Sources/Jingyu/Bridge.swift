import Foundation

struct Settings: Codable, Equatable {
    var name = "鲸屿"
    var ownerName = "你"
    var aliases = "鲸鱼娘"
    var age = ""
    var job = ""
    var appearance = ""
    var personality = "你是一位生活在海岛上的 AI 陪伴。说中文，语气温暖自然，有一点幽默。先认真听我说，再回应；表达亲近时尊重彼此的界限。"
    var background = ""
    var rolePrompt = ""
    var stylePrompt = ""
    var privatePrompt = ""
    var groupPrompt = ""
    var boundaries = ""
    var memory = ""
    var publicMemory = ""
    var workspace = ""
    var workEnabled = false
    var stayAwake = false
    var voiceMode = "on-request"
    var voiceProvider = "system"
    var voiceEndpoint = ""
    var voiceModel = ""
    var voiceId = ""
    var voice = "Tingting"
    var autoSticker = false
    var diaryEnabled = false
    var diaryTime = "21:30"
    var groupEnabled = false
    var groupIds = ""

    private enum CodingKeys: String, CodingKey {
        case name, ownerName, aliases, age, job, appearance
        case personality, background, rolePrompt, stylePrompt, privatePrompt, groupPrompt
        case boundaries, memory, publicMemory, workspace, workEnabled, stayAwake
        case voiceMode, voiceProvider, voiceEndpoint, voiceModel, voiceId, voice
        case autoSticker, diaryEnabled, diaryTime, groupEnabled
        case groupIds
    }

    init() {}

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? name
        ownerName = try values.decodeIfPresent(String.self, forKey: .ownerName) ?? ownerName
        aliases = try values.decodeIfPresent(String.self, forKey: .aliases) ?? aliases
        age = try values.decodeIfPresent(String.self, forKey: .age) ?? age
        job = try values.decodeIfPresent(String.self, forKey: .job) ?? job
        appearance = try values.decodeIfPresent(String.self, forKey: .appearance) ?? appearance
        personality = try values.decodeIfPresent(String.self, forKey: .personality) ?? personality
        background = try values.decodeIfPresent(String.self, forKey: .background) ?? background
        rolePrompt = try values.decodeIfPresent(String.self, forKey: .rolePrompt) ?? rolePrompt
        stylePrompt = try values.decodeIfPresent(String.self, forKey: .stylePrompt) ?? stylePrompt
        privatePrompt = try values.decodeIfPresent(String.self, forKey: .privatePrompt) ?? privatePrompt
        groupPrompt = try values.decodeIfPresent(String.self, forKey: .groupPrompt) ?? groupPrompt
        boundaries = try values.decodeIfPresent(String.self, forKey: .boundaries) ?? boundaries
        memory = try values.decodeIfPresent(String.self, forKey: .memory) ?? memory
        publicMemory = try values.decodeIfPresent(String.self, forKey: .publicMemory) ?? publicMemory
        workspace = try values.decodeIfPresent(String.self, forKey: .workspace) ?? workspace
        workEnabled = try values.decodeIfPresent(Bool.self, forKey: .workEnabled) ?? workEnabled
        stayAwake = try values.decodeIfPresent(Bool.self, forKey: .stayAwake) ?? stayAwake
        voiceMode = try values.decodeIfPresent(String.self, forKey: .voiceMode) ?? voiceMode
        voiceProvider = try values.decodeIfPresent(String.self, forKey: .voiceProvider) ?? voiceProvider
        voiceEndpoint = try values.decodeIfPresent(String.self, forKey: .voiceEndpoint) ?? voiceEndpoint
        voiceModel = try values.decodeIfPresent(String.self, forKey: .voiceModel) ?? voiceModel
        voiceId = try values.decodeIfPresent(String.self, forKey: .voiceId) ?? voiceId
        voice = try values.decodeIfPresent(String.self, forKey: .voice) ?? voice
        autoSticker = try values.decodeIfPresent(Bool.self, forKey: .autoSticker) ?? autoSticker
        diaryEnabled = try values.decodeIfPresent(Bool.self, forKey: .diaryEnabled) ?? diaryEnabled
        diaryTime = try values.decodeIfPresent(String.self, forKey: .diaryTime) ?? diaryTime
        groupEnabled = try values.decodeIfPresent(Bool.self, forKey: .groupEnabled) ?? groupEnabled
        groupIds = try values.decodeIfPresent(String.self, forKey: .groupIds) ?? groupIds
    }

    static let characterFields: [String: WritableKeyPath<Settings, String>] = [
        "name": \.name, "ownerName": \.ownerName, "aliases": \.aliases,
        "age": \.age, "job": \.job, "appearance": \.appearance,
        "personality": \.personality, "background": \.background,
        "rolePrompt": \.rolePrompt, "stylePrompt": \.stylePrompt, "privatePrompt": \.privatePrompt,
        "groupPrompt": \.groupPrompt, "boundaries": \.boundaries,
        "memory": \.memory, "publicMemory": \.publicMemory,
    ]
}

struct Sticker: Decodable, Identifiable {
    let id: String
    let name: String
    let tags: String
    let description: String
}

struct Diary: Decodable, Identifiable {
    let date: String
    let text: String
    var id: String { date }
}

struct BridgeStatus: Decodable {
    let apiVersion: Int?
    let settings: Settings
    let media: [Sticker]
    let connection: String
    let message: String
    let lastError: String
    let qrUrl: String?
    let qrImage: String?
    let pinRequired: Bool
    let claimCode: String?
    let groupKey: String?
    let voiceKeyConfigured: Bool?
    let chatId: String?
    let workId: String?
}

struct EmptyPayload: Encodable {}
struct VoiceList: Decodable { let voices: [String] }
struct DiaryList: Decodable { let entries: [Diary] }
struct VoicePreview: Decodable { let audio: String }

struct VoiceRequest: Encodable {
    let settings: [String: String]
    let apiKey: String
    var clearKey: Bool?
    var text: String?

    init(_ settings: Settings, apiKey: String, clearKey: Bool? = nil, text: String? = nil) {
        self.settings = Dictionary(uniqueKeysWithValues: Settings.voiceFields.map { ($0.key, settings[keyPath: $0.value]) })
        self.apiKey = apiKey
        self.clearKey = clearKey
        self.text = text
    }
}

extension Settings {
    static let voiceFields: [String: WritableKeyPath<Settings, String>] = [
        "voice": \.voice, "voiceMode": \.voiceMode, "voiceProvider": \.voiceProvider,
        "voiceEndpoint": \.voiceEndpoint, "voiceModel": \.voiceModel, "voiceId": \.voiceId
    ]
}

enum BridgeError: LocalizedError {
    case offline
    case invalidReply
    case rejected(String)
    case largeSticker

    var errorDescription: String? {
        switch self {
        case .offline: return "DSH 插件未连接。请打开 DSH，再点刷新。"
        case .invalidReply: return "鲸屿插件回复异常。请确认已启用最新版插件。"
        case .rejected(let reason): return reason
        case .largeSticker: return "图片大小上限为 5 MB。"
        }
    }
}

struct StickerUpload: Encodable {
    let name: String
    let mime: String
    let base64: String
    let tags: String
    let description: String

    init(url: URL, name: String, tags: String, description: String) throws {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let maximum = 5 * 1024 * 1024
        let bytes = try file.read(upToCount: maximum + 1) ?? Data()
        guard bytes.count <= maximum else { throw BridgeError.largeSticker }
        let mediaTypes = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                          "gif": "image/gif", "webp": "image/webp"]
        guard let type = mediaTypes[url.pathExtension.lowercased()] else {
            throw BridgeError.rejected("请选择 PNG、JPEG、GIF 或 WebP 图片。")
        }
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? url.lastPathComponent : name
        self.mime = type
        self.base64 = bytes.base64EncodedString()
        self.tags = tags
        self.description = description
    }
}

private final class LocalOnlySessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

actor Bridge {
    private struct Envelope<Value: Encodable>: Encodable {
        let action: String
        let data: Value
    }

    private struct ErrorEnvelope: Decodable { let error: String }

    private let baseURL = URL(string: "http://127.0.0.1:18429")!
    private let session: URLSession
    private var csrf: String?

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 42
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.connectionProxyDictionary = [:]
        session = URLSession(configuration: config, delegate: LocalOnlySessionDelegate(), delegateQueue: nil)
    }

    func call<Payload: Encodable, Result: Decodable>(_ action: String, _ data: Payload) async throws -> Result {
        let body = try JSONEncoder().encode(Envelope(action: action, data: data))
        for attempt in 0...1 {
            if csrf == nil { csrf = try await token() }
            var request = URLRequest(url: baseURL.appendingPathComponent("api/action"))
            request.timeoutInterval = action == "previewVoice" ? 36 : 12
            request.httpMethod = "POST"
            request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(csrf, forHTTPHeaderField: "x-jingyu-csrf")
            request.httpBody = body
            let (bytes, response) = try await send(request)
            if response.statusCode == 403 && attempt == 0 {
                csrf = nil
                continue
            }
            guard response.statusCode == 200 else {
                let message = (try? JSONDecoder().decode(ErrorEnvelope.self, from: bytes))?.error
                throw BridgeError.rejected(message ?? "鲸屿插件请求失败。")
            }
            guard let result = try? JSONDecoder().decode(Result.self, from: bytes) else {
                throw BridgeError.invalidReply
            }
            return result
        }
        throw BridgeError.invalidReply
    }

    private func token() async throws -> String {
        let (bytes, response) = try await send(URLRequest(url: baseURL))
        guard response.statusCode == 200, let page = String(data: bytes, encoding: .utf8),
              let tag = page.range(of: "name=\"jingyu-csrf\" content=\""),
              let end = page[tag.upperBound...].firstIndex(of: "\"") else {
            throw BridgeError.invalidReply
        }
        let value = String(page[tag.upperBound..<end])
        guard value.utf8.count == 64, value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw BridgeError.invalidReply
        }
        return value
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (bytes, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.url?.host == baseURL.host, http.url?.port == baseURL.port else {
                throw BridgeError.invalidReply
            }
            return (bytes, http)
        } catch is URLError {
            csrf = nil
            throw BridgeError.offline
        }
    }
}
