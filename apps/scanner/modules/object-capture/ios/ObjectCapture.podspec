Pod::Spec.new do |s|
  s.name           = 'ObjectCapture'
  s.version        = '0.1.0'
  s.summary        = 'RealityKit Object Capture bridge for the Infallible scanner'
  s.description    = s.summary
  s.author         = 'Infallible'
  s.homepage       = 'https://github.com/infallible'
  s.license        = { type: 'Proprietary' }
  s.platforms      = { ios: '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'RealityKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
