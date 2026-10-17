package expo.modules.objectcapture

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android has no RealityKit equivalent; the JS layer falls back to guided
 * expo-camera capture and the driver reconstructs server-side. An ARCore
 * depth-assisted capture can be implemented here later behind the same API.
 */
class ObjectCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ObjectCapture")

    Function("isSupported") { false }

    AsyncFunction("startCapture") { _: Map<String, Any?> ->
      throw CodedException("ERR_UNSUPPORTED", "Object Capture is iOS-only; use guided capture", null)
    }
  }
}
