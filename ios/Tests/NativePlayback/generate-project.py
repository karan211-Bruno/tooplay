#!/usr/bin/env python3
"""Generate a hosted native XCTest project without changing the application project.

Usage: generate-project.py OUTPUT_DIR HOST_PRODUCTS_DIR VIDEO_MP4 SUBTITLE_SRT
Build the real simulator host with ENABLE_TESTABILITY=YES before running this test.
"""
import hashlib
import plistlib
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 5:
    raise SystemExit(__doc__)
source = Path(__file__).resolve().parent
root, products, video, subtitle = [Path(value).resolve() for value in sys.argv[1:]]
host = products / 'Tooplay.app' / 'Tooplay'
for item in (host, video, subtitle):
    if not item.is_file():
        raise SystemExit(f'Missing required input: {item}')
root.mkdir(parents=True, exist_ok=True)
host_products = Path(str(root).replace('/private/tmp/', '/tmp/', 1)) / 'HostProducts'
host_products.mkdir(exist_ok=True)
shutil.copytree(host.parent, host_products / 'Tooplay.app', dirs_exist_ok=True)
host_info = plistlib.loads((host.parent / 'Info.plist').read_bytes())
test_host = host_products / 'Tooplay.app' / 'Tooplay'
shutil.copyfile(source / 'NativePlaybackTests.swift', root / 'NativePlaybackTests.swift')
shutil.copyfile(video, root / 'Tooplay-smoke-video.mp4')
shutil.copyfile(subtitle, root / 'Tooplay-smoke-subtitle.srt')

def uid(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def quote(value): return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
objects = []
def obj(name, value): objects.append(f'\t\t{uid(name)} = {{ {value} }};')
for name, path, kind in [('source', 'NativePlaybackTests.swift', 'sourcecode.swift'), ('video', 'Tooplay-smoke-video.mp4', 'file'), ('subtitle', 'Tooplay-smoke-subtitle.srt', 'text')]:
    obj(name, f'isa = PBXFileReference; lastKnownFileType = {kind}; path = {quote(path)}; sourceTree = "<group>";')
    obj(name + '-build', f'isa = PBXBuildFile; fileRef = {uid(name)};')
obj('product', 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = NativePlaybackTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
obj('host-product', 'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Tooplay.app; sourceTree = BUILT_PRODUCTS_DIR;')
obj('main-group', f'isa = PBXGroup; children = ({uid("source")},{uid("video")},{uid("subtitle")},{uid("product")}); sourceTree = "<group>";')
obj('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("source-build")}); runOnlyForDeploymentPostprocessing = 0;')
obj('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("video-build")},{uid("subtitle-build")}); runOnlyForDeploymentPostprocessing = 0;')
settings = {'SDKROOT': 'iphoneos', 'SUPPORTED_PLATFORMS': 'iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET': '16.0',
    'SWIFT_VERSION': '5.0', 'CLANG_ENABLE_MODULES': 'YES', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone',
    'DEBUG_INFORMATION_FORMAT': 'dwarf', 'CODE_SIGNING_ALLOWED': 'NO', 'CODE_SIGNING_REQUIRED': 'NO',
    'GENERATE_INFOPLIST_FILE': 'YES', 'PRODUCT_NAME': 'NativePlaybackTests',
    'PRODUCT_BUNDLE_IDENTIFIER': 'com.tooplay.native-playback-tests', 'TARGETED_DEVICE_FAMILY': '1,2',
    'CONFIGURATION_BUILD_DIR': str(host_products),
    'TEST_HOST': str(test_host), 'BUNDLE_LOADER': '$(TEST_HOST)', 'SWIFT_INCLUDE_PATHS': str(products),
    'FRAMEWORK_SEARCH_PATHS': '$(inherited) ' + quote(products),
    'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path @executable_path/Frameworks @loader_path/Frameworks',
    'ENABLE_USER_SCRIPT_SANDBOXING': 'YES'}
if (test_host.parent / 'Tooplay.debug.dylib').is_file():
    settings['OTHER_LDFLAGS'] = '$(inherited) ' + quote(test_host.parent / 'Tooplay.debug.dylib')
obj('config', 'isa = XCBuildConfiguration; buildSettings = { ' + ' '.join(k + ' = ' + quote(v) + ';' for k, v in settings.items()) + ' }; name = Debug;')
obj('configs', f'isa = XCConfigurationList; buildConfigurations = ({uid("config")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug;')
obj('target', f'isa = PBXNativeTarget; buildConfigurationList = {uid("configs")}; buildPhases = ({uid("sources")},{uid("frameworks")},{uid("resources")}); buildRules = (); dependencies = (); name = NativePlaybackTests; productName = NativePlaybackTests; productReference = {uid("product")}; productType = "com.apple.product-type.bundle.unit-test";')
host_settings = {'SDKROOT': 'iphoneos', 'SUPPORTED_PLATFORMS': 'iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET': '16.0',
    'PRODUCT_NAME': 'Tooplay', 'PRODUCT_BUNDLE_IDENTIFIER': host_info['CFBundleIdentifier'], 'TARGETED_DEVICE_FAMILY': '1,2',
    'CONFIGURATION_BUILD_DIR': str(host_products), 'INFOPLIST_FILE': str(host.parent / 'Info.plist'),
    'GENERATE_INFOPLIST_FILE': 'NO', 'CODE_SIGNING_ALLOWED': 'NO', 'CODE_SIGNING_REQUIRED': 'NO', 'ENABLE_DEBUG_DYLIB': 'NO'}
obj('host-config', 'isa = XCBuildConfiguration; buildSettings = { ' + ' '.join(k + ' = ' + quote(v) + ';' for k, v in host_settings.items()) + ' }; name = Debug;')
obj('host-configs', f'isa = XCConfigurationList; buildConfigurations = ({uid("host-config")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug;')
obj('host-target', f'isa = PBXNativeTarget; buildConfigurationList = {uid("host-configs")}; buildPhases = (); buildRules = (); dependencies = (); name = Tooplay; productName = Tooplay; productReference = {uid("host-product")}; productType = "com.apple.product-type.application";')
obj('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; TargetAttributes = {{ {uid("target")} = {{ TestTargetID = {uid("host-target")}; }}; }}; }}; buildConfigurationList = {uid("configs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base); mainGroup = {uid("main-group")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("host-target")},{uid("target")});')
project = root / 'NativePlaybackTests.xcodeproj'
project.mkdir(exist_ok=True)
(project / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(objects) + '\n}; rootObject = ' + uid('project') + '; }\n')
schemes = project / 'xcshareddata/xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("target")}" BuildableName="NativePlaybackTests.xctest" BlueprintName="NativePlaybackTests" ReferencedContainer="container:NativePlaybackTests.xcodeproj"/>'
(schemes / 'NativePlaybackTests.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
<BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="NO"><Testables><TestableReference skipped="NO">{ref}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug"/><ProfileAction buildConfiguration="Debug"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Debug"/>
</Scheme>\n''')
print(project)
