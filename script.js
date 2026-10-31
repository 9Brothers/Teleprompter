'use strict';
(() => {
const $ = id => document.getElementById(id);
const key = 'olhar.teleprompter.v1';
const sample = 'Sua próxima boa história\ncomeça com um olhar.\n\nRespire fundo. Encontre seu ritmo.\nVocê não precisa decorar cada palavra —\nsó precisa estar presente.\n\nCole seu roteiro no painel ao lado,\najuste a velocidade e fale com naturalidade.\n\nOlhe para a câmera.\nConverse com quem está do outro lado.';
const defaults = {speed:38,fontSize:38,lineHeight:1.6,textWidth:88,preset:'top',readerX:50,readerY:4,readerWidth:74,focusEnabled:true,focusHeight:150,focusWidth:100,focusX:50,focusY:25,textColor:'#f4f3ef',background:'#171a20',contrast:false,mirrorText:false,mirrorCamera:true,cameraX:94,cameraY:88,cameraWidth:280,countdown:'3',autoScroll:true,readerOpacity:100,cameraOpacity:100,cropEnabled:false,cropWidth:720,cropHeight:1280,cropX:50,cropY:50,cameraZoom:1,recordingFormat:'auto',readingDirection:'vertical',horizontalWindow:35,captureResolution:'1080',cameraFps:'30',recordingBitrate:12,gazeX:50};
let prefs={...defaults}, text=sample, offset=0, running=false, lastTime=null, streamVideo=null, streamAudio=null, recorder=null, chunks=[], resultURL=null, recordingStart=0, timer=null, countdownTimer=null, pending=false, busy=false, storageTimer, croppedStream=null, recordingCrop=null, photoURL=null, photoTimer=null, photoEncoding=false;
try {const saved=JSON.parse(localStorage.getItem(key)); if(saved){text=typeof saved.text==='string'?saved.text:sample; for(const name of Object.keys(defaults)){if(typeof saved.prefs?.[name]===typeof defaults[name]) prefs[name]=saved.prefs[name];}}} catch {notify('Os dados salvos estão indisponíveis. Você pode continuar usando o aplicativo.');}
for(const name of ['cropWidth','cropHeight']){const n=prefs[name];prefs[name]=Number.isFinite(n)?Math.max(64,Math.min(3840,Math.round(n/2)*2)):defaults[name];}
function notify(message){$('message').textContent=message;}
function save(){clearTimeout(storageTimer);storageTimer=setTimeout(()=>{try{localStorage.setItem(key,JSON.stringify({text:$('editor').value,prefs}));}catch{notify('Não foi possível salvar: armazenamento indisponível ou cheio.');}},250);}
const profilesKey = 'olhar.teleprompter.profiles.v1';
let profileData={selectedId:'',items:[]};
try {
 const data=JSON.parse(localStorage.getItem(profilesKey));
 if(data&&Array.isArray(data.items)){
  profileData.items=data.items.filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&p.snapshot&&typeof p.snapshot.text==='string');
  profileData.selectedId=profileData.items.some(p=>p.id===data.selectedId)?data.selectedId:'';
 }
} catch {notify('Não foi possível ler os perfis salvos.');}
function selectedProfile(){return profileData.items.find(p=>p.id===$('profileSelect').value);}
function writeProfiles(next){
 try{localStorage.setItem(profilesKey,JSON.stringify(next));profileData=next;return true;}
 catch{notify('Não foi possível salvar os perfis. O armazenamento pode estar cheio ou indisponível.');return false;}
}
function renderProfiles(){
 $('profileSelect').replaceChildren(new Option('Selecione um perfil',''));
 for(const p of profileData.items)$('profileSelect').add(new Option(p.name,p.id));
 $('profileSelect').value=profileData.selectedId;
 $('profileName').value=selectedProfile()?.name||'';
 const selected=!!selectedProfile();
 for(const id of ['saveProfile','loadProfile','deleteProfile','exportProfile'])$(id).disabled=!selected;
}
function snapshot(){
 const stage=$('stage');
 return {text:$('editor').value,prefs:{...prefs,readerWidth:Math.max(25,Math.min(100,$('reader').offsetWidth/stage.clientWidth*100)),cameraWidth:Math.max(160,Math.min(600,$('cameraBox').offsetWidth))},readerHeight:$('reader').offsetHeight,cameraHeight:$('cameraBox').offsetHeight,cameraDevice:$('cameraSelect').value,micDevice:$('micSelect').value};
}
function profileName(){const name=$('profileName').value.trim();if(!name){notify('Digite um nome para o perfil.');$('profileName').focus();return null;}return name;}
function profileLocked(){if(busy||pending||recorder?.state==='recording'){notify('Encerre a gravação ou cancele a contagem antes de carregar um perfil.');return true;}return false;}
$('profileSelect').onchange=()=>{profileData.selectedId=$('profileSelect').value;writeProfiles({...profileData});renderProfiles();};
$('createProfile').onclick=()=>{
 const name=profileName();if(!name)return;
 const id=crypto.randomUUID();
 const next={selectedId:id,items:[...profileData.items,{id,name,snapshot:snapshot()}]};
 if(writeProfiles(next)){renderProfiles();notify(`Perfil “${name}” criado com as configurações atuais.`);}
};
$('saveProfile').onclick=()=>{
 const current=selectedProfile(),name=profileName();if(!current||!name)return;
 const next={...profileData,items:profileData.items.map(p=>p.id===current.id?{...p,name,snapshot:snapshot()}:p)};
 if(writeProfiles(next)){renderProfiles();notify(`Perfil “${name}” atualizado.`);}
};
$('loadProfile').onclick=()=>{
 if(profileLocked())return;
 const profile=selectedProfile();if(!profile)return;
 const saved=profile.snapshot;
 // Loading a profile never requests device permissions or starts recording.
 for(const stream of [streamVideo,streamAudio])stream?.getTracks().forEach(t=>t.stop());
 streamVideo=null;streamAudio=null;$('webcam').srcObject=null;mediaUI();
 prefs={...defaults};
 for(const name of Object.keys(defaults)){
  const el=$(name),value=saved.prefs?.[name];
  if(typeof value===typeof defaults[name]&&(typeof value!=='number'||Number.isFinite(value)))prefs[name]=value;
  if(el.type==='checkbox')el.checked=prefs[name];else el.value=prefs[name];
  if(el.type==='number'&&!el.validity.valid)el.value=defaults[name];
  prefs[name]=el.type==='checkbox'?el.checked:typeof defaults[name]==='number'?Number(el.value):el.value;
 }
 for(const [id,value] of [['cameraSelect',saved.cameraDevice],['micSelect',saved.micDevice]]){
  const el=$(id);el.value=[...el.options].some(o=>o.value===value)?value:'';
 }
 $('editor').value=saved.text;renderText();updateOutputs();layout();
 for(const [id,height] of [['reader',saved.readerHeight],['cameraBox',saved.cameraHeight]]){
  if(Number.isFinite(height))$(id).style.height=`${Math.max(140,Math.min(window.innerHeight,height))}px`;
 }
 position($('reader'),prefs.readerX,prefs.readerY);position($('cameraBox'),prefs.cameraX,prefs.cameraY);paint();save();
 notify(`Perfil “${profile.name}” carregado. Ative a câmera e o microfone quando desejar.`);
};
$('deleteProfile').onclick=()=>{
 const profile=selectedProfile();if(!profile||!confirm(`Excluir o perfil “${profile.name}”? As configurações atuais serão mantidas.`))return;
 if(writeProfiles({selectedId:'',items:profileData.items.filter(p=>p.id!==profile.id)})){renderProfiles();notify('Perfil excluído.');}
};
function portableProfile(profile){
 const {cameraDevice,micDevice,...settings}=profile.snapshot;
 return {format:'olhar-teleprompter-profile',version:1,profile:{name:profile.name,snapshot:settings}};
}
function validateProfileFile(data){
 if(data?.format!=='olhar-teleprompter-profile'||data.version!==1)throw new Error('Formato ou versão de perfil não reconhecido.');
 const profile=data.profile,settings=profile?.snapshot;
 if(typeof profile?.name!=='string'||!profile.name.trim()||profile.name.length>80||typeof settings?.text!=='string'||!settings.prefs||typeof settings.prefs!=='object'||Array.isArray(settings.prefs))throw new Error('O arquivo não contém um perfil válido.');
 const clean={text:settings.text,prefs:{...defaults},cameraDevice:'',micDevice:''};
 for(const name of Object.keys(defaults)){
  if(!Object.hasOwn(settings.prefs,name))continue;
  let value=settings.prefs[name];const el=$(name);
  if(typeof value!==typeof defaults[name])throw new Error(`Valor inválido para ${name}.`);
  if(typeof value==='number'){
   if(!Number.isFinite(value))throw new Error(`Número inválido para ${name}.`);
   if(el.min!=='')value=Math.max(Number(el.min),value);
   if(el.max!=='')value=Math.min(Number(el.max),value);
   if(el.type==='number')value=Math.round(value/2)*2;
  }
  if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value))throw new Error(`Opção inválida para ${name}.`);
  if(el.type==='color'&&!/^#[0-9a-f]{6}$/i.test(value))throw new Error(`Cor inválida para ${name}.`);
  clean.prefs[name]=value;
 }
 for(const name of ['readerHeight','cameraHeight']){
  if(settings[name]!==undefined){if(!Number.isFinite(settings[name])||settings[name]<=0)throw new Error('Tamanho de área inválido.');clean[name]=Math.min(10000,settings[name]);}
 }
 return {name:profile.name.trim(),snapshot:clean};
}
function uniqueImportedName(name){
 if(!profileData.items.some(p=>p.name===name))return name;
 let count=1,candidate;
 do{const suffix=` (importado ${count++})`;candidate=name.slice(0,80-suffix.length)+suffix;}while(profileData.items.some(p=>p.name===candidate));
 return candidate;
}
$('exportProfile').onclick=()=>{
 const profile=selectedProfile();if(!profile)return;
 const blob=new Blob([JSON.stringify(portableProfile(profile),null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=`olhar-perfil-${profile.name.replace(/[^a-z0-9_-]/gi,'-')||'exportado'}.json`;
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 notify(`Perfil “${profile.name}” exportado. O arquivo inclui o roteiro salvo.`);
};
$('importProfile').onclick=()=>$('profileFile').click();
$('profileFile').addEventListener('change',async()=>{
 const input=$('profileFile'),file=input.files?.[0];if(!file)return;
 try{
  if(file.size>5*1024*1024)throw new Error('O arquivo deve ter no máximo 5 MB.');
  const profile=validateProfileFile(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
  profile.id=crypto.randomUUID();profile.name=uniqueImportedName(profile.name);
  if(writeProfiles({selectedId:profile.id,items:[...profileData.items,profile]})){
   renderProfiles();notify(`Perfil “${profile.name}” importado. Clique em Carregar perfil para aplicá-lo.`);
  }
 }catch(error){notify(`Não foi possível importar o perfil. ${error instanceof SyntaxError?'O arquivo JSON está inválido.':error.message}`);}
 finally{input.value='';}
});
renderProfiles();
function position(box,x,y){box.style.left=`${Math.max(0,(window.innerWidth-box.offsetWidth)*Number(x)/100)}px`;box.style.top=`${Math.max(0,(window.innerHeight-box.offsetHeight)*Number(y)/100)}px`;}
function layout(){
 const reader=$('reader'), stage=$('stage');
 reader.classList.toggle('horizontal-reading',prefs.readingDirection==='horizontal');
 $('horizontalWindowControl').hidden=prefs.readingDirection!=='horizontal';
 $('gazePositionControl').hidden=prefs.readingDirection!=='horizontal';
 $('gazeMarker').hidden=prefs.readingDirection!=='horizontal';
 reader.style.opacity=prefs.readerOpacity/100;
 $('cameraBox').style.opacity=prefs.cameraOpacity/100;
 reader.style.width=`${stage.clientWidth*prefs.readerWidth/100}px`;
 reader.style.maxHeight=`${window.innerHeight}px`;
 reader.style.background=prefs.contrast?'#000000':prefs.background;
 reader.style.color=prefs.contrast?'#ffffff':prefs.textColor;
 position(reader,prefs.readerX,prefs.readerY);
 $('cameraBox').style.width=`${Math.min(prefs.cameraWidth,stage.clientWidth)}px`;
 position($('cameraBox'),prefs.cameraX,prefs.cameraY);
 $('webcam').style.transform=prefs.mirrorCamera?'scaleX(-1)':'none';
 $('cameraCrop').style.transform=prefs.mirrorCamera?'scaleX(-1)':'none';
 updateCropPreview();
 updateFormatSupport();
 updateQualityInfo();
 for(const el of [$('scriptDim'),$('scriptFocus')]){el.style.fontSize=`${prefs.fontSize}px`;el.style.lineHeight=prefs.lineHeight;el.style.paddingLeft=el.style.paddingRight=`${(100-prefs.textWidth)/2}%`;}
 $('scriptDim').style.opacity=prefs.focusEnabled?'.22':'1';
 $('focusBand').hidden=!prefs.focusEnabled;
 paint();
}
// Only camera pixels are drawn here. CSS mirroring and opacity never enter the recording.
function cropSupported(){return typeof $('cameraCrop').captureStream==='function';}
function cameraEffectsEnabled(){return prefs.cropEnabled||prefs.cameraZoom>1;}
function cropSettings(){
 const video=$('webcam');
 return {width:prefs.cropEnabled?prefs.cropWidth:video.videoWidth,height:prefs.cropEnabled?prefs.cropHeight:video.videoHeight,x:prefs.cropX,y:prefs.cropY,zoom:prefs.cameraZoom};
}
function updateCropPreview(){const enabled=!!(recordingCrop||cameraEffectsEnabled());$('webcam').hidden=enabled;$('cameraCrop').hidden=!enabled;$('cropSupport').textContent=cropSupported()?'':'Gravação com zoom ou recorte indisponível neste navegador. Para gravar a câmera original, desative o recorte e ajuste o zoom para 1×.';}
function drawCrop(){
 const crop=recordingCrop||(cameraEffectsEnabled()?cropSettings():null);
 if(!crop)return false;
 const video=$('webcam'),canvas=$('cameraCrop');
 if(!streamVideo||video.readyState<2||!video.videoWidth||!video.videoHeight)return false;
 if(canvas.width!==crop.width)canvas.width=crop.width;
 if(canvas.height!==crop.height)canvas.height=crop.height;
 const context=canvas.getContext('2d');if(!context)return false;
 const scale=Math.max(crop.width/video.videoWidth,crop.height/video.videoHeight);
 const width=crop.width/(scale*crop.zoom),height=crop.height/(scale*crop.zoom);
 const x=(video.videoWidth-width)*crop.x/100,y=(video.videoHeight-height)*crop.y/100;
 context.drawImage(video,x,y,width,height,0,0,crop.width,crop.height);
 return true;
}
function releaseCropStream(){croppedStream?.getTracks().forEach(track=>track.stop());croppedStream=null;recordingCrop=null;}
function gazeAnchor(){const width=$('viewport').clientWidth;return Math.max(6,Math.min(width-6,width*prefs.gazeX/100));}
function focusGeometry(){
 const v=$('viewport'),horizontal=prefs.readingDirection==='horizontal';
 const w=v.clientWidth*(horizontal?prefs.horizontalWindow:prefs.focusWidth)/100;
 const h=Math.min(horizontal?Number(prefs.fontSize)*Number(prefs.lineHeight):Number(prefs.focusHeight),v.clientHeight);
 return {w,h,x:horizontal?Math.max(0,Math.min(v.clientWidth-w,gazeAnchor()-w/2)):(v.clientWidth-w)*prefs.focusX/100,y:(v.clientHeight-h)*prefs.focusY/100};
}
function paint(){
 updateScrollDuration();
 const v=$('viewport'),f=focusGeometry(),band=$('focusBand');
 Object.assign(band.style,{left:`${f.x}px`,top:`${f.y}px`,width:`${f.w}px`,height:`${f.h}px`});
 const mirror=prefs.mirrorText?' scaleX(-1)':'';
 if(prefs.readingDirection==='horizontal'){
  const x=gazeAnchor()+(prefs.mirrorText?$('scriptDim').scrollWidth:0)-offset;
  $('scriptDim').style.transform=`translate(${x}px,${f.y}px)${mirror}`;
  Object.assign($('scriptFocus').style,{width:'max-content',left:`${-f.x}px`,transform:`translate(${x}px,0px)${mirror}`});
  Object.assign($('gazeMarker').style,{left:`${gazeAnchor()}px`,top:`${f.y}px`,height:`${f.h}px`});
 }else{
  const start=Math.max(20,f.y+f.h/2-Number(prefs.fontSize)*Number(prefs.lineHeight)/2),y=start-offset;
  $('scriptDim').style.transform=`translateY(${y}px)${mirror}`;
  Object.assign($('scriptFocus').style,{width:`${v.clientWidth}px`,left:`${-f.x}px`,transform:`translateY(${y-f.y}px)${mirror}`});
 }
}
function maximum(){return prefs.readingDirection==='horizontal'?$('scriptDim').scrollWidth:Math.max(0,$('scriptDim').offsetHeight-Number(prefs.fontSize)*Number(prefs.lineHeight));}
function formatDuration(seconds){
 const total=Math.max(0,Math.ceil(seconds));
 const hours=Math.floor(total/3600),minutes=Math.floor(total/60)%60,remainder=total%60;
 const pad=value=>String(value).padStart(2,'0');
 return hours?`${pad(hours)}:${pad(minutes)}:${pad(remainder)}`:`${pad(minutes)}:${pad(remainder)}`;
}
function updateScrollDuration(){
 const seconds=$('editor').value.trim()?maximum()/Number(prefs.speed):0;
 const label=formatDuration(seconds);
 if($('scrollDuration').textContent!==label)$('scrollDuration').textContent=label;
}
function setRunning(value){running=value;lastTime=null;$('play').textContent=value?'Ⅱ Pausar leitura':offset>0?'▶ Retomar leitura':'▶ Iniciar leitura';$('scrollState').textContent=value?'Leitura em andamento':offset>0?'Leitura pausada':'Pronto para começar';}
function frame(time){drawCrop();if(running){if(lastTime!==null){offset=Math.min(maximum(),offset+(time-lastTime)/1000*Number(prefs.speed));paint();if(offset>=maximum()){setRunning(false);$('scrollState').textContent='Fim do roteiro';}}lastTime=time;}requestAnimationFrame(frame);}
function renderText(){const value=$('editor').value;for(const id of ['scriptDim','scriptFocus'])$(id).textContent=value;$('wordCount').textContent=`${value.trim()?value.trim().split(/\s+/u).length:0} palavras`;offset=0;setRunning(false);paint();}
function updateOutputs(){const units={speed:' px/s',fontSize:' px',lineHeight:'×',textWidth:'%',readerX:'%',readerY:'%',readerWidth:'%',focusHeight:' px',focusWidth:'%',focusX:'%',focusY:'%',readerOpacity:'%',cameraOpacity:'%',cropX:'%',cropY:'%',cameraZoom:'×',horizontalWindow:'%',recordingBitrate:' Mbps',gazeX:'%'};for(const [id,unit] of Object.entries(units))$(id+'Value').textContent=prefs[id]+unit;}
for(const name of Object.keys(defaults)){const el=$(name);if(el.type==='checkbox')el.checked=prefs[name];else el.value=prefs[name];prefs[name]=el.type==='checkbox'?el.checked:typeof defaults[name]==='number'?Number(el.value):el.value;el.addEventListener('input',()=>{if(el.type==='number'&&!el.validity.valid)return;prefs[name]=el.type==='checkbox'?el.checked:typeof defaults[name]==='number'?Number(el.value):el.value;if(name==='readingDirection'){offset=0;setRunning(false);}if(name==='preset'){const positions={top:[50,4],center:[50,42],left:[0,12],right:[100,12]};if(positions[prefs.preset]){[prefs.readerX,prefs.readerY]=positions[prefs.preset];$('readerX').value=prefs.readerX;$('readerY').value=prefs.readerY;}}if(['readerX','readerY'].includes(name)){prefs.preset='manual';$('preset').value='manual';}updateOutputs();layout();save();});}
$('editor').value=text;$('editor').addEventListener('input',()=>{renderText();save();});
$('play').onclick=()=>{if(!running&&offset>=maximum())offset=0;setRunning(!running);};
$('restart').onclick=()=>{offset=0;setRunning(false);paint();};
function paragraphOffsets(){
 const copy=$('scriptDim'),node=copy.firstChild;
 if(!node||!copy.textContent.trim())return [];
 const starts=[];
 // Blank lines separate paragraphs; soft wrapping and single line breaks stay together.
 const pattern=/(?:^|\n[ \t]*\n)([ \t\n]*)(?=\S)/g;
 for(const match of copy.textContent.matchAll(pattern))starts.push(match.index+match[0].length);
 const range=document.createRange();
 const tops=starts.map(start=>{
  range.setStart(node,start);range.setEnd(node,start+1);
  const rect=range.getBoundingClientRect();
  return prefs.readingDirection==='horizontal'?(prefs.mirrorText?-rect.right:rect.left):rect.top;
 });
 return tops.map(top=>Math.max(0,top-tops[0]));
}
let lastParagraphWheel=-Infinity;
function manualScroll(event){
 // Preserve browser zoom gestures (including pinch-to-zoom on trackpads).
 if(event.ctrlKey||event.metaKey||!event.deltaY)return;
 event.preventDefault();
 const now=performance.now(),previous=lastParagraphWheel;
 lastParagraphWheel=now;
 // Treat trackpad inertia and tightly spaced wheel events as one gesture.
 if(now-previous<160)return;
 const paragraphs=paragraphOffsets();
 if(!paragraphs.length)return;
 const target=event.deltaY>0?paragraphs.find(top=>top>offset+1):paragraphs.findLast(top=>top<offset-1);
 if(target!==undefined)offset=Math.min(maximum(),target);
 setRunning(false);
 paint();
}
$('reader').addEventListener('wheel',manualScroll,{passive:false});
let textDrag=null;
const readingViewport=$('viewport');
readingViewport.addEventListener('pointerdown',event=>{
 if(event.button!==0||event.isPrimary===false||event.ctrlKey||event.metaKey||textDrag)return;
 event.preventDefault();
 textDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY};
 readingViewport.setPointerCapture(event.pointerId);
 readingViewport.classList.add('dragging-text');
 setRunning(false);
});
readingViewport.addEventListener('pointermove',event=>{
 if(!textDrag||textDrag.pointerId!==event.pointerId)return;
 // Follow the pointer: dragging upward advances the script.
 offset=Math.max(0,Math.min(maximum(),offset+(prefs.readingDirection==='horizontal'?textDrag.x-event.clientX:textDrag.y-event.clientY)));
 textDrag.y=event.clientY;textDrag.x=event.clientX;
 setRunning(false);
 paint();
});
function finishTextDrag(event){
 if(!textDrag||textDrag.pointerId!==event.pointerId)return;
 textDrag=null;
 readingViewport.classList.remove('dragging-text');
 if(readingViewport.hasPointerCapture(event.pointerId))readingViewport.releasePointerCapture(event.pointerId);
}
for(const type of ['pointerup','pointercancel','lostpointercapture'])readingViewport.addEventListener(type,finishTextDrag);
function readingMode(on){document.body.classList.toggle('reading',on);$('exitReading').hidden=!on;requestAnimationFrame(layout);if(on)$('exitReading').focus();else $('readingMode').focus();}
$('readingMode').onclick=()=>readingMode(true);$('exitReading').onclick=()=>readingMode(false);
$('panelToggle').onclick=()=>{const hidden=document.body.classList.toggle('panel-hidden');$('panelToggle').textContent=hidden?'Mostrar painel':'Ocultar painel';$('panelToggle').setAttribute('aria-expanded',String(!hidden));requestAnimationFrame(layout);};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(pending)cancelCountdown();if(document.body.classList.contains('reading'))readingMode(false);return;}if(e.code==='KeyP'&&!e.target.closest('input,textarea,select,[contenteditable="true"],dialog')&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();$('takePhoto').click();return;}if(e.target.closest('input,textarea,select,button,a,[contenteditable="true"],dialog')||e.ctrlKey||e.altKey||e.metaKey)return;if(e.code==='Space'){e.preventDefault();$('play').click();}if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();$('speed').value=Math.max(Number($('speed').min),Math.min(Number($('speed').max),Number(prefs.speed)+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?50:5)));$('speed').dispatchEvent(new Event('input'));}});
document.addEventListener('visibilitychange',()=>{lastTime=null;});
function draggable(box,handle,xName,yName){let drag=null;handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:box.offsetLeft,top:box.offsetTop};handle.setPointerCapture(e.pointerId);});handle.addEventListener('pointermove',e=>{if(!drag)return;const dx=window.innerWidth-box.offsetWidth,dy=window.innerHeight-box.offsetHeight;prefs[xName]=dx>0?Math.max(0,Math.min(100,(drag.left+e.clientX-drag.x)/dx*100)):0;prefs[yName]=dy>0?Math.max(0,Math.min(100,(drag.top+e.clientY-drag.y)/dy*100)):0;$(xName).value=prefs[xName];$(yName).value=prefs[yName];if(xName==='readerX'){prefs.preset='manual';$('preset').value='manual';}position(box,prefs[xName],prefs[yName]);updateOutputs();});const finish=()=>{if(drag){drag=null;save();}};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);}
draggable($('reader'),$('readerHandle'),'readerX','readerY');draggable($('cameraBox'),$('cameraHandle'),'cameraX','cameraY');
new ResizeObserver(updateScrollDuration).observe($('scriptDim'));
new ResizeObserver(()=>{position($('reader'),prefs.readerX,prefs.readerY);paint();}).observe($('reader'));
new ResizeObserver(()=>position($('cameraBox'),prefs.cameraX,prefs.cameraY)).observe($('cameraBox'));
for(const id of ['reader','cameraBox'])$(id).addEventListener('pointerdown',()=>{
 for(const other of ['reader','cameraBox'])$(other).classList.toggle('floating-front',other===id);
});
window.addEventListener('resize',layout);
function mediaError(error){const messages={NotAllowedError:'Acesso negado. Autorize a câmera ou o microfone nas configurações do navegador.',NotFoundError:'Nenhum dispositivo compatível foi encontrado. Conecte uma câmera ou microfone.',NotReadableError:'Não foi possível abrir o dispositivo. Verifique se outro aplicativo está usando a câmera ou microfone.',OverconstrainedError:'O dispositivo selecionado não está disponível. Escolha outro dispositivo.',SecurityError:'O navegador bloqueou o acesso. Abra em localhost ou HTTPS.'};notify(messages[error.name]||`Não foi possível acessar o dispositivo: ${error.message||error.name}`);}
function available(){if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){notify('A câmera exige localhost ou HTTPS e um navegador com suporte a getUserMedia.');return false;}return true;}
async function devices(){if(!navigator.mediaDevices?.enumerateDevices)return;try{const list=await navigator.mediaDevices.enumerateDevices();for(const [kind,id] of [['videoinput','cameraSelect'],['audioinput','micSelect']]){const select=$(id),old=select.value;select.replaceChildren(new Option('Padrão do sistema',''));let n=0;for(const d of list.filter(d=>d.kind===kind))select.add(new Option(d.label||`${kind==='videoinput'?'Câmera':'Microfone'} ${++n}`,d.deviceId));select.value=[...select.options].some(o=>o.value===old)?old:'';}}catch{notify('Não foi possível listar os dispositivos. Você ainda pode tentar o dispositivo padrão.');}}
function cameraConstraints(){
 const height=Number(prefs.captureResolution);
 return {width:{ideal:Math.round(height*16/9)},height:{ideal:height},frameRate:{ideal:Number(prefs.cameraFps)}};
}
function updateQualityInfo(){
 const track=streamVideo?.getVideoTracks()[0],settings=track?.getSettings();
 $('applyCameraQuality').disabled=!track||busy||pending||recorder?.state==='recording';
 if(!settings){$('qualityInfo').textContent='Ative a câmera para verificar a resolução efetivamente recebida.';return;}
 const resolution=settings.width&&settings.height?`${settings.width} × ${settings.height}`:'resolução não informada';
 const fps=settings.frameRate?` · ${settings.frameRate.toFixed(1)} FPS`:'';
 const crop=prefs.cropEnabled?` · Saída recortada: ${prefs.cropWidth} × ${prefs.cropHeight}`:'';
 const zoom=prefs.cameraZoom>1?` · Zoom digital: ${prefs.cameraZoom}×`:'';
 $('qualityInfo').textContent=`Recebido da câmera: ${resolution}${fps}${crop}${zoom}.`;
}
$('applyCameraQuality').onclick=async()=>{
 if(busy||pending||recorder?.state==='recording')return;
 const track=streamVideo?.getVideoTracks()[0];if(!track)return;
 busy=true;lockMedia(true);
 try{await track.applyConstraints(cameraConstraints());notify('Qualidade solicitada aplicada. Confira abaixo a resolução e o FPS efetivamente recebidos.');}
 catch(error){mediaError(error);}
 finally{busy=false;lockMedia(false);updateQualityInfo();}
};
function mediaUI(){const camera=!!streamVideo,mic=!!streamAudio;$('takePhoto').disabled=photoEncoding||(!camera&&!photoTimer);$('cameraEmpty').hidden=camera;$('cameraToggle').textContent=camera?'Desativar câmera':'Ativar câmera';$('micToggle').textContent=mic?'Desativar microfone':'Ativar microfone';$('liveLabel').textContent=camera?'AO VIVO':'DESLIGADA';updateQualityInfo();}
async function acquire(kind){const video=kind==='video',id=$(video?'cameraSelect':'micSelect').value;const stream=await navigator.mediaDevices.getUserMedia(video?{video:{...cameraConstraints(),...(id?{deviceId:{exact:id}}:{})},audio:false}:{video:false,audio:id?{deviceId:{exact:id}}:true});for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(recorder?.state==='recording')stopRecording();if(pending)cancelCountdown();if(video&&streamVideo===stream){streamVideo=null;$('webcam').srcObject=null;}if(!video&&streamAudio===stream)streamAudio=null;mediaUI();notify('Um dispositivo foi desconectado ou interrompido.');});return stream;}
async function toggleMedia(kind){if(busy||pending||recorder?.state==='recording')return;if(!available())return;busy=true;lockMedia(true);try{const current=kind==='video'?streamVideo:streamAudio;if(current){current.getTracks().forEach(t=>t.stop());if(kind==='video'){streamVideo=null;$('webcam').srcObject=null;}else streamAudio=null;}else{const stream=await acquire(kind);if(kind==='video'){streamVideo=stream;$('webcam').srcObject=stream;}else streamAudio=stream;}await devices();}catch(e){mediaError(e);}finally{busy=false;lockMedia(false);mediaUI();}}
function lockMedia(lock){$('cropControls').disabled=lock;$('qualityControls').disabled=lock;$('recordingFormat').disabled=lock;for(const id of ['cameraToggle','cameraQuick','micToggle','cameraSelect','micSelect'])$(id).disabled=lock;$('record').disabled=busy;updateQualityInfo();}
$('cameraToggle').onclick=$('cameraQuick').onclick=()=>toggleMedia('video');$('micToggle').onclick=()=>toggleMedia('audio');
for(const [id,kind] of [['cameraSelect','video'],['micSelect','audio']])$(id).onchange=async()=>{if(busy||pending||recorder?.state==='recording')return;const old=kind==='video'?streamVideo:streamAudio;if(!old)return;busy=true;lockMedia(true);try{const stream=await acquire(kind);old.getTracks().forEach(t=>t.stop());if(kind==='video'){streamVideo=stream;$('webcam').srcObject=stream;}else streamAudio=stream;}catch(e){$(id).value=old.getTracks()[0]?.getSettings().deviceId||'';mediaError(e);}finally{busy=false;lockMedia(false);mediaUI();}};
navigator.mediaDevices?.addEventListener('devicechange',devices);
function formatType(format){
 if(!window.MediaRecorder)return '';
 const types={mp4:['video/mp4','video/mp4;codecs=avc1,mp4a.40.2'],webm:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']};
 return (types[format]||[]).find(type=>MediaRecorder.isTypeSupported(type))||'';
}
function supportedType(){
 if(prefs.recordingFormat==='auto')return formatType('mp4')||formatType('webm');
 const type=formatType(prefs.recordingFormat);
 if(!type)throw new Error(`Gravação em ${prefs.recordingFormat.toUpperCase()} indisponível neste navegador. Selecione Automático ou outro formato suportado.`);
 return type;
}
function updateFormatSupport(){
 const mp4=!!formatType('mp4'),webm=!!formatType('webm');
 for(const option of $('recordingFormat').options){if(option.value==='mp4')option.disabled=!mp4;if(option.value==='webm')option.disabled=!webm;}
 $('formatSupport').textContent=mp4?'MP4 disponível. Escolha o formato antes de iniciar a gravação; o download usará esse formato.':'MP4 indisponível neste navegador. Use WebM ou abra em um navegador com suporte à gravação MP4. Arquivos já gravados não são convertidos aqui.';
}
function cancelCountdown(){clearInterval(countdownTimer);countdownTimer=null;pending=false;$('countdownOverlay').hidden=true;$('record').textContent='● Iniciar gravação';lockMedia(false);}
function startRecording(){pending=false;$('countdownOverlay').hidden=true;try{const mime=supportedType();recordingCrop=cameraEffectsEnabled()?cropSettings():null;
let videoTracks=streamVideo.getVideoTracks();
if(recordingCrop){if(!cropSupported())throw new Error('Este navegador não suporta gravação com zoom ou recorte. Desative o recorte e ajuste o zoom para 1× para gravar a câmera original.');if(!drawCrop())throw new Error('Aguarde a imagem da câmera aparecer antes de gravar.');croppedStream=$('cameraCrop').captureStream(Number(prefs.cameraFps));videoTracks=croppedStream.getVideoTracks();}
const combined=new MediaStream([...videoTracks,...streamAudio.getAudioTracks()]);if(combined.getTracks().some(t=>t.readyState!=='live'))throw new Error('Câmera ou microfone desconectado. Ative os dispositivos novamente.');recorder=new MediaRecorder(combined,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:prefs.recordingBitrate*1000000,audioBitsPerSecond:192000});chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=()=>{notify('A gravação foi interrompida pelo navegador. Confira o arquivo recuperado.');if(recorder.state!=='inactive')stopRecording();};recorder.onstop=finishRecording;recorder.start(1000);recordingStart=performance.now();document.body.classList.add('recording');$('record').textContent='■ Encerrar gravação';$('recordStatus').setAttribute('aria-label','Gravação em andamento');timer=setInterval(()=>{const total=Math.floor((performance.now()-recordingStart)/1000);$('elapsed').textContent=`${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;$('readingElapsed').textContent=$('elapsed').textContent;},250);lockMedia(true);if(prefs.autoScroll){if(offset>=maximum())offset=0;setRunning(true);}notify('Gravando câmera e microfone. Pausar a leitura mantém a gravação ativa.');}catch(e){releaseCropStream();lockMedia(false);$('record').textContent='● Iniciar gravação';notify(`Não foi possível iniciar a gravação. ${e.message}`);}}
function stopRecording(){if(recorder?.state==='recording'){recorder.stop();$('record').disabled=true;setRunning(false);}}
function finishRecording(){releaseCropStream();clearInterval(timer);document.body.classList.remove('recording');$('recordStatus').setAttribute('aria-label','Gravação encerrada');$('record').textContent='● Iniciar gravação';lockMedia(false);const type=recorder.mimeType||chunks[0]?.type||'video/webm';const blob=new Blob(chunks,{type});chunks=[];if(!blob.size){notify('O navegador não produziu dados de vídeo. Tente novamente.');return;}if(resultURL){$('playback').removeAttribute('src');$('playback').load();URL.revokeObjectURL(resultURL);}resultURL=URL.createObjectURL(blob);$('playback').src=resultURL;$('download').href=resultURL;const extension=type.includes('mp4')?'mp4':type.includes('ogg')?'ogv':'webm';$('download').textContent=`↓ Baixar ${extension.toUpperCase()}`;$('download').download=`olhar-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;$('resultInfo').textContent=`${$('elapsed').textContent} · ${(blob.size/1024/1024).toFixed(1)} MB · ${type.split(';')[0]} · Vídeo: ${(recorder.videoBitsPerSecond/1000000).toFixed(1)} Mbps (configurado) · Salve o arquivo antes de fechar esta página.`;$('result').showModal();notify('Gravação finalizada. Assista e baixe o resultado.');}
$('readingRecording').onclick=stopRecording;
$('record').onclick=async()=>{if(pending){cancelCountdown();return;}if(recorder?.state==='recording'){stopRecording();return;}if(!window.MediaRecorder){notify('Este navegador não suporta MediaRecorder. Use uma versão atual do Chrome, Edge, Firefox ou Safari.');return;}if(!available()||busy)return;try{supportedType();}catch(e){notify(e.message);return;}busy=true;lockMedia(true);try{if(!streamVideo){streamVideo=await acquire('video');$('webcam').srcObject=streamVideo;}if(!streamAudio)streamAudio=await acquire('audio');mediaUI();await devices();busy=false;const seconds=Number(prefs.countdown);$('elapsed').textContent='00:00';if(seconds){if(prefs.autoScroll)setRunning(false);pending=true;let remaining=seconds;$('countdownOverlay').hidden=false;$('countdownOverlay').textContent=remaining;$('record').disabled=false;$('record').textContent='✕ Cancelar contagem';countdownTimer=setInterval(()=>{remaining--;if(remaining<=0){clearInterval(countdownTimer);startRecording();}else $('countdownOverlay').textContent=remaining;},1000);}else startRecording();}catch(e){busy=false;lockMedia(false);mediaUI();mediaError(e);}};
function cancelPhoto(){
 clearInterval(photoTimer);photoTimer=null;
 $('takePhoto').textContent='▣ Foto · 3 s';mediaUI();
}
async function capturePhoto(){
 photoEncoding=true;cancelPhoto();
 try{
  const video=$('webcam');
  if(!streamVideo||streamVideo.getVideoTracks()[0]?.readyState!=='live'||video.readyState<2||!video.videoWidth)throw new Error('Ative a câmera e aguarde a imagem aparecer.');
  let source=video,width=video.videoWidth,height=video.videoHeight;
  if(recordingCrop||cameraEffectsEnabled()){
   if(!drawCrop())throw new Error('Não foi possível capturar o enquadramento atual.');
   source=$('cameraCrop');width=source.width;height=source.height;
  }
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw new Error('Captura de foto indisponível neste navegador.');
  context.drawImage(source,0,0,width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Não foi possível gerar a foto.');
  const previous=photoURL;photoURL=URL.createObjectURL(blob);
  $('photoThumbnail').src=$('photoFull').src=photoURL;
  $('downloadPhoto').href=photoURL;
  $('downloadPhoto').download=`olhar-foto-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
  $('photoResult').hidden=false;
  if(previous)URL.revokeObjectURL(previous);
  notify('Foto pronta em Câmera e gravação. Você pode ampliá-la e baixar o PNG. A leitura continua.');
 }catch(error){notify(`Não foi possível tirar a foto. ${error.message}`);}
 finally{photoEncoding=false;mediaUI();}
}
$('takePhoto').onclick=()=>{
 if(photoTimer){cancelPhoto();notify('Foto cancelada.');return;}
 if(photoEncoding)return;
 if(!streamVideo){notify('Ative a câmera antes de tirar uma foto.');return;}
 let remaining=3;
 $('takePhoto').textContent=`Cancelar foto · ${remaining}`;
 notify('Continue lendo normalmente. Foto em 3 segundos.');
 photoTimer=setInterval(()=>{
  remaining--;
  if(remaining<=0){capturePhoto();return;}
  $('takePhoto').textContent=`Cancelar foto · ${remaining}`;
  notify(`Continue lendo. Foto em ${remaining} segundo(s).`);
 },1000);
};
$('viewPhoto').onclick=()=>$('photoDialog').showModal();
$('closePhoto').onclick=()=>$('photoDialog').close();
$('closeResult').onclick=()=>$('result').close();$('result').addEventListener('close',()=>$('playback').pause());
$('clearData').onclick=()=>{if(busy||pending||recorder?.state==='recording'){notify('Encerre a gravação ou cancele a contagem antes de limpar as preferências.');return;}if(!confirm('Apagar o roteiro, todas as preferências e todos os perfis salvos neste navegador?'))return;clearTimeout(storageTimer);try{localStorage.removeItem(key);localStorage.removeItem(profilesKey);}catch{notify('Não foi possível limpar o armazenamento.');return;}profileData={selectedId:'',items:[]};renderProfiles();prefs={...defaults};$('editor').value='';for(const name of Object.keys(defaults)){if($(name).type==='checkbox')$(name).checked=prefs[name];else $(name).value=prefs[name];}renderText();updateOutputs();layout();notify('Roteiro, preferências e perfis apagados.');};
window.addEventListener('pagehide',()=>{clearInterval(countdownTimer);clearInterval(timer);clearInterval(photoTimer);if(photoURL)URL.revokeObjectURL(photoURL);if(recorder?.state==='recording')recorder.stop();releaseCropStream();for(const s of [streamVideo,streamAudio])s?.getTracks().forEach(t=>t.stop());if(resultURL)URL.revokeObjectURL(resultURL);});
updateOutputs();renderText();layout();mediaUI();devices();requestAnimationFrame(frame);
})();
