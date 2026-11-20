import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

private enum CharacterPalette {
    static let ink = Color(red: 32 / 255, green: 48 / 255, blue: 59 / 255)
    static let muted = Color(red: 125 / 255, green: 137 / 255, blue: 148 / 255)
    static let fieldLabel = Color(red: 93 / 255, green: 111 / 255, blue: 123 / 255)
    static let line = Color(red: 230 / 255, green: 235 / 255, blue: 239 / 255)
    static let fieldLine = Color(red: 220 / 255, green: 228 / 255, blue: 233 / 255)
    static let accent = Color(red: 22 / 255, green: 126 / 255, blue: 130 / 255)
    static let soft = Color(red: 240 / 255, green: 246 / 255, blue: 247 / 255)
    static let field = Color(red: 252 / 255, green: 253 / 255, blue: 253 / 255)
}

private struct CharacterCard<Content: View>: View {
    let title: String
    let subtitle: String
    let content: Content

    init(_ title: String, subtitle: String = "", @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 9) {
                Text(title).font(.system(size: 16, weight: .semibold))
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(CharacterPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .foregroundStyle(CharacterPalette.ink)
        .background(.white, in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(CharacterPalette.line))
        .tint(CharacterPalette.accent)
    }
}

private struct CharacterButton: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var primary = false
    var destructive = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: primary ? .semibold : .regular))
            .foregroundStyle(primary ? .white : destructive ? .red : CharacterPalette.ink)
            .padding(.horizontal, 15)
            .padding(.vertical, 9)
            .background(
                primary ? CharacterPalette.accent : configuration.isPressed ? CharacterPalette.soft : .white,
                in: RoundedRectangle(cornerRadius: 9)
            )
            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(primary ? CharacterPalette.accent : CharacterPalette.fieldLine))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
    }
}

private struct CharacterField<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(CharacterPalette.fieldLabel)
                .accessibilityHidden(true)
            content.accessibilityLabel(title)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CharacterTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String

    init(_ title: String, placeholder: String = "", text: Binding<String>) {
        self.title = title
        self.placeholder = placeholder
        _text = text
    }

    var body: some View {
        CharacterField(title) {
            TextField(placeholder.isEmpty ? title : placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(CharacterPalette.field, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(CharacterPalette.fieldLine))
        }
    }
}

private struct CharacterEditor: View {
    let title: String
    let placeholder: String
    let height: CGFloat
    @Binding var text: String

    init(_ title: String, placeholder: String = "", height: CGFloat = 95, text: Binding<String>) {
        self.title = title
        self.placeholder = placeholder
        self.height = height
        _text = text
    }

    var body: some View {
        CharacterField(title) {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .padding(7)
                if text.isEmpty && !placeholder.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(CharacterPalette.muted)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                }
            }
            .font(.system(size: 13))
            .frame(minHeight: height, maxHeight: height)
            .background(CharacterPalette.field, in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(CharacterPalette.fieldLine)
                    .allowsHitTesting(false)
            )
        }
    }
}

private struct CardHint: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(CharacterPalette.fieldLabel)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct PersonaView: View {
    @ObservedObject var model: JingyuModel

    var body: some View {
        CharacterCard("角色的基本轮廓", subtitle: "这些设定会参与鲸屿的角色提示词。") {
            HStack(alignment: .top, spacing: 18) {
                CharacterTextField("角色名称", text: $model.settings.name)
                CharacterTextField("怎么称呼你", text: $model.settings.ownerName)
            }
            HStack(alignment: .top, spacing: 18) {
                CharacterTextField("角色年龄", text: $model.settings.age)
                CharacterTextField("身份 / 职业", text: $model.settings.job)
            }
            CharacterEditor("性格与表达", text: $model.settings.personality)
            CharacterEditor("背景设定", text: $model.settings.background)
            CharacterEditor("外观设定", height: 76, text: $model.settings.appearance)
            CharacterEditor("呼唤别名（每行一个）", height: 76, text: $model.settings.aliases)
            Button("保存角色设定", action: model.save)
                .buttonStyle(CharacterButton(primary: true))
        }
    }
}

struct MemoryView: View {
    @ObservedObject var model: JingyuModel

    var body: some View {
        CharacterCard(
            "对话会留下什么",
            subtitle: "在这里编辑希望鲸屿记住的事。相关内容会随对话发送给 DSH 使用的模型。"
        ) {
            CharacterEditor("私聊记忆", placeholder: "例如 心情不好时，我更喜欢先有人听我说。", height: 130, text: $model.settings.memory)
            CharacterEditor("群聊可用记忆", placeholder: "在授权群聊中可使用的内容。", height: 110, text: $model.settings.publicMemory)
            CardHint("人设与背景也会在授权群聊中使用。只想让鲸屿在私聊知道的内容可以放在上方第一栏。")
            Button("保存记忆", action: model.save)
                .buttonStyle(CharacterButton(primary: true))
        }
    }
}

private struct StickerDraft: Identifiable {
    let id: String
    let source: URL?
    var name: String
    var tags: String
    var description: String

    init(_ sticker: Sticker) {
        id = sticker.id
        source = nil
        name = sticker.name
        tags = sticker.tags
        description = sticker.description
    }

    init(source: URL) {
        id = UUID().uuidString
        self.source = source
        name = source.lastPathComponent
        tags = ""
        description = ""
    }
}

private struct StickerEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: StickerDraft
    let save: (StickerDraft) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(draft.source == nil ? "编辑表情包" : "导入表情包")
                .font(.title3.weight(.semibold))
            if draft.source == nil {
                Text(draft.name).foregroundStyle(.secondary)
            } else {
                CharacterTextField("图片名称", placeholder: "留空时使用原文件名", text: $draft.name)
            }
            CharacterTextField("标签", placeholder: "例如 开心、撒娇、鼓掌", text: $draft.tags)
            CharacterEditor("图片描述", height: 76, text: $draft.description)
            HStack(spacing: 10) {
                Spacer()
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .buttonStyle(CharacterButton())
                Button(draft.source == nil ? "保存" : "导入图片") {
                    save(draft)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(CharacterButton(primary: true))
            }
        }
        .padding(24)
        .frame(width: 425)
    }
}

struct StickersView: View {
    @ObservedObject var model: JingyuModel
    @State private var draft: StickerDraft?
    @State private var removing: Sticker?

    private var assetFolder: URL {
        let environment = ProcessInfo.processInfo.environment
        if let stateDirectory = environment["JINGYU_STATE_DIR"], !stateDirectory.isEmpty {
            return URL(fileURLWithPath: stateDirectory, isDirectory: true).appendingPathComponent("stickers", isDirectory: true)
        }
        let home = environment["DSH_HOME"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh", isDirectory: true)
        return home.appendingPathComponent("jingyu/stickers", isDirectory: true)
    }

    var body: some View {
        CharacterCard("表情包图库", subtitle: "给图片加上标签或描述，鲸屿就能结合聊天内容挑选贴切的表情。") {
            HStack(spacing: 10) {
                Button("导入图片", action: chooseImage)
                    .buttonStyle(CharacterButton(primary: true))
                Button("在 Finder 中打开") {
                    NSWorkspace.shared.open(assetFolder)
                }
                .buttonStyle(CharacterButton())
            }
            if model.media.isEmpty {
                Text("还没有表情图。支持 PNG、JPEG、GIF 和 WebP，单张上限 5 MB。")
                    .font(.system(size: 12))
                    .foregroundStyle(CharacterPalette.muted)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(CharacterPalette.field, in: RoundedRectangle(cornerRadius: 9))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 12)], spacing: 12) {
                    ForEach(model.media, id: \.id) { sticker in
                        stickerTile(sticker)
                    }
                }
            }
            Divider()
            Toggle("由鲸屿决定何时发表情", isOn: $model.settings.autoSticker)
                .toggleStyle(.checkbox)
            Button("保存表情设置", action: model.save)
                .buttonStyle(CharacterButton(primary: true))
        }
        .sheet(item: $draft) { initialDraft in
            StickerEditSheet(draft: initialDraft) { edit in
                if let source = edit.source {
                    model.upload(url: source, name: edit.name, tags: edit.tags, description: edit.description)
                } else {
                    model.saveSticker(id: edit.id, tags: edit.tags, description: edit.description)
                }
            }
        }
        .confirmationDialog(
            "删除表情包？",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { sticker in
            Button("删除", role: .destructive) { model.deleteSticker(id: sticker.id) }
            Button("取消", role: .cancel) {}
        } message: { sticker in
            Text("将从鲸屿图库删除「\(sticker.name)」。")
        }
    }

    private func chooseImage() {
        let picker = NSOpenPanel()
        picker.title = "导入表情包"
        picker.prompt = "选取"
        picker.allowedContentTypes = [.png, .jpeg, .gif, .webP]
        picker.canChooseFiles = true
        picker.canChooseDirectories = false
        picker.allowsMultipleSelection = false
        if picker.runModal() == .OK, let source = picker.url {
            draft = StickerDraft(source: source)
        }
    }

    private func stickerTile(_ sticker: Sticker) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Group {
                if let image = stickerThumbnail(sticker) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                } else {
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(CharacterPalette.muted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 92, maxHeight: 92)
            .accessibilityHidden(true)
            Text(sticker.name)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
                .help(sticker.name)
            if !sticker.tags.isEmpty {
                Text(sticker.tags)
                    .font(.system(size: 11))
                    .foregroundStyle(CharacterPalette.fieldLabel)
                    .lineLimit(1)
            }
            HStack(spacing: 12) {
                Button("编辑") { draft = StickerDraft(sticker) }
                Button("删除", role: .destructive) { removing = sticker }
            }
            .font(.system(size: 12))
            .buttonStyle(.borderless)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CharacterPalette.field, in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(CharacterPalette.line))
    }

    private func stickerThumbnail(_ sticker: Sticker) -> NSImage? {
        guard UUID(uuidString: sticker.id) != nil,
              let source = CGImageSourceCreateWithURL(assetFolder.appendingPathComponent(sticker.id) as CFURL, nil),
              let thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 200,
              ] as CFDictionary) else { return nil }
        return NSImage(cgImage: thumb, size: .zero)
    }
}

private enum VoiceSource: String, CaseIterable, Identifiable {
    case system
    case breezeblue
    case minimax
    case siliconflow
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "Mac 系统语音"
        case .breezeblue: return "BreezeBlue"
        case .minimax: return "MiniMax"
        case .siliconflow: return "硅基流动"
        case .custom: return "自定义 API（OpenAI 兼容）"
        }
    }

    var suggestions: VoiceAPIDraft {
        switch self {
        case .breezeblue:
            return VoiceAPIDraft(endpoint: "https://api.breeze.blue/v1/text-to-speech",
                                 model: "breeze-tts-2", voice: "voc_u3nxkd5578wc")
        case .minimax:
            return VoiceAPIDraft(endpoint: "https://api.minimaxi.com/v1/t2a_v2",
                                 model: "speech-2.8-turbo", voice: "qiaopi_mengmei")
        case .siliconflow:
            return VoiceAPIDraft(endpoint: "https://api.siliconflow.cn/v1/audio/speech",
                                 model: "FunAudioLLM/CosyVoice2-0.5B",
                                 voice: "FunAudioLLM/CosyVoice2-0.5B:claire")
        case .custom:
            return VoiceAPIDraft(endpoint: "例如 https://你的服务地址/v1/audio/speech",
                                 model: "服务商提供的模型", voice: "服务商提供的音色")
        case .system:
            return VoiceAPIDraft()
        }
    }
}

private struct VoiceAPIDraft {
    var endpoint = ""
    var model = ""
    var voice = ""
}

struct VoiceView: View {
    @ObservedObject var model: JingyuModel
    @State private var sample = "你好，我是鲸屿。很高兴见到你。"
    @State private var preview: Process?
    @State private var previewMessage = ""
    @State private var apiKey = ""
    @State private var drafts: [VoiceSource: VoiceAPIDraft] = [:]
    @State private var confirmingClear = false
    @State private var savingKey = false

    private var source: VoiceSource { VoiceSource(rawValue: model.settings.voiceProvider) ?? .system }
    private var previewPlaying: Bool { preview != nil || model.voicePreviewPlaying }

    private var savedKey: Bool {
        model.status?.settings.voiceProvider == source.rawValue && model.status?.voiceKeyConfigured == true
    }

    private var savedAddressChanged: Bool {
        guard savedKey, let stored = model.status?.settings.voiceEndpoint else { return false }
        let before = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        let after = model.settings.voiceEndpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard source != .custom else { return before != after }
        let defaultAddress = source.suggestions.endpoint
        return (before.isEmpty ? defaultAddress : before) != (after.isEmpty ? defaultAddress : after)
    }

    private var keyPlaceholder: String {
        if savedAddressChanged { return "为新的接口地址填写密钥" }
        return savedKey ? "已保存 · 留空保留现有密钥" : "填写服务商提供的 API 密钥"
    }

    private var sourceSelection: Binding<VoiceSource> {
        Binding(get: { source }, set: selectSource)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            voiceSettings
            audition
        }
        .onAppear { if source == .system { model.loadVoices() } }
        .onDisappear(perform: stopPreview)
        .onChange(of: model.busy) { busy in
            guard !busy, savingKey else { return }
            savingKey = false
            if model.error.isEmpty { apiKey = "" }
        }
        .confirmationDialog("清除已保存的语音 API 密钥？", isPresented: $confirmingClear, titleVisibility: .visible) {
            Button("清除密钥", role: .destructive) { saveVoice(clearKey: true) }
            Button("取消", role: .cancel) {}
        }
    }

    private var voiceSettings: some View {
        CharacterCard("语音发送") {
            HStack(alignment: .top, spacing: 18) {
                CharacterField("语音合成服务") {
                    Picker("语音合成服务", selection: sourceSelection) {
                        ForEach(VoiceSource.allCases) { item in
                            Text(item.label).tag(item)
                        }
                    }
                    .labelsHidden()
                    .disabled(model.busy)
                }
                voiceMode
            }
            if source == .system {
                systemVoice
            } else {
                apiSettings
            }
            HStack(spacing: 10) {
                Button("保存语音设置") { saveVoice() }
                    .buttonStyle(CharacterButton(primary: true))
                    .disabled(!model.online || model.busy)
                if source != .system && savedKey {
                    Button("清除已保存的密钥", role: .destructive) { confirmingClear = true }
                        .buttonStyle(CharacterButton(destructive: true))
                        .disabled(!model.online || model.busy)
                }
            }
        }
    }

    private var voiceMode: some View {
        CharacterField("什么时候发语音") {
            Picker("什么时候发语音", selection: $model.settings.voiceMode) {
                Text("关闭语音").tag("off")
                Text("我用 /voice 时").tag("on-request")
                Text("日常聊天也发语音").tag("always")
            }
            .labelsHidden()
        }
    }

    private var systemVoice: some View {
        CharacterField("系统音色") {
            Picker("系统音色", selection: $model.settings.voice) {
                ForEach(Array(Set(model.voices + [model.settings.voice]).subtracting([""])).sorted(), id: \.self) { voice in
                    Text(voice).tag(voice)
                }
            }
            .labelsHidden()
        }
    }

    private var apiSettings: some View {
        let suggestions = source.suggestions
        return VStack(alignment: .leading, spacing: 16) {
            CharacterTextField("API 接口地址", placeholder: suggestions.endpoint, text: $model.settings.voiceEndpoint)
            HStack(alignment: .top, spacing: 18) {
                CharacterTextField("模型 ID", placeholder: suggestions.model, text: $model.settings.voiceModel)
                CharacterTextField("音色 ID", placeholder: suggestions.voice, text: $model.settings.voiceId)
            }
            CharacterField("API 密钥") {
                SecureField(keyPlaceholder, text: $apiKey)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(CharacterPalette.field, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(CharacterPalette.fieldLine))
            }
            if savedAddressChanged {
                CardHint("保存过的密钥只会用于原接口地址。")
            }
            CardHint("试听文字和生成微信语音时使用的回复文本会发送到你配置的语音服务。")
        }
    }

    private var audition: some View {
        CharacterCard("声音与测试") {
            CharacterTextField("试听文字", text: $sample)
            Button(previewPlaying ? "停止播放" : "合成并试听", action: togglePreview)
                .buttonStyle(CharacterButton(primary: !previewPlaying))
                .disabled(!previewPlaying && (
                    sample.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || (source != .system && (!model.online || model.busy))
                ))
            if !previewMessage.isEmpty {
                CardHint(previewMessage)
            }
        }
    }

    private func selectSource(_ next: VoiceSource) {
        let previous = source
        guard next != previous else { return }
        stopPreview()
        previewMessage = ""
        apiKey = ""
        if previous != .system {
            drafts[previous] = VoiceAPIDraft(endpoint: model.settings.voiceEndpoint,
                                             model: model.settings.voiceModel, voice: model.settings.voiceId)
        }
        let draft = drafts[next] ?? savedDraft(for: next)
        model.settings.voiceProvider = next.rawValue
        model.settings.voiceEndpoint = draft.endpoint
        model.settings.voiceModel = draft.model
        model.settings.voiceId = draft.voice
        if next == .system { model.loadVoices() }
    }

    private func savedDraft(for provider: VoiceSource) -> VoiceAPIDraft {
        guard let settings = model.status?.settings, settings.voiceProvider == provider.rawValue else {
            return VoiceAPIDraft()
        }
        return VoiceAPIDraft(endpoint: settings.voiceEndpoint, model: settings.voiceModel, voice: settings.voiceId)
    }

    private func saveVoice(clearKey: Bool = false) {
        savingKey = source != .system && (clearKey || !apiKey.isEmpty)
        model.saveVoice(apiKey: clearKey || source == .system ? "" : apiKey, clearKey: clearKey)
    }

    private func stopPreview() {
        if let preview, preview.isRunning { preview.terminate() }
        if model.voicePreviewPlaying { model.stopVoicePreview() }
    }

    private func togglePreview() {
        if previewPlaying {
            stopPreview()
            return
        }
        if source != .system {
            previewMessage = ""
            model.previewVoice(String(sample.prefix(640)), apiKey: apiKey)
            return
        }
        let voice = model.settings.voice
        guard model.voices.contains(voice) else {
            previewMessage = "请先选一个这台 Mac 已安装的系统音色。"
            return
        }
        let runner = Process()
        runner.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        runner.arguments = ["-v", voice, "--", String(sample.prefix(160))]
        runner.standardOutput = FileHandle.nullDevice
        runner.standardError = FileHandle.nullDevice
        runner.terminationHandler = { completed in
            let status = completed.terminationStatus
            let interrupted = completed.terminationReason == .uncaughtSignal
            DispatchQueue.main.async {
                preview = nil
                if status != 0 && !interrupted {
                    previewMessage = "这次试听未能播放。可以换一个系统音色。"
                }
            }
        }
        do {
            try runner.run()
            preview = runner
            previewMessage = ""
        } catch {
            previewMessage = "无法启动 Mac 的语音试听。"
        }
    }
}

struct DiaryView: View {
    @ObservedObject var model: JingyuModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            CharacterCard("每日记忆 · 日记", subtitle: "鲸屿会用当天的私聊片段整理日记。") {
                HStack(spacing: 10) {
                    Button("从当天私聊生成日记", action: model.writeDiary)
                        .buttonStyle(CharacterButton(primary: true))
                    Button("刷新日记", action: model.loadDiaries)
                        .buttonStyle(CharacterButton())
                }
                if model.diaries.isEmpty {
                    Text("尚未生成日记")
                        .font(.system(size: 12))
                        .foregroundStyle(CharacterPalette.muted)
                        .frame(maxWidth: .infinity, minHeight: 55)
                } else {
                    ForEach(model.diaries, id: \.date) { entry in
                        DisclosureGroup {
                            Text(entry.text)
                                .font(.system(size: 13))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 8)
                        } label: {
                            Text(entry.date)
                                .font(.system(size: 13, weight: .medium))
                        }
                        .padding(10)
                        .background(CharacterPalette.field, in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            CharacterCard("日记时间", subtitle: "每天按北京时间写日记。到点时 DSH 需保持运行。") {
                Toggle("每天写日记", isOn: $model.settings.diaryEnabled)
                    .toggleStyle(.checkbox)
                CharacterField("每天几点") {
                    HStack(spacing: 5) {
                        timePicker("小时", component: 0, limit: 24)
                        Text("时").font(.caption)
                        timePicker("分钟", component: 1, limit: 60)
                        Text("分").font(.caption)
                    }
                    .disabled(!model.settings.diaryEnabled)
                }
                Button("保存日记时间", action: model.save)
                    .buttonStyle(CharacterButton(primary: true))
            }
        }
        .onAppear(perform: model.loadDiaries)
    }

    private func timePicker(_ label: String, component: Int, limit: Int) -> some View {
        Picker(label, selection: Binding(
            get: { timeParts[component] },
            set: { value in
                var next = timeParts
                next[component] = value
                model.settings.diaryTime = String(format: "%02d:%02d", next[0], next[1])
            }
        )) {
            ForEach(0..<limit, id: \.self) { value in
                Text(String(format: "%02d", value)).tag(value)
            }
        }
        .labelsHidden()
        .accessibilityLabel(label)
    }

    private var timeParts: [Int] {
        let fields = model.settings.diaryTime.split(separator: ":").compactMap { Int($0) }
        return fields.count == 2 ? fields : [21, 30]
    }
}
