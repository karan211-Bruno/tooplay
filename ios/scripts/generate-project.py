#!/usr/bin/env python3
"""Generate a deterministic Xcode project without third-party generators."""
import hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'

objects = []
def obj(name, text):
    objects.append(f'\t\t{uid(name)} = {{ {text} }};')
    return uid(name)

sources = sorted((ROOT / 'Tooplay').glob('*.swift'))
for file in sources:
    obj('file:' + file.name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {quote(file.name)}; sourceTree = "<group>";')
    obj('build:' + file.name, f'isa = PBXBuildFile; fileRef = {uid("file:" + file.name)};')
obj('assets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\";')
obj('assets-build', f'isa = PBXBuildFile; fileRef = {uid("assets")};')
obj('Info.plist', 'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')
obj('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Tooplay.app; sourceTree = BUILT_PRODUCTS_DIR;')
obj('source-group', 'isa = PBXGroup; children = (' + ','.join(uid('file:' + f.name) for f in sources) + ',' + uid('Info.plist') + ',' + uid('assets') + '); path = Tooplay; sourceTree = "<group>";')
obj('products', f'isa = PBXGroup; children = ({uid("product")}); name = Products; sourceTree = "<group>";')
obj('main-group', f'isa = PBXGroup; children = ({uid("source-group")},{uid("products")}); sourceTree = "<group>";')
obj('cast-package', 'isa = XCRemoteSwiftPackageReference; repositoryURL = "https://github.com/googlecast/google-cast-ios-sdk"; requirement = { kind = exactVersion; version = 4.8.6; };')
obj('cast-product', f'isa = XCSwiftPackageProductDependency; package = {uid("cast-package")}; productName = GoogleCastDynamic;')
obj('cast-framework', f'isa = PBXBuildFile; productRef = {uid("cast-product")};')
obj('sources', 'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (' + ','.join(uid('build:' + f.name) for f in sources) + '); runOnlyForDeploymentPostprocessing = 0;')
obj('frameworks', f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({uid("cast-framework")}); runOnlyForDeploymentPostprocessing = 0;')
obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("assets-build")}); runOnlyForDeploymentPostprocessing = 0;')
for configuration in ('Debug', 'Release'):
    project = {'CLANG_ENABLE_MODULES': 'YES', 'CLANG_ENABLE_OBJC_ARC': 'YES', 'SDKROOT': 'iphoneos', 'IPHONEOS_DEPLOYMENT_TARGET': '16.0', 'SWIFT_VERSION': '5.0', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES', 'DEBUG_INFORMATION_FORMAT': 'dwarf' if configuration == 'Debug' else 'dwarf-with-dsym', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if configuration == 'Debug' else '-O'}
    target = {'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'PRODUCT_NAME': 'Tooplay', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.tooplay.mobile', 'MARKETING_VERSION': '0.3.2', 'CURRENT_PROJECT_VERSION': '3', 'INFOPLIST_FILE': 'Tooplay/Info.plist', 'CODE_SIGN_STYLE': 'Automatic', 'TARGETED_DEVICE_FAMILY': '1,2', 'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST': 'NO', 'SWIFT_EMIT_LOC_STRINGS': 'YES', 'GENERATE_INFOPLIST_FILE': 'NO', 'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks'}
    if configuration == 'Debug': target['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG $(inherited)'
    for scope, settings in [('project', project), ('target', target)]:
        obj(scope + configuration, 'isa = XCBuildConfiguration; buildSettings = { ' + ' '.join(k + ' = ' + quote(v) + ';' for k, v in settings.items()) + ' }; name = ' + configuration + ';')
for scope in ('project', 'target'):
    obj(scope + '-configs', f'isa = XCConfigurationList; buildConfigurations = ({uid(scope + "Debug")},{uid(scope + "Release")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
obj('target', f'isa = PBXNativeTarget; buildConfigurationList = {uid("target-configs")}; buildPhases = ({uid("sources")},{uid("frameworks")},{uid("resources")}); buildRules = (); dependencies = (); name = Tooplay; packageProductDependencies = ({uid("cast-product")}); productName = Tooplay; productReference = {uid("product")}; productType = "com.apple.product-type.application";')
obj('project', f'isa = PBXProject; attributes = {{ BuildIndependentTargetsInParallel = 1; LastUpgradeCheck = 1600; TargetAttributes = {{ {uid("target")} = {{ CreatedOnToolsVersion = 16.0; }}; }}; }}; buildConfigurationList = {uid("project-configs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = ko; hasScannedForEncodings = 0; knownRegions = (ko,en,Base); mainGroup = {uid("main-group")}; packageReferences = ({uid("cast-package")}); productRefGroup = {uid("products")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")});')
project_dir = ROOT / 'Tooplay.xcodeproj'
project_dir.mkdir(exist_ok=True)
(project_dir / 'project.pbxproj').write_text('// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n' + '\n'.join(objects) + '\n\t};\n\trootObject = ' + uid('project') + ';\n}\n')
scheme_dir = project_dir / 'xcshareddata' / 'xcschemes'
scheme_dir.mkdir(parents=True, exist_ok=True)
ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("target")}" BuildableName="Tooplay.app" BlueprintName="Tooplay" ReferencedContainer="container:Tooplay.xcodeproj"/>'
(scheme_dir / 'Tooplay.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print(project_dir)
