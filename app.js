// ═══════════════════════════════════════════════════
//  INDEXEDDB — stores the actual file blobs
//  No size limit beyond available disk space
// ═══════════════════════════════════════════════════
const DB_NAME='collabboard_files';
const DB_VER=1;
const STORE='files';
let db=null;

function openDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded=e=>{e.target.result.createObjectStore(STORE);}
    req.onsuccess=e=>{db=e.target.result;res(db);}
    req.onerror=e=>rej(e);
  });
}
function dbPut(key,blob){
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(blob,key);
    tx.oncomplete=()=>res();tx.onerror=e=>rej(e);
  });
}
function dbGet(key){
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).get(key);
    req.onsuccess=()=>res(req.result);req.onerror=e=>rej(e);
  });
}
function dbDel(key){
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete=()=>res();tx.onerror=e=>rej(e);
  });
}

// ═══════════════════════════════════════════════════
//  APP STATE  (metadata only in localStorage)
// ═══════════════════════════════════════════════════
const COLORS=['#7c4dff','#f44336','#2196f3','#4caf50','#ff9800','#e91e63','#00bcd4','#9c27b0','#ff5722','#607d8b'];

let S={dark:false,boards:[],activeBoardId:null,cardColor:COLORS[0],secColor:COLORS[0],cardType:'note'};
let pendingFile=null;   // {blob, name, size, mimeType, objectUrl}

function loadState(){const r=localStorage.getItem('cb_meta');if(r)try{Object.assign(S,JSON.parse(r));}catch(e){}}
function saveState(){try{localStorage.setItem('cb_meta',JSON.stringify(S));}catch(e){toast('Could not save board data','err');}}

function activeBoard(){return S.boards.find(b=>b.id===S.activeBoardId)||null}
function activeSection(secId){return activeBoard()?.sections.find(s=>s.id===secId)||null}

// ═══════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════
function renderSidebar(filter=''){
  const list=document.getElementById('boardList');
  list.innerHTML='';
  const boards=filter?S.boards.filter(b=>b.name.toLowerCase().includes(filter.toLowerCase())):S.boards;
  if(!boards.length){list.innerHTML='<div style="padding:6px 8px;font-size:12px;color:var(--text3)">No boards yet</div>';return;}
  boards.forEach(b=>{
    const el=document.createElement('div');
    el.className='sb-item'+(b.id===S.activeBoardId?' active':'');
    el.innerHTML=`<div class="sb-board-dot" style="background:${b.color||'var(--primary)'}"></div>
      <span class="sb-item-label">${esc(b.name)}</span>
      <div class="sb-item-actions">
        <button class="sb-mini-btn" title="Rename" onclick="event.stopPropagation();renameBoardPrompt('${b.id}')"><i class="ti ti-pencil"></i></button>
        <button class="sb-mini-btn" title="Delete" onclick="event.stopPropagation();deleteBoard('${b.id}')"><i class="ti ti-trash"></i></button>
      </div>`;
    el.onclick=()=>switchBoard(b.id);
    list.appendChild(el);
  });
}
function sbSearch(v){renderSidebar(v);}

// ═══════════════════════════════════════════════════
//  BOARDS
// ═══════════════════════════════════════════════════
function openNewBoardModal(){
  document.getElementById('newBoardName').value='';
  document.getElementById('newBoardDesc').value='';
  openModal('newBoardModal');
  setTimeout(()=>document.getElementById('newBoardName').focus(),120);
}
function createBoard(){
  const name=document.getElementById('newBoardName').value.trim()||'Untitled Board';
  const desc=document.getElementById('newBoardDesc').value.trim();
  const color=COLORS[S.boards.length%COLORS.length];
  const board={id:'b'+Date.now(),name,desc,color,sections:[],createdAt:new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})};
  S.boards.push(board);
  closeModal('newBoardModal');saveState();switchBoard(board.id);
  toast('"'+name+'" created','ok');
}
function switchBoard(id){
  S.activeBoardId=id;saveState();renderSidebar();renderBoard();
}
function updateBoardTitle(v){
  const b=activeBoard();if(!b)return;
  b.name=v||'Untitled Board';
  document.getElementById('tbBoardName').textContent=b.name;
  renderSidebar();saveState();
}
function focusBoardTitle(){const i=document.getElementById('boardTitleInput');i.focus();i.select();}
function renameBoardPrompt(id){
  const b=S.boards.find(x=>x.id===id);if(!b)return;
  const n=prompt('Rename board:',b.name);
  if(n&&n.trim()){b.name=n.trim();saveState();renderSidebar();if(b.id===S.activeBoardId)renderBoard();}
}
function deleteBoard(id){
  if(!confirm('Delete this board and all its content?'))return;
  // clean up file blobs from IndexedDB
  const b=S.boards.find(x=>x.id===id);
  if(b)b.sections.forEach(s=>s.cards.forEach(c=>{if(c.fileKey)dbDel(c.fileKey);}));
  S.boards=S.boards.filter(b=>b.id!==id);
  if(S.activeBoardId===id)S.activeBoardId=S.boards[0]?.id||null;
  saveState();renderSidebar();renderBoard();toast('Board deleted');
}

// ═══════════════════════════════════════════════════
//  BOARD RENDER
// ═══════════════════════════════════════════════════
function renderBoard(){
  const b=activeBoard();
  const empty=document.getElementById('emptyState');
  const view=document.getElementById('boardView');
  if(!b){empty.style.display='flex';view.style.display='none';document.getElementById('tbBoardName').textContent='—';return;}
  empty.style.display='none';view.style.display='block';
  document.getElementById('boardTitleInput').value=b.name;
  document.getElementById('tbBoardName').textContent=b.name;
  const totalCards=b.sections.reduce((a,s)=>a+s.cards.length,0);
  document.getElementById('boardMeta').innerHTML=
    `<span><i class="ti ti-calendar-event"></i>${b.createdAt||'Today'}</span>`+
    `<span><i class="ti ti-stack-2"></i>${b.sections.length} section${b.sections.length!==1?'s':''}</span>`+
    `<span><i class="ti ti-cards"></i>${totalCards} card${totalCards!==1?'s':''}</span>`;
  renderSections();
}

// ═══════════════════════════════════════════════════
//  SECTIONS
// ═══════════════════════════════════════════════════
function renderSections(){
  const b=activeBoard();
  const wrap=document.getElementById('sectionsWrap');
  wrap.innerHTML='';
  if(!b)return;
  b.sections.forEach((sec,idx)=>{
    const div=document.createElement('div');
    div.className='section-wrap';
    div.innerHTML=`
      <div class="section-header">
        <div class="sec-color-dot" style="background:${sec.color||'var(--primary)'}" onclick="cycleSecColor('${sec.id}')" title="Change color"></div>
        <input class="sec-title-input" value="${esc(sec.title)}" placeholder="Section title…"
          onchange="updateSecTitle('${sec.id}',this.value)" onblur="updateSecTitle('${sec.id}',this.value)">
        <span class="sec-count">${sec.cards.length}</span>
        <div class="sec-actions">
          <button class="sec-icon-btn" onclick="moveSec('${sec.id}',-1)" ${idx===0?'style="opacity:.25;pointer-events:none"':''}><i class="ti ti-arrow-up"></i></button>
          <button class="sec-icon-btn" onclick="moveSec('${sec.id}',1)" ${idx===b.sections.length-1?'style="opacity:.25;pointer-events:none"':''}><i class="ti ti-arrow-down"></i></button>
          <button class="sec-icon-btn" onclick="deleteSection('${sec.id}')"><i class="ti ti-trash"></i></button>
        </div>
        <div class="sec-spacer"></div>
        <button class="sec-add-btn" onclick="openAddCardModal('${sec.id}')"><i class="ti ti-plus" style="font-size:12px"></i> Add card</button>
      </div>
      <div class="card-row" id="row-${sec.id}">
        ${sec.cards.length===0?'<div class="empty-row-hint"><i class="ti ti-arrow-right" style="font-size:12px"></i>No cards yet — click "Add card" to start</div>':''}
      </div>`;
    wrap.appendChild(div);
    // render cards async so we can fetch blobs
    renderCardsForSection(sec);
  });
}

async function renderCardsForSection(sec){
  const row=document.getElementById('row-'+sec.id);
  if(!row)return;
  // Remove hint if cards exist
  if(sec.cards.length>0)row.innerHTML='';
  for(const card of sec.cards){
    const el=document.createElement('div');
    el.className='card';
    el.dataset.id=card.id;
    el.innerHTML=await buildCardHTML(card,sec.id);
    row.appendChild(el);
    // bind events
    el.addEventListener('click',e=>{
      if(e.target.closest('.card-menu-btn')||e.target.closest('.like-btn'))return;
      openPreview(card.id,sec.id);
    });
    el.querySelector('.card-menu-btn')?.addEventListener('click',e=>{e.stopPropagation();showCtx(e,card.id,sec.id);});
    el.querySelector('.like-btn')?.addEventListener('click',e=>{e.stopPropagation();likeCard(card.id,sec.id);});
  }
  // add card button
  const addBtn=document.createElement('div');
  addBtn.className='card-add';
  addBtn.innerHTML='<i class="ti ti-plus"></i><span>Add card</span>';
  addBtn.onclick=()=>openAddCardModal(sec.id);
  row.appendChild(addBtn);
  // update count
  const cnt=document.querySelector(`[data-sec-id="${sec.id}"]`);
  const countEl=row.closest('.section-wrap')?.querySelector('.sec-count');
  if(countEl)countEl.textContent=sec.cards.length;
}

async function buildCardHTML(card,secId){
  const TYPE_META={
    note:{icon:'ti-note',bg:'#fff8e1',fg:'#f9ab00'},
    image:{icon:'ti-photo',bg:'#e8f0fe',fg:'#4285f4'},
    video:{icon:'ti-video',bg:'#111',fg:'#fff'},
    pdf:{icon:'ti-file-description',bg:'#fce8e6',fg:'#e53935'},
    link:{icon:'ti-link',bg:'#e6f4ea',fg:'#34a853'},
    todo:{icon:'ti-checkbox',bg:'#f3e8ff',fg:'#7c4dff'},
  };
  const tm=TYPE_META[card.type]||TYPE_META.note;
  const tags=(card.tags||[]).slice(0,4).map(t=>`<span class="card-tag">${esc(t)}</span>`).join('');

  let media='';
  if(card.fileKey){
    try{
      const blob=await dbGet(card.fileKey);
      if(blob){
        const url=URL.createObjectURL(blob);
        if(card.type==='image'){
          media=`<div class="card-media"><img src="${url}" alt="${esc(card.title)}" loading="lazy" onload=""></div>`;
        } else if(card.type==='video'){
          media=`<div class="card-media" style="background:#000">
            <video src="${url}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover"></video>
            <div class="card-media-badge"><i class="ti ti-player-play" style="font-size:9px"></i> ${card.fileName||'Video'}</div>
          </div>`;
        } else if(card.type==='pdf'){
          media=`<div class="card-media" style="background:#fce8e6"><i class="ti ti-file-type-pdf" style="font-size:38px;color:#e53935"></i><div class="card-media-pdf-badge">PDF</div></div>`;
        } else {
          media=`<div class="card-media" style="background:${tm.bg}"><i class="ti ${tm.icon}" style="font-size:34px;color:${tm.fg}"></i></div>`;
        }
      }
    } catch(e){
      media=`<div class="card-media" style="background:${tm.bg}"><i class="ti ${tm.icon}" style="font-size:34px;color:${tm.fg}"></i></div>`;
    }
  } else if(card.type==='link'&&card.link){
    media=`<div class="card-media" style="background:#e6f4ea"><i class="ti ti-link" style="font-size:34px;color:#34a853"></i></div>`;
  } else if(card.type!=='note'&&card.type!=='todo'){
    media=`<div class="card-media" style="background:${tm.bg}"><i class="ti ${tm.icon}" style="font-size:34px;color:${tm.fg}"></i></div>`;
  }

  const descHtml=card.type==='link'&&card.link
    ?`<div class="card-desc" style="color:var(--primary);word-break:break-all">${esc(card.link)}</div>`
    :(card.body?`<div class="card-desc">${card.body}</div>`:'');

  return `${media}
    <div class="card-body">
      <div class="card-author-row">
        <div class="card-av"></div>
        <span class="card-author">You</span>
        <span class="card-time">${card.time||'just now'}</span>
      </div>
      <div class="card-title">${esc(card.title)}</div>
      ${descHtml}
      ${card.fileName?`<div class="card-desc" style="font-size:10.5px;color:var(--text3)"><i class="ti ti-paperclip" style="font-size:11px"></i> ${esc(card.fileName)} ${card.fileSize?'('+fmtSize(card.fileSize)+')':''}</div>`:''}
      ${tags?`<div class="card-tags">${tags}</div>`:''}
    </div>
    <div class="card-footer">
      <button class="card-stat like-btn" data-card="${card.id}" data-sec="${secId}"><i class="ti ti-heart"></i> ${card.likes||0}</button>
      <button class="card-stat"><i class="ti ti-message-circle"></i> ${card.comments||0}</button>
      <div class="card-spacer"></div>
      <button class="card-menu-btn" data-c="${card.id}" data-s="${secId}"><i class="ti ti-dots-vertical"></i></button>
    </div>
    <div class="card-color-stripe" style="background:${card.color||'var(--primary)'}"></div>`;
}

function openAddSectionModal(){
  if(!activeBoard()){toast('Create a board first','err');return;}
  initCpicker('secCpicker','secColor');
  document.getElementById('newSecTitle').value='';
  openModal('addSectionModal');
  setTimeout(()=>document.getElementById('newSecTitle').focus(),120);
}
function saveSection(){
  const b=activeBoard();if(!b)return;
  const title=document.getElementById('newSecTitle').value.trim();
  if(!title){toast('Enter a section title','err');return;}
  b.sections.push({id:'s'+Date.now(),title,color:S.secColor,cards:[]});
  closeModal('addSectionModal');saveState();renderBoard();toast('"'+title+'" added','ok');
}
function updateSecTitle(secId,val){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===secId);
  if(sec){sec.title=val.trim()||'Untitled Section';saveState();}
}
function cycleSecColor(secId){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===secId);if(!sec)return;
  const idx=(COLORS.indexOf(sec.color)+1)%COLORS.length;
  sec.color=COLORS[idx];saveState();renderSections();
}
function moveSec(secId,dir){
  const b=activeBoard();if(!b)return;
  const i=b.sections.findIndex(s=>s.id===secId);
  const j=i+dir;if(j<0||j>=b.sections.length)return;
  [b.sections[i],b.sections[j]]=[b.sections[j],b.sections[i]];
  saveState();renderSections();
}
function deleteSection(secId){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===secId);
  if(!confirm(`Delete "${sec?.title||'this section'}" and all its cards?`))return;
  sec.cards.forEach(c=>{if(c.fileKey)dbDel(c.fileKey);});
  b.sections=b.sections.filter(s=>s.id!==secId);
  saveState();renderBoard();toast('Section deleted');
}

// ═══════════════════════════════════════════════════
//  ADD CARD  +  FILE UPLOAD
// ═══════════════════════════════════════════════════
let _targetSec=null;

function openAddCardModal(secId){
  if(!activeBoard()){toast('Create a board first','err');return;}
  _targetSec=secId||activeBoard().sections[0]?.id;
  S.cardType='note';pendingFile=null;
  // reset UI
  document.querySelectorAll('#typeTabs .type-tab').forEach(t=>t.classList.toggle('on',t.dataset.type==='note'));
  showTypeUI('note');
  initCpicker('cardCpicker','cardColor');
  ['cardTitle','cardLink','cardTags'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cardBody').innerHTML='';
  document.getElementById('filePreviewWrap').style.display='none';
  document.getElementById('filePreviewWrap').innerHTML='';
  document.getElementById('progressWrap').style.display='none';
  document.getElementById('fileInput').value='';
  // section select
  const sel=document.getElementById('cardSecSel');
  sel.innerHTML=activeBoard().sections.map(s=>`<option value="${s.id}"${s.id===_targetSec?' selected':''}>${esc(s.title)}</option>`).join('');
  openModal('addCardModal');
  setTimeout(()=>document.getElementById('cardTitle').focus(),120);
}

function selType(btn){
  document.querySelectorAll('#typeTabs .type-tab').forEach(t=>t.classList.remove('on'));
  btn.classList.add('on');S.cardType=btn.dataset.type;
  showTypeUI(S.cardType);
  pendingFile=null;
  document.getElementById('filePreviewWrap').style.display='none';
  document.getElementById('filePreviewWrap').innerHTML='';
  document.getElementById('fileInput').value='';
}

const UPLOAD_TYPES=['image','video','pdf'];
const UPLOAD_HINTS={
  image:'JPG, PNG, GIF, WebP, SVG, HEIC — any size',
  video:'MP4, WebM, MOV, MKV, AVI — any size, including large files',
  pdf:'PDF, DOCX, XLSX, PPTX, TXT — any size',
};

function showTypeUI(type){
  document.getElementById('uploadGroup').style.display=UPLOAD_TYPES.includes(type)?'block':'none';
  document.getElementById('linkGroup').style.display=type==='link'?'block':'none';
  document.getElementById('bodyGroup').style.display=(type==='note'||type==='todo')?'block':'none';
  if(UPLOAD_TYPES.includes(type)){
    document.getElementById('uploadHint').textContent=UPLOAD_HINTS[type]||'Any file';
    document.getElementById('uploadLimit').textContent='No size limit — stored on your device';
    // set accepted file types
    const accepts={image:'image/*',video:'video/*',pdf:'.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'};
    document.getElementById('fileInput').accept=accepts[type]||'*';
  }
}

function handleFile(input){
  const file=input.files[0];if(!file)return;
  // Store the raw File object — no size limit
  pendingFile=file;
  showProgress(0,'Preparing…');
  // Show preview immediately for images using createObjectURL (no reading needed)
  const url=URL.createObjectURL(file);
  showFilePreview(file,url);
  showProgress(100,'Ready');
  setTimeout(()=>document.getElementById('progressWrap').style.display='none',600);
  // Auto-fill title
  const titleEl=document.getElementById('cardTitle');
  if(!titleEl.value)titleEl.value=file.name.replace(/\.[^.]+$/,'');
}

function showProgress(pct,label){
  const pw=document.getElementById('progressWrap');
  pw.style.display='block';
  document.getElementById('progressLabel').textContent=label;
  document.getElementById('progressPct').textContent=pct+'%';
  document.getElementById('progressFill').style.width=pct+'%';
}

function showFilePreview(file,url){
  const wrap=document.getElementById('filePreviewWrap');
  wrap.style.display='block';
  let thumbHtml='';
  if(file.type.startsWith('image/')){
    thumbHtml=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
  } else if(file.type.startsWith('video/')){
    thumbHtml=`<video src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px" muted></video>`;
  } else {
    const icons={'pdf':'ti-file-type-pdf','word':'ti-file-word','excel':'ti-file-excel','powerpoint':'ti-file-powerpoint','text':'ti-file-text'};
    let icon='ti-file';
    if(file.type.includes('pdf'))icon='ti-file-type-pdf';
    else if(file.type.includes('word')||file.name.endsWith('.docx'))icon='ti-file-word';
    else if(file.type.includes('excel')||file.name.endsWith('.xlsx'))icon='ti-file-excel';
    else if(file.type.includes('powerpoint')||file.name.endsWith('.pptx'))icon='ti-file-powerpoint';
    else if(file.type.startsWith('text/'))icon='ti-file-text';
    thumbHtml=`<i class="ti ${icon}" style="font-size:22px;color:var(--text3)"></i>`;
  }
  wrap.innerHTML=`<div class="file-preview">
    <div class="fp-thumb">${thumbHtml}</div>
    <div style="flex:1;min-width:0">
      <div class="fp-name">${esc(file.name)}</div>
      <div class="fp-size">${fmtSize(file.size)}</div>
    </div>
    <button class="fp-rm" onclick="clearFile()" title="Remove"><i class="ti ti-x"></i></button>
  </div>`;
}

function clearFile(){
  pendingFile=null;
  document.getElementById('filePreviewWrap').style.display='none';
  document.getElementById('filePreviewWrap').innerHTML='';
  document.getElementById('fileInput').value='';
}

// ═══════════════════════════════════════════════════
//  SAVE CARD  — stores blob in IndexedDB
// ═══════════════════════════════════════════════════
async function saveCard(){
  const b=activeBoard();if(!b)return;
  const secId=document.getElementById('cardSecSel').value;
  const sec=b.sections.find(s=>s.id===secId);if(!sec)return;
  const title=document.getElementById('cardTitle').value.trim();
  if(!title){toast('Enter a card title','err');document.getElementById('cardTitle').focus();return;}
  if(UPLOAD_TYPES.includes(S.cardType)&&!pendingFile){toast('Please select a file to upload','err');return;}
  if(S.cardType==='link'&&!document.getElementById('cardLink').value.trim()){toast('Enter a URL','err');return;}

  const btn=document.getElementById('addCardBtn');
  btn.disabled=true;btn.textContent='Saving…';

  let fileKey=null;
  let fileName=null;
  let fileSize=null;

  if(pendingFile){
    fileKey='file_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    fileName=pendingFile.name;
    fileSize=pendingFile.size;
    showProgress(30,'Saving to device storage…');
    try{
      await dbPut(fileKey,pendingFile);   // store raw File/Blob
      showProgress(100,'Saved!');
    }catch(e){
      toast('Could not save file: '+e.message,'err');
      btn.disabled=false;btn.innerHTML='<i class="ti ti-check" style="font-size:13px"></i> Add Card';
      return;
    }
    setTimeout(()=>document.getElementById('progressWrap').style.display='none',500);
  }

  const card={
    id:'c'+Date.now(),type:S.cardType,title,
    body:document.getElementById('cardBody').innerText.trim(),
    link:document.getElementById('cardLink').value.trim(),
    tags:document.getElementById('cardTags').value.split(',').map(t=>t.trim()).filter(Boolean),
    color:S.cardColor,time:timeAgo(),likes:0,comments:0,
    fileKey,fileName,fileSize,
  };
  sec.cards.push(card);
  closeModal('addCardModal');
  pendingFile=null;
  btn.disabled=false;btn.innerHTML='<i class="ti ti-check" style="font-size:13px"></i> Add Card';
  saveState();renderBoard();toast('Card added!','ok');
}

// ═══════════════════════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════════════════════
let _ctx={cardId:null,secId:null};
function showCtx(e,cardId,secId){
  _ctx={cardId,secId};
  const m=document.getElementById('ctxMenu');
  m.style.top=Math.min(e.clientY,window.innerHeight-130)+'px';
  m.style.left=Math.min(e.clientX,window.innerWidth-160)+'px';
  m.classList.add('show');e.stopPropagation();
}
document.addEventListener('click',()=>document.getElementById('ctxMenu').classList.remove('show'));

function ctxAct(action){
  document.getElementById('ctxMenu').classList.remove('show');
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===_ctx.secId);if(!sec)return;
  if(action==='del'){
    const card=sec.cards.find(c=>c.id===_ctx.cardId);
    if(card?.fileKey)dbDel(card.fileKey);
    sec.cards=sec.cards.filter(c=>c.id!==_ctx.cardId);
    saveState();renderBoard();toast('Card deleted');
  } else if(action==='dup'){
    const orig=sec.cards.find(c=>c.id===_ctx.cardId);
    if(orig){
      const copy={...orig,id:'c'+Date.now(),title:orig.title+' (copy)',time:'just now',fileKey:null};
      // note: we don't dup large files — just metadata
      sec.cards.push(copy);saveState();renderBoard();toast('Duplicated (file not copied)','ok');
    }
  } else if(action==='edit'){
    openEditCard(_ctx.cardId,_ctx.secId);
  }
}

// ═══════════════════════════════════════════════════
//  EDIT CARD
// ═══════════════════════════════════════════════════
let _editTarget={cardId:null,secId:null};
function openEditCard(cardId,secId){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===secId);if(!sec)return;
  const card=sec.cards.find(c=>c.id===cardId);if(!card)return;
  _editTarget={cardId,secId};
  document.getElementById('editTitle').value=card.title;
  document.getElementById('editBody').innerHTML=card.body||'';
  document.getElementById('editTags').value=(card.tags||[]).join(', ');
  initCpicker('editCpicker','cardColor');
  openModal('editCardModal');
}
function saveEdit(){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===_editTarget.secId);if(!sec)return;
  const card=sec.cards.find(c=>c.id===_editTarget.cardId);if(!card)return;
  card.title=document.getElementById('editTitle').value.trim()||card.title;
  card.body=document.getElementById('editBody').innerText.trim();
  card.tags=document.getElementById('editTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  card.color=S.cardColor;
  closeModal('editCardModal');saveState();renderBoard();toast('Card updated','ok');
}

// ═══════════════════════════════════════════════════
//  LIKE
// ═══════════════════════════════════════════════════
function likeCard(cardId,secId){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===secId);if(!sec)return;
  const card=sec.cards.find(c=>c.id===cardId);
  if(card){card.likes=(card.likes||0)+1;saveState();
    const btn=document.querySelector(`.like-btn[data-card="${cardId}"]`);
    if(btn)btn.innerHTML=`<i class="ti ti-heart"></i> ${card.likes}`;
  }
}

// ═══════════════════════════════════════════════════
//  PREVIEW  +  DOWNLOAD
// ═══════════════════════════════════════════════════
let _preview={cardId:null,secId:null,objectUrl:null,blob:null,fileName:null};

async function openPreview(cardId,secId){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===secId);if(!sec)return;
  const card=sec.cards.find(c=>c.id===cardId);if(!card)return;

  _preview={cardId,secId,objectUrl:null,blob:null,fileName:card.fileName||null};

  document.getElementById('previewTitle').textContent=card.title;
  document.getElementById('previewMeta').textContent=card.time||'';
  const body=document.getElementById('previewBody');
  body.innerHTML='<div style="padding:40px;color:var(--text3);font-size:13px">Loading preview…</div>';
  document.getElementById('previewFileInfo').textContent=card.fileName?`${card.fileName}${card.fileSize?' · '+fmtSize(card.fileSize):''}`:'No attached file';
  document.getElementById('previewDownloadBtn').style.display=card.fileKey||card.type==='note'||card.type==='todo'?'inline-flex':(card.link?'inline-flex':'none');
  document.getElementById('previewDownloadBtn').innerHTML = card.link && !card.fileKey
    ? '<i class="ti ti-external-link" style="font-size:13px"></i> Open Link'
    : '<i class="ti ti-download" style="font-size:13px"></i> Download';

  openPreviewModal();

  if(card.fileKey){
    try{
      const blob=await dbGet(card.fileKey);
      if(!blob){body.innerHTML=docFallback('ti-alert-triangle','File not found','It may have been removed from this device.');return;}
      const url=URL.createObjectURL(blob);
      _preview.objectUrl=url;_preview.blob=blob;

      if(card.type==='image'){
        body.innerHTML=`<img src="${url}" alt="${escAttr(card.title)}">`;
      } else if(card.type==='video'){
        body.innerHTML=`<video src="${url}" controls autoplay style="max-width:100%;max-height:70vh"></video>`;
      } else if(card.type==='pdf'){
        if(blob.type==='application/pdf'||(card.fileName||'').toLowerCase().endsWith('.pdf')){
          body.innerHTML=`<iframe src="${url}"></iframe>`;
        } else {
          body.innerHTML=docFallback('ti-file-description',card.fileName||'Document','Preview not available for this file type — download to view.');
        }
      } else {
        body.innerHTML=docFallback('ti-file',card.fileName||'File','Click download to save this file.');
      }
    } catch(e){
      body.innerHTML=docFallback('ti-alert-triangle','Could not load file',e.message);
    }
  } else if(card.type==='link'&&card.link){
    body.innerHTML=`<div class="preview-content-text" style="text-align:center">
      <i class="ti ti-link" style="font-size:48px;color:var(--primary);margin-bottom:14px;display:block"></i>
      <div class="pct-title" style="font-size:14px">${escHtml(card.link)}</div>
      <div style="margin-top:14px"><a href="${escAttr(card.link)}" target="_blank" rel="noopener" class="tb-btn tb-btn-primary" style="text-decoration:none;display:inline-flex">
        <i class="ti ti-external-link" style="font-size:13px"></i> Open in new tab</a></div>
    </div>`;
  } else {
    // note / todo / text content
    const tagsHtml=(card.tags||[]).map(t=>`<span class="card-tag">${escHtml(t)}</span>`).join('');
    body.innerHTML=`<div class="preview-content-text">
      <div class="pct-title">${escHtml(card.title)}</div>
      <div>${card.body?card.body:'<span style="color:var(--text3)">No additional content</span>'}</div>
      ${tagsHtml?`<div class="preview-tags-row">${tagsHtml}</div>`:''}
    </div>`;
  }
}

function docFallback(icon,title,sub){
  return `<div class="preview-doc-fallback"><i class="ti ${icon}"></i><div class="pf-title">${escHtml(title)}</div><div class="pf-sub">${escHtml(sub)}</div></div>`;
}

function openPreviewModal(){document.getElementById('previewOverlay').classList.add('open');}
function closePreview(){
  document.getElementById('previewOverlay').classList.remove('open');
  if(_preview.objectUrl){URL.revokeObjectURL(_preview.objectUrl);}
  // stop any playing video
  const v=document.querySelector('#previewBody video');
  if(v){v.pause();}
  _preview={cardId:null,secId:null,objectUrl:null,blob:null,fileName:null};
}
document.getElementById('previewOverlay').addEventListener('click',e=>{if(e.target.id==='previewOverlay')closePreview();});

function downloadCurrentPreview(){
  const b=activeBoard();if(!b)return;
  const sec=b.sections.find(s=>s.id===_preview.secId);if(!sec)return;
  const card=sec.cards.find(c=>c.id===_preview.cardId);if(!card)return;

  if(card.link&&!card.fileKey){
    window.open(card.link,'_blank','noopener');
    return;
  }
  if(_preview.blob){
    const a=document.createElement('a');
    a.href=_preview.objectUrl;
    a.download=_preview.fileName||card.title||'download';
    document.body.appendChild(a);a.click();
    document.body.removeChild(a);
    toast('Downloading…','ok');
    return;
  }
  if(card.type==='note'||card.type==='todo'){
    // export note as a .txt file
    const text=`${card.title}\n\n${card.body||''}\n\nTags: ${(card.tags||[]).join(', ')}`;
    const blob=new Blob([text],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=(card.title||'note').replace(/[^\w\-]+/g,'_')+'.txt';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Note downloaded as .txt','ok');
    return;
  }
  toast('Nothing to download for this card','err');
}

function openEditFromPreview(){
  const cardId=_preview.cardId,secId=_preview.secId;
  closePreview();
  openEditCard(cardId,secId);
}

function escHtml(s){return esc(s);}
function escAttr(s){return esc(s);}

// ═══════════════════════════════════════════════════
//  SHARE
// ═══════════════════════════════════════════════════
function openShareModal(){document.getElementById('shareLink').value='https://collabboard.app/b/'+(S.activeBoardId||'new');openModal('shareModal');}
function copyLink(){navigator.clipboard.writeText(document.getElementById('shareLink').value).catch(()=>{});toast('Link copied!','ok');}
function selPerm(el){el.closest('.perm-grid').querySelectorAll('.popt').forEach(p=>p.classList.remove('on'));el.classList.add('on');}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function toggleDark(){S.dark=!S.dark;document.body.toggleAttribute('data-dark',S.dark);document.getElementById('themeBtn').innerHTML=`<i class="ti ti-${S.dark?'sun':'moon'}"></i>`;saveState();}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('collapsed');}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.overlay').forEach(el=>{el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});});
function initCpicker(id,key){
  const el=document.getElementById(id);if(!el)return;el.innerHTML='';
  COLORS.forEach(c=>{const d=document.createElement('div');d.className='cdot'+(S[key]===c?' on':'');d.style.background=c;d.style.color=c;d.onclick=()=>{el.querySelectorAll('.cdot').forEach(x=>x.classList.remove('on'));d.classList.add('on');S[key]=c;};el.appendChild(d);});
}
function fmt(cmd){document.execCommand(cmd,false,null);}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtSize(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';if(b<1073741824)return(b/1048576).toFixed(1)+'MB';return(b/1073741824).toFixed(2)+'GB';}
function timeAgo(){return 'just now';}
function toast(msg,type=''){
  const w=document.getElementById('toastWrap');
  const t=document.createElement('div');
  t.className='toast'+(type?' '+type:'');
  t.innerHTML=`<i class="ti ti-${type==='ok'?'check':type==='err'?'alert-circle':'info-circle'}" style="font-size:14px"></i> ${msg}`;
  w.appendChild(t);
  setTimeout(()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),300);},2800);
}

// DRAG & DROP on upload zone
document.addEventListener('DOMContentLoaded',()=>{
  const zone=document.getElementById('uploadZone');
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));
  zone.addEventListener('drop',e=>{
    e.preventDefault();zone.classList.remove('drag');
    const file=e.dataTransfer.files[0];
    if(file){const inp=document.getElementById('fileInput');const dt=new DataTransfer();dt.items.add(file);inp.files=dt.files;handleFile(inp);}
  });
});

// ═══════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════
async function boot(){
  await openDB();
  loadState();
  if(S.dark){document.body.setAttribute('data-dark','');document.getElementById('themeBtn').innerHTML='<i class="ti ti-sun"></i>';}
  if(S.activeBoardId&&!S.boards.find(b=>b.id===S.activeBoardId))S.activeBoardId=S.boards[0]?.id||null;
  renderSidebar();
  renderBoard();
}
boot();
