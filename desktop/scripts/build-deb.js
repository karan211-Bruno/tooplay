const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { copyData } = require('./runtime-files');

function buildDeb(unpacked, output, version) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-deb-'));
  const run = (cmd, args, cwd=stage) => execFileSync(cmd,args,{cwd,stdio:'inherit',timeout:300000});
  try {
    const data = path.join(stage, 'data');
    const control = path.join(stage, 'control');
    fs.mkdirSync(control);
    const appDir=path.join(data,'opt','Tooplay');
    copyData(unpacked,appDir);
    fs.chmodSync(path.join(appDir,'chrome-sandbox'),0o4755);
    fs.mkdirSync(path.join(data,'usr','bin'),{recursive:true});
    fs.symlinkSync('/opt/Tooplay/tooplay',path.join(data,'usr','bin','tooplay'));
    const desktop=path.join(data,'usr','share','applications'); fs.mkdirSync(desktop,{recursive:true});
    fs.writeFileSync(path.join(desktop,'com.tooplay.cross.desktop'), '[Desktop Entry]\nType=Application\nName=Tooplay\nComment=Video player with subtitles and Chromecast\nExec=/opt/Tooplay/tooplay %U\nIcon=tooplay\nTerminal=false\nCategories=AudioVideo;Video;Player;\nMimeType=video/mp4;video/x-matroska;video/quicktime;video/x-msvideo;video/webm;\nStartupWMClass=tooplay\n');
    const icons=path.join(data,'usr','share','icons','hicolor','512x512','apps'); fs.mkdirSync(icons,{recursive:true});
    copyData(path.join(__dirname,'..','assets','icon.png'),path.join(icons,'tooplay.png'));
    fs.writeFileSync(path.join(control,'control'), `Package: tooplay\nVersion: ${version}\nSection: video\nPriority: optional\nArchitecture: amd64\nMaintainer: Tooplay\nDepends: libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libdrm2, libgbm1, libnotify4, libasound2 | libasound2t64, libx11-xcb1, libxkbcommon0, libxcb-dri3-0\nDescription: Tooplay video player\n Local video playback, text subtitles and Chromecast support.\n`);
    const ownership = process.platform === 'linux'
      ? ['--owner=0','--group=0','--numeric-owner','--format=gnu','--no-xattrs','--no-acls']
      : ['--uid','0','--gid','0','--uname','root','--gname','root','--format=gnutar','--no-xattrs','--no-acls','--no-fflags'];
    run('tar',[...ownership,'-czf',path.join(stage,'control.tar.gz'),'-C',control,'.']);
    run('tar',[...ownership,'-cJf',path.join(stage,'data.tar.xz'),'-C',data,'.']);
    fs.writeFileSync(path.join(stage,'debian-binary'),'2.0\n');
    const artifact=path.join(stage,`Tooplay-${version}-amd64.deb`);
    const archive = fs.openSync(artifact, 'w');
    try {
      fs.writeSync(archive, '!<arch>\n');
      for (const name of ['debian-binary', 'control.tar.gz', 'data.tar.xz']) {
        const content = fs.readFileSync(path.join(stage, name));
        const header = (name + '/').padEnd(16) + String(Math.floor(Date.now()/1000)).padEnd(12)
          + '0'.padEnd(6) + '0'.padEnd(6) + '100644'.padEnd(8) + String(content.length).padEnd(10) + '`\n';
        fs.writeSync(archive, header); fs.writeSync(archive, content);
        if (content.length % 2) fs.writeSync(archive, '\n');
      }
    } finally { fs.closeSync(archive); }
    fs.mkdirSync(output,{recursive:true}); copyData(artifact,path.join(output,path.basename(artifact)));
    console.log(`Created: ${path.join(output,path.basename(artifact))}`);
  } finally { fs.rmSync(stage,{recursive:true,force:true}); }
}
module.exports={ buildDeb };
if(require.main===module) buildDeb(path.resolve(process.argv[2]),path.resolve(process.argv[3]),process.argv[4]);
