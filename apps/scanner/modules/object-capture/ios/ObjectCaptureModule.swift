import ExpoModulesCore
#if canImport(RealityKit)
import RealityKit
#endif

/// Bridges RealityKit's Object Capture (iOS 17+, LiDAR) to JS.
public class ObjectCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ObjectCapture")

    Function("isSupported") { () -> Bool in
      #if canImport(RealityKit) && !targetEnvironment(simulator)
      if #available(iOS 17.0, *) {
        return ObjectCaptureSession.isSupported
      }
      #endif
      return false
    }

    AsyncFunction("startCapture") { (_: CaptureOptions, promise: Promise) in
      // TODO: present an ObjectCaptureView, drive the ObjectCaptureSession, optionally run
      // PhotogrammetrySession for a USDZ, and resolve with the CaptureResult fields
      // (frames, poses, scaleM, meshUri).
      promise.reject("ERR_NOT_IMPLEMENTED", "Object Capture flow is not implemented yet")
    }
  }
}

struct CaptureOptions: Record {
  @Field var maxFrames: Int = 80
  @Field var reconstructOnDevice: Bool = true
}
