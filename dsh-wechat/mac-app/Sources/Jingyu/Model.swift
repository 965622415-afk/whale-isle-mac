import AppKit
import AVFoundation
import SwiftUI

@MainActor
final class JingyuModel: ObservableObject {
    @Published var settings = Settings()
    @Published private(set) var status: BridgeStatus?
    @Published private(set) var diaries: [Diary] = []
    @Published private(set) var voices: [String] = []
    @Published private(set) var presets: [CharacterPreset] = []
    @Published private(set) var migration: MigrationResult?
    @Published private(set) var busy = false
    @Published private(set) var notice = ""
    @Published private(set) var error = ""
    @Published private(set) var online = false
    @Published private(set) var voicePreviewPlaying = false
    private var voicePlayer: AVAudioPlayer?
    private var voicePlaybackCheck: Task<Void, Never>?
    private var saved = Settings()
    private var automaticMigrationTried = false
    private let bridge = Bridge()
    private let files = AppFiles()

    var media: [Sticker] { status?.media ?? [] }
    var hasUnsavedChanges: Bool { settings != saved }
    var canSave: Bool { online && !busy && hasUnsavedChanges }

    init() {
        if let snapshot = files.load(Settings.self, from: "settings-snapshot.json") {
            settings = snapshot
            saved = snapshot
        }
        presets = files.load([CharacterPreset].self, from: "presets.json") ?? []
        migration = files.load(MigrationResult.self, from: "migration.json")
    }

    func monitor() async {
        while !Task.isCancelled {
            if !busy {
                await refreshStatus(reportErrors: false)
                if online && !busy && !automaticMigrationTried && migration == nil && !hasUnsavedChanges
                    && (status?.apiVersion ?? 0) >= 2 {
                    automaticMigrationTried = true
                    do {
                        if let legacy = try LegacyProfile.read() {
                            busy = true
                            defer { busy = false }
                            try await importProfile(legacy)
                        }
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
            let pairing = ["pairing", "claim"].contains(status?.connection ?? "")
            try? await Task.sleep(nanoseconds: pairing ? 1_500_000_000 : 5_000_000_000)
        }
    }

    func refresh() {
        guard !busy else { return }
        Task { await refreshStatus(reportErrors: true) }
    }

    private func refreshStatus(reportErrors: Bool) async {
        do {
            let result: BridgeStatus = try await bridge.call("status", EmptyPayload())
            guard !busy else { return }
            accept(result)
            if reportErrors { error = "" }
        } catch {
            guard !busy else { return }
            online = false
            status = nil
            if reportErrors { self.error = error.localizedDescription }
        }
    }

    private func accept(_ result: BridgeStatus, submitted: Settings? = nil) {
        let unchanged = settings == (submitted ?? saved)
        online = true
        status = result
        if unchanged { settings = result.settings }
        if saved != result.settings {
            saved = result.settings
            try? files.save(saved, to: "settings-snapshot.json")
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        notice = ""
        error = ""
        Task {
            defer { busy = false }
            do {
                try await action()
            } catch let failure as BridgeError {
                if case .offline = failure { online = false; status = nil }
                error = failure.localizedDescription
            } catch let failure {
                error = failure.localizedDescription
            }
        }
    }

    func save() {
        let draft = settings
        run {
            let result: BridgeStatus = try await self.bridge.call("save", draft)
            self.accept(result, submitted: draft)
            self.notice = "设置已保存并同步到 DSH。"
        }
    }

    private func statusAction<Payload: Encodable>(_ action: String, _ input: Payload, feedback: String? = nil) {
        run {
            let result: BridgeStatus = try await self.bridge.call(action, input)
            self.accept(result)
            if let feedback { self.notice = feedback }
        }
    }

    func connectWeChat() { statusAction("login", EmptyPayload()) }
    func disconnectWeChat() { statusAction("logout", EmptyPayload()) }
    func submitPIN(_ code: String) { statusAction("pin", ["code": code]) }
    func testChat(_ text: String) { statusAction("testChat", ["text": text], feedback: "试聊已送到 DSH。") }
    func testWork() { statusAction("testWork", EmptyPayload(), feedback: "工作测试已送到 DSH。") }

    func upload(url: URL, name: String, tags: String, description: String) {
        run {
            let upload = try StickerUpload(url: url, name: name, tags: tags, description: description)
            let result: BridgeStatus = try await self.bridge.call("upload", upload)
            self.accept(result)
            self.notice = "已添加表情包。"
        }
    }

    func saveSticker(id: String, tags: String, description: String) {
        statusAction("saveMedia", ["id": id, "tags": tags, "description": description], feedback: "已保存表情设置。")
    }

    func deleteSticker(id: String) { statusAction("deleteMedia", ["id": id], feedback: "已删除表情。") }

    func loadVoices() {
        run {
            let result: VoiceList = try await self.bridge.call("voices", EmptyPayload())
            self.voices = result.voices
        }
    }

    func loadDiaries() {
        run {
            let result: DiaryList = try await self.bridge.call("listDiary", EmptyPayload())
            self.diaries = result.entries
        }
    }

    func saveVoice(apiKey: String, clearKey: Bool) {
        let request = VoiceRequest(settings, apiKey: apiKey, clearKey: clearKey)
        run {
            let result: BridgeStatus = try await self.bridge.call("saveVoice", request)
            self.accept(result)
            for (name, key) in Settings.voiceFields where self.settings[keyPath: key] == request.settings[name] {
                self.settings[keyPath: key] = result.settings[keyPath: key]
            }
            self.notice = "语音设置已保存。"
        }
    }

    func previewVoice(_ text: String, apiKey: String) {
        stopVoicePreview()
        let request = VoiceRequest(settings, apiKey: apiKey, text: text)
        run {
            let result: VoicePreview = try await self.bridge.call("previewVoice", request)
            guard let audio = Data(base64Encoded: result.audio), !audio.isEmpty,
                  let player = try? AVAudioPlayer(data: audio), player.play() else {
                throw BridgeError.rejected("合成已完成，但音频无法播放。")
            }
            self.voicePlayer = player
            self.voicePreviewPlaying = true
            self.voicePlaybackCheck = Task { [weak self] in
                while !Task.isCancelled && player.isPlaying {
                    try? await Task.sleep(nanoseconds: 150_000_000)
                }
                if !Task.isCancelled { self?.stopVoicePreview() }
            }
        }
    }

    func stopVoicePreview() {
        voicePlaybackCheck?.cancel()
        voicePlaybackCheck = nil
        voicePlayer?.stop()
        voicePlayer = nil
        voicePreviewPlaying = false
    }

    func writeDiary() { statusAction("writeDiary", EmptyPayload(), feedback: "日记已交给 DSH，稍后可以刷新查看。") }

    func openDSH() {
        let application = URL(fileURLWithPath: "/Applications/DeepSeek Harness.app")
        guard FileManager.default.fileExists(atPath: application.path) else {
            error = "在应用程序目录找不到 DeepSeek Harness。"
            return
        }
        NSWorkspace.shared.openApplication(at: application, configuration: .init()) { _, _ in }
    }

    func usePreset(_ preset: CharacterPreset) {
        for (name, value) in preset.fields {
            if let key = Settings.characterFields[name] { settings[keyPath: key] = value }
        }
        notice = "预设已填入，点击保存应用到 DSH。"
    }

    func savePreset(_ name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let fields = Settings.characterFields.mapValues { settings[keyPath: $0] }
        let updated = presets + [CharacterPreset(id: UUID().uuidString, name: name, fields: fields)]
        do {
            try files.save(updated, to: "presets.json")
            presets = updated
            notice = "已保存本机人设预设。"
        } catch {
            self.error = error.localizedDescription
        }
    }

    func importLegacy() {
        run {
            guard (self.status?.apiVersion ?? 0) >= 2 else {
                throw BridgeError.rejected("请先在 DSH 启用鲸屿 1.1 或更新版本。")
            }
            guard !self.hasUnsavedChanges else { throw BridgeError.rejected("请先保存正在编辑的设置。") }
            guard let legacy = try LegacyProfile.read() else { throw BridgeError.rejected("这台 Mac 没有找到旧鲸屿资料。") }
            try await self.importProfile(legacy)
        }
    }

    private func importProfile(_ legacy: LegacyProfile) async throws {
        let defaults = Settings()
        var draft = settings
        var applied = false
        if migration == nil {
            for (name, value) in legacy.fields {
                guard !value.isEmpty, let key = Settings.characterFields[name], draft[keyPath: key] == defaults[keyPath: key] else { continue }
                draft[keyPath: key] = value
            }
            if draft.diaryTime == defaults.diaryTime, let time = legacy.diaryTime { draft.diaryTime = time }
            if draft.diaryEnabled == defaults.diaryEnabled, let enabled = legacy.diaryEnabled { draft.diaryEnabled = enabled }
            if draft != settings {
                let result: BridgeStatus = try await bridge.call("save", draft)
                // Accepts changes if the user has not edited the form since the import started.
                accept(result)
                applied = true
            }
        }
        let known = Set(presets.map(\.id))
        let combined = presets + legacy.presets.filter { !known.contains($0.id) }
        if combined.count != presets.count {
            try files.save(combined, to: "presets.json")
            presets = combined
        }
        var available = Set(media.map { $0.name })
        var migrated = 0
        var skipped = 0
        for item in legacy.stickers {
            if available.contains(item.name) {
                migrated += 1
                continue
            }
            if available.count >= 40 { skipped += 1; continue }
            let upload: StickerUpload
            do {
                upload = try StickerUpload(url: item.url, name: item.name, tags: item.tags, description: "")
            } catch {
                skipped += 1
                continue
            }
            let result: BridgeStatus = try await bridge.call("upload", upload)
            accept(result)
            available.insert(item.name)
            migrated += 1
        }
        let report = MigrationResult(profile: applied || migration?.profile == true,
                                     presets: legacy.presets.count, stickers: migrated, skipped: skipped)
        try files.save(report, to: "migration.json")
        migration = report
        notice = "旧版资料已导入。"
    }
}
