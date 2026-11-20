import AppKit

// The original Whale Isle macOS icon from desktop/scripts/make-icon.swift.
let destination = URL(fileURLWithPath: CommandLine.arguments[1])
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()

let ocean = NSColor(calibratedRed: 0.08, green: 0.21, blue: 0.26, alpha: 1)
ocean.setFill()
NSBezierPath(
    roundedRect: NSRect(x: 20, y: 20, width: 984, height: 984), xRadius: 218, yRadius: 218
).fill()

NSColor(calibratedRed: 0.12, green: 0.29, blue: 0.33, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 210, y: 270, width: 604, height: 484)).fill()

let whale = NSBezierPath()
whale.move(to: NSPoint(x: 210, y: 480))
whale.curve(
    to: NSPoint(x: 710, y: 505), controlPoint1: NSPoint(x: 185, y: 750),
    controlPoint2: NSPoint(x: 678, y: 762)
)
whale.line(to: NSPoint(x: 850, y: 607))
whale.line(to: NSPoint(x: 805, y: 397))
whale.line(to: NSPoint(x: 695, y: 426))
whale.curve(
    to: NSPoint(x: 210, y: 480), controlPoint1: NSPoint(x: 500, y: 240),
    controlPoint2: NSPoint(x: 230, y: 300)
)
whale.close()
NSColor(calibratedRed: 0.67, green: 0.87, blue: 0.76, alpha: 1).setFill()
whale.fill()

ocean.setFill()
NSBezierPath(ovalIn: NSRect(x: 590, y: 558, width: 34, height: 34)).fill()

let wave = NSBezierPath()
wave.move(to: NSPoint(x: 235, y: 272))
wave.curve(
    to: NSPoint(x: 780, y: 272), controlPoint1: NSPoint(x: 400, y: 342),
    controlPoint2: NSPoint(x: 598, y: 210)
)
wave.lineWidth = 20
wave.lineCapStyle = .round
NSColor(calibratedRed: 0.31, green: 0.56, blue: 0.59, alpha: 1).setStroke()
wave.stroke()

NSColor(calibratedRed: 0.91, green: 0.83, blue: 0.63, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 252, y: 755, width: 58, height: 58)).fill()

image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let source = bitmap.cgImage,
      let space = CGColorSpace(name: CGColorSpace.sRGB)
else { throw CocoaError(.fileWriteUnknown) }

func png(pixels: Int) throws -> Data {
    guard let graphics = CGContext(
        data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: pixels * 4,
        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { throw CocoaError(.fileWriteUnknown) }
    graphics.interpolationQuality = .high
    graphics.draw(source, in: CGRect(x: 0, y: 0, width: pixels, height: pixels))
    guard let resized = graphics.makeImage(),
          let contents = NSBitmapImageRep(cgImage: resized).representation(using: .png, properties: [:])
    else { throw CocoaError(.fileWriteUnknown) }
    return contents
}

func appendEntry(_ type: String, bytes: Data, to contents: inout Data) {
    // Each ICNS entry contains a four-letter type and its big-endian size, including the header.
    contents.append(contentsOf: type.utf8)
    let length = UInt32(bytes.count + 8).bigEndian
    withUnsafeBytes(of: length) { contents.append(contentsOf: $0) }
    contents.append(bytes)
}

let representations = [
    ("icp4", 16), ("ic11", 32), ("icp5", 32), ("ic12", 64),
    ("ic07", 128), ("ic13", 256), ("ic08", 256), ("ic14", 512),
    ("ic09", 512), ("ic10", 1024),
]
var images = Data()
for (type, size) in representations {
    appendEntry(type, bytes: try png(pixels: size), to: &images)
}
var catalog = Data()
appendEntry("icns", bytes: images, to: &catalog)
try catalog.write(to: destination)
