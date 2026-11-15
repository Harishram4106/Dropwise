// Turns a timeline of JPEG frames into a 1920x1080, 30 fps H.264 MP4.
// Usage: encode <timeline.txt> <out.mp4>
// timeline.txt: one line per frame, "<seconds in the final video>\t<path to jpeg>", in order. Each frame is shown
// from its time until the next frame's. Frames that aren't 16:9 are fitted on a dark background.
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let args = CommandLine.arguments
guard args.count == 3 else { fatalError("usage: encode <timeline.txt> <out.mp4>") }
let width = 1920, height = 1080, fps: Int32 = 30

struct Entry { let t: Double; let path: String }
let entries: [Entry] = try String(contentsOfFile: args[1], encoding: .utf8)
  .split(separator: "\n")
  .compactMap { line in
    let parts = line.split(separator: "\t", maxSplits: 1)
    guard parts.count == 2, let t = Double(parts[0]) else { return nil }
    return Entry(t: t, path: String(parts[1]))
  }
guard let last = entries.last else { fatalError("empty timeline") }
let duration = last.t + 1.0

let outURL = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: outURL)
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let space = CGColorSpaceCreateDeviceRGB()
func render(_ path: String) -> CVPixelBuffer {
  var buffer: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
  let pb = buffer!
  CVPixelBufferLockBaseAddress(pb, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: space, bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  ctx.setFillColor(CGColor(red: 0, green: 0.11, blue: 0.39, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
  if let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
    let scale = min(Double(width) / Double(img.width), Double(height) / Double(img.height))
    let w = Double(img.width) * scale, h = Double(img.height) * scale
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: (Double(width) - w) / 2, y: (Double(height) - h) / 2, width: w, height: h))
  }
  CVPixelBufferUnlockBaseAddress(pb, [])
  return pb
}

var index = 0
var current: CVPixelBuffer? = nil
var currentPath = ""
let total = Int(duration * Double(fps))
for frame in 0..<total {
  let t = Double(frame) / Double(fps)
  while index + 1 < entries.count && entries[index + 1].t <= t { index += 1 }
  if entries[index].path != currentPath {
    currentPath = entries[index].path
    current = render(currentPath)
  }
  while !input.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(current!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fatalError("writer failed: \(String(describing: writer.error))") }
print("wrote \(args[2]): \(String(format: "%.1f", duration)) s, \(total) frames")
