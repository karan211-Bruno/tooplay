#!/usr/bin/env python3
"""Generate an isolated UI runner; --staged explicitly excludes Files import.

Usage: generate-ui.py OUTPUT_DIR [--staged]
Never modifies the canonical app or FullscreenUITests.swift.
"""
import argparse
import hashlib
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output_dir')
parser.add_argument('--staged', action='store_true', help='Expect an isolated test app to load its video and SRT before this test')
args = parser.parse_args()
source = Path(__file__).resolve().parent
root = Path(args.output_dir).resolve()
root.mkdir(parents=True, exist_ok=True)
test_source = (source / 'FullscreenUITests.swift').read_text()
if args.staged:
    replacements = {
        'func testFullscreenModesRotationAndReturnPreservePausedMovieAndSubtitle()':
            'func testStagedFixtureFullscreenModesRotationAndReturnPreservePausedMovieAndSubtitle()',
        '        tap(app.buttons["영상 열기"])\n        chooseFile(videoName)\n': '',
        '        tap(app.buttons["자막 열기"])\n        chooseFile(subtitleName)\n': '',
        'Imported video should start': 'Staged fixture video should start',
        'FULLSCREEN_UI_EVIDENCE': 'STAGED_FULLSCREEN_UI_EVIDENCE',
        'FULLSCREEN_LAYOUT_EVIDENCE': 'STAGED_FULLSCREEN_LAYOUT_EVIDENCE',
        'FULLSCREEN_SCREENSHOT_EVIDENCE': 'STAGED_FULLSCREEN_SCREENSHOT_EVIDENCE',
        '/// Blackbox checks against the actual installed app and its normal Files picker.':
            '/// STAGED FIXTURE: actual playback/fullscreen UI, with test-only startup import; excludes Files picker.'
    }
    for before, after in replacements.items():
        if test_source.count(before) != 1:
            raise SystemExit(f'Cannot safely generate staged test; expected one occurrence: {before!r}')
        test_source = test_source.replace(before, after, 1)
(root / 'FullscreenUITests.swift').write_text(test_source)

def uid(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def quote(value): return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
objects = []
def obj(name, text): objects.append(f'\t\t{uid(name)} = {{ {text} }};')
obj('source', 'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = FullscreenUITests.swift; sourceTree = "<group>";')
obj('source-build', f'isa = PBXBuildFile; fileRef = {uid("source")};')
obj('product', 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = FullscreenUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
resource = ''
obj('main-group', f'isa = PBXGroup; children = ({uid("source")},{uid("product")}); sourceTree = "<group>";')
obj('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("source-build")}); runOnlyForDeploymentPostprocessing = 0;')
obj('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({resource}); runOnlyForDeploymentPostprocessing = 0;')
settings = {'SDKROOT': 'iphoneos', 'SUPPORTED_PLATFORMS': 'iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET': '16.0', 'SWIFT_VERSION': '5.0', 'CLANG_ENABLE_MODULES': 'YES', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone', 'DEBUG_INFORMATION_FORMAT': 'dwarf', 'CODE_SIGNING_ALLOWED': 'NO', 'CODE_SIGNING_REQUIRED': 'NO', 'GENERATE_INFOPLIST_FILE': 'YES', 'PRODUCT_NAME': 'FullscreenUITests', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.tooplay.fullscreen-ui', 'TARGETED_DEVICE_FAMILY': '1,2', 'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks @loader_path/Frameworks', 'TEST_TARGET_NAME': '', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES'}
obj('config', 'isa = XCBuildConfiguration; buildSettings = { ' + ' '.join(k+' = '+quote(v)+';' for k,v in settings.items()) + ' }; name = Debug;')
obj('configs', f'isa = XCConfigurationList; buildConfigurations = ({uid("config")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug;')
obj('target', f'isa = PBXNativeTarget; buildConfigurationList = {uid("configs")}; buildPhases = ({uid("sources")},{uid("frameworks")},{uid("resources")}); buildRules = (); dependencies = (); name = FullscreenUITests; productName = FullscreenUITests; productReference = {uid("product")}; productType = "com.apple.product-type.bundle.ui-testing";')
obj('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; }}; buildConfigurationList = {uid("configs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base); mainGroup = {uid("main-group")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")});')
project = root / 'FullscreenUITests.xcodeproj'
project.mkdir(exist_ok=True)
(project / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(objects) + '\n}; rootObject = ' + uid('project') + '; }\n')
schemes = project / 'xcshareddata/xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("target")}" BuildableName="FullscreenUITests.xctest" BlueprintName="FullscreenUITests" ReferencedContainer="container:FullscreenUITests.xcodeproj"/>'
(schemes / 'FullscreenUITests.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
<BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="NO"><Testables><TestableReference skipped="NO">{ref}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug"/><ProfileAction buildConfiguration="Debug"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Debug"/>
</Scheme>\n''')
print(project)
