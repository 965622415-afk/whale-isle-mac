import AppKit
let root=CommandLine.arguments[1]
let size=1024
let image=NSImage(size:NSSize(width:size,height:size))
image.lockFocus()
let rect=NSRect(x:0,y:0,width:1024,height:1024)
let bg=NSBezierPath(roundedRect:rect.insetBy(dx:20,dy:20),xRadius:218,yRadius:218)
NSColor(calibratedRed:0.08,green:0.21,blue:0.26,alpha:1).setFill();bg.fill()
let glow=NSBezierPath(ovalIn:NSRect(x:210,y:270,width:604,height:484))
NSColor(calibratedRed:0.12,green:0.29,blue:0.33,alpha:1).setFill();glow.fill()
let whale=NSBezierPath();whale.move(to:NSPoint(x:210,y:480));whale.curve(to:NSPoint(x:710,y:505),controlPoint1:NSPoint(x:185,y:750),controlPoint2:NSPoint(x:678,y:762));whale.line(to:NSPoint(x:850,y:607));whale.line(to:NSPoint(x:805,y:397));whale.line(to:NSPoint(x:695,y:426));whale.curve(to:NSPoint(x:210,y:480),controlPoint1:NSPoint(x:500,y:240),controlPoint2:NSPoint(x:230,y:300));whale.close()
NSColor(calibratedRed:0.67,green:0.87,blue:0.76,alpha:1).setFill();whale.fill()
NSColor(calibratedRed:0.08,green:0.21,blue:0.26,alpha:1).setFill();NSBezierPath(ovalIn:NSRect(x:590,y:558,width:34,height:34)).fill()
let wave=NSBezierPath();wave.move(to:NSPoint(x:235,y:272));wave.curve(to:NSPoint(x:780,y:272),controlPoint1:NSPoint(x:400,y:342),controlPoint2:NSPoint(x:598,y:210));wave.lineWidth=20;wave.lineCapStyle = .round;NSColor(calibratedRed:0.31,green:0.56,blue:0.59,alpha:1).setStroke();wave.stroke()
NSColor(calibratedRed:0.91,green:0.83,blue:0.63,alpha:1).setFill();NSBezierPath(ovalIn:NSRect(x:252,y:755,width:58,height:58)).fill()
image.unlockFocus()
let rep=NSBitmapImageRep(data:image.tiffRepresentation!)!
try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:root))
