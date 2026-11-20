import AppKit
import Foundation
import SwiftUI

struct ConnectionView: View {
    @ObservedObject var model: JingyuModel
    @State private var pin = ""
    @State private var testMessage = "你好，鲸屿。请简单介绍一下自己。"
    @State private var confirmDisconnect = false
    @State private var copiedClaim = false

    var body: some View {
        Form {
            Section("微信连接") {
                if let status = model.status {
                    connectionStatus(status)
                    if status.connection == "pairing" {
                        pairingView(status)
                    }
                    if let code = status.claimCode, status.connection == "claim" {
                        claimView(code)
                    }
                } else {
                    Label("正在等待 DSH", systemImage: "bolt.horizontal.circle")
                        .font(.headline)
                    Text("打开 Mac 上的 DeepSeek Harness，鲸屿加载后就可以连接微信。")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("打开 DSH", action: model.openDSH)
                        Button("重新检查", action: model.refresh)
                    }
                }
            }

            Section("测试 DSH") {
                Text("测试会把这条消息发进 DSH 的「鲸屿 · 陪伴」会话。")
                    .foregroundStyle(.secondary)
                TextField("测试消息", text: $testMessage)
                    .onSubmit(sendTest)
                    .disabled(model.status == nil)
                HStack {
                    Button("发测试消息", action: sendTest)
                        .disabled(model.status == nil || testMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("打开 DSH", action: model.openDSH)
                }
            }
        }
        .formStyle(.grouped)
        .confirmationDialog("断开微信连接？", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("断开连接", role: .destructive, action: model.disconnectWeChat)
            Button("取消", role: .cancel) {}
        } message: {
            Text("之后可以再次扫码绑定。已保存的对话仍可在 DSH 中查看。")
        }
        .onChange(of: model.status?.connection) { _ in
            pin = ""
            copiedClaim = false
        }
    }

    private func connectionStatus(_ status: BridgeStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(connectionLabel(status.connection), systemImage: connectionIcon(status.connection))
                .font(.headline)
                .foregroundStyle(status.connection == "connected" ? Color.green : Color.primary)
            if !status.message.isEmpty {
                Text(status.message)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            if !status.lastError.isEmpty {
                Text(status.lastError)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            HStack {
                switch status.connection {
                case "connected":
                    Button("断开连接") { confirmDisconnect = true }
                case "pairing", "claim":
                    Button("取消绑定", action: model.disconnectWeChat)
                default:
                    Button("连接微信", action: model.connectWeChat)
                        .buttonStyle(.borderedProminent)
                }
                Button("刷新状态", action: model.refresh)
            }
        }
    }

    @ViewBuilder
    private func pairingView(_ status: BridgeStatus) -> some View {
        if let image = status.qrImage, let layout = JingyuQRGrid(dataURI: image) {
            JingyuQRCode(grid: layout)
                .frame(width: 222, height: 222)
                .accessibilityLabel("微信绑定二维码")
            Text("用手机微信扫一扫，然后在手机上确认。")
                .foregroundStyle(.secondary)
        } else if !status.pinRequired {
            Text("二维码生成后会显示在这里。")
                .foregroundStyle(.secondary)
        }
        if let value = status.qrUrl, let url = trustedWeChatURL(value) {
            Link("打开微信连接页", destination: url)
        }
        if status.pinRequired {
            HStack {
                TextField("手机微信显示的验证码", text: $pin)
                    .onSubmit(verifyPIN)
                Button("提交验证码", action: verifyPIN)
                    .disabled(pin.isEmpty)
            }
        }
    }

    private func claimView(_ code: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("在手机新出现的微信机器人对话中发送以下内容，完成绑定。")
            HStack(spacing: 12) {
                Text("/claim " + code)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                Button(copiedClaim ? "已复制" : "复制绑定指令") {
                    copiedClaim = copyJingyuValue("/claim " + code)
                }
            }
        }
    }

    private func verifyPIN() {
        let digits = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !digits.isEmpty else { return }
        model.submitPIN(digits)
    }

    private func sendTest() {
        let message = testMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard model.status != nil, !message.isEmpty else { return }
        model.testChat(message)
    }

    private func connectionLabel(_ state: String) -> String {
        switch state {
        case "connected": "微信已连接"
        case "pairing": "等待微信扫码"
        case "claim": "等待微信确认"
        default: "微信未连接"
        }
    }

    private func connectionIcon(_ state: String) -> String {
        switch state {
        case "connected": "checkmark.circle.fill"
        case "pairing", "claim": "qrcode"
        default: "message"
        }
    }
}

struct WorkView: View {
    @ObservedObject var model: JingyuModel

    private var canTest: Bool {
        guard let saved = model.status?.settings else { return false }
        return saved.workEnabled && model.settings.workEnabled && saved.workspace == model.settings.workspace
    }

    var body: some View {
        Form {
            Section("工作设置") {
                Toggle("启用远程工作", isOn: $model.settings.workEnabled)
                VStack(alignment: .leading, spacing: 7) {
                    Text("工作文件夹")
                    HStack {
                        TextField("选择你要交给鲸屿的项目文件夹", text: $model.settings.workspace)
                        Button("选择…", action: chooseWorkspace)
                    }
                }
                Toggle("接通电源时保持唤醒", isOn: $model.settings.stayAwake)
                Text("微信已绑定且 DSH 正在运行时，锁屏后能继续工作。Mac 休眠或离线时，任务会暂停。")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("保存", action: model.save)
                        .buttonStyle(.borderedProminent)
                    Button("测试工作会话", action: model.testWork)
                        .disabled(!canTest)
                    Button("打开 DSH", action: model.openDSH)
                }
                if let status = model.status, !status.message.isEmpty, status.workId != nil {
                    Text(status.message)
                        .foregroundStyle(.secondary)
                }
                Text("保存后可运行只读测试。测试会让 DSH 列出至多五个文件或文件夹的名称。")
                    .foregroundStyle(.secondary)
            }

            Section("微信里怎么用") {
                example("派任务", "帮我在电脑上检查这个项目")
                example("连续派活", "开始工作")
                example("切回陪聊", "结束工作")
                example("取回结果", "任务结果")
                example("取回文件", "/file 报告.pdf")
                Text("DSH 需要审批时会通过微信提醒。在 Mac 的 DSH 中处理后，任务即可继续。")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func example(_ label: String, _ command: String) -> some View {
        LabeledContent(label) {
            Text(command)
                .textSelection(.enabled)
        }
    }

    private func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.title = "选择鲸屿的工作文件夹"
        panel.prompt = "选择"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        if !model.settings.workspace.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: NSString(string: model.settings.workspace).expandingTildeInPath)
        }
        if panel.runModal() == .OK, let url = panel.url {
            model.settings.workspace = url.path
        }
    }
}

struct GroupView: View {
    @ObservedObject var model: JingyuModel
    @State private var showKey = false
    @State private var copiedKey = false

    var body: some View {
        Form {
            Section("AstrBot 群聊") {
                Text("AstrBot 需要能接收目标群的消息。在已授权的群里 @ 鲸屿，消息会进入该群自己的 DSH 会话。")
                    .foregroundStyle(.secondary)
                Toggle("启用群聊陪伴", isOn: $model.settings.groupEnabled)
                VStack(alignment: .leading, spacing: 7) {
                    Text("授权的群聊 ID")
                    TextEditor(text: $model.settings.groupIds)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 84)
                        .accessibilityLabel("授权的群聊 ID")
                    Text("填写 AstrBot 适配器显示的 ID，每行一个。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Button("保存", action: model.save)
                    .buttonStyle(.borderedProminent)
            }

            if model.settings.groupEnabled {
                Section("AstrBot 插件配置") {
                    Text("把同一台 Mac 上的 AstrBot 指向下方接口。")
                        .foregroundStyle(.secondary)
                    Text("http://127.0.0.1:18429/api/group/reply")
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                    if let key = model.status?.groupKey {
                        HStack {
                            if showKey {
                                Text(key)
                                    .font(.system(.callout, design: .monospaced))
                                    .textSelection(.enabled)
                            } else {
                                SecureField("群聊连接密钥", text: .constant(key))
                                    .disabled(true)
                            }
                            Button(showKey ? "隐藏" : "显示") {
                                showKey.toggle()
                            }
                            Button(copiedKey ? "已复制" : "复制") {
                                copiedKey = copyJingyuValue(key)
                            }
                        }
                    } else {
                        Text("保存配置后会生成群聊连接密钥。")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: model.status?.groupKey) { _ in
            showKey = false
            copiedKey = false
        }
        .onDisappear {
            showKey = false
            copiedKey = false
        }
    }
}

private func copyJingyuValue(_ value: String) -> Bool {
    NSPasteboard.general.clearContents()
    return NSPasteboard.general.setString(value, forType: .string)
}

private func trustedWeChatURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.scheme == "https", url.user == nil, url.password == nil,
          let hostname = url.host?.lowercased(),
          ["weixin.qq.com", "wechat.com"].contains(where: { hostname == $0 || hostname.hasSuffix("." + $0) })
    else { return nil }
    return url
}

// The bridge emits an SVG made solely of 1×1 QR cells. Decode those cells without loading a web page.
struct JingyuQRGrid {
    let side: Int
    let cells: [CGPoint]

    init?(dataURI: String) {
        let prefix = "data:image/svg+xml;base64,"
        guard dataURI.hasPrefix(prefix), dataURI.utf8.count <= 800_000,
              let data = Data(base64Encoded: String(dataURI.dropFirst(prefix.count))),
              let svg = String(data: data, encoding: .utf8),
              let viewBox = svg.range(of: #"viewBox="0 0 [0-9]{2,3} [0-9]{2,3}""#, options: .regularExpression)
        else { return nil }

        let dimensions = svg[viewBox].dropFirst("viewBox=\"0 0 ".count).dropLast().split(separator: " ")
        guard dimensions.count == 2, let side = Int(dimensions[0]), Int(dimensions[1]) == side,
              (29...185).contains(side), (side - 29).isMultiple(of: 4),
              let pathStart = svg.range(of: #"<path d=""#),
              let pathEnd = svg.range(of: #""/></svg>"#, range: pathStart.upperBound..<svg.endIndex),
              let cellPattern = try? NSRegularExpression(pattern: #"M([0-9]{1,3}),([0-9]{1,3})h1v1h-1z"#)
        else { return nil }

        let path = String(svg[pathStart.upperBound..<pathEnd.lowerBound])
        let matches = cellPattern.matches(in: path, range: NSRange(path.startIndex..., in: path))
        var cells: [CGPoint] = []
        var cursor = 0
        for item in matches {
            guard item.range.location == cursor,
                  let xRange = Range(item.range(at: 1), in: path), let yRange = Range(item.range(at: 2), in: path),
                  let x = Int(path[xRange]), let y = Int(path[yRange]),
                  (4..<(side - 4)).contains(x), (4..<(side - 4)).contains(y)
            else { return nil }
            cells.append(CGPoint(x: x, y: y))
            cursor = NSMaxRange(item.range)
        }
        guard cursor == path.utf16.count, !cells.isEmpty else { return nil }
        self.side = side
        self.cells = cells
    }
}

private struct JingyuQRCode: View {
    let grid: JingyuQRGrid

    var body: some View {
        Canvas { context, size in
            let module = floor(min(size.width, size.height) / CGFloat(grid.side))
            guard module >= 1 else { return }
            let width = CGFloat(grid.side) * module
            let left = floor((size.width - width) / 2)
            let top = floor((size.height - width) / 2)
            let background = Path(CGRect(origin: .zero, size: size))
            context.fill(background, with: .color(.white))
            var modules = Path()
            for cell in grid.cells {
                modules.addRect(CGRect(x: left + cell.x * module, y: top + cell.y * module, width: module, height: module))
            }
            context.fill(modules, with: .color(.black), style: FillStyle(antialiased: false))
        }
        .accessibilityAddTraits(.isImage)
    }
}
