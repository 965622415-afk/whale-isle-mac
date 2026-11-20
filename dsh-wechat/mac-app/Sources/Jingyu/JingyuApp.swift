import AppKit
import SwiftUI

@main
struct JingyuApp: App {
    @StateObject private var model = JingyuModel()

    var body: some Scene {
        Window("鲸屿 · AI 配置中心", id: "jingyu-settings") {
            Workbench(model: model)
                .frame(minWidth: 900, minHeight: 655)
                .preferredColorScheme(.light)
                .task { await model.monitor() }
        }
        .defaultSize(width: 1130, height: 790)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .saveItem) {
                Button("保存鲸屿设置") { model.save() }
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(!model.canSave)
            }
        }
    }
}

private let ink = Color(red: 32 / 255, green: 48 / 255, blue: 59 / 255)
private let muted = Color(red: 104 / 255, green: 118 / 255, blue: 129 / 255)
private let accent = Color(red: 22 / 255, green: 126 / 255, blue: 130 / 255)
private let panelOutline = Color(red: 230 / 255, green: 235 / 255, blue: 239 / 255)
private let sidebar = Color(red: 20 / 255, green: 43 / 255, blue: 53 / 255)
private let selected = Color(red: 42 / 255, green: 75 / 255, blue: 85 / 255)
private let mint = Color(red: 152 / 255, green: 216 / 255, blue: 201 / 255)

private enum Page: String, CaseIterable, Identifiable {
    case home, models, persona, stickers, voice, diary, prompts, chat, memory, settings, work, bridge, diagnostics

    var id: Self { self }

    var label: String {
        switch self {
        case .home: return "总览"
        case .models: return "模型与连接"
        case .persona: return "角色设定"
        case .stickers: return "表情包"
        case .voice: return "语音发送"
        case .diary: return "日记"
        case .prompts: return "提示词与预设"
        case .chat: return "本机试聊"
        case .memory: return "对话与记忆"
        case .settings: return "设置"
        case .work: return "Harness 任务"
        case .bridge: return "微信桥接"
        case .diagnostics: return "诊断与关于"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "◒"
        case .models: return "◈"
        case .persona: return "◇"
        case .stickers: return "▧"
        case .voice: return "♫"
        case .diary: return "▥"
        case .prompts: return "≋"
        case .chat: return "◌"
        case .memory: return "▤"
        case .settings: return "⚙"
        case .work: return "✦"
        case .bridge: return "⇄"
        case .diagnostics: return "⌁"
        }
    }
}

private struct Workbench: View {
    @ObservedObject var model: JingyuModel
    @State private var page = Page.home
    @State private var test = ""

    var body: some View {
        HStack(spacing: 0) {
            navigation
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.horizontal, 38)
                    .padding(.top, 47)
                    .padding(.bottom, 22)
                if !model.error.isEmpty || !model.notice.isEmpty {
                    Text(model.error.isEmpty ? model.notice : model.error)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(model.error.isEmpty ? accent : .red)
                        .padding(.horizontal, 38)
                        .padding(.bottom, 10)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 17) { detail }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 38)
                        .padding(.bottom, 32)
                }
                .id(page)
            }
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(red: 244 / 255, green: 246 / 255, blue: 250 / 255))
        }
        .tint(accent)
    }

    private var navigation: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                WhaleMark().frame(width: 45, height: 45)
                VStack(alignment: .leading, spacing: 4) {
                    Text("鲸屿").font(.system(size: 25, weight: .bold)).tracking(3)
                        .foregroundStyle(Color(red: 0.91, green: 0.97, blue: 0.93))
                    Text("WHALE ISLE").font(.system(size: 9)).tracking(2)
                        .foregroundStyle(Color(red: 0.57, green: 0.68, blue: 0.71))
                }
            }
            .padding(.leading, 14)
            .padding(.top, 48)
            .padding(.bottom, 23)
            Text("你的 AI 工作台")
                .font(.system(size: 11))
                .tracking(1)
                .foregroundStyle(Color(red: 0.45, green: 0.57, blue: 0.62))
                .padding(.leading, 14)
                .padding(.bottom, 10)
            ScrollView {
                VStack(spacing: 3) {
                    ForEach(Page.allCases) { item in
                        Button { page = item } label: {
                            HStack(spacing: 13) {
                                Text(item.symbol).font(.system(size: 17)).frame(width: 20)
                                    .accessibilityHidden(true)
                                Text(item.label).font(.system(size: 14))
                                Spacer(minLength: 0)
                                if page == item { Circle().fill(mint).frame(width: 5, height: 5) }
                            }
                            .padding(.horizontal, 15)
                            .frame(height: 37)
                            .contentShape(Rectangle())
                            .foregroundStyle(page == item ? Color(red: 0.88, green: 0.97, blue: 0.93)
                                                           : Color(red: 0.66, green: 0.75, blue: 0.78))
                            .background(page == item ? selected : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(page == item ? .isSelected : [])
                    }
                }
            }
            .scrollIndicators(.hidden)
            HStack(spacing: 7) {
                Circle().fill(mint).frame(width: 6, height: 6)
                Text("本机运行 · 设置保存在 Mac")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 0.51, green: 0.62, blue: 0.66))
            }
            .padding(.top, 14)
            .padding(.leading, 10)
            .padding(.bottom, 19)
        }
        .padding(.horizontal, 17)
        .frame(width: 218)
        .background(sidebar)
    }

    private var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 6) {
                Text("WHALE ISLE / MACOS").font(.system(size: 10, weight: .semibold)).tracking(1.6)
                    .foregroundStyle(muted)
                Text(page.label).font(.system(size: 25, weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer()
            if model.busy { ProgressView().controlSize(.small).accessibilityLabel("正在处理") }
            Text(model.online ? "DSH 已连接" : "DSH 未连接")
                .font(.system(size: 11))
                .foregroundStyle(muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.white, in: Capsule())
                .overlay { Capsule().strokeBorder(panelOutline) }
            Button { model.refresh() } label: { Image(systemName: "arrow.clockwise") }
                .help("刷新连接状态")
                .accessibilityLabel("刷新连接状态")
            if model.hasUnsavedChanges && page != .voice {
                Button("保存设置") { model.save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canSave)
            }
        }
    }

    @ViewBuilder private var detail: some View {
        switch page {
        case .home: home
        case .models: modelPanel
        case .persona: PersonaView(model: model)
        case .stickers: StickersView(model: model)
        case .voice: VoiceView(model: model)
        case .diary: DiaryView(model: model)
        case .prompts: PromptsView(model: model)
        case .chat: testPanel
        case .memory: MemoryView(model: model)
        case .settings: GroupView(model: model)
        case .work: WorkView(model: model)
        case .bridge: ConnectionView(model: model)
        case .diagnostics: about
        }
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text("让你的 AI，有自己的样子。")
                        .font(.system(size: 27, weight: .semibold))
                    Text("设置鲸屿的角色和表达，在微信和她聊天，或把手头的任务交给 Mac 上的 DSH。")
                        .foregroundStyle(muted).lineSpacing(4)
                    HStack {
                        Button(model.status?.connection == "connected" ? "查看微信连接" : "连接微信") { page = .bridge }
                            .buttonStyle(.borderedProminent)
                        Button("角色设定") { page = .persona }
                    }
                }
                Spacer()
                WhaleMark().frame(width: 112, height: 104).opacity(0.78)
            }
            .padding(30)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(red: 0.90, green: 0.94, blue: 0.93), in: RoundedRectangle(cornerRadius: 16))
            HStack(spacing: 12) {
                tile("正在使用的角色", model.settings.name, "\(model.presets.count) 份本机预设")
                tile("微信私聊", model.status?.connection == "connected" ? "已绑定" : "待连接", "微信 ClawBot")
                tile("远程工作", model.settings.workEnabled ? "已开启" : "未开启", "DSH 原生会话")
            }
            DesktopPanel("把配置变成体验") {
                shortcut("完善你的角色", "编辑称呼、性格和背景。", page: .persona)
                Divider()
                shortcut("看看她怎么说话", "把一条测试消息送到 DSH 陪伴会话。", page: .chat)
                Divider()
                shortcut("设置远程工作", "选择要交给鲸屿处理的 Mac 项目。", page: .work)
            }
        }
    }

    private func tile(_ name: String, _ value: String, _ note: String) -> some View {
        DesktopPanel(name) {
            Text(value).font(.system(size: 21, weight: .semibold))
            Text(note).font(.system(size: 12)).foregroundStyle(muted)
        }.frame(maxWidth: .infinity)
    }

    private func shortcut(_ name: String, _ note: String, page target: Page) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(name).fontWeight(.medium)
                Text(note).font(.system(size: 12)).foregroundStyle(muted)
            }
            Spacer()
            Button(target.label + " →") { page = target }
        }
    }

    private var modelPanel: some View {
        DesktopPanel("DeepSeek Harness 模型") {
            Text("鲸屿使用你在 DSH 中配置的模型。陪伴、工作和群聊分别保存在原生会话中。")
                .foregroundStyle(muted)
            Button("在 DSH 管理模型") { model.openDSH() }.buttonStyle(.borderedProminent)
        }
    }

    private var testPanel: some View {
        DesktopPanel("陪伴会话试聊") {
            Text("消息和回复可以在 DSH 的「鲸屿 · 陪伴」中查看。")
                .foregroundStyle(muted)
            TextField("输入一条测试消息", text: $test)
                .textFieldStyle(.roundedBorder)
                .onSubmit { if canSendTest { model.testChat(test) } }
            HStack {
                Button("发送测试消息") { model.testChat(test) }
                    .buttonStyle(.borderedProminent).disabled(!canSendTest)
                Button("打开 DSH") { model.openDSH() }
            }
        }
    }

    private var canSendTest: Bool { model.online && !model.busy && !test.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var about: some View {
        VStack(alignment: .leading, spacing: 17) {
            DesktopPanel("运行状态") {
                Text(model.online ? "鲸屿插件正在运行。" : "请打开 DSH 以使用微信收发和工作执行。")
                Button("打开 DSH") { model.openDSH() }
                LabeledContent("应用版本", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.2.0")
            }
            DesktopPanel("旧版鲸屿资料") {
                if let migration = model.migration {
                    Text("已导入 \(migration.presets) 份人设预设、\(migration.stickers) 张表情包。")
                    if migration.skipped > 0 { Text("\(migration.skipped) 张图片超过导入限制，仍留在旧资料目录。") }
                } else {
                    Text("从这台 Mac 的旧鲸屿资料中导入角色、提示词、预设及表情包。")
                }
                Button("从旧版导入") { model.importLegacy() }
                    .disabled(!model.online || model.busy || model.hasUnsavedChanges)
            }
        }
    }
}

private struct WhaleMark: View {
    var body: some View {
        Canvas { context, size in
            let transform = CGAffineTransform(scaleX: size.width / 48, y: size.height / 48)
            var body = Path()
            body.move(to: CGPoint(x: 8, y: 25))
            body.addCurve(to: CGPoint(x: 25, y: 10), control1: CGPoint(x: 8, y: 16), control2: CGPoint(x: 15, y: 10))
            body.addCurve(to: CGPoint(x: 38, y: 22), control1: CGPoint(x: 33, y: 10), control2: CGPoint(x: 37, y: 15))
            body.addLines([CGPoint(x: 38, y: 22), CGPoint(x: 45, y: 17), CGPoint(x: 43, y: 29), CGPoint(x: 35, y: 28)])
            body.addCurve(to: CGPoint(x: 8, y: 25), control1: CGPoint(x: 24, y: 42), control2: CGPoint(x: 8, y: 37))
            body.closeSubpath()
            context.fill(body.applying(transform), with: .color(mint))
            context.fill(Path(ellipseIn: CGRect(x: 27, y: 18, width: 4, height: 4)).applying(transform), with: .color(sidebar))
            var spout = Path()
            spout.move(to: CGPoint(x: 17, y: 10))
            spout.addLine(to: CGPoint(x: 13, y: 3))
            spout.move(to: CGPoint(x: 22, y: 8))
            spout.addLine(to: CGPoint(x: 23, y: 3))
            context.stroke(spout.applying(transform), with: .color(mint),
                           style: StrokeStyle(lineWidth: 2.6 * size.width / 48, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

struct DesktopPanel<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 17, weight: .semibold)).accessibilityAddTraits(.isHeader)
            content
        }
        .padding(23)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 13))
        .overlay { RoundedRectangle(cornerRadius: 13).strokeBorder(panelOutline) }
    }
}

private struct PromptsView: View {
    @ObservedObject var model: JingyuModel
    @State private var presetName = ""

    var body: some View {
        DesktopPanel("编辑提示词") {
            editor("核心角色", $model.settings.rolePrompt, height: 132)
            editor("表达风格", $model.settings.stylePrompt, height: 72)
            editor("私聊规则", $model.settings.privatePrompt, height: 72)
            editor("群聊规则", $model.settings.groupPrompt, height: 72)
            editor("行为边界", $model.settings.boundaries, height: 72)
            Button("保存提示词") { model.save() }.buttonStyle(.borderedProminent).disabled(!model.canSave)
        }
        DesktopPanel("人设预设") {
            ForEach(model.presets) { preset in
                HStack {
                    Text(preset.name)
                    Spacer()
                    Button("使用预设") { model.usePreset(preset) }
                }
                Divider()
            }
            HStack {
                TextField("预设名称", text: $presetName).textFieldStyle(.roundedBorder)
                Button("另存为预设") {
                    model.savePreset(presetName)
                    presetName = ""
                }.disabled(presetName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func editor(_ label: String, _ text: Binding<String>, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 12, weight: .medium))
            TextEditor(text: text).font(.system(size: 13)).padding(5)
                .frame(minHeight: height)
                .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(panelOutline) }
                .accessibilityLabel(label)
        }
    }
}
