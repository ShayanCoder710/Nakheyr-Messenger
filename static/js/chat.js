const S = io({ transports: ['websocket', 'polling'] });
const CD = window.CHAT_DATA || {};
CD.joined = window.JOINED !== false;

let currentChat = window.CURRENT_CHAT;
let composerChatId = window.CURRENT_CHAT || null;
let pendingFiles = [];   
let _pfSeq = 0;
let recState = null;     
let pendingReply = null;
let selectedIds = new Set();
let selecting = false;
let typingTimers = {};
let typingSent = false;
let typingSelfTimer = null;

function applyTheme(t) {
  const v = (t === 'light' || t === 'auto') ? t : 'dark';
  document.documentElement.dataset.theme = v;
}
applyTheme(window.ME ? window.ME.theme : 'dark');

const sideEl = document.querySelector('.sidebar');
const sideToggleBtn = document.getElementById('sideToggle');
function setSideCollapsed(v) {
  if (!sideEl) return;
  sideEl.classList.toggle('collapsed', v);
  if (sideToggleBtn) sideToggleBtn.title = v ? 'باز کردن سایدبار' : 'جمع کردن سایدبار';
}
if (sideEl && sideToggleBtn) {
  setSideCollapsed(false);
  sideToggleBtn.onclick = e => {
    e.stopPropagation();
    setSideCollapsed(!sideEl.classList.contains('collapsed'));
  };
}
const sideSearchBtn = document.getElementById('sideSearchBtn');
if (sideEl && sideSearchBtn) {
  sideSearchBtn.onclick = e => {
    e.stopPropagation();
    const open = sideEl.classList.toggle('search-open');
    if (open) {
      const inp = document.getElementById('searchInput');
      if (inp) inp.focus();
    }
  };
}

function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

let draftTimer = null;
function saveDraftNow(chatId, text) {
  if (!chatId) return;
  api('/api/draft', { chat_id: +chatId, text: String(text == null ? '' : text) }).catch(() => {});
}
function flushDraftFor(chatId, text) {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (chatId) saveDraftNow(chatId, text);
}
function flushDraft() {
  const input = document.getElementById('msgInput');
  if (composerChatId) flushDraftFor(composerChatId, input ? input.value : '');
  composerChatId = null;
}
function queueDraftSave() {
  if (!composerChatId) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    const input = document.getElementById('msgInput');
    saveDraftNow(composerChatId, input ? input.value : '');
  }, 600);
}

function getMember(id) {
  if (CD.members && id !== undefined) {
    const m = CD.members.find(x => x.id === id);
    if (m) return m;
  }
  return { display_name: 'کاربر', username: '', avatar: '', status: 'offline' };
}

function avBox(name, avatar, online, size) {
  const cls = ('avatar' + (size ? ' ' + size : '')).trim();
  const init = esc(String(name || '?').trim().charAt(0) || '?');
  const dot = avatar ? '' : (online === undefined ? '' : `<i class="dot ${online ? 'on' : 'off'}"></i>`);
  return `<div class="${cls}">${avatar ? `<img src="${avatar}" alt="">` : init}${dot}</div>`;
}

function myRole() { return CD.role || null; }

function isPeer() {
  return CD.chat && CD.chat.chat_type === 'dm';
}

function peer() {
  return isPeer() && CD.chat.peer ? CD.chat.peer : null;
}

function reactionChips(m) {
  const mine = m.my_reaction;
  const agg = {};
  Object.values(m.reactions || {}).forEach(e => { agg[e] = (agg[e] || 0) + 1; });
  return Object.entries(agg).map(([e, n]) => {
    const safe = esc(e);
    return `<span class="${e === mine ? 'mine' : ''}" data-emoji="${safe}" data-mid="${m.id}"><span class="rx-e">${safe}</span>${n}</span>`;
  }).join('');
}

function canPinMsg(m) {
  if (m.sender_id === window.ME.id) return true;
  if (window.ME.is_admin) return true;
  if (['owner', 'admin'].includes(myRole())) return true;
  return !!(CD.chat && CD.chat.chat_type === 'dm'); 
}

function lastSenderOf(mid) {
  const msgs = (CD.initialMessages || []).filter(x => !x.deleted && x.msg_type !== 'system');
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].id === mid) return i > 0 ? msgs[i - 1].sender_id : null;
  }
  return null;
}

function nextSenderOf(mid) {
  const msgs = (CD.initialMessages || []).filter(x => !x.deleted && x.msg_type !== 'system');
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].id === mid) return i < msgs.length - 1 ? msgs[i + 1].sender_id : null;
  }
  return null;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    ok ? resolve() : reject(new Error('copy failed'));
  });
}

function fileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].includes(ext)) return 'file-earmark-zip';
  if (['pdf'].includes(ext)) return 'file-earmark-pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'file-earmark-word';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'file-earmark-excel';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'file-earmark-ppt';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'file-earmark-music';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp'].includes(ext)) return 'file-earmark-play';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) return 'file-earmark-image';
  if (['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'toml', 'cfg', 'conf'].includes(ext)) return 'file-earmark-text';
  const codeExt = ['py', 'pyw', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass',
    'less', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'cs', 'java', 'kt', 'kts',
    'go', 'rs', 'rb', 'php', 'pl', 'lua', 'r', 'jl', 'swift', 'm', 'mm', 'dart', 'scala', 'sql', 'graphql',
    'proto', 'prisma', 'vue', 'svelte', 'astro', 'hs', 'erl', 'ex', 'exs', 'clj', 'lisp', 'asm', 'sol', 'tex',
    'ipynb', 'ino', 'qml', 'vala', 'hx', 'glsl', 'hlsl', 'wgsl', 'jsp', 'asp', 'aspx', 'ejs', 'hbs', 'pug',
    'jade', 'njk', 'liquid', 'twig', 'mustache', 'haml', 'slim', 'erb', 'v', 'd', 'nim', 'zig'];
  const codeNames = ['makefile', 'dockerfile', 'jenkinsfile', 'rakefile', 'gemfile', 'procfile', 'vagrantfile', 'cmakelists'];
  if (codeExt.includes(ext) || codeNames.includes((name || '').toLowerCase())) return 'file-earmark-code';
  return 'file-earmark';
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
}

function tickIcon(seen) {
  return bi(seen ? 'check2-all' : 'check');
}

function faNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);
}

function pollHtml(p) {
  const total = p.total || 0;
  const voters = (p.voters !== undefined && p.voters !== null) ? p.voters : 0;
  const multi = !!p.multi;
  const closed = !!p.closed;
  const myVotes = p.my_votes || [];
  const voted = myVotes.length > 0;
  const showResults = closed || voted;
  const opts = (p.options || []).map((label, i) => {
    const c = (p.counts && p.counts[i]) || 0;
    const pct = total ? Math.round(c / total * 100) : 0;
    const sel = myVotes.includes(i);
    return `<div class="poll-opt ${sel ? 'selected' : ''}" data-pollopt="${p.id}" data-opt="${i}">
      <div class="opt-top">
        <span class="opt-label">${esc(label)}</span>
        ${showResults ? `<span class="opt-pct${sel ? ' sel' : ''}">${faNum(pct)}٪</span>` : ''}
      </div>
      ${showResults ? `<div class="opt-track"><span class="opt-fill${sel ? ' sel' : ''}" style="width:${pct}%"></span></div>` : ''}
    </div>`;
  }).join('');
  const isGroup = CD.chat && CD.chat.chat_type === 'group';
  const canSeeVoters = closed && isGroup && (window.ME.is_admin || (CD.role && ['owner', 'admin'].includes(CD.role)));
  const canClose = !closed && (p.created_by === window.ME.id || window.ME.is_admin || (CD.role && ['owner', 'admin'].includes(CD.role)));
  const expTag = closed ? (p.expires_at ? `<span class="poll-tag exp">${bi('hourglass-split')} انقضاشده</span>` : `<span class="poll-tag">${bi('lock')} بسته</span>`) : '';
  const multiTag = multi ? `<span class="poll-tag">${bi('ui-checks')} چندگزینه‌ای</span>` : '';
  const canRevoke = !closed && voted;
  const foot = `<div class="poll-foot">
    <span class="poll-total">${bi('people')} ${faNum(voters)} رای</span>
    <span class="poll-foot-acts">
      ${canRevoke ? `<button class="poll-revoke-btn" data-pollrevoke="${p.id}" title="پس گرفتن رای من">${bi('arrow-counterclockwise')} لغو رای</button>` : ''}
      ${canSeeVoters ? `<button class="poll-close-btn" data-pollvoters="${p.id}" title="مشاهده رأی‌دهندگان">${bi('eye')}</button>` : ''}
      ${canClose ? `<button class="poll-close-btn" data-pollclose="${p.id}" title="بستن">${bi('lock')}</button>` : ''}
    </span>
  </div>`;
  return `<div class="poll-card ${closed ? 'poll-locked' : ''}" data-pollid="${p.id}">
    <div class="poll-head"><span class="poll-head-ic">${bi('bar-chart')}</span><b>نظرسنجی</b>${multiTag}${expTag}</div>
    <div class="poll-q">${esc(p.question)}</div>
    <div class="poll-opts">${opts}</div>
    ${foot}
  </div>`;
}

function renderMsg(m) {
  if (m.deleted) return '';
  if (m.msg_type === 'system') {
    return `<div class="sys-msg" data-mid="${m.id}"><span>${esc(m.content)}</span></div>`;
  }
  const url = esc(m.file_url || '');
  const fname = esc(m.file_name || '');
  let body = '';
  if (m.msg_type === 'image') {
    body = `<img class="img" src="${url}" alt="${fname}" loading="lazy" data-media="image" data-src="${m.file_url || ''}" data-name="${fname}">`;
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'gif') {
    if (/\.mp4$/i.test(m.file_name || '')) {
      body = `<div class="vid-wrap"><video class="vid" src="${url}" muted loop autoplay playsinline preload="metadata"></video>`
        + `<button class="vid-expand" title="نمایش بزرگ" data-media="gif" data-src="${m.file_url || ''}" data-name="${fname}">${bi('arrows-angle-expand')}</button></div>`;
    } else {
      body = `<img class="img" src="${url}" alt="${fname}" loading="lazy" data-media="image" data-src="${m.file_url || ''}" data-name="${fname}">`;
    }
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'video') {
    body = `<div class="vid-wrap"><video class="vid" src="${url}" controls preload="metadata" playsinline></video>`
      + `<button class="vid-expand" title="نمایش بزرگ" data-media="video" data-src="${m.file_url || ''}" data-name="${fname}">${bi('arrows-angle-expand')}</button></div>`;
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'audio') {
    const vcMine = m.sender_id === window.ME.id;
    body = `<div class="voice-card ${vcMine ? 'sent' : ''}" data-mid="${m.id}" data-vurl="${esc(url)}" dir="ltr">
      <button class="vc-play" title="پخش">${bi('play-fill')}</button>
      <span class="vc-wave" data-vcwave="${m.id}" title="برای جابه‌جایی کلیک یا بکشید">${vcWaveHtml(m.id)}</span>
      <button class="vc-speed" data-mid="${m.id}" title="سرعت پخش">1x</button>
      <span class="vc-times"><span class="vc-cur">0:00</span><span class="vc-dur">…</span></span>
    </div>`;
    ensureVoiceMeta(m, vcMine ? 'پیام صوتی من' : 'پیام صوتی');
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'file') {
    body = `<div class="file-card"><div class="fi">${bi(fileIcon(m.file_name))}</div><div class="fc-meta"><b>${fname}</b><small>فایل</small></div></div>`;
    if (m.file_url) {
      body += `<div class="file-actions"><a class="btn sm" href="${url}" download="${fname}">${bi('download')} دریافت</a>`
        + `<a class="btn sm ghost" href="${url}" target="_blank" rel="noopener">${bi('box-arrow-up-right')} باز کردن</a></div>`;
    }
  } else {
    if (m.poll) {
      body = `${pollHtml(m.poll)}`;
    } else {
      body = `<div class="txt md">${md(m.content)}</div>`;
    }
  }

  const sender = m.sender_id ? getMember(m.sender_id) : { display_name: 'سیستم', avatar: '' };
  const mine = m.sender_id === window.ME.id;
  const hasImg = m.msg_type === 'image';
  const isMedia = hasImg || m.msg_type === 'video' || m.msg_type === 'gif';
  const imgOnly = (hasImg || m.msg_type === 'gif') && !m.content;
  const seen = mine && window.ME.read_receipts !== false && Array.isArray(m.read_by) && m.read_by.some(id => String(id) !== String(window.ME.id));
  const newGroup = String(m.sender_id) !== String(lastSenderOf(m.id));
  const groupTail = String(nextSenderOf(m.id)) !== String(m.sender_id);
  const reply = m.reply && !m.reply.deleted
    ? `<div class="reply-ref" data-goto="${m.reply.id}"><b>${esc((getMember(m.reply.sender_id) || {}).display_name || 'کاربر')}</b> ${esc(m.reply.content || '(تصویر/فایل)')}</div>`
    : '';
  const fwd = m.fwd_from_name ? `<div class="fwd-tag">${bi('share')} فوروارد شده از <b>${esc(m.fwd_from_name)}</b></div>` : '';
  const pinTag = m.pinned ? `<span class="pin-tag">${bi('pin-angle-fill')} پین شده</span>` : '';
  const title = (!mine && sender.title) ? ` <span class="member-title" title="لقب در این گروه">${esc(sender.title)}</span>` : '';
  const isDm = !!(CD.chat && CD.chat.chat_type === 'dm');
  const isChannel = !!(CD.chat && CD.chat.chat_type === 'channel');
  const showSender = !mine && !isDm && !isChannel && newGroup;
  const mineRow = mine || isChannel;
  const html = `
    <div class="mrow ${mineRow ? 'mine-row' : ''} ${newGroup ? 'who' : ''}" data-mid="${m.id}">
      ${(!mine && !isChannel) ? (groupTail ? `<span class="av-click" data-profile-user="${esc(sender.username || '')}">${avBox(sender.display_name, sender.avatar, sender.status === 'online', 'sm')}</span>` : '<div class="avatar sm ghost"></div>') : ''}
      <div class="bubble ${(!isChannel && mine) ? 'me' : ''} ${isMedia ? 'has-img' : ''} ${imgOnly ? 'img-only' : ''} ${m.pinned ? 'pinned' : ''} ${!newGroup ? 'compact' : ''}">
        ${showSender ? `<div class="sender-line">${esc(sender.display_name)}${title}</div>` : ''}
        ${fwd}${reply}${body}
        <div class="m-meta">
          ${pinTag}
          <span>${fmtTime(m.created_at)}</span>
          ${m.is_edited ? '<span class="edited">ویرایش شده</span>' : ''}
          ${mine ? `<span class="ticks" data-mid="${m.id}">${tickIcon(seen)}</span>` : ''}
        </div>
        <div class="reactions" data-mid="${m.id}">${reactionChips(m)}</div>
      </div>
      <span class="sel-check" data-sel="${m.id}" aria-hidden="true"></span>
    </div>`;
  return html;
}

function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  return d.toDateString();
}

function lastDayKey() {
  const seps = document.querySelectorAll('#msgs .day-sep, #msgsBody .day-sep');
  return seps.length ? seps[seps.length - 1].dataset.day : null;
}

function ensureDaySep(iso) {
  const raw = dayKey(iso);
  if (raw !== lastDayKey()) {
    document.getElementById('msgsBody').insertAdjacentHTML('beforeend',
      `<div class="day-sep" data-day="${esc(raw)}"><span>${fmtDay(iso)}</span></div>`);
  }
}

function renderAllMessages() {
  const body = document.getElementById('msgsBody');
  body.innerHTML = '';
  const msgs = (CD.initialMessages || []).filter(m => !m.deleted);
  if (msgs.length) {
    let lastRaw = null;
    msgs.forEach(m => {
      try {
        const raw = dayKey(m.created_at);
        if (raw !== lastRaw) {
          body.insertAdjacentHTML('beforeend',
            `<div class="day-sep" data-day="${esc(raw)}"><span>${fmtDay(m.created_at)}</span></div>`);
          lastRaw = raw;
        }
        body.insertAdjacentHTML('beforeend', renderMsg(m));
      } catch (err) {
        console.warn('renderMsg failed for message', m.id, err);
      }
    });
  } else if (currentChat) {
    body.innerHTML = '<div class="empty-msgs">اینجا جای پیام‌هاست. اولین پیام رو تو بفرست</div>';
  }
  scrollToBottom(true);
}

function nearBottom() {
  const el = document.getElementById('msgs');
  return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function scrollToBottom(force) {
  const el = document.getElementById('msgs');
  if (force || nearBottom()) {
    el.scrollTop = el.scrollHeight;
  }
  updateScrollBtn();
}

function updateScrollBtn() {
  const btn = document.getElementById('scrollDown');
  const el = document.getElementById('msgs');
  if (!btn || !el) return;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  btn.classList.toggle('show', dist > 220);
}

(function initScrollDown() {
  const el = document.getElementById('msgs');
  const btn = document.getElementById('scrollDown');
  if (!el || !btn) return;
  el.addEventListener('scroll', updateScrollBtn, { passive: true });
  new MutationObserver(updateScrollBtn).observe(el, { childList: true, subtree: true });
  btn.addEventListener('click', () => { el.scrollTop = el.scrollHeight; updateScrollBtn(); });
  window.addEventListener('resize', updateScrollBtn);
  updateScrollBtn();
})();

function registerMessage(m) {
  if (!CD.initialMessages) CD.initialMessages = [];
  if (!CD.initialMessages.find(x => x.id === m.id)) CD.initialMessages.push(m);
}

let loadingOlder = false;
let oldestId = null;
function attachMore() {
  const msgs = (CD.initialMessages || []).filter(x => !x.deleted);
  oldestId = msgs.length ? msgs[0].id : null;
  const el = document.getElementById('msgs');
  if (el._oldBound) return;
  el._oldBound = true;
  el.addEventListener('scroll', () => {
    if (el.scrollTop > 40 || !oldestId || loadingOlder || !currentChat) return;
    const before = oldestId;
    loadingOlder = true;
    fetch('/api/messages/' + currentChat + '?before=' + before).then(r => r.json()).then(j => {
      if (j.messages && j.messages.length) {
        const keep = el.scrollTop;
        const prevH = el.scrollHeight;
        prependOlder(j);
        el.scrollTop = el.scrollHeight - prevH + keep;
      }
      loadingOlder = false;
    }).catch(() => { loadingOlder = false; });
  });
}

function prependOlder(j) {
  const bodyEl = document.getElementById('msgsBody');
  const topEl = document.createElement('div');
  bodyEl.insertBefore(topEl, bodyEl.firstChild);
  j.messages.forEach(m => registerMessage(m));
  const existingSep = bodyEl.querySelector('.day-sep');
  const nextDay = existingSep ? existingSep.dataset.day : null;
  let lastRaw = null;
  j.messages.forEach((m, i) => {
    const raw = dayKey(m.created_at);
    if (raw !== lastRaw) {
      const isLastDay = i === j.messages.length - 1 || dayKey(j.messages[i + 1].created_at) !== raw;
      if (!(isLastDay && raw === nextDay)) {
        topEl.insertAdjacentHTML('beforeend',
          `<div class="day-sep" data-day="${esc(raw)}"><span>${fmtDay(m.created_at)}</span></div>`);
      }
      lastRaw = raw;
    }
    topEl.insertAdjacentHTML('beforeend', `<div id="m${m.id}">${renderMsg(m)}</div>`);
  });
  oldestId = j.messages[0].id;
}

function flashMsg(row) {
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1200);
}
async function jumpToMessage(mid) {
  mid = +mid;
  let row = document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (row) { flashMsg(row); return; }
  let guard = 0;
  while (oldestId && mid < oldestId && guard < 30) {
    if (loadingOlder) break;
    const before = oldestId;
    let j;
    try { j = await (await fetch('/api/messages/' + currentChat + '?before=' + before)).json(); }
    catch { break; }
    if (!j.messages || !j.messages.length) break;
    prependOlder(j);
    guard++;
    if (j.messages.some(m => m.id === mid)) break;
  }
  row = document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (row) flashMsg(row);
}

function shortSnippet(m) {
  const t = m.msg_type;
  if (t === 'image') return 'تصویر';
  if (t === 'video') return 'ویدیو';
  if (t === 'audio') return 'پیام صوتی';
  if (t === 'file') return 'فایل';
  const text = (m.content || '').replace(/\n/g, ' ');
  return text.slice(0, 40) + (text.length > 40 ? '…' : '');
}

function updateConvPreview(m) {
  if (!m || !m.chat_id) return;
  const el = document.querySelector('.conv[data-chat-id="' + m.chat_id + '"]');
  if (!el) { refreshConvList(); return; }
  const sys = m.msg_type === 'system';
  const mine = m.sender_id === window.ME.id;
  let prefix = '';
  if (!sys && el.dataset.type !== 'dm') {
    if (mine) prefix = 'شما · ';
    else {
      const mm = (CD.members || []).find(x => x.id === m.sender_id);
      if (!mm) { refreshConvList(); return; }
      prefix = (mm.display_name || 'کاربر') + ' · ';
    }
  }
  const row2 = el.querySelector('.row2 span');
  if (row2) row2.textContent = prefix + shortSnippet(m);
  const time = el.querySelector('time');
  if (time) time.textContent = fmtTime(m.created_at);
  const list = el.parentElement;
  if (list && list.firstElementChild !== el) list.insertBefore(el, list.firstElementChild);
}

function appendMsg(m) {
  const body = document.getElementById('msgsBody');
  if (document.getElementById('m' + m.id)) { registerMessage(m); return; }
  registerMessage(m);
  ensureDaySep(m.created_at);
  const own = m.sender_id === window.ME.id;
  body.insertAdjacentHTML('beforeend', `<div id="m${m.id}">${renderMsg(m)}</div>`);
  scrollToBottom(own);
  updateConvPreview(m);
  if (selecting) syncSelection();
}

function renderSlowHint() {
  const el = document.getElementById('slowModeHint');
  if (!el) return;
  const sm = +((CD.chat && CD.chat.slow_mode) || 0);
  if (!sm) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const label = sm >= 60
    ? (sm % 60 === 0 ? (sm / 60) + ' دقیقه' : Math.round(sm / 60 * 10) / 10 + ' دقیقه')
    : sm + ' ثانیه';
  el.innerHTML = bi('hourglass-split')
    + ' <span>حالت آهسته فعاله — هر ' + esc(label) + ' یک پیام (مدیران مستثنی)</span>';
  el.style.display = 'flex';
}

function setHead() {
  const headAv = document.getElementById('chatHeadAvatar');
  const name = document.getElementById('chatHeadName');
  const sub = document.getElementById('chatHeadSub');
  const repBtn = document.getElementById('btnReportUser');
  const joinBtn = document.getElementById('btnJoin');
  const peerBtn = document.getElementById('btnPeerProfile');
  if (!CD.chat) return;
  let displayName, subText, av = '', subHtml = false;
  const c = CD.chat;
  renderSlowHint();
  joinBtn.style.display = 'none';
  repBtn.style.display = 'none';
  peerBtn.style.display = 'none';
  if (c.is_notes) {
    displayName = 'فضای شخصی';
    subText = 'یادداشت‌ها و پیام‌های خودت';
    headAv.innerHTML = bi('bookmark');
    delete headAv.dataset.media; delete headAv.dataset.src; delete headAv.dataset.name;
    name.textContent = displayName;
    sub.textContent = subText;
    return;
  }
  if (c.chat_type === 'dm') {
    const p = c.peer || {};
    displayName = p.display_name || c.name || 'کاربر';
    const status = p.status === 'online' ? 'آنلاین' : 'آفلاین';
    const narrow = window.innerWidth <= 480;
    subText = p.username ? (narrow ? status : ('@' + p.username + ' · ' + status)) : status;
    av = p.avatar || '';
    if (p.id) repBtn.style.display = 'grid';
  } else {
    displayName = c.name || (c.chat_type === 'channel' ? 'کانال' : 'گروه');
    const vis = c.is_public ? bi('globe') + ' عمومی' : bi('lock') + ' خصوصی';
    subText = (c.chat_type === 'channel' ? 'کانال' : 'گروه') + ' · ' + vis + ' · ' + ((c.members || (CD.members || [])).length) + ' عضو';
    subHtml = true;
    av = c.avatar;
    const isMember = CD.role !== null && CD.role !== undefined;
    if (!isMember && !window.ME.is_admin) {
      if (c.is_public) joinBtn.style.display = 'grid';
      else subText += ' · برای ورود دعوت شو';
    }
  }
  headAv.innerHTML = (av ? '<img src="' + av + '" alt="">' : (displayName || '؟').charAt(0));
  const oType = (c.chat_type === 'dm') ? 'user' : 'chat';
  const oId = (c.chat_type === 'dm') ? (c.peer ? c.peer.id : null) : c.id;
  setAvatarData(headAv, av, displayName || '', oType, oId);
  name.textContent = displayName;
  if (subHtml) sub.innerHTML = subText;
  else sub.textContent = subText;
  const pane = document.getElementById('msgsPane');
  if (pane) pane.classList.toggle('not-joined', !CD.joined && c.chat_type !== 'dm');
  if (isPeer()) {
    const p = c.peer || {};
    peerBtn.style.display = 'grid';
    peerBtn.href = '/profile/' + (p.username || '');
    repBtn.dataset.target = p.id || '';
    repBtn.dataset.name = p.display_name || '';
    if (p.id) repBtn.style.display = 'grid';
  }
}

let _headResizeT;
window.addEventListener('resize', () => {
  clearTimeout(_headResizeT);
  _headResizeT = setTimeout(() => { if (CD.chat) setHead(); }, 120);
});

document.addEventListener('click', e => {
  const chip = e.target.closest('.chip[data-username]');
  if (chip) {
    e.preventDefault();
    openDmByUsername(chip.dataset.username);
  }
});

document.getElementById('btnReportUser').onclick = () => openReportFromBtn();

function openReportFromBtn() {
  const btn = document.getElementById('btnReportUser');
  openReport({ id: +btn.dataset.target || 0, display_name: btn.dataset.name || 'کاربر' }, btn.dataset.msgid || '');
}

function openReport(target, messageId) {
  if (!target || !target.id) return;
  window._reportTarget = target.id;
  window._reportMsgId = messageId;
  document.getElementById('reportTitle').textContent = 'گزارش از: ' + (target.display_name || target.username || 'کاربر');
  document.getElementById('reportReason').value = '';
  document.getElementById('reportModal').classList.add('show');
}

document.getElementById('reportCancel').onclick = () => document.getElementById('reportModal').classList.remove('show');

document.querySelectorAll('.modal').forEach(mod => {
  mod.addEventListener('click', e => {
    if (e.target === mod) mod.classList.remove('show');
  });
  const box = mod.querySelector('.box');
  if (box && !box.querySelector('.modal-x')) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'modal-x';
    x.title = 'بستن';
    x.innerHTML = bi('x-lg');
    x.onclick = () => mod.classList.remove('show');
    box.prepend(x);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.show, .report-modal.show').forEach(m => m.classList.remove('show'));
    hidePicker();
    cancelSelect();
    const cs = document.getElementById('chatSearch');
    if (cs && cs.style.display !== 'none') closeChatSearch();
  }
});

let _titleTarget = null;
function openTitleGlobal(userId) {
  const m = (CD.members || []).find(x => x.id === +userId);
  if (!m) return;
  _titleTarget = +userId;
  document.getElementById('tmAvatar').innerHTML = avatarInner(m.display_name, m.avatar, m.status === 'online');
  document.getElementById('tmName').textContent = m.display_name;
  document.getElementById('tmUser').textContent = m.username;
  document.getElementById('tmInput').value = m.title || '';
  document.getElementById('titleModal').classList.add('show');
}
document.getElementById('tmCancel').onclick = () => document.getElementById('titleModal').classList.remove('show');
document.getElementById('tmSave').onclick = async () => {
  if (_titleTarget === null) return;
  const r = await api('/api/chat/' + currentChat + '/members', {
    action: 'title', user_id: _titleTarget, title: document.getElementById('tmInput').value.trim()
  });
  if (r.ok) {
    document.getElementById('titleModal').classList.remove('show');
    toast('لقب ثبت شد');
    loadMembers(currentChat);
    renderAllMessages();
  } else toast(r.error, 'error');
};
document.getElementById('tmClear').onclick = async () => {
  if (_titleTarget === null) return;
  document.getElementById('tmInput').value = '';
  const r = await api('/api/chat/' + currentChat + '/members', {
    action: 'title', user_id: _titleTarget, title: ''
  });
  if (r.ok) {
    document.getElementById('titleModal').classList.remove('show');
    toast('لقب حذف شد');
    loadMembers(currentChat);
    renderAllMessages();
  } else toast(r.error, 'error');
};

let _delAction = null;
function openConfirm(title, sub, onConfirm, okLabel) {
  document.getElementById('delTitle').textContent = title;
  document.getElementById('delSub').textContent = sub;
  document.getElementById('delConfirm').textContent = okLabel || 'تأیید';
  _delAction = onConfirm;
  document.getElementById('deleteModal').classList.add('show');
}
document.getElementById('delCancel').onclick = () => document.getElementById('deleteModal').classList.remove('show');
document.getElementById('delConfirm').onclick = () => {
  document.getElementById('deleteModal').classList.remove('show');
  const fn = _delAction;
  _delAction = null;
  if (fn) fn();
};
document.getElementById('deleteModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) { document.getElementById('deleteModal').classList.remove('show'); _delAction = null; }
});

function _pollRowNum(n) {
  const fa = ['۱','۲','۳','۴','۵','۶'];
  return fa[n - 1] || n;
}
function _addPollOption(value) {
  const box = document.getElementById('pollOptions');
  if (box.querySelectorAll('.poll-opt-row').length >= 6) { toast('حداکثر ۶ گزینه', 'error'); return; }
  const n = box.querySelectorAll('.poll-opt-row').length + 1;
  const row = document.createElement('div');
  row.className = 'poll-opt-row';
  row.innerHTML = `
    <span class="poll-row-num">${_pollRowNum(n)}</span>
    <input class="input poll-opt" maxlength="80" placeholder="گزینه ${_pollRowNum(n)}" value="${esc(value || '')}">
    <button type="button" class="poll-rm" data-rmopt title="حذف گزینه">${bi('x-lg')}</button>`;
  box.appendChild(row);
  row.querySelector('input').focus();
  _renumberPollRows();
}
function _renumberPollRows() {
  document.querySelectorAll('#pollOptions .poll-opt-row').forEach((row, i) => {
    const num = row.querySelector('.poll-row-num');
    if (num) num.textContent = _pollRowNum(i + 1);
    const inp = row.querySelector('input');
    if (inp && !inp.value.trim()) inp.placeholder = 'گزینه ' + _pollRowNum(i + 1);
  });
}
function openPollModal() {
  const modal = document.getElementById('pollModal');
  document.getElementById('pollQuestion').value = '';
  const box = document.getElementById('pollOptions');
  box.innerHTML = '';
  _addPollOption('');
  _addPollOption('');
  document.getElementById('pollMulti').checked = false;
  const seg = document.getElementById('pollExpiry');
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.exp === ''));
  modal.classList.add('show');
  document.getElementById('pollQuestion').focus();
}
document.getElementById('btnPoll').onclick = () => {
  if (CD.chat && CD.chat.chat_type === 'dm') {
    toast('نظرسنجی تو پیوی نمی‌شه بفرستی. اول تو یه گروه یا کانال بساز، بعد فوروارد کن', 'error');
    return;
  }
  openPollModal();
};
document.getElementById('pollCancel').onclick = () => document.getElementById('pollModal').classList.remove('show');
document.getElementById('pollAddOpt').onclick = () => _addPollOption('');
document.getElementById('pollOptions').addEventListener('click', e => {
  const rm = e.target.closest('[data-rmopt]');
  if (!rm) return;
  const box = rm.closest('.poll-opt-row');
  if (box.parentElement.querySelectorAll('.poll-opt-row').length <= 2) { toast('حداقل ۲ گزینه لازم داری', 'error'); return; }
  box.remove();
  _renumberPollRows();
});
document.getElementById('pollExpiry').addEventListener('click', e => {
  const b = e.target.closest('button[data-exp]');
  if (!b) return;
  e.target.closest('#pollExpiry').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
});
document.getElementById('pollCreate').onclick = async () => {
  if (!currentChat) { toast('اول یه گپ باز کن', 'error'); return; }
  const question = document.getElementById('pollQuestion').value.trim();
  if (question.length < 2) { toast('سوال رو کامل بنویس', 'error'); return; }
  const opts = [...document.querySelectorAll('#pollOptions .poll-opt')].map(x => x.value.trim()).filter(Boolean);
  if (opts.length < 2) { toast('حداقل ۲ گزینه با متن لازم داری', 'error'); return; }
  const multi = document.getElementById('pollMulti').checked;
  const exp = (document.querySelector('#pollExpiry .on') || {}).dataset.exp || '';
  const r = await api('/api/poll/create', { chat_id: currentChat, question, options: opts, multi, expires: exp });
  document.getElementById('pollModal').classList.remove('show');
  if (r.ok && r.message) {
    appendMsg(r.message);
    scrollToBottom(true);
    refreshConvList();
  } else if (r.error) toast(r.error, 'error');
};

document.addEventListener('click', e => {
  const revBtn = e.target.closest('[data-pollrevoke]');
  if (revBtn) {
    e.preventDefault();
    api('/api/poll/' + revBtn.dataset.pollrevoke + '/revoke', {}).then(j => {
      if (!j.ok) toast(j.error || 'نمی‌شود پس گرفت', 'error');
    });
    return;
  }
  const closeBtn = e.target.closest('[data-pollclose]');
  if (closeBtn) {
    e.preventDefault();
    const pid = +closeBtn.dataset.pollclose;
    api('/api/poll/' + pid + '/close', {}).then(j => {
      if (!j.ok) toast(j.error || 'انجام نشد', 'error');
    });
    return;
  }
  const votersBtn = e.target.closest('[data-pollvoters]');
  if (votersBtn) {
    e.preventDefault();
    openPollVotersModal(+votersBtn.dataset.pollvoters);
    return;
  }
});

function openPollVotersModal(pid) {
  api('/api/poll/' + pid + '/voters').then(j => {
    if (!j.ok) { toast(j.error || 'امکان نمایش رأی‌دهندگان نیست', 'error'); return; }
    const modal = document.getElementById('pollVotersModal');
    const list = document.getElementById('pollVotersList');
    const voters = j.voters || [];
    if (!voters.length) {
      list.innerHTML = '<p style="color:var(--dim); font-size:13px; text-align:center; padding:16px">هنوز کسی رای نداده</p>';
    } else {
      list.innerHTML = voters.map(v => {
        const u = v.user || {};
        const picks = (v.picks || []).join('، ');
        return `<div class="pv-row">
          <span class="avatar sm">${u.avatar ? '<img src="' + esc(u.avatar) + '" alt="">' : esc((u.display_name || '?').charAt(0))}</span>
          <div class="pv-id"><b>${esc(u.display_name || 'کاربر')}</b><small>${esc(picks || '—')}</small></div>
        </div>`;
      }).join('');
    }
    modal.classList.add('show');
  });
}
document.getElementById('pollVotersModal').addEventListener('click', e => {
  if (e.target === e.currentTarget || e.target.closest('#pollVotersClose')) {
    document.getElementById('pollVotersModal').classList.remove('show');
  }
});
document.addEventListener('click', e => {
  const opt = e.target.closest('[data-pollopt]');
  if (!opt) return;
  const pid = +opt.dataset.pollopt;
  const idx = +opt.dataset.opt;
  const m = (CD.initialMessages || []).find(x => x.poll && x.poll.id === pid);
  if (!m || !m.poll) return;
  const p = m.poll;
  if (p.closed) return;
  const myVotes = p.my_votes || [];
  let pick;
  if (p.multi) {
    pick = myVotes.includes(idx) ? myVotes.filter(x => x !== idx) : myVotes.concat(idx).sort((a, b) => a - b);
  } else {
    pick = [idx];
  }
  if (pick.length === 0) {
    api('/api/poll/' + pid + '/revoke', {}).then(j => {
      if (!j.ok) toast(j.error || 'نمی‌شود پس گرفت', 'error');
    });
  } else {
    api('/api/poll/' + pid + '/vote', { options: pick }).then(j => {
      if (!j.ok) toast(j.error || 'رای ثبت نشد', 'error');
    });
  }
});

document.getElementById('pollModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.target.classList.remove('show');
});

document.getElementById('btnSendReport').onclick = async () => {
  const reason = document.getElementById('reportReason').value.trim();
  if (!reason) return toast('دلیل رو بنویس', 'error');
  const r = await api('/api/report', { user_id: +window._reportTarget, reason, message_id: window._reportMsgId || null });
  document.getElementById('reportModal').classList.remove('show');
  toast(r.ok ? 'گزارشتت ثبت شد. ادمین‌ها بررسی می‌کنن.' : r.error, r.ok ? 'success' : 'error');
};

function clearUnread(id) {
  document.querySelectorAll(`.conv[data-chat-id="${id}"] .unread-pill`).forEach(el => el.remove());
}

function setActiveConv(id) {
  document.querySelectorAll('.conv').forEach(c => c.classList.toggle('active', String(c.dataset.chatId) === String(id)));
}

function closeChatPane(syncUrl) {
  if (recState) finishRec(false);
  flushDraft();
  currentChat = null;
  document.getElementById('msgsPane').classList.remove('open');
  document.getElementById('mainEmpty').style.display = 'grid';
  document.querySelector('.chat-layout').classList.remove('chatted');
  document.querySelectorAll('.conv.active').forEach(c => c.classList.remove('active'));
  if (syncUrl !== false && location.pathname !== '/') history.pushState({}, '', '/');
}

function setChatted(on) {
  document.querySelector('.chat-layout').classList.toggle('chatted', on);
}

document.getElementById('btnBackChat').onclick = () => closeChatPane();

async function openChat(id, opts) {
  if (recState) finishRec(false);
  const inputEl = document.getElementById('msgInput');
  if (composerChatId) {
    flushDraftFor(composerChatId, inputEl ? inputEl.value : '');
  } else {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  currentChat = +id;
  if (typeof closeChatSearch === 'function') closeChatSearch();
  const r = await fetch('/api/messages/' + id);
  let j;
  try { j = await r.json(); } catch (e) { j = {}; }
  if (currentChat !== +id) return;
  if (!r.ok || !j.chat) {
    CD.chat = null;
    CD.role = null;
    CD.members = [];
    closeChatPane();
    toast('دسترسی به این گپ نداری', 'error');
    refreshConvList();
    return;
  }
  CD.initialMessages = j.messages || [];
  CD.chat = j.chat;
  CD.role = j.role;
  CD.members = j.members;
  CD.joined = j.joined !== false;
  setHead();
  document.getElementById('mainEmpty').style.display = 'none';
  document.getElementById('msgsPane').classList.add('open');
  setChatted(true);
  document.getElementById('msgsBody').innerHTML = '';
  document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
  cancelSelect();
  pendingReply = null;
  document.getElementById('replyPreview').style.display = 'none';
  const canPost = !(j.chat.chat_type === 'channel' && CD.role !== 'owner' && CD.role !== 'admin' && !window.ME.is_admin);
  document.getElementById('msgInput').disabled = !canPost;
  document.getElementById('btnAttach').style.visibility = canPost ? 'visible' : 'hidden';
  document.getElementById('btnMic').style.visibility = canPost ? 'visible' : 'hidden';
  document.getElementById('btnPoll').style.visibility = canPost ? 'visible' : 'hidden';
  document.getElementById('channelHint').style.display = canPost ? 'none' : 'flex';
  const savedDraft = typeof j.draft === 'string' ? j.draft : '';
  if (+composerChatId !== +id) inputEl.value = savedDraft;
  composerChatId = +id;
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  renderSlowHint();
  renderAllMessages();
  attachMore();
  api('/api/mark-read', { chat_id: currentChat });
  clearUnread(id);
  setActiveConv(id);
  S.emit('stop_typing', { chat_id: currentChat });
  typingSent = false;
  Object.keys(typingTimers).forEach(k => { clearTimeout(typingTimers[k]); delete typingTimers[k]; });
  document.getElementById('typingBar').innerHTML = '';
  loadPinned();
  if (!(opts && opts.fromHistory)) {
    const url = '/chat/' + id;
    if (location.pathname !== url) history.pushState({ chat: +id }, '', url);
  }
}

window.addEventListener('popstate', () => {
  const m = location.pathname.match(/^\/chat\/(\d+)/);
  if (m) openChat(+m[1], { fromHistory: true });
  else closeChatPane(false);
});

function renderConvItem(it) {
  const lock = (it.chat_type !== 'dm' && !it.is_notes && it.is_public === false) ? ' ' + bi('lock') : '';
  let av;
  if (it.is_notes) {
    av = `<div class="avatar conv-av" style="border-radius:14px">${bi('bookmark')}</div>`;
  } else if (it.avatar) {
    av = `<div class="avatar conv-av" style="border-radius:14px"><img src="${it.avatar}" alt=""></div>`;
  } else {
    av = `<div class="avatar conv-av" style="border-radius:14px">${esc((it.name || '؟').charAt(0))}</div>`;
  }
  const muteIco = it.muted ? `<span class="conv-mute" title="بی‌صدا">${bi('bell-slash')}</span>` : '';
  return `
    <div class="conv ${it.chat_id === currentChat ? 'active' : ''}${it.muted ? ' muted' : ''}" data-chat-id="${it.chat_id}" data-type="${it.chat_type}" data-name="${esc(it.name || '')}" data-peer="${esc(it.peer_username || '')}" data-peer-id="${it.peer_id || ''}" data-blocked="${it.blocked ? 1 : 0}" data-owner="${it.owner_id || ''}" data-muted="${it.muted ? 1 : 0}" data-archived="${it.archived ? 1 : 0}" data-unread="${it.unread || 0}">
      ${av}
      <div class="body">
        <div class="row1"><b>${esc(it.name)}${lock}</b><span class="conv-meta">${muteIco}<time>${fmtTime(it.last_at)}</time></span></div>
        <div class="row2"><span>${esc(it.last)}</span>${it.unread ? `<span class="unread-pill">${it.unread}</span>` : ''}</div>
      </div>
    </div>`;
}

let convSeq = 0;
let convTimer = null;
function refreshConvList() {
  clearTimeout(convTimer);
  convTimer = setTimeout(loadConvList, 120);
}
function loadConvList() {
  const seq = ++convSeq;
  fetch('/api/conversations').then(r => r.json()).then(j => {
    if (seq !== convSeq) return;
    const byCat = { dm: [], group: [], channel: [], notes: [], archive: [] };
    j.conversations.forEach(it => {
      if (it.archived && !it.is_notes) { byCat.archive.push(it); return; }
      const cat = it.is_notes ? 'notes' : it.chat_type;
      byCat[cat] = byCat[cat] || [];
      byCat[cat].push(it);
    });
    const arcSec = document.getElementById('archiveSection');
    if (arcSec) arcSec.style.display = byCat.archive.length ? '' : 'none';
    for (const cat of ['archive', 'dm', 'group', 'channel', 'notes']) {
      const list = document.getElementById('convList' + cat.charAt(0).toUpperCase() + cat.slice(1));
      if (!list) continue;
      let html;
      if (cat === 'notes') {
        html = byCat.notes.map(renderConvItem).join('')
          + (byCat.notes.length
            ? ''
            : `<button class="conv new-notes" id="newNotesBtn" title="فضای شخصی رو بساز">
                 <span class="avatar conv-av" style="border-radius:14px">${bi('bookmark')}</span>
                 <div class="body"><div class="row1"><b>فضای شخصی من</b></div><div class="row2"><span>یادداشت و پیام به خودت</span></div></div>
               </button>`);
      } else {
        html = byCat[cat].map(renderConvItem).join('') || '<div class="conv-empty">—</div>';
      }
      list.innerHTML = html;
      const head = document.querySelector(`.conv-section-head[data-cat="${cat}"] span`);
      if (head && cat !== 'notes') {
        if (!head.dataset.base) head.dataset.base = head.textContent;
        const icon = head.querySelector('svg');
        head.textContent = head.dataset.base.replace(/\s*\(\d+\)$/, '') + ' (' + byCat[cat].length + ')';
        if (icon) head.insertBefore(icon, head.firstChild);
      }
    }
    const nn = document.getElementById('newNotesBtn');
    if (nn) nn.onclick = () => openNotes();
    setActiveConv(currentChat);
  });
}

let _notesChatId = null;
async function openNotes() {
  const r = await api('/api/notes', {});
  if (!r.ok || !r.chat_id) { toast(r.error || 'خطا', 'error'); return; }
  _notesChatId = r.chat_id;
  openChat(r.chat_id);
  refreshConvList();
}

function initConvHeads() {
  document.querySelectorAll('.conv-section-head span').forEach(s => {
    s.dataset.base = s.textContent;
  });
}

document.addEventListener('click', e => {
  const conv = e.target.closest('.conv');
  if (conv) {
    conv.classList.remove('pulsing');
    void conv.offsetWidth; 
    conv.classList.add('pulsing');
    openChat(conv.dataset.chatId);
    e.stopPropagation();
    return;
  }
  const head = e.target.closest('.conv-section-head');
  if (head) {
    head.parentElement.classList.toggle('collapsed');
    return;
  }
});

function editMessage(mid, rowEl) {
  const row = rowEl || document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (!row) return;
  const txt = row.querySelector('.txt');
  if (!txt) return;
  const m = (CD.initialMessages || []).find(x => x.id === mid);
  const original = m ? m.content : txt.textContent;

  const wrap = document.createElement('div');
  wrap.className = 'edit-wrap';
  const input = document.createElement('textarea');
  input.className = 'input edit-input';
  input.rows = 1;
  input.value = original;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm primary edit-save';
  btn.innerHTML = bi('check2') + '<span>ویرایش</span>';
  wrap.appendChild(input);
  wrap.appendChild(btn);
  txt.replaceWith(wrap);

  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; };
  grow();
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== original) {
      api('/api/message/edit', { message_id: mid, content: v }).then(j => {
        if (j.ok) { if (m) m.content = v; txt.innerHTML = md(v); }
        else { txt.innerHTML = md(original); toast(j.error, 'error'); }
      });
    } else {
      txt.innerHTML = md(original);
    }
    wrap.replaceWith(txt);
  };
  const cancel = () => { if (done) return; done = true; wrap.replaceWith(txt); };
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', finish);
  input.addEventListener('input', grow);
  input.onkeydown = ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finish(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
  };
  input.onblur = finish;
}

let pickerMsg = null;
function hidePicker() {
  const p = document.getElementById('emojiPicker');
  p.style.display = 'none';
  p.style.left = ''; p.style.top = '';
  pickerMsg = null;
}
function openEmojiPicker(mid, x, y) {
  pickerMsg = mid;
  const p = document.getElementById('emojiPicker');
  p.innerHTML = EMOJIS.map(e => `<button data-emoji="${e}">${e}</button>`).join('');
  p.classList.add('global');
  p.style.display = 'grid';
  const bw = p.offsetWidth, bh = p.offsetHeight;
  let px = x - bw / 2, py = y + 22;
  if (px < 8) px = 8;
  if (px + bw > window.innerWidth - 8) px = window.innerWidth - bw - 8;
  if (py + bh > window.innerHeight - 8) py = y - bh - 22;
  p.style.left = px + 'px';
  p.style.top = py + 'px';
}
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#emojiPicker')) hidePicker();
});

const ALL_EMOJIS = [...new Set(EMOJI_SETS.flatMap(s => s.emojis))];
function searchEmojis(q) {
  return ALL_EMOJIS.filter(e => e === q || (EMOJI_KEYWORDS[e] || '').includes(q)).slice(0, 240);
}

function buildEmojiPanel() {
  const tabs = document.getElementById('epTabs');
  const body = document.getElementById('epBody');
  const search = document.getElementById('epSearch');
  tabs.innerHTML = EMOJI_SETS.map((s, i) =>
    `<button type="button" data-tab="${i}" class="${i === 0 ? 'on' : ''}" title="دسته ${i + 1}">${s.icon}</button>`).join('');
  let current = 0;
  const renderSet = i => {
    current = i;
    epCurrentSet = i;
    renderEpCurrentSet();
  };
  const runSearch = () => {
    const q = (search.value || '').trim().toLowerCase();
    if (epMode === 'gif') { renderGifGrid(); return; }  
    if (!q) { tabs.style.display = 'flex'; renderSet(current); return; }
    tabs.style.display = 'none';
    const found = searchEmojis(q);
    body.innerHTML = found.length
      ? found.map(e => `<button type="button" data-em="${e}">${e}</button>`).join('')
      : '<div class="ep-empty">چیزی پیدا نشد</div>';
    body.scrollTop = 0;
  };
  tabs.querySelectorAll('button').forEach(b => b.onclick = () => {
    tabs.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    search.value = '';
    tabs.style.display = 'flex';
    renderSet(+b.dataset.tab);
  });
  search.oninput = runSearch;
  search.onkeydown = ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (epMode === 'gif') {
      const first = document.querySelector('#epGifGrid [data-gif]');
      if (first) sendGifFromTile(first.dataset.gif);
      return;
    }
    const first = body.querySelector('[data-em]');
    if (first) insertEmoji(first.dataset.em);
  };
  renderSet(0);
  const swEm = document.getElementById('epSwEmoji');
  const swGif = document.getElementById('epSwGif');
  swEm.onclick = () => epSetMode('emoji');
  swGif.onclick = () => epSetMode('gif');
  epSetMode('emoji');
}

let epMode = 'emoji';      
let epCurrentSet = 0;      

function epSetMode(mode) {
  epMode = mode;
  const gifView = document.getElementById('epGifView');
  const tabs = document.getElementById('epTabs');
  const body = document.getElementById('epBody');
  const search = document.getElementById('epSearch');
  document.getElementById('epSwEmoji').classList.toggle('on', mode === 'emoji');
  document.getElementById('epSwGif').classList.toggle('on', mode === 'gif');
  gifView.style.display = mode === 'gif' ? 'flex' : 'none';
  tabs.style.display = mode === 'emoji' ? 'flex' : 'none';
  body.style.display = mode === 'emoji' ? 'grid' : 'none';
  search.placeholder = mode === 'gif' ? 'جستجوی گیف…' : 'جستجوی ایموجی…';
  search.value = '';
  if (mode === 'gif') { loadGifs(); renderGifGrid(); }
  else renderEpCurrentSet();
}

function renderEpCurrentSet() {
  const set = EMOJI_SETS[epCurrentSet] || EMOJI_SETS[0];
  const body = document.getElementById('epBody');
  const tabs = document.getElementById('epTabs');
  body.innerHTML = set.emojis.map(e => `<button type="button" data-em="${e}">${e}</button>`).join('');
  body.scrollTop = 0;
  tabs.style.display = 'flex';
  tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.tab === epCurrentSet));
}

async function loadGifs() {
  if (CD.gifs !== undefined) return;
  CD.gifs = null;               
  renderGifGrid();
  try {
    const r = await fetch('/api/gifs').then(x => x.json());
    if (r && r.ok) CD.gifs = r.gifs || [];
    else CD.gifs = undefined;   
  } catch (e) { CD.gifs = undefined; }
  renderGifGrid();
}
function renderGifGrid() {
  const grid = document.getElementById('epGifGrid');
  if (!grid) return;
  if (CD.gifs === undefined || CD.gifs === null) {
    grid.innerHTML = Array.from({ length: 6 }, () =>
      `<div class="ep-giftile ep-gifskel" aria-hidden="true"><div class="skel-shimmer"></div></div>`).join('')
      + `<span class="ep-gifempty">در حال بارگذاری گیف‌ها…</span>`;
    if (CD.gifs === undefined) loadGifs();
    return;
  }
  const search = document.getElementById('epSearch');
  const q = (search && search.value || '').trim().toLowerCase();
  const all = CD.gifs || [];
  const gifs = q ? all.filter(g => (g.name || '').toLowerCase().includes(q)) : all;
  const tiles = gifs.map(g => {
    const media = g.kind === 'video'
      ? `<video src="${esc(g.url)}" muted loop autoplay playsinline preload="metadata"></video>`
      : `<img src="${esc(g.url)}" alt="" loading="lazy">`;
    return `<button type="button" class="ep-giftile" data-gif="${g.id}" title="${esc(g.name)}">`
      + media + `<span class="ep-gifx" data-gifdel="${g.id}" title="حذف از گیف‌های من">${bi('x-lg')}</span></button>`;
  }).join('');
  grid.innerHTML =
    `<button type="button" class="ep-giftile ep-gifadd" id="epGifAdd">${bi('plus')}<span>افزودن گیف یا ویدیو</span></button>`
    + tiles
    + (q ? (!gifs.length ? '<span class="ep-gifempty">گیفی با این اسم پیدا نشد</span>' : '')
      : (!all.length ? '<span class="ep-gifempty">هنوز گیفی نداری — یکی اضافه کن</span>' : ''));
  const add = document.getElementById('epGifAdd');
  if (add) add.onclick = () => document.getElementById('epGifInput').click();
  document.getElementById('epGifInput').onchange = e => {
    addGifFile(e.target.files[0]);
    e.target.value = '';
  };
}
async function addGifFile(file) {
  if (!file) return;
  if (!/\.(gif|mp4)$/i.test(file.name)) { toast('فقط GIF یا MP4 بدون صدا مجازه', 'error'); return; }
  const fd = new FormData();
  fd.append('file', file, file.name);
  toast('در حال آپلود…');
  const r = await fetch('/api/gifs', { method: 'POST', body: fd }).then(x => x.json()).catch(() => null);
  if (!r || !r.ok) { toast((r && r.error) || 'افزودن گیف ناموفق بود', 'error'); return; }
  CD.gifs = [r.gif, ...((CD.gifs || []))];
  renderGifGrid();
  toast('به گیف‌های تو اضافه شد');
}
function delGifFromGrid(gid) {
  const id = +gid;
  CD.gifs = (CD.gifs || []).filter(x => x.id !== id);
  renderGifGrid();
  fetch('/api/gifs/' + id, { method: 'DELETE' }).then(x => x.json()).then(j => {
    if (!j.ok) toast(j.error || 'حذف نشد', 'error');
    else toast('گیف از لیستت حذف شد');
  }).catch(() => { /* best effort; the list row is already gone */ });
}
function sendGifFromTile(gid) {
  const g = (CD.gifs || []).find(x => x.id === +gid);
  if (!g) return;
  pendingFiles.push({ id: ++_pfSeq, path: g.url.slice('/files/'.length), name: g.name + (g.kind === 'video' ? '.mp4' : '.gif'),
                      kind: 'gif', url: g.url, asFile: false, vid: g.kind === 'video',
                      status: 'ready', progress: 100, size: 0 });
  renderAttachPreview();
  const inp = document.getElementById('msgInput');
  if (inp && !inp.disabled) inp.focus();
}

function hideEmojiPanel() {
  const p = document.getElementById('emojiPanel');
  if (p) p.style.display = 'none';
  const s = document.getElementById('epSearch');
  if (s) s.value = '';
  epSetMode('emoji'); 
  const b = document.getElementById('btnEmoji');
  if (b) b.classList.remove('active');
}

function openEmojiPanel() {
  const panel = document.getElementById('emojiPanel');
  if (panel.style.display === 'flex') { hideEmojiPanel(); return; }
  if (!panel.dataset.built) { buildEmojiPanel(); panel.dataset.built = '1'; }
  const btn = document.getElementById('btnEmoji');
  const r = btn.getBoundingClientRect();
  panel.style.display = 'flex';
  const b2 = document.getElementById('btnEmoji');
  if (b2) b2.classList.add('active');
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  let left = r.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (left < 8) left = 8;
  let top = r.top - ph - 10;
  if (top < 8) top = r.bottom + 10;
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}

function insertEmoji(e) {
  const inp = document.getElementById('msgInput');
  if (!inp || inp.disabled) return;
  const start = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
  const end = inp.selectionEnd == null ? inp.value.length : inp.selectionEnd;
  inp.value = inp.value.slice(0, start) + e + inp.value.slice(end);
  const pos = start + e.length;
  inp.focus();
  inp.setSelectionRange(pos, pos);
  inp.dispatchEvent(new Event('input'));
}

document.getElementById('btnEmoji').onclick = e => {
  e.stopPropagation();
  openEmojiPanel();
};
document.getElementById('emojiPanel').addEventListener('click', e => {
  const gx = e.target.closest('.ep-gifx');
  if (gx) { e.stopPropagation(); delGifFromGrid(gx.dataset.gifdel); return; }
  const b = e.target.closest('[data-em]');
  if (b) { insertEmoji(b.dataset.em); return; }
  const g = e.target.closest('[data-gif]');
  if (g) { sendGifFromTile(g.dataset.gif); return; }
  e.stopPropagation();
});
document.addEventListener('click', e => {
  if (!e.target.closest('#emojiPanel') && !e.target.closest('#btnEmoji')) hideEmojiPanel();
});

function doReact(mid, emoji) {
  localReact(mid, emoji);
  api('/api/message/react', { message_id: mid, emoji }).then(j => {
    if (!j.ok && j.error) toast(j.error, 'error');
  });
}

document.addEventListener('click', e => {
  const avc = e.target.closest('[data-profile-user]');
  if (avc) {
    const uname = avc.dataset.profileUser;
    if (uname && uname !== (window.ME && window.ME.username)) {
      e.preventDefault();
      window.location.href = '/profile/' + encodeURIComponent(uname);
      return;
    }
  }
  const memItem = e.target.closest('#csMembersList .mb-item');
  if (memItem) {
    const mem = memberById(+memItem.dataset.mmember);
    if (mem && mem.username && mem.id !== window.ME.id) {
      window.location.href = '/profile/' + encodeURIComponent(mem.username);
    }
    return;
  }
  const uLink = e.target.closest('.u-link[data-u]');
  if (uLink) {
    e.preventDefault();
    openDmByUsername(uLink.dataset.u);
    return;
  }

  const gEm = e.target.closest('#emojiPicker [data-emoji]');
  if (gEm) {
    if (pickerMsg != null) doReact(pickerMsg, gEm.dataset.emoji);
    hidePicker();
    return;
  }

  const goto = e.target.closest('[data-goto]');
  if (goto) {
    const target = document.querySelector(`.mrow[data-mid="${goto.dataset.goto}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1200);
    }
    return;
  }

  const chip = e.target.closest('.reactions [data-emoji]');
  if (chip) {
    doReact(+chip.closest('.reactions').dataset.mid, chip.dataset.emoji);
    return;
  }

  if (selecting) {
    const row = e.target.closest('.mrow');
    if (row && !e.target.closest('a, .reply-ref, .reactions, [data-media], video, audio')) {
      e.preventDefault();
      toggleSelect(+row.dataset.mid);
    }
  }
});

let sending = false;
async function sendText(caption) {
  if (sending || !currentChat) return;
  const chatId = currentChat;
  const input = document.getElementById('msgInput');
  if (input.disabled) {
    if (pendingFiles.some(f => f.status === 'ready')) toast('تو این گپ نمی‌تونی پیام بفرستی', 'error');
    return;
  }
  const text = (caption !== undefined ? caption : input.value).trim();
  const item = pendingFiles.find(f => f.status === 'ready');
  if (!text && !item) {
    if (pendingFiles.some(f => f.status === 'uploading')) toast('صبر کن تا آپلود تموم شه', 'error');
    return;
  }
  sending = true;
  const body = { chat_id: chatId, content: text };
  if (item) {
    body.msg_type = item.asFile ? 'file' : item.kind;
    body.file_path = item.path;
    body.file_name = item.name;
  } else {
    body.msg_type = 'text';
  }
  if (pendingReply) body.reply_to = pendingReply.id;
  try {
    const r = await api('/api/message/send', body);
    if (r.ok) {
      if (item) {
        const i = pendingFiles.indexOf(item);
        if (i > -1) pendingFiles.splice(i, 1);
      }
      if (currentChat === chatId) {
        appendMsg(r.message);
        if (caption === undefined) {
          input.value = '';
          input.style.height = 'auto';
        }
        pendingReply = null;
        renderAttachPreview();
        document.getElementById('replyPreview').style.display = 'none';
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(0, 0); } catch (_) {}
      }
      refreshConvList();
      if (caption === undefined) {
        setTimeout(() => {
          if (currentChat !== chatId) return;
          if (pendingFiles.some(f => f.status === 'ready')) {
            sendText(text);
          } else {
            input.value = '';
            input.style.height = 'auto';
            flushDraftFor(chatId, '');
          }
        }, 250);
      } else {
        if (!pendingFiles.some(f => f.status === 'ready')) flushDraftFor(chatId, '');
      }
    } else toast(r.error, 'error');
  } finally {
    sending = false;
  }
}

function openReply(mid) {
  const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (!row) return;
  const m = (CD.initialMessages || []).find(x => x.id === mid) || {};
  const sender = getMember(m.sender_id);
  const raw = m.msg_type === 'image' ? 'تصویر' : m.msg_type === 'gif' ? 'گیف' : m.msg_type === 'file' ? 'فایل' : (m.content || '');
  const label = String(raw).replace(/\n/g, ' ').slice(0, 60);
  pendingReply = { id: mid, name: sender.display_name || 'کاربر', preview: label || 'پیام' };
  const pv = document.getElementById('replyPreview');
  pv.innerHTML = `<span>${bi('reply')} پاسخ به <b>${esc(pendingReply.name)}</b>: ${esc(pendingReply.preview)}</span><button data-cancels>${bi('x-lg')}</button>`;
  pv.style.display = 'flex';
  document.getElementById('msgInput').focus();
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-cancels]')) {
    document.getElementById('replyPreview').style.display = 'none';
    pendingReply = null;
  }
});

let _fwdMid = null;
async function openForward(mid) {
  _fwdMid = mid;
  const modal = document.getElementById('fwdModal');
  const list = document.getElementById('fwdList');
  list.innerHTML = '<small style="color:var(--dim)">در حال بارگذاری…</small>';
  modal.classList.add('show');
  const j = await fetch('/api/conversations').then(r => r.json()).catch(() => null);
  if (!j) { list.innerHTML = '<small style="color:var(--dim)">بارگذاری نشد</small>'; return; }
  const convs = j.conversations || [];
  if (!convs.length) { list.innerHTML = '<small style="color:var(--dim)">هنوز گپی نداری</small>'; return; }
  const kindFa = c => c.chat_type === 'dm' ? (c.is_notes ? 'پیام‌های ذخیره‌شده' : 'گفتگو') : c.chat_type === 'group' ? 'گروه' : 'کانال';
  list.innerHTML = convs.map(c => `
    <div class="fwd-row" data-cid="${c.chat_id}">
      <span class="avatar sm">${avatarInner(c.name, c.avatar)}</span>
      <div class="blk-id"><b>${esc(c.name)}</b><small>${kindFa(c)}</small></div>
    </div>`).join('');
  list.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => doForward(+b.dataset.cid));
}

async function doForward(chatId) {
  if (!_fwdMid) return;
  const r = await api('/api/message/forward', { message_id: _fwdMid, chat_id: chatId });
  document.getElementById('fwdModal').classList.remove('show');
  if (r.ok) {
    toast('فوروارد شد');
    refreshConvList();
  } else toast(r.error, 'error');
}

function deleteRow(mid) {
  const wrapper = document.querySelector('#m' + mid) || document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (!wrapper) return;
  const row = wrapper.classList.contains('mrow') ? wrapper : wrapper.querySelector('.mrow');
  const el = row ? row : wrapper;
  el.classList.add('removing');
  setTimeout(() => {
    el.classList.remove('removing');
    el.classList.add('removing-done');
    setTimeout(() => el.remove(), 200);
  }, 220);
}

function removeMsgRow(mid) {
  deleteRow(mid);
}

function hideForMe(mid) {
  removeMsgRow(mid);
  const arr = CD.initialMessages || [];
  const i = arr.findIndex(x => x.id === mid);
  if (i > -1) arr.splice(i, 1);
  api('/api/message/hide', { message_id: mid }).then(j => { if (!j.ok) toast(j.error || 'حذف نشد', 'error'); });
}

function clearHistory(chatId) {
  const run = forEveryone => api('/api/chat/' + chatId + '/clear', { for_everyone: forEveryone }).then(j => {
    if (!j.ok) return toast(j.error, 'error');
    toast(forEveryone ? 'تاریخچه برای همه پاک شد' : 'تاریخچه پاک شد');
    if (currentChat === chatId) {
      CD.initialMessages = [];
      CD.pins = [];
      renderAllMessages();
      renderPinnedBar();
    }
    refreshConvList();
  });
  showCtxMenu(window.innerWidth / 2, window.innerHeight / 2, [
    { label: 'پاک کردن برای من', icon: bi('eye-slash'), fn: () => run(false) },
    { label: 'پاک کردن برای همه', icon: bi('eraser'), danger: true, fn: () => openConfirm('پاک کردن تاریخچه', 'همه‌ی پیام‌های این گپ برای همه پاک می‌شه. این کار قابل بازگشت نیست', () => run(true), 'پاک کن') },
  ]);
}

document.getElementById('fwdCancel').onclick = () => document.getElementById('fwdModal').classList.remove('show');

function toggleSelect(mid) {
  const nowOn = !selectedIds.has(mid);
  if (selectedIds.has(mid)) selectedIds.delete(mid);
  else selectedIds.add(mid);
  syncSelection();
  if (nowOn) {
    const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
    if (row) {
      row.classList.remove('pulsing');
      void row.offsetWidth;
      row.classList.add('pulsing');
    }
  }
}

function syncSelection() {
  document.querySelectorAll('.mrow').forEach(r => {
    const on = selectedIds.has(+r.dataset.mid);
    r.classList.toggle('sel-selected', on);
    r.classList.toggle('sel-eligible', selecting && !on);
  });
  const bar = document.getElementById('bulkBar');
  bar.style.display = selecting ? 'flex' : 'none';
  document.getElementById('bulkCount').textContent = selectedIds.size
    ? selectedIds.size + ' پیام انتخاب شده'
    : 'پیامی انتخاب نشده';
  document.getElementById('bulkCopy').disabled = !selectedIds.size;
  document.getElementById('bulkDelete').disabled = !selectedIds.size;
}

function enterSelect(mid) {
  selecting = true;
  selectedIds.clear();
  document.getElementById('msgs').classList.add('selecting');
  toggleSelect(mid);
}

function cancelSelect() {
  if (!selecting && !selectedIds.size) return;
  selecting = false;
  selectedIds.clear();
  document.getElementById('msgs').classList.remove('selecting');
  syncSelection();
}

let _lpTimer = null;
document.getElementById('msgs').addEventListener('touchstart', e => {
  const row = e.target.closest('.mrow');
  if (!row || selecting) return;
  const mid = +row.dataset.mid;
  _lpTimer = setTimeout(() => {
    _lpTimer = null;
    if (navigator.vibrate) navigator.vibrate(15);
    const r = row.getBoundingClientRect();
    const px = Math.max(8, Math.min(r.right - 8, window.innerWidth - 230));
    const py = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 320));
    openMsgActions(mid, px, py);
  }, 420);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
  document.getElementById('msgs').addEventListener(ev, () => {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  }, { passive: true }));

function selectAllMine() {
  selectedIds.clear();
  (CD.initialMessages || []).forEach(m => {
    if (!m.deleted && m.sender_id === window.ME.id && m.msg_type !== 'system') selectedIds.add(m.id);
  });
  syncSelection();
}

let _convLpTimer = null;
const convSections = document.getElementById('convSections');
if (convSections) {
  convSections.addEventListener('touchstart', e => {
    const conv = e.target.closest('.conv');
    if (!conv || conv.id === 'newNotesBtn') return;
    _convLpTimer = setTimeout(() => {
      _convLpTimer = null;
      if (navigator.vibrate) navigator.vibrate(15);
      const r = conv.getBoundingClientRect();
      const px = Math.max(8, Math.min(r.left, window.innerWidth - 240));
      const py = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 320));
      openConvActions(conv, px, py);
    }, 480);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
    convSections.addEventListener(ev, () => {
      if (_convLpTimer) { clearTimeout(_convLpTimer); _convLpTimer = null; }
    }, { passive: true }));
}

function localDeleteMid(mid) {
  const m = (CD.initialMessages || []).find(x => x.id === mid);
  if (m) m.deleted = true;
  const row = document.querySelector(`#m${mid}`) || document.querySelector(`.mrow[data-mid="${mid}"]`) || document.querySelector(`.sys-msg[data-mid="${mid}"]`);
  if (row) {
    const wrap = row.classList.contains('mrow') ? row.closest('#m' + mid) || row : row;
    wrap.remove();
  }
  if ((CD.pins || []).some(p => +p.id === +mid)) loadPinned();
}

function syncPinRows(ids) {
  const set = new Set((ids || []).map(Number));
  (CD.initialMessages || []).forEach(x => { x.pinned = set.has(+x.id); });
  document.querySelectorAll('.mrow[data-mid]').forEach(r => {
    const b = r.querySelector('.bubble');
    if (!b) return;
    const on = set.has(+r.dataset.mid);
    b.classList.toggle('pinned', on);
    const meta = b.querySelector('.m-meta');
    if (!meta) return;
    const tag = meta.querySelector('.pin-tag');
    if (on && !tag) meta.insertAdjacentHTML('afterbegin', `<span class="pin-tag">${bi('pin-angle-fill')} پین شده</span>`);
    else if (!on && tag) tag.remove();
  });
}
function localSetPin(mid, pinned) {
  CD.pins = (CD.pins || []).filter(p => +p.id !== +mid);
  if (pinned) {
    const m = (CD.initialMessages || []).find(x => x.id === mid);
    if (m) { m.pinned = true; CD.pins.unshift({ id: mid, m, sender: getMember(m.sender_id) }); }
  }
  syncPinRows(CD.pins.map(p => p.id));
  loadPinned();
}

function localReact(mid, emoji) {
  const m = (CD.initialMessages || []).find(x => x.id === mid);
  if (!m) return;
  if (!m.reactions) m.reactions = {};
  const key = String(window.ME.id);
  if (m.reactions[key] === emoji) delete m.reactions[key];
  else m.reactions[key] = emoji;
  m.my_reaction = m.reactions[key];
  const chip = document.querySelector(`.mrow[data-mid="${mid}"] .reactions`);
  if (chip) chip.innerHTML = reactionChips(m);
}

async function bulkDelete() {
  const ids = [...selectedIds];
  const r = await api('/api/message/bulk-delete', { ids });
  if (r.ok) {
    toast(r.deleted + ' پیام حذف شد');
    cancelSelect();
    const rr = await fetch('/api/messages/' + currentChat);
    CD.initialMessages = (await rr.json()).messages;
    document.getElementById('msgsBody').innerHTML = '';
    renderAllMessages();
    attachMore();
  } else toast(r.error, 'error');
}

async function bulkCopy() {
  const msgs = (CD.initialMessages || []).filter(m => selectedIds.has(m.id) && !m.deleted);
  const text = msgs.map(m => m.msg_type === 'text' ? m.content
    : m.msg_type === 'image' ? '[تصویر]' : m.msg_type === 'gif' ? '[گیف]'
    : m.msg_type === 'video' ? '[ویدیو]' : m.msg_type === 'audio' ? '[پیام صوتی]'
    : m.msg_type === 'poll' ? '[نظرسنجی]' : '[فایل]').join('\n');
  if (!text) return toast('چیزی برای کپی نیست', 'error');
  try { await copyText(text); toast(msgs.length + ' پیام کپی شد'); }
  catch (e) { toast('کپی نشد', 'error'); }
}

document.getElementById('bulkDelete').onclick = bulkDelete;
document.getElementById('bulkCancel').onclick = cancelSelect;
document.getElementById('bulkAllMine').onclick = selectAllMine;
document.getElementById('bulkCopy').onclick = bulkCopy;

function pinSnippet(m) {
  if (m.msg_type === 'image') return m.content || 'تصویر';
  if (m.msg_type === 'video') return m.content || 'ویدیو';
  if (m.msg_type === 'gif') return m.content || 'گیف';
  if (m.msg_type === 'audio') return m.content || 'پیام صوتی';
  if (m.msg_type === 'file') return m.file_name || 'فایل';
  return m.content || 'پیام';
}
function pinThumb(m) {
  if (m.msg_type === 'image' && m.file_url) return `<img class="pin-thumb" src="${m.file_url}" alt="">`;
  if (m.msg_type === 'gif' && /\.gif$/i.test(m.file_name || '') && m.file_url) return `<img class="pin-thumb" src="${m.file_url}" alt="">`;
  if (m.msg_type === 'video' && m.file_url) return `<span class="pin-vid">${bi('camera-reels')}</span>`;
  if (m.msg_type === 'gif' && m.file_url) return `<span class="pin-vid">${bi('camera-reels')}</span>`;
  return '';
}
function renderPinnedBar() {
  const bar = document.getElementById('pinnedBar');
  if (!currentChat) return;
  CD.pins = CD.pins || [];
  if (!CD.pins.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const p = CD.pins[0];
  const moreChip = CD.pins.length > 1
    ? `<span class="pin-count" title="${CD.pins.length} پیام پین شده">${CD.pins.length}</span>` : '';
  bar.innerHTML = `<span class="pin-bar-icon">${bi('pin-angle-fill')}</span>${pinThumb(p.m)}<span class="pin-bar-text"><b>${esc((p.sender || {}).display_name || 'کاربر')}</b><span>${esc(pinSnippet(p.m))}</span></span>${moreChip}<button class="pin-unpin" data-unpin="${p.id}" title="لغو پین">${bi('x-lg')}</button>`;
  bar.style.display = 'flex';
  bar.querySelector('.pin-bar-text').onclick = () => {
    if (CD.pins.length > 1) openPinsModal();
    else jumpToMessage(p.id);
  };
  bar.querySelector('[data-unpin]').onclick = () => {
    const id = +document.querySelector('#pinnedBar [data-unpin]').dataset.unpin;
    localSetPin(id, false);
    api('/api/message/pin', { message_id: id }).then(j => {
      if (!j.ok) { loadPinned(); toast(j.error || 'لغو پین نشد', 'error'); }
    });
  };
}
function canClearAllPins() {
  if (!CD.chat) return false;
  if (CD.chat.chat_type === 'dm') return true;
  return !!(window.ME && window.ME.is_admin) || ['owner', 'admin'].includes(CD.role || '');
}
function openPinsModal() {
  CD.pins = CD.pins || [];
  const list = document.getElementById('pinsList');
  document.getElementById('pinsModalSub').textContent = CD.pins.length + ' پیام پین شده';
  list.innerHTML = CD.pins.map(p => {
    const ic = p.m.msg_type === 'image' ? 'image' : p.m.msg_type === 'video' ? 'camera-reels'
      : p.m.msg_type === 'gif' ? 'image'
      : p.m.msg_type === 'audio' ? 'headphones' : p.m.msg_type === 'file' ? 'paperclip' : 'chat-dots';
    const t = p.m.created_at ? fmtTime(p.m.created_at) : '';
    return `<div class="pin-item" data-pid="${p.id}">
      <span class="pin-item-ic">${bi(ic)}</span>
      <span class="pin-item-body"><b>${esc((p.sender || {}).display_name || 'کاربر')}</b><span>${esc(pinSnippet(p.m))}</span><em>${esc(t)}</em></span>
      <button class="pin-item-btn" data-jump="${p.id}" title="رفتن به پیام">${bi('chevron-down')}</button>
      <button class="pin-item-btn danger" data-unpin="${p.id}" title="لغو پین">${bi('pin-angle')}</button>
    </div>`;
  }).join('');
  document.getElementById('pinsClearRow').style.display = canClearAllPins() ? '' : 'none';
  list.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
    document.getElementById('pinsModal').classList.remove('show');
    jumpToMessage(+b.dataset.jump);
  });
  list.querySelectorAll('[data-unpin]').forEach(b => b.onclick = () => {
    const id = +b.dataset.unpin;
    localSetPin(id, false);
    api('/api/message/pin', { message_id: id }).then(j => {
      if (!j.ok) { loadPinned(); toast(j.error || 'لغو پین نشد', 'error'); }
      else if (CD.pins.length) openPinsModal();
      else document.getElementById('pinsModal').classList.remove('show');
    });
  });
  document.getElementById('pinsClearAll').onclick = async () => {
    const j = await api('/api/chat/' + currentChat + '/pins/clear', {});
    if (j.ok) {
      toast((j.cleared || 0) + ' پین حذف شد');
      document.getElementById('pinsModal').classList.remove('show');
      loadPinned();
    } else toast(j.error || 'حذف نشد', 'error');
  };
  document.getElementById('pinsModal').classList.add('show');
}
let pinSeq = 0;
async function loadPinned() {
  if (!currentChat) return;
  const my = ++pinSeq;
  const r = await fetch('/api/chat/' + currentChat + '/pinned');
  if (!r.ok || my !== pinSeq) return; 
  const j = await r.json();
  CD.pins = (j.pins || []).map(p => ({ id: p.m.id, m: p.m, sender: p.sender }));
  syncPinRows(CD.pins.map(p => p.id));
  renderPinnedBar();
}

document.getElementById('btnSend').onclick = sendText;
document.getElementById('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
  if (e.key === 'Escape') {
    typingSent = false;
    clearTimeout(typingSelfTimer);
    S.emit('stop_typing', { chat_id: currentChat });
  }
});
document.getElementById('msgInput').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
  if (!currentChat) return;
  queueDraftSave();
  if (!typingSent) {
    S.emit('typing', { chat_id: currentChat });
    typingSent = true;
  }
  clearTimeout(typingSelfTimer);
  typingSelfTimer = setTimeout(() => {
    if (typingSent) {
      typingSent = false;
      S.emit('stop_typing', { chat_id: currentChat });
    }
  }, 3000);
});

document.getElementById('btnAttach').onclick = e => { e.stopPropagation(); toggleAttachMenu(); };

const attachMenu = document.getElementById('attachMenu');
const attachBtn = document.getElementById('btnAttach');
function openAttachMenu() {
  attachMenu.classList.add('show');
  const r = attachBtn.getBoundingClientRect();
  const mh = attachMenu.offsetHeight;
  const isMobile = window.matchMedia('(max-width: 860px)').matches;
  if (isMobile) {
    attachMenu.style.top = Math.max(12, r.top - mh - 12) + 'px';
    return;
  }
  const mw = attachMenu.offsetWidth;
  let left = r.left + r.width / 2 - mw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.top - mh - 10;
  if (top < 8) top = r.bottom + 10;
  attachMenu.style.left = left + 'px';
  attachMenu.style.top = top + 'px';
}
function closeAttachMenu() { attachMenu.classList.remove('show'); }
function toggleAttachMenu() {
  attachMenu.classList.contains('show') ? closeAttachMenu() : openAttachMenu();
}
document.addEventListener('click', e => {
  if (!e.target.closest('#attachMenu') && !e.target.closest('#btnAttach')) closeAttachMenu();
});
attachMenu.querySelectorAll('[data-attach]').forEach(it => {
  it.addEventListener('click', () => {
    const kind = it.dataset.attach;
    closeAttachMenu();
    if (kind === 'poll') {
      document.getElementById('btnPoll').onclick();
      return;
    }
    const input = document.getElementById('fileInput');
    input.removeAttribute('capture');
    if (kind === 'media') input.accept = 'image/*,video/*';
    else if (kind === 'camera') { input.accept = 'image/*'; input.setAttribute('capture', 'environment'); }
    else input.accept = '';
    input.click();
  });
});

function apItemIcon(f) {
  return f.kind === 'image' ? '' : f.kind === 'video' ? bi('camera-reels')
    : f.kind === 'gif' ? (f.vid ? bi('camera-reels') : '')
    : f.kind === 'audio' ? bi('headphones') : bi(fileIcon(f.name));
}
function renderAttachPreview() {
  const pv = document.getElementById('attachPreview');
  const c = document.querySelector('.composer');
  if (c) c.classList.remove('recording');
  if (recState) { renderRecBar(); return; }
  if (!pendingFiles.length) {
    pv.classList.remove('show');
    pv.innerHTML = '';
    return;
  }
  const rows = pendingFiles.map(f => {
    if (f.status === 'uploading') {
      if (f.forceKind === 'audio') {
        const n = 36;
        const peaks = f.peaks || pseudoPeaks(f.id, n);
        const cut = Math.round(f.progress / 100 * n);
        const bars = peaks.map((p, i) => `<i class="${i < cut ? 'on' : ''}" style="height:${Math.round(3 + p * 24)}px"></i>`).join('');
        return `<div class="ap-item ap-voice uploading" id="apItem${f.id}" data-vid="${f.id}">
          <button class="ap-play" data-play="${f.id}" title="پخش">${bi('hourglass-split')}</button>
          <span class="ap-vwave">${bars}</span>
          <span class="ap-vtime">${f.progress}%</span>
          <button class="ap-x" data-rm="${f.id}" title="لغو آپلود">${bi('x-lg')}</button>
        </div>`;
      }
      return `<div class="ap-item uploading" id="apItem${f.id}">
        <span class="ap-ic">${bi('hourglass-split')}</span>
        <span class="fname">${esc(f.name)}</span>
        <span class="ap-progress" title="در حال آپلود"><span class="ap-bar" style="width:${f.progress}%"></span><span class="ap-pct">${f.progress}%</span></span>
        <button class="ap-x" data-rm="${f.id}" title="لغو آپلود">${bi('x-lg')}</button>
      </div>`;
    }
    if (f.forceKind === 'audio') {
      return `<div class="ap-item ap-voice" id="apItem${f.id}" data-vid="${f.id}">
        <button class="ap-play" data-play="${f.id}" title="پخش">${bi('play-fill')}</button>
        <span class="ap-vwave">${voicePeaksHtml(f)}</span>
        <span class="ap-vtime">${f.secs ? fmtRec(f.secs) : ''}</span>
        <button class="ap-x" data-rm="${f.id}" title="حذف">${bi('x-lg')}</button>
      </div>`;
    }
    const thumb = (f.kind === 'image' || f.kind === 'gif') && !f.vid && f.url
      ? `<img src="${esc(f.url)}" alt="">`
      : `<span class="ap-ic">${apItemIcon(f)}</span>`;
    const size = f.size ? `<small>${fmtSize(f.size)}</small>` : '';
    const asFileBtn = ['image', 'video', 'gif'].includes(f.kind)
      ? `<button class="ap-asfile ${f.asFile ? 'on' : ''}" data-asfile="${f.id}" title="ارسال به‌عنوان فایل (دانلود)">${bi('download')} فایل</button>`
      : '';
    return `<div class="ap-item ready" id="apItem${f.id}">
      ${thumb}<span class="fname">${esc(f.name)}${size}</span>${asFileBtn}
      <button class="ap-x" data-rm="${f.id}" title="حذف">${bi('x-lg')}</button>
    </div>`;
  }).join('');
  pv.innerHTML = rows;
  pv.classList.add('show');
}

function pseudoPeaks(seed, n) {
  const out = [];
  let s = ((seed * 2654435761) >>> 0) || 7;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push(0.25 + 0.75 * Math.abs(Math.sin(s / 1073741824 + i * 0.85)));
  }
  return out;
}
const vcCache = new Map();
let vcMpMid = null;
const vcSpeeds = [1, 1.5, 2];
function vcWaveHtml(mid) {
  const st = vcCache.get(mid);
  const peaks = (st && st.peaks) ? st.peaks : pseudoPeaks(mid, 36);
  return peaks.map(p => `<i style="height:${Math.round(2 + p * 22)}px"></i>`).join('');
}
function vcFindCard(mid) { return document.querySelector(`.voice-card[data-mid="${mid}"]`); }
function vcPaint(mid) {
  const st = vcCache.get(mid);
  const card = vcFindCard(mid);
  if (!st || !card) return;
  if (st.peaks) card.querySelector('.vc-wave').innerHTML = vcWaveHtml(mid);
  const dur = card.querySelector('.vc-dur');
  if (dur && st.dur) dur.textContent = fmtRec(Math.round(st.dur));
  vcPaintSpeed(mid);
}
function ensureVoiceMeta(m, title) {
  if (!m || !m.file_url) return;
  if (!vcCache.has(m.id)) {
    if (vcCache.size > 200) {
      for (const k of vcCache.keys()) {
        const old = vcCache.get(k);
        if (!old || !old.audio) { vcCache.delete(k); break; }
      }
    }
    vcCache.set(m.id, { url: m.file_url, peaks: null, dur: 0, audio: null, speed: 1, title: title || 'پیام صوتی' });
  }
  const st = vcCache.get(m.id);
  if (!st.audio) {
    fetch(m.file_url).then(r => r.arrayBuffer()).then(buf => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      return ctx.decodeAudioData(buf).then(dec => {
        st.dur = dec.duration;
        const data = dec.getChannelData(0);
        const n = 36;
        const step = Math.max(1, Math.floor(data.length / n));
        st.peaks = [];
        for (let i = 0; i < n; i++) {
          let mx = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 32) {
            const v = Math.abs(data[j]);
            if (v > mx) mx = v;
          }
          st.peaks.push(mx < 0.02 ? 0.06 : mx);
        }
        ctx.close();
        vcPaint(m.id);
      });
    }).catch(() => {});
  }
}
function vcSpeedLabel(s) { return (s === 1 ? '1' : s) + 'x'; }
function vcPaintSpeed(mid) {
  const st = vcCache.get(mid);
  if (!st) return;
  const label = vcSpeedLabel(st.speed);
  document.querySelectorAll(`.vc-speed[data-mid="${mid}"]`).forEach(el => {
    el.textContent = label;
    el.classList.toggle('on', st.speed !== 1);
  });
  if (vcMpMid === mid) {
    const el = document.getElementById('mpSpeed');
    if (el) el.textContent = label;
  }
}
function vcEnsureAudio(mid) {
  const st = vcCache.get(mid);
  if (!st || !st.url) return null;
  if (!st.audio) {
    const a = new Audio(st.url);
    st.audio = a;
    a.playbackRate = st.speed;
    a.addEventListener('timeupdate', () => vcPaintProgress(mid));
    a.addEventListener('ended', () => vcOnEnded(mid));
  }
  return st.audio;
}
function vcResetVisuals(mid) {
  const card = vcFindCard(mid);
  if (!card) return;
  card.querySelectorAll('.vc-wave i').forEach(b => b.classList.remove('on'));
  const cur = card.querySelector('.vc-cur');
  if (cur) cur.textContent = '0:00';
  const btn = card.querySelector('.vc-play');
  if (btn) btn.innerHTML = bi('play-fill');
}
function vcOnEnded(mid) {
  const st = vcCache.get(mid);
  if (!st) return;
  st.audio = null;
  vcResetVisuals(mid);
  if (vcMpMid === mid) vcMpHide();
}
function vcPaintProgress(mid) {
  const st = vcCache.get(mid);
  if (!st) return;
  const a = st.audio;
  const t = a ? (a.currentTime || 0) : 0;
  const d = (a && a.duration && isFinite(a.duration) ? a.duration : 0) || st.dur;
  const card = vcFindCard(mid);
  if (card) {
    const bars = card.querySelectorAll('.vc-wave i');
    const cut = d ? Math.round(t / d * bars.length) : 0;
    bars.forEach((b, i) => b.classList.toggle('on', i < cut));
    const cur = card.querySelector('.vc-cur');
    if (cur) cur.textContent = fmtRec(Math.floor(t || 0));
  }
  if (vcMpMid === mid) vcMpPaint();
}
function toggleVoiceCard(mid) {
  const st = vcCache.get(mid);
  if (!st || !st.url) return;
  const a = vcEnsureAudio(mid);
  if (!a) return;
  if (!a.paused) {
    a.pause();
    const card = vcFindCard(mid);
    if (card) card.querySelector('.vc-play').innerHTML = bi('play-fill');
    vcMpIcon();
    return;
  }
  a.playbackRate = st.speed;
  vcCache.forEach((o, oid) => {
    if (oid === mid || !o.audio || o.audio.paused) return;
    try { o.audio.pause(); } catch (_) {}
    o.audio = null;
    vcResetVisuals(oid);
    if (vcMpMid === oid) vcMpHide();
  });
  a.play().then(() => {
    const card = vcFindCard(mid);
    if (card) card.querySelector('.vc-play').innerHTML = bi('pause-fill');
    vcMpShow(mid);
  }).catch(() => {});
}
function vcCycleSpeed(mid) {
  const st = vcCache.get(mid);
  if (!st) return;
  st.speed = vcSpeeds[(vcSpeeds.indexOf(st.speed) + 1) % vcSpeeds.length];
  if (st.audio) st.audio.playbackRate = st.speed;
  vcPaintSpeed(mid);
}
function vcSeekRatio(e, wave) {
  const r = wave.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}
function vcDoSeek(mid, pr) {
  const st = vcCache.get(mid);
  if (!st) return;
  const a = vcEnsureAudio(mid);
  if (!a) return;
  const d = (a.duration && isFinite(a.duration) && a.duration > 0) ? a.duration : st.dur;
  if (!d) return;
  a.currentTime = d * pr;
  a.pause();
  vcPaintProgress(mid);
}
let vcSeeking = null;
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest) return;
  const wave = e.target.closest('.vc-wave');
  if (!wave || !wave.dataset.vcwave) return;
  vcSeeking = wave;
  e.preventDefault();
  try { wave.setPointerCapture(e.pointerId); } catch (_) {}
  vcDoSeek(Number(wave.dataset.vcwave), vcSeekRatio(e, wave));
}, true);
document.addEventListener('pointermove', (e) => {
  if (!vcSeeking) return;
  const wave = (e.target.closest && e.target.closest('.vc-wave')) || vcSeeking;
  if (!wave || !wave.dataset.vcwave) return;
  vcDoSeek(Number(wave.dataset.vcwave), vcSeekRatio(e, wave));
});
document.addEventListener('pointerup', () => { vcSeeking = null; });
document.addEventListener('pointercancel', () => { vcSeeking = null; });
document.addEventListener('click', (e) => {
  const sp = e.target.closest ? e.target.closest('.vc-speed') : null;
  if (sp && sp.dataset.mid) { e.preventDefault(); e.stopPropagation(); vcCycleSpeed(Number(sp.dataset.mid)); }
});
function vcMpShow(mid) {
  vcMpMid = mid;
  const el = document.getElementById('voiceMp');
  if (!el) return;
  el.classList.add('on');
  const st = vcCache.get(mid);
  const t = document.getElementById('mpTitle');
  if (t) t.textContent = (st && st.title) || 'پیام صوتی';
  vcMpIcon();
  vcPaintSpeed(mid);
  vcMpPaint();
}
function vcMpHide() {
  vcMpMid = null;
  const el = document.getElementById('voiceMp');
  if (el) el.classList.remove('on');
}
function vcMpIcon() {
  if (vcMpMid == null) return;
  const st = vcCache.get(vcMpMid);
  const b = document.getElementById('mpToggle');
  if (b) b.innerHTML = bi(st && st.audio && !st.audio.paused ? 'pause-fill' : 'play-fill');
}
function vcMpPaint() {
  if (vcMpMid == null) return;
  const st = vcCache.get(vcMpMid);
  const a = st.audio;
  const d = (a && a.duration && isFinite(a.duration) ? a.duration : 0) || st.dur;
  const t = a ? (a.currentTime || 0) : 0;
  const time = document.getElementById('mpTime');
  if (time) time.textContent = fmtRec(Math.floor(t)) + ' / ' + fmtRec(Math.floor(d || 0));
  const s = document.getElementById('mpSeek');
  if (s) s.value = d ? Math.round(t / d * 1000) : 0;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest) return;
  const tg = e.target.closest('#mpToggle');
  if (tg) {
    e.preventDefault();
    if (vcMpMid != null) toggleVoiceCard(vcMpMid);
    return;
  }
  const cl = e.target.closest('#mpClose');
  if (cl) {
    e.preventDefault();
    if (vcMpMid == null) return;
    const st = vcCache.get(vcMpMid);
    if (st && st.audio) { try { st.audio.pause(); } catch (_) {} st.audio = null; }
    vcResetVisuals(vcMpMid);
    vcMpHide();
    return;
  }
  const spd = e.target.closest('#mpSpeed');
  if (spd) {
    e.preventDefault();
    if (vcMpMid != null) vcCycleSpeed(vcMpMid);
  }
});
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'mpSeek' && vcMpMid != null) {
    const st = vcCache.get(vcMpMid);
    if (!st) return;
    const a = vcEnsureAudio(vcMpMid);
    const d = (a && a.duration && isFinite(a.duration) ? a.duration : 0) || st.dur;
    if (!a || !d) return;
    a.currentTime = d * (Number(e.target.value) / 1000);
    vcPaintProgress(vcMpMid);
  }
});
function voicePeaksHtml(f) {
  const n = 36;
  const peaks = (f.peaks && f.peaks.length === n) ? f.peaks : pseudoPeaks(f.id, n);
  return peaks.map(p => `<i style="height:${Math.round(3 + p * 24)}px"></i>`).join('');
}
function analyzePeaks(f) {
  return new Promise(resolve => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      f.file.arrayBuffer().then(buf => ctx.decodeAudioData(buf)).then(audio => {
        const data = audio.getChannelData(0);
        const n = 36;
        const step = Math.max(1, Math.floor(data.length / n));
        const peaks = [];
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) {
            const v = Math.abs(data[j]);
            if (v > m) m = v;
          }
          peaks.push(m < 0.02 ? 0.06 : m);
        }
        ctx.close();
        resolve(peaks);
      }).catch(() => resolve(null));
    } catch (_) { resolve(null); }
  });
}
function paintVoiceProgress(it, pr) {
  const row = document.querySelector(`[data-vid="${it.id}"]`);
  if (!row) return;
  const bars = row.querySelectorAll('.ap-vwave i');
  const cut = Math.round(pr * bars.length);
  bars.forEach((b, i) => b.classList.toggle('on', i < cut));
}
function toggleVoicePreview(it, btn) {
  if (it.audioEl) {
    try { it.audioEl.pause(); } catch (_) {}
    it.audioEl = null;
    btn.classList.remove('playing');
    btn.innerHTML = bi('play-fill');
    paintVoiceProgress(it, 0);
    return;
  }
  if (!it.url) { toast('صبر کن تا آپلود تموم شه', 'error'); return; }
  const a = new Audio(it.url);
  it.audioEl = a;
  btn.classList.add('playing');
  btn.innerHTML = bi('pause-fill');
  a.ontimeupdate = () => {
    const pr = a.duration && isFinite(a.duration) && a.duration > 0 ? a.currentTime / a.duration : 0;
    paintVoiceProgress(it, pr);
  };
  a.onended = () => {
    it.audioEl = null;
    paintVoiceProgress(it, 0);
    const b = document.querySelector(`[data-play="${it.id}"]`);
    if (b) { b.classList.remove('playing'); b.innerHTML = bi('play-fill'); }
  };
  a.play().catch(() => {});
}

function removePendingFile(id, silent) {
  const it = pendingFiles.find(f => f.id === id);
  if (it && it.xhr && it.status === 'uploading') { try { it.xhr.abort(); } catch (_) {} }
  if (it && it.audioEl) { try { it.audioEl.pause(); } catch (_) {} }
  pendingFiles = pendingFiles.filter(f => f.id !== id);
  renderAttachPreview();
}
function uploadFile(item) {
  const fd = new FormData();
  fd.append('file', item.file, item.name);
  if (item.forceKind) fd.append('kind', item.forceKind);
  item.xhr = new XMLHttpRequest();
  item.xhr.open('POST', '/api/upload');
  item.xhr.upload.addEventListener('progress', e => {
    if (!e.lengthComputable) return;
    item.progress = Math.min(99, Math.round(e.loaded * 100 / e.total));
    const row = document.getElementById('apItem' + item.id);
    if (!row) return;
    const bar = row.querySelector('.ap-bar'); if (bar) bar.style.width = item.progress + '%';
    const pct = row.querySelector('.ap-pct'); if (pct) pct.textContent = item.progress + '%';
    const vw = row.querySelector('.ap-vwave');
    if (vw) {
      const bars = vw.querySelectorAll('i');
      const cut = Math.round(item.progress / 100 * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i < cut));
      const vt = row.querySelector('.ap-vtime'); if (vt) vt.textContent = item.progress + '%';
    }
  });
  const done = (r) => {
    if (r && r.ok) {
      item.status = 'ready';
      item.path = r.file_path; item.kind = r.kind; item.url = r.file_url;
      item.name = r.file_name || item.name;
      renderAttachPreview();
      if (item.autoSend) {
        item.autoSend = false;
        sendText(undefined);
      } else {
        document.getElementById('msgInput').focus();
      }
    } else {
      toast((r && r.error) || 'آپلود ناموفق بود', 'error');
      removePendingFile(item.id, true);
    }
  };
  item.xhr.onload = () => { let r = null; try { r = JSON.parse(item.xhr.responseText); } catch (_) {} done(r); };
  item.xhr.onerror = () => { toast('آپلود ناموفق بود', 'error'); removePendingFile(item.id, true); };
  item.xhr.onabort = () => { renderAttachPreview(); };
  item.xhr.send(fd);
}
function enqueueFiles(list, opts) {
  const files = Array.from(list || []);
  if (!files.length) return;
  for (const f of files) {
    if (!f || !f.name) continue;
    if (f.size > 50 * 1024 * 1024) { toast('حجم هر فایل حداکثر ۵۰ مگابایت است', 'error'); continue; }
    const item = {
      id: ++_pfSeq, file: f, name: f.name, size: f.size,
      status: 'uploading', progress: 0, asFile: false, xhr: null,
      forceKind: opts && opts.forceKind,
      autoSend: !!(opts && opts.autoSend),
    };
    pendingFiles.push(item);
    uploadFile(item);
  }
  renderAttachPreview();
}
function handleFiles(file, opts) { enqueueFiles([file], opts); }

document.getElementById('fileInput').onchange = e => {
  const files = e.target.files;
  e.target.value = '';
  if (files && files.length) enqueueFiles(files);
};
document.addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    removePendingFile(Number(rm.dataset.rm));
    return;
  }
  const af = e.target.closest('[data-asfile]');
  if (af) {
    const it = pendingFiles.find(f => f.id === Number(af.dataset.asfile));
    if (it) { it.asFile = !it.asFile; af.classList.toggle('on'); }
  }
  const pl = e.target.closest('[data-play]');
  if (pl) {
    const it = pendingFiles.find(f => f.id === Number(pl.dataset.play));
    if (it) toggleVoicePreview(it, pl);
  }
  const vc = e.target.closest('.vc-play');
  if (vc) {
    const card = vc.closest('.voice-card');
    if (card) toggleVoiceCard(Number(card.dataset.mid));
  }
  const rec = e.target.closest('[data-rec]');
  if (rec) finishRec(rec.dataset.rec === 'stop');
});

const dropZone = document.getElementById('app') || document.body;
['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
  if (!currentChat || !e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
  if (ev === 'dragleave' && e.target !== dropZone) return;
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', e => {
  if (!currentChat) return;
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  e.preventDefault();
  enqueueFiles(files);
});
document.getElementById('msgInput').addEventListener('paste', e => {
  if (!currentChat) return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) { e.preventDefault(); handleFiles(f); return; }
    }
  }
});

document.getElementById('btnMic').onclick = e => {
  e.stopPropagation();
  if (recState) return;
  startRec();
};
async function startRec() {
  if (!currentChat) {
    toast('اول یک گپ رو باز کن', 'error');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند', 'error');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    toast('دسترسی به میکروفون لازم است', 'error');
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (_) {
    stream.getTracks().forEach(t => t.stop());
    toast('ضبط صدا ممکن نشد', 'error');
    return;
  }
  recState = { rec, stream, mime, chunks: [], secs: 0, started: Date.now() };
  rec.ondataavailable = e => { if (e.data && e.data.size) recState.chunks.push(e.data); };
  rec.start(250);
  const msgInp = document.getElementById('msgInput');
  if (msgInp) msgInp.blur();
  recState.int = setInterval(() => {
    if (!recState) return;
    recState.secs = Math.floor((Date.now() - recState.started) / 1000);
    const el = document.getElementById('recTime');
    if (el) el.textContent = fmtRec(recState.secs);
  }, 250);
  renderRecBar();
}
function fmtRec(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function renderRecBar() {
  const pv = document.getElementById('attachPreview');
  const c = document.querySelector('.composer');
  if (c) c.classList.add('recording');
  pv.innerHTML =
    `<div class="rec-bar">
       <span class="rec-state">
         <span class="rec-dot"></span>
         <span class="rec-time" id="recTime">0:00</span>
       </span>
       <span class="rec-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
       <button class="rec-x" data-rec="cancel" title="لغو ضبط">${bi('x-lg')}</button>
       <button class="rec-stop" data-rec="stop" title="توقف و ارسال پیام صوتی"><span class="rec-ring"></span><span class="rec-ring r2"></span>${bi('stop')}</button>
     </div>`;
  pv.classList.add('show');
}
function finishRec(keep) {
  if (!recState) return;
  const st = recState;
  recState = null;
  clearInterval(st.int);
  st.stream.getTracks().forEach(t => t.stop());
  st.rec.stop();
  const onStopped = () => {
    if (keep) {
      const secs = Math.floor((Date.now() - st.started) / 1000);
      const blob = new Blob(st.chunks, { type: st.mime || 'audio/webm' });
      if (blob.size < 2048) {
        toast('ضبط خیلی کوتاه بود', 'error');
        renderAttachPreview();
        return;
      }
      const ext = (st.mime || '').includes('mp4') ? 'm4a' : (st.mime || '').includes('ogg') ? 'ogg' : 'webm';
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
      const f = new File([blob], `voice-${stamp}.${ext}`, { type: blob.type });
      enqueueFiles([f], { forceKind: 'audio', autoSend: true });
      const it = pendingFiles.find(x => x.name === f.name);
      if (it) {
        it.secs = secs;
        analyzePeaks(it).then(p => {
          if (!p) return;
          const cur = pendingFiles.find(x => x.id === it.id);
          if (cur) { cur.peaks = p; renderAttachPreview(); }
        });
      }
    }
    renderAttachPreview();
  };
  st.rec.onstop = onStopped;
}

const MV = { items: [], index: 0, kind: 'image', canDelete: false, ownerType: null, ownerId: null, onDeleted: null };

function openMediaViewer(src, kind, name, items, index, opts) {
  if (!src && !(items && items.length)) return;
  opts = opts || {};
  MV.items = (items && items.length > 1) ? items : [{ src: src, name: name }];
  MV.index = (items && items.length > 1 && index != null) ? index : 0;
  MV.kind = kind || 'image';
  MV.canDelete = !!opts.canDelete;
  MV.ownerType = opts.ownerType || null;
  MV.ownerId = opts.ownerId || null;
  MV.onDeleted = opts.onDeleted || null;
  MV.render();
  document.getElementById('mediaViewer').classList.add('show');
}
MV.render = function () {
  const it = MV.items[MV.index] || { src: '', name: '' };
  const src = it.src || '';
  const stage = document.getElementById('mvStage');
  stage.innerHTML = (MV.kind === 'video' && src)
    ? `<video src="${esc(src)}" controls autoplay playsinline></video>`
    : (MV.kind === 'gif' && src)
    ? `<video src="${esc(src)}" controls autoplay muted loop playsinline></video>`
    : `<img src="${esc(src)}" alt="${esc(it.name || '')}">`;
  document.getElementById('mvName').textContent = it.name || '';
  const dl = document.getElementById('mvDownload');
  dl.href = src; dl.setAttribute('download', it.name || '');
  const op = document.getElementById('mvOpen');
  op.href = src; op.style.display = (MV.kind === 'video' || MV.kind === 'gif' || !src) ? 'none' : '';
  const multi = MV.items.length > 1;
  document.getElementById('mvPrev').style.display = multi ? '' : 'none';
  document.getElementById('mvNext').style.display = multi ? '' : 'none';
  const count = document.getElementById('mvCount');
  count.style.display = multi ? '' : 'none';
  if (multi) count.textContent = (MV.index + 1) + ' / ' + MV.items.length;
  document.getElementById('mvDelete').style.display = (MV.canDelete && src && it.id) ? '' : 'none';
};
function mvStep(delta) {
  if (MV.items.length <= 1) return;
  MV.index = (MV.index + delta + MV.items.length) % MV.items.length;
  MV.render();
}
function closeMediaViewer() {
  const v = document.getElementById('mediaViewer');
  if (!v.classList.contains('show')) return;
  v.classList.remove('show');
  document.getElementById('mvStage').innerHTML = '';
}
document.getElementById('mvPrev').onclick = () => mvStep(-1);
document.getElementById('mvNext').onclick = () => mvStep(1);
document.getElementById('mvDelete').onclick = async () => {
  if (!MV.canDelete || !MV.ownerType) return;
  const it = MV.items[MV.index];
  if (!it || !it.id) return;
  const ep = MV.ownerType === 'user' ? '/api/avatar' : '/api/chat/' + MV.ownerId + '/avatar';
  const j = await fetch(ep, { method: 'POST', body: new URLSearchParams({ remove: String(it.id) }) }).then(r => r.json());
  if (!j.ok) { toast(j.error || 'حذف نشد', 'error'); return; }
  MV.items.splice(MV.index, 1);
  if (!MV.items.length) closeMediaViewer();
  else { MV.index = Math.min(MV.index, MV.items.length - 1); MV.render(); }
  if (MV.onDeleted) MV.onDeleted();
};

function setAvatarData(el, src, name, ownerType, ownerId) {
  if (src) {
    el.dataset.media = 'image'; el.dataset.src = src; el.dataset.name = name || '';
    if (ownerType && (ownerId || ownerId === 0)) {
      el.dataset.avatarType = ownerType; el.dataset.avatarId = String(ownerId);
    } else { delete el.dataset.avatarType; delete el.dataset.avatarId; }
  } else {
    delete el.dataset.media; delete el.dataset.src; delete el.dataset.name;
    delete el.dataset.avatarType; delete el.dataset.avatarId;
  }
}
function canManageChatAvatar(chatId) {
  if (window.ME.is_admin) return true;
  return currentChat === chatId && !!(CD.role && ['owner', 'admin'].includes(CD.role));
}
async function openAvatarSlideshow(ownerType, ownerId, ownerName, primarySrc) {
  const ep = ownerType === 'user' ? '/api/user/' + ownerId + '/avatars' : '/api/chat/' + ownerId + '/avatars';
  let list = [];
  try {
    const j = await fetch(ep).then(r => r.json());
    if (j.ok && Array.isArray(j.avatars)) list = j.avatars;
  } catch (e) { /* ignore; fall back to the single primary */ }
  if (!list.length && primarySrc) list = [{ url: primarySrc, id: null, is_primary: true }];
  if (!list.length) return;
  const items = list.map(a => ({ src: a.url, name: ownerName, id: a.id || null, primary: !!a.is_primary }));
  let idx = items.findIndex(a => a.primary); if (idx < 0) idx = 0;
  const canDelete = ownerType === 'user' ? (window.ME.id === +ownerId) : canManageChatAvatar(ownerId);
  openMediaViewer(items[idx].src, 'image', ownerName, items, idx, {
    canDelete: canDelete,
    ownerType: ownerType,
    ownerId: +ownerId,
    onDeleted: () => syncOwnerPrimary(ownerType, ownerId),
  });
}
function syncOwnerPrimary(ownerType, ownerId) {
  const ep = ownerType === 'user' ? '/api/avatar/all' : '/api/chat/' + ownerId + '/avatars';
  fetch(ep).then(r => r.json()).then(j => {
    if (!j.ok) return;
    const prim = j.avatars.find(a => a.is_primary) || j.avatars[0];
    const url = prim ? prim.url : '';
    if (ownerType === 'user' && window.ME.id === +ownerId) {
      window.ME.avatar = url;
      if (typeof refreshSideAvatar === 'function') refreshSideAvatar();
      const pm = document.getElementById('pmAvatar');
      if (pm && document.getElementById('myProfilePage').style.display !== 'none') {
        pm.innerHTML = avatarInner(window.ME.display_name, url);
      }
    }
    if (ownerType === 'chat' && currentChat === +ownerId) {
      const head = document.getElementById('chatHeadAvatar');
      if (head) { head.innerHTML = url ? '<img src="' + url + '" alt="">' : head.innerHTML; setAvatarData(head, url, '', 'chat', ownerId); }
      const cs = document.getElementById('csAvatar');
      if (cs) cs.innerHTML = url ? '<img src="' + url + '" alt="">' : cs.innerHTML;
    }
    if (typeof refreshConvList === 'function') refreshConvList();
  }).catch(() => {});
}

document.addEventListener('click', e => {
  const media = e.target.closest('[data-media]');
  if (media) {
    e.preventDefault();
    const ot = media.dataset.avatarType, oid = media.dataset.avatarId;
    if (ot && oid) openAvatarSlideshow(ot, oid, media.dataset.name, media.dataset.src);
    else openMediaViewer(media.dataset.src, media.dataset.media, media.dataset.name);
    return;
  }
  if (e.target.id === 'mvClose' || e.target.id === 'mediaViewer') closeMediaViewer();
  else if (e.target.id === 'mvStage' && MV.items.length <= 1) closeMediaViewer();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMediaViewer(); return; }
  if (document.getElementById('mediaViewer').classList.contains('show') && MV.items.length > 1) {
    if (e.key === 'ArrowRight') mvStep(1);
    else if (e.key === 'ArrowLeft') mvStep(-1);
  }
});

async function loadMembers(chatId) {
  const r = await fetch('/api/chat/' + chatId + '/members').then(x => x.json());
  renderMembers(r.members);
}

const PERM_LABELS = {
  send_messages: 'ارسال پیام',
  send_media: 'ارسال عکس و فایل',
  add_members: 'افزودن عضو',
  pin_messages: 'پین کردن پیام',
  delete_messages: 'حذف پیام دیگران',
  manage_members: 'مدیریت اعضا',
};

function renderMembers(members) {
  CD.members = members;
  const role = myRole();
  const canManage = role === 'owner' || role === 'admin' || !!window.ME.is_admin;
  const head = document.getElementById('csMembersHead');
  if (head) head.textContent = 'اعضا (' + members.length + ')';
  const meta = document.getElementById('csMeta');
  if (meta && CD.chat) {
    meta.textContent = (CD.chat.chat_type === 'channel' ? 'کانال' : 'گروه') + ' · ' + members.length + ' عضو';
  }
  const list = document.getElementById('csMembersList');
  if (!list) return;
  const addRow = canManage ? `
    <div class="mb-add">
      <input class="input ml-add-input" id="mlAddInput" placeholder="نام کاربری برای دعوت">
      <button class="btn sm primary" id="mlAddBtn">افزودن</button>
    </div>` : '';
  list.innerHTML = addRow + (members.map(m => {
    const isMe = m.id === window.ME.id;
    const badge = m.role === 'owner'
      ? `<span class="mb-role owner">${bi('star-fill')} مالک</span>`
      : m.role === 'admin'
        ? `<span class="mb-role admin">${bi('shield-fill')} مدیر</span>`
        : '';
    return `
    <div class="mb-item${isMe ? ' me' : ''}" data-mmember="${m.id}"${canManage && !isMe ? ' title="برای دیدن گزینه‌ها راست‌کلیک کن"' : ''}>
      <span class="avatar sm">${avatarInner(m.display_name, m.avatar, m.status === 'online')}</span>
      <div class="mb-info">
        <b>${esc(m.display_name)}${m.title ? ` <span class="member-title">${esc(m.title)}</span>` : ''}${isMe ? ' <span class="mb-you">شما</span>' : ''}</b>
        <small>@${esc(m.username)}${badge ? ' · ' + badge : ''}</small>
      </div>
    </div>`;
  }).join('') || '<div class="mb-empty">عضوی نیست</div>');

  const addBtn = document.getElementById('mlAddBtn');
  if (addBtn) addBtn.onclick = async () => {
    const uname = document.getElementById('mlAddInput').value.trim();
    if (!uname) return toast('نام کاربری رو بنویس', 'error');
    const sr = await fetch('/api/search?q=' + encodeURIComponent(uname)).then(x => x.json());
    const u = sr.users.find(x => x.username.toLowerCase() === uname.toLowerCase()) || sr.users[0];
    if (!u) return toast('کاربری با این نام پیدا نشد', 'error');
    api(`/api/chat/${currentChat}/members`, { action: 'add', user_id: u.id })
      .then(j => j.ok ? (toast(u.display_name + ' دعوت شد'), loadMembers(currentChat)) : toast(j.error, 'error'));
  };
}

function memberById(id) {
  return (CD.members || []).find(x => x.id === +id);
}

function isSiteAdmin() { return !!window.ME.is_admin; }

function openMemberMenu(m, x, y) {
  if (!m) return;
  const role = myRole();
  const isOwner = role === 'owner' || isSiteAdmin();
  const isAdmin = role === 'admin';
  const isMe = m.id === window.ME.id;
  if (isMe || (!isOwner && !isAdmin)) return;
  const canEditTarget = isOwner || (isAdmin && m.role === 'member');
  const items = [];
  if (canEditTarget) items.push({ label: 'ویرایش مجوزها', icon: bi('sliders'), fn: () => openMemberPerms(m) });
  if (isOwner && m.role === 'member') items.push({ label: 'ارتقا به مدیر', icon: bi('shield-fill'), fn: () => promoteMember(m) });
  if (isOwner && m.role === 'admin') items.push({ label: 'حذف از مدیران گروه', icon: bi('shield-slash'), fn: () => demoteMember(m) });
  if (isOwner && m.role !== 'owner') items.push({ label: 'انتقال مالکیت', icon: bi('star-fill'), danger: true, fn: () => transferOwnership(m) });
  if ((isOwner || isAdmin) && m.role !== 'owner') items.push({ label: 'حذف از گروه', icon: bi('trash'), danger: true, fn: () => kickMember(m) });
  if (!items.length) return;
  showCtxMenu(x, y, items);
}

function promoteMember(m) {
  openConfirm('ارتقا به مدیر', `«${m.display_name}» به مدیرهای گروه اضافه می‌شه`, () => {
    api(`/api/chat/${currentChat}/members`, { action: 'promote', user_id: m.id })
      .then(j => j.ok ? (toast('به مدیر ارتقا یافت'), loadMembers(currentChat)) : toast(j.error, 'error'));
  }, 'ارتقا');
}

function demoteMember(m) {
  openConfirm('حذف از مدیران', `«${m.display_name}» دیگه مدیر گروه نیست`, () => {
    api(`/api/chat/${currentChat}/members`, { action: 'demote', user_id: m.id })
      .then(j => j.ok ? (toast('از مدیران حذف شد'), loadMembers(currentChat)) : toast(j.error, 'error'));
  }, 'حذف از مدیران');
}

function kickMember(m) {
  openConfirm('حذف از گروه', `«${m.display_name}» از گروه حذف می‌شه و دسترسی‌اش قطع می‌شه`, () => {
    api(`/api/chat/${currentChat}/members`, { action: 'kick', user_id: m.id })
      .then(j => j.ok ? (toast('از گروه حذف شد'), loadMembers(currentChat)) : toast(j.error, 'error'));
  }, 'حذف');
}

function transferOwnership(m) {
  openConfirm('انتقال مالکیت', `مطمئنی می‌خوای مالکیت گروه رو به «${m.display_name}» بدی؟ تو بعد از این مدیر می‌مونی.`, () => {
    openConfirm('تأیید نهایی انتقال مالکیت', 'این تغییر مهمه؛ برای اطمینان دوباره تأیید کن.', () => {
      api(`/api/chat/${currentChat}/members`, { action: 'transfer', user_id: m.id })
        .then(j => {
          if (j.ok) { toast('مالکیت منتقل شد'); loadMembers(currentChat); if (currentChat) openChat(currentChat); }
          else toast(j.error, 'error');
        });
    }, 'بله، مطمئنم');
  }, 'ادامه');
}

let _permMember = null;
function openMemberPerms(m) {
  _permMember = m;
  const role = myRole();
  const isOwner = role === 'owner' || isSiteAdmin();
  let myPerms = null;
  if (!isOwner) {
    const meM = memberById(window.ME.id);
    myPerms = (meM && meM.permissions) || {};
  }
  document.getElementById('mpAvatar').innerHTML = avatarInner(m.display_name, m.avatar, m.status === 'online');
  document.getElementById('mpName').textContent = m.display_name;
  document.getElementById('mpUsername').textContent = '@' + m.username;
  document.getElementById('mpTitle').value = m.title || '';
  const box = document.getElementById('mpPerms');
  const cur = m.permissions || {};
  const note = isOwner ? '' : '<small class="perm-note">فقط می‌تونی دسترسی‌هایی رو بدی که خودت داری</small>';
  box.innerHTML = note + Object.keys(PERM_LABELS).map(k => {
    const allowed = isOwner || (myPerms && myPerms[k]);
    const on = !!cur[k];
    return `<label class="perm-row${allowed ? '' : ' locked'}">
      <input type="checkbox" data-perm="${k}" ${on ? 'checked' : ''}${allowed ? '' : ' disabled'}>
      <span>${PERM_LABELS[k]}</span>${allowed ? '' : `<span class="perm-lock">${bi('lock')}</span>`}
    </label>`;
  }).join('');
  document.getElementById('memberPermModal').classList.add('show');
}
document.getElementById('mpCancel').onclick = () => document.getElementById('memberPermModal').classList.remove('show');
document.getElementById('mpSave').onclick = async () => {
  if (!_permMember) return;
  const permissions = {};
  document.querySelectorAll('#mpPerms [data-perm]').forEach(c => {
    if (!c.disabled) permissions[c.dataset.perm] = c.checked;
  });
  const title = document.getElementById('mpTitle').value.trim();
  const r = await api('/api/chat/' + currentChat + '/members', {
    action: 'permissions', user_id: _permMember.id, title, permissions
  });
  if (r.ok) {
    document.getElementById('memberPermModal').classList.remove('show');
    toast('مجوزها ذخیره شد');
    loadMembers(currentChat);
  } else toast(r.error, 'error');
};

document.getElementById('btnJoin').onclick = async () => {
  const r = await api(`/api/chat/${currentChat}/join`, {});
  if (r.ok) {
    toast('پیوستی');
    document.getElementById('btnJoin').style.display = 'none';
    CD.role = 'member';
    refreshConvList();
  } else toast(r.error, 'error');
};

function segSelect(el, val) {
  el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.val === val));
  el.dataset.value = val;
}

function resetAvPick(prefix) {
  const inp = document.getElementById(prefix + 'Input');
  inp.value = '';
  document.getElementById(prefix + 'Label').innerHTML = bi('camera') + ' انتخاب عکس…';
  const prev = document.getElementById(prefix + 'Prev');
  prev.src = '';
  prev.style.display = 'none';
}
['groupAv', 'channelAv'].forEach(p => {
  const inp = document.getElementById(p + 'Input');
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    if (!f) return resetAvPick(p);
    document.getElementById(p + 'Label').innerHTML = bi('check2') + ' ' + esc(f.name);
    const prev = document.getElementById(p + 'Prev');
    prev.src = URL.createObjectURL(f);
    prev.style.display = 'block';
  });
});
function uploadChatAvatar(chatId, file) {
  const fd = new FormData();
  fd.append('avatar', file);
  return fetch('/api/chat/' + chatId + '/avatar', { method: 'POST', body: fd }).then(x => x.json());
}

async function openNewGroup() {
  const modal = document.getElementById('newGroupModal');
  modal.classList.add('show');
  segSelect(document.getElementById('groupVis'), 'public');
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
  resetAvPick('groupAv');
  const r = await fetch('/api/search?q=').then(x => x.json());
  document.getElementById('groupMemberPick').innerHTML = r.users.filter(u => !u.is_banned).map(u =>
    `<label><input type="checkbox" value="${u.id}"><span class="avatar sm">${avatarInner(u.display_name, u.avatar)}</span>${esc(u.display_name)}</label>`
  ).join('') || '<small style="color:var(--dim)">کاربری برای دعوت پیدا نشد</small>';
}
document.querySelectorAll('#groupVis button').forEach(b => b.onclick = () => segSelect(document.getElementById('groupVis'), b.dataset.val));
document.getElementById('groupCancel').onclick = () => document.getElementById('newGroupModal').classList.remove('show');

document.getElementById('btnCreateGroup').onclick = async () => {
  const members = [...document.querySelectorAll('#groupMemberPick input:checked')].map(x => +x.value);
  const r = await api('/api/group/create', {
    name: document.getElementById('groupName').value.trim(),
    description: document.getElementById('groupDesc').value.trim(),
    members,
    is_public: document.getElementById('groupVis').dataset.value === 'public'
  });
  if (r.ok) {
    const avFile = document.getElementById('groupAvInput').files[0];
    if (avFile) {
      const ar = await uploadChatAvatar(r.chat_id, avFile);
      if (ar.ok) toast('گروه و عکسش ساخته شد');
    } else toast('گروه ساخته شد');
    document.getElementById('newGroupModal').classList.remove('show');
    openChat(r.chat_id);
    refreshConvList();
  } else toast(r.error, 'error');
};

function openNewChannel() {
  document.getElementById('newChannelModal').classList.add('show');
  segSelect(document.getElementById('channelVis'), 'public');
  document.getElementById('channelName').value = '';
  document.getElementById('channelDesc').value = '';
  resetAvPick('channelAv');
}

const fabMenu = document.getElementById('fabMenu');
const fabBtn = document.getElementById('fabNew');
fabBtn.onclick = e => {
  e.stopPropagation();
  fabMenu.classList.toggle('show');
  fabBtn.classList.toggle('open');
};
fabMenu.querySelectorAll('button').forEach(b => b.onclick = () => {
  fabMenu.classList.remove('show');
  fabBtn.classList.remove('open');
  const d = b.dataset.do;
  if (d === 'group') openNewGroup();
  else if (d === 'channel') openNewChannel();
  else document.getElementById('searchInput').focus();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.fab-wrap')) {
    fabMenu.classList.remove('show');
    fabBtn.classList.remove('open');
  }
});
document.querySelectorAll('#channelVis button').forEach(b => b.onclick = () => segSelect(document.getElementById('channelVis'), b.dataset.val));
document.getElementById('channelCancel').onclick = () => document.getElementById('newChannelModal').classList.remove('show');

document.getElementById('btnCreateChannel').onclick = async () => {
  const r = await api('/api/channel/create', {
    name: document.getElementById('channelName').value.trim(),
    description: document.getElementById('channelDesc').value.trim(),
    is_public: document.getElementById('channelVis').dataset.value === 'public'
  });
  if (r.ok) {
    const avFile = document.getElementById('channelAvInput').files[0];
    if (avFile) {
      const ar = await uploadChatAvatar(r.chat_id, avFile);
      if (ar.ok) toast('کانال و عکسش ساخته شد');
    } else toast('کانال ساخته شد');
    document.getElementById('newChannelModal').classList.remove('show');
    openChat(r.chat_id);
    refreshConvList();
  } else toast(r.error, 'error');
};

function openDmInfo() {
  if (!CD.chat || CD.chat.chat_type !== 'dm') return;
  const p = CD.chat.peer || {};
  if (!p.id) return;
  window._dmPeer = p;
  const dmAv = document.getElementById('dmAvatar');
  dmAv.innerHTML = avatarInner(p.display_name, p.avatar, p.status === 'online');
  setAvatarData(dmAv, p.avatar, p.display_name || (p.username ? '@' + p.username : ''), 'user', p.id);
  document.getElementById('dmName').textContent = p.display_name || 'کاربر';
  document.getElementById('dmUsername').textContent = p.username ? '@' + p.username : '';
  document.getElementById('dmStatus').innerHTML = p.status === 'online' ? bi('circle-fill') + ' آنلاین' : bi('circle') + ' آفلاین';
  document.getElementById('dmBio').textContent = p.bio || 'بیویی نداره';
  document.getElementById('dmFull').href = '/profile/' + encodeURIComponent(p.username || '');
  document.getElementById('dmBlock').innerHTML = p.blocked ? bi('check-circle') + ' لغو بلاک' : bi('slash-circle') + ' بلاک';
  document.getElementById('dmBlockNote').style.display = p.blocked ? 'block' : 'none';
  document.getElementById('dmModal').classList.add('show');
}

document.getElementById('dmClose').onclick = () => document.getElementById('dmModal').classList.remove('show');
document.getElementById('dmBlock').onclick = () => {
  const p = window._dmPeer;
  if (!p) return;
  api('/api/block', { user_id: p.id }).then(j => {
    if (!j.ok) return toast(j.error, 'error');
    p.blocked = !!j.blocked;
    if (CD.chat && CD.chat.peer) CD.chat.peer.blocked = p.blocked;
    openDmInfo();
    toast(j.blocked ? 'بلاک شد' : 'لغو بلاک شد', 'success');
    refreshConvList();
  });
};
document.getElementById('dmReport').onclick = () => {
  const p = window._dmPeer;
  document.getElementById('dmModal').classList.remove('show');
  if (p) openReport(p);
};

function openSettings() {
  if (!CD.chat || CD.chat.chat_type === 'dm') return;
  const c = CD.chat;
  const role = myRole();
  const canEdit = role === 'owner' || role === 'admin' || window.ME.is_admin;
  document.getElementById('csName').textContent = c.name;
  document.getElementById('csMeta').textContent =
    (c.chat_type === 'channel' ? 'کانال' : 'گروه') + ' · ' + ((CD.members || []).length) + ' عضو';
  document.getElementById('csDescView').textContent = c.description || 'بدون توضیح';
  const csAv = document.getElementById('csAvatar');
  csAv.innerHTML = c.avatar ? '<img src="' + c.avatar + '" alt="">' : c.name.charAt(0);
  setAvatarData(csAv, c.avatar, c.name, 'chat', c.id);
  const nameInp = document.getElementById('csNameInput');
  const descInp = document.getElementById('csDescInput');
  nameInp.value = c.name;
  descInp.value = c.description || '';
  nameInp.disabled = !canEdit;
  descInp.disabled = !canEdit;
  const vis = document.getElementById('csVis');
  vis.querySelectorAll('button').forEach(b => b.style.display = 'inline-flex');
  if (!canEdit) {
    vis.querySelectorAll('button').forEach(b => b.style.display = 'none');
    let note = vis.querySelector('.cs-note');
    if (!note) vis.insertAdjacentHTML('beforeend', '<small class="cs-note">تغییرات فقط برای صاحب و ادمین گپ</small>');
    if (note) note.style.display = 'block';
  } else {
    if (vis.querySelector('.cs-note')) vis.querySelector('.cs-note').style.display = 'none';
  }
  segSelect(vis, c.is_public ? 'public' : 'private');
  const slowSeg = document.getElementById('csSlow');
  const slowWrap = document.getElementById('csSlowWrap');
  if (slowWrap && slowSeg) {
    slowWrap.style.display = canEdit ? '' : 'none';
    const slowVal = c.slow_mode ? String(c.slow_mode) : '0';
    segSelect(slowSeg, slowVal);
  }
  document.getElementById('csAvLabel').innerHTML = c.avatar ? bi('image') + ' آواتار فعلی — برای تغییر عکس جدید انتخاب کن' : bi('camera') + ' انتخاب عکس…';
  document.getElementById('csAvInput').value = '';
  const csPrev = document.getElementById('csAvPrev');
  if (csPrev) csPrev.style.display = 'none';
  document.getElementById('csAvUpload').style.display = canEdit ? 'inline-flex' : 'none';
  document.getElementById('csAvClear').style.display = (canEdit && c.avatar) ? 'inline-flex' : 'none';
  loadChatAvGrid(c.id);
  document.getElementById('csInviteLink').textContent = location.origin + '/chat/' + c.id;
  document.getElementById('csMembersHead').textContent = 'اعضا (' + ((CD.members || []).length) + ')';
  renderMembers(CD.members || []);
  loadMembers(c.id);
  const leave = document.getElementById('csLeave');
  leave.style.display = (c.chat_type !== 'dm' && role && role !== 'owner') ? 'inline-flex' : 'none';
  const del = document.getElementById('csDelete');
  const canDel = (role === 'owner' || window.ME.is_admin) && c.chat_type !== 'dm';
  del.style.display = canDel ? 'inline-flex' : 'none';
  del.dataset.chatId = c.id;
  document.getElementById('chatSettingsModal').classList.add('show');
}

document.getElementById('chatHeadId').onclick = (e) => {
  if (e.target.closest('#chatHeadAvatar[data-media]')) return; 
  if (CD.chat && CD.chat.chat_type === 'dm' && CD.chat.peer) {
    openDmInfo();
    return;
  }
  openSettings();
};

let _srchMatches = [], _srchIdx = -1, _srchTimer = null, _srchSeq = 0;
function clearChatSearchMarks() {
  document.querySelectorAll('.mrow.search-hit, .mrow.search-cur').forEach(r => r.classList.remove('search-hit', 'search-cur'));
}
function openChatSearch() {
  document.getElementById('chatSearch').style.display = 'flex';
  document.getElementById('chatSearchInput').focus();
  runChatSearch();
}
function closeChatSearch() {
  const bar = document.getElementById('chatSearch');
  if (!bar) return;
  bar.style.display = 'none';
  document.getElementById('chatSearchInput').value = '';
  document.getElementById('chatSearchCount').textContent = '';
  _srchMatches = []; _srchIdx = -1;
  clearChatSearchMarks();
}
async function runChatSearch() {
  const q = document.getElementById('chatSearchInput').value.trim().toLowerCase();
  clearChatSearchMarks();
  _srchIdx = -1;
  const cnt = document.getElementById('chatSearchCount');
  clearTimeout(_srchTimer);
  _srchMatches = [];
  if (!q) { cnt.textContent = ''; return; }
  if (q.length < 2) { cnt.textContent = 'بیشتر بنویس'; return; }
  cnt.textContent = '…';
  _srchTimer = setTimeout(async () => {
    const mySeq = ++_srchSeq;
    try {
      const r = await fetch(`/api/chat/${currentChat}/search?q=${encodeURIComponent(q)}`).then(x => x.json());
      if (mySeq !== _srchSeq) return; 
      if (!r || !r.ok) { cnt.textContent = 'خطا'; return; }
      _srchMatches = r.matches || [];
      if (!_srchMatches.length) { cnt.textContent = 'پیدا نشد'; return; }
      cnt.textContent = '۱/' + _srchMatches.length;
      _srchMatches.forEach(m => {
        const row = document.querySelector(`.mrow[data-mid="${m.id}"]`);
        if (row) row.classList.add('search-hit');
      });
      _srchIdx = 0;
      goToMatch(0);
    } catch (_) {
      if (mySeq === _srchSeq) cnt.textContent = 'خطا';
    }
  }, 350);
}
async function goToMatch(i) {
  if (!_srchMatches.length) return;
  _srchIdx = (i + _srchMatches.length) % _srchMatches.length;
  const m = _srchMatches[_srchIdx];
  document.querySelectorAll('.mrow.search-cur').forEach(r => r.classList.remove('search-cur'));
  let row = document.querySelector(`.mrow[data-mid="${m.id}"]`);
  if (!row) row = await loadAround(m.id);
  if (row) {
    row.classList.add('search-hit', 'search-cur');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  document.getElementById('chatSearchCount').textContent = (_srchIdx + 1) + '/' + _srchMatches.length;
}
async function loadAround(mid) {
  if (!currentChat) return null;
  let r;
  try {
    r = await fetch(`/api/chat/${currentChat}/messages/around?mid=${mid}&limit=21`).then(x => x.json());
  } catch (_) { return null; }
  if (!r || !r.ok || !r.messages || !r.messages.length) return null;
  const body = document.getElementById('msgsBody');
  for (const m of r.messages) {
    if (document.getElementById('m' + m.id)) continue;
    if (!CD.initialMessages.find(x => x.id === m.id)) CD.initialMessages.push(m);
    let anchor = null;
    for (const el of body.children) {
      if (!el.id || el.id[0] !== 'm') continue;
      if (Number(el.id.slice(1)) > m.id) { anchor = el; break; }
    }
    const wrap = document.createElement('div');
    wrap.id = 'm' + m.id;
    wrap.innerHTML = renderMsg(m); 
    if (anchor) body.insertBefore(wrap, anchor); else body.appendChild(wrap);
  }
  const target = body.querySelector(`.mrow[data-mid="${mid}"]`);
  if (!target) return null;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return target;
}
document.getElementById('btnChatSearch').onclick = () => {
  const bar = document.getElementById('chatSearch');
  if (bar.style.display === 'none' || !bar.style.display) openChatSearch();
  else closeChatSearch();
};
document.getElementById('chatSearchClose').onclick = closeChatSearch;
document.getElementById('chatSearchInput').oninput = runChatSearch;
document.getElementById('chatSearchInput').onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); goToMatch(_srchIdx + 1); }
};
document.getElementById('chatSearchNext').onclick = () => goToMatch(_srchIdx + 1);
document.getElementById('chatSearchPrev').onclick = () => goToMatch(_srchIdx - 1);
document.getElementById('csClose').onclick = () => document.getElementById('chatSettingsModal').classList.remove('show');
document.querySelectorAll('#csVis button').forEach(b => b.onclick = () => segSelect(document.getElementById('csVis'), b.dataset.val));
document.querySelectorAll('#csSlow button').forEach(b => b.onclick = () => segSelect(document.getElementById('csSlow'), b.dataset.val));

document.getElementById('csCopyInvite').onclick = () => {
  const link = document.getElementById('csInviteLink').textContent;
  copyText(link).then(() => toast('لینک کپی شد')).catch(() => toast('کپی نشد', 'error'));
};

document.getElementById('csAvUpload').onclick = async () => {
  const f = document.getElementById('csAvInput').files[0];
  if (!f) return toast('فایلی انتخاب نکردی', 'error');
  const fd = new FormData();
  fd.append('avatar', f);
  const r = await fetch('/api/chat/' + currentChat + '/avatar', { method: 'POST', body: fd }).then(x => x.json());
  if (r.ok) {
    toast('آواتار گپ آپلود شد');
    CD.chat.avatar = r.avatar;
    document.getElementById('csAvatar').innerHTML = r.avatar
      ? '<img src="' + r.avatar + '" alt="">'
      : document.getElementById('csName').textContent.charAt(0);
    document.getElementById('csAvLabel').innerHTML = bi('image') + ' آواتار جدید ثبت شد';
    const prev = document.getElementById('csAvPrev');
    if (prev) { prev.src = URL.createObjectURL(f); prev.style.display = 'block'; }
    document.getElementById('csAvClear').style.display = r.avatar ? 'inline-flex' : 'none';
    setHead();
    refreshConvList();
    loadChatAvGrid(currentChat);
  } else toast(r.error, 'error');
};

document.getElementById('csAvInput').addEventListener('change', e => {
  const f = e.target.files[0];
  const prev = document.getElementById('csAvPrev');
  if (!f || !prev) return;
  prev.src = URL.createObjectURL(f);
  prev.style.display = 'block';
});

document.getElementById('csAvClear').onclick = async () => {
  const fd = new FormData();
  fd.append('delete', '1');   
  const r = await fetch('/api/chat/' + currentChat + '/avatar', { method: 'POST', body: fd }).then(x => x.json());
  if (r.ok) {
    toast('آواتار اصلی گپ حذف شد');
    CD.chat.avatar = r.avatar || '';
    document.getElementById('csAvatar').innerHTML = CD.chat.avatar
      ? '<img src="' + CD.chat.avatar + '" alt="">'
      : document.getElementById('csName').textContent.charAt(0);
    document.getElementById('csAvLabel').innerHTML = CD.chat.avatar ? bi('image') + ' آواتار گپ' : bi('camera') + ' انتخاب عکس…';
    const prev = document.getElementById('csAvPrev');
    if (prev) { prev.style.display = 'none'; prev.src = ''; }
    document.getElementById('csAvInput').value = '';
    document.getElementById('csAvClear').style.display = CD.chat.avatar ? 'inline-flex' : 'none';
    setHead();
    refreshConvList();
    loadChatAvGrid(currentChat);
  } else toast(r.error, 'error');
};

async function loadChatAvGrid(chatId) {
  const g = document.getElementById('csAvGrid');
  if (!g) return;
  const j = await fetch('/api/chat/' + chatId + '/avatars').then(r => r.json()).catch(() => ({ ok: false, avatars: [] }));
  const list = (j.ok && j.avatars) || [];
  if (!list.length) { g.innerHTML = ''; return; }
  const canManage = window.ME.is_admin || (CD.role && ['owner', 'admin'].includes(CD.role));
  const cName = (CD.chat && CD.chat.name) || '';
  g.innerHTML = list.map(a => (
    `<div class="av-cell${a.is_primary ? ' primary' : ''}" data-avid="${a.id}">`
    + `<img src="${a.url}" alt="" title="اسلاید">`
    + (a.is_primary ? `<span class="av-tag">${bi('star-fill')} اصلی</span>` : '')
    + (canManage && !a.is_primary ? `<button class="av-cell-btn" data-cssetprim="${a.id}" title="اصلی کردن">${bi('star')}</button>` : '')
    + (canManage ? `<button class="av-cell-btn av-del" data-csdel="${a.id}" title="حذف این عکس">${bi('trash')}</button>` : '')
    + `</div>`
  )).join('');
  g.querySelectorAll('.av-cell img').forEach(img => {
    img.onclick = () => openAvatarSlideshow('chat', chatId, cName, img.src);
  });
}
function actChatAvatar(fields) {
  fetch('/api/chat/' + currentChat + '/avatar', { method: 'POST', body: new URLSearchParams(fields) }).then(r => r.json()).then(j => {
    if (!j.ok) { toast(j.error || 'انجام نشد', 'error'); return; }
    CD.chat.avatar = j.avatar || '';
    const cs = document.getElementById('csAvatar');
    cs.innerHTML = j.avatar ? '<img src="' + j.avatar + '" alt="">' : document.getElementById('csName').textContent.charAt(0);
    setAvatarData(cs, j.avatar || '', document.getElementById('csName').textContent, 'chat', currentChat);
    setHead();
    refreshConvList();
    loadChatAvGrid(currentChat);
  });
}
document.getElementById('csAvGrid').addEventListener('click', e => {
  const setp = e.target.closest('[data-cssetprim]');
  if (setp) { actChatAvatar({ primary: setp.dataset.cssetprim }); return; }
  const del = e.target.closest('[data-csdel]');
  if (del) actChatAvatar({ remove: del.dataset.csdel });
});

document.getElementById('csSave').onclick = async () => {
  const role = myRole();
  const canEdit = role === 'owner' || role === 'admin' || window.ME.is_admin;
  const visVal = document.getElementById('csVis').dataset.value;
  const slowVal = document.getElementById('csSlow').dataset.value || '0';
  const payload = canEdit
    ? {
        name: document.getElementById('csNameInput').value.trim(),
        description: document.getElementById('csDescInput').value.trim(),
        is_public: visVal === 'public',
        slow_mode: parseInt(slowVal, 10) || 0
      }
    : {};
  if (!Object.keys(payload).length) {
    document.getElementById('chatSettingsModal').classList.remove('show');
    return;
  }
  const r = await api('/api/chat/' + currentChat + '/settings', payload);
  if (r.ok) {
    toast('تغییرات ذخیره شد');
    document.getElementById('chatSettingsModal').classList.remove('show');
    const rr = await fetch('/api/messages/' + currentChat);
    const j = await rr.json();
    CD.chat = j.chat;
    CD.role = j.role;
    CD.members = j.members;
    setHead();
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('csLeave').onclick = () => {
  openConfirm('خروج از گپ', 'از این گپ خارج می‌شی. برای بازگشت دوباره باید عضویت بگیری', () => {
    api('/api/chat/' + currentChat + '/members', { action: 'leave' }).then(r => {
      if (r.ok) {
        toast('از گپ خارج شدی');
        document.getElementById('chatSettingsModal').classList.remove('show');
        closeChatPane();
        refreshConvList();
      } else toast(r.error, 'error');
    });
  }, 'خروج');
};

document.getElementById('csDelete').onclick = () => {
  const cid = +document.getElementById('csDelete').dataset.chatId || currentChat;
  const c = CD.chat || {};
  const label = c.chat_type === 'channel' ? 'کانال' : 'گروه';
  openConfirm('حذف ' + label,
    `«${c.name || label}» کامل حذف می‌شه؛ همه‌ی پیام‌ها و عکسا برای همه‌ی اعضا می‌ره. این کار قابل بازگشت نیست`, () => {
      api('/api/chat/' + cid + '/delete').then(r => {
        if (r.ok) {
          toast('گپ حذف شد');
          document.getElementById('chatSettingsModal').classList.remove('show');
          if (currentChat === cid) closeChatPane();
          refreshConvList();
        } else toast(r.error || 'حذف نشد', 'error');
      });
    }, 'حذف');
};

document.getElementById('sideProfileLink').addEventListener('click', e => {
  e.preventDefault();
  openProfilePage();
});

function openProfilePage() {
  document.querySelector('.chat-layout').style.display = 'none';
  document.getElementById('myProfilePage').style.display = 'flex';
  const av = document.getElementById('pmAvatar');
  av.innerHTML = avatarInner(window.ME.display_name, window.ME.avatar);
  document.getElementById('pmName').textContent = window.ME.display_name;
  document.getElementById('pmUsername').textContent = '@' + window.ME.username;
  document.getElementById('pmBio').textContent = window.ME.bio || 'بیویی نداری';
  document.getElementById('pmDisplayName').value = window.ME.display_name;
  document.getElementById('pmUsernameInput').value = window.ME.username;
  document.getElementById('pmBioInput').value = window.ME.bio || '';
  const prev = document.getElementById('pmAvPrev');
  if (window.ME.avatar) {
    prev.src = window.ME.avatar;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
  document.getElementById('pmAvClear').style.display = window.ME.avatar ? 'inline-flex' : 'none';
  const rr = document.getElementById('pmReadReceipts');
  if (rr) rr.checked = window.ME.read_receipts !== false;
  const so = document.getElementById('pmShowOnline');
  if (so) so.checked = window.ME.show_online !== false;
  syncThemeSeg();
  const ad = document.getElementById('pmAdmin');
  if (ad) ad.style.display = window.ME.is_admin ? 'inline-flex' : 'none';
  loadBlocks();
  loadMyAvatarGrid();
}

const pmRR = document.getElementById('pmReadReceipts');
if (pmRR) pmRR.onchange = e => {
  const on = e.target.checked;
  api('/api/profile', { read_receipts: on }).then(j => {
    if (j.ok) {
      window.ME.read_receipts = on;
      toast(on ? 'تیک خوانده‌شدن روشن شد' : 'تیک خوانده‌شدن خاموش شد');
    } else {
      e.target.checked = !on;
      toast(j.error, 'error');
    }
  });
};

const pmSO = document.getElementById('pmShowOnline');
if (pmSO) pmSO.onchange = e => {
  const on = e.target.checked;
  api('/api/profile', { show_online: on }).then(j => {
    if (j.ok) {
      window.ME.show_online = on;
      toast(on ? 'وضعیت آنلاین برای دیگران نمایش داده می‌شود' : 'وضعیت آنلاین برای دیگران پنهان شد');
    } else {
      e.target.checked = !on;
      toast(j.error, 'error');
    }
  });
};

const pmTheme = document.getElementById('pmTheme');
function syncThemeSeg() {
  if (!pmTheme) return;
  const cur = (window.ME && window.ME.theme) || 'dark';
  pmTheme.querySelectorAll('button[data-theme-v]').forEach(b =>
    b.classList.toggle('on', b.dataset.themeV === cur));
}
if (pmTheme) pmTheme.addEventListener('click', e => {
  const b = e.target.closest('button[data-theme-v]');
  if (!b) return;
  const prev = (window.ME && window.ME.theme) || 'dark';
  const next = b.dataset.themeV;
  window.ME.theme = next;
  applyTheme(next);
  syncThemeSeg();
  api('/api/profile', { theme: next }).then(j => {
    if (!j.ok) {
      window.ME.theme = prev;
      applyTheme(prev);
      syncThemeSeg();
      toast(j.error, 'error');
    } else {
      toast({ dark: 'تم تیره شد', light: 'تم روشن شد', auto: 'تم با سیستم همگام شد' }[next]);
    }
  });
});

async function loadBlocks() {
  const box = document.getElementById('pmBlocks');
  if (!box) return;
  const r = await fetch('/api/blocks').then(x => x.json()).catch(() => null);
  if (!r || !r.ok || !r.users.length) {
    box.innerHTML = '<small style="color:var(--dim)">کسی رو بلاک نکردی</small>';
    return;
  }
  box.innerHTML = r.users.map(u => `
    <div class="blk-row" data-uid="${u.id}">
      <span class="avatar sm">${avatarInner(u.display_name, u.avatar)}</span>
      <div class="blk-id"><b>${esc(u.display_name)}</b><small>@${esc(u.username)}</small></div>
      <button class="btn sm" data-unblock="${u.id}">رفع بلاک</button>
    </div>`).join('');
  box.querySelectorAll('[data-unblock]').forEach(b => b.onclick = () => {
    api('/api/block', { user_id: +b.dataset.unblock }).then(j => {
      if (j.ok) { toast('رفع بلاک شد'); loadBlocks(); }
      else toast(j.error, 'error');
    });
  });
}

document.getElementById('pmBack').onclick = () => {
  document.getElementById('myProfilePage').style.display = 'none';
  document.querySelector('.chat-layout').style.display = 'flex';
};

document.getElementById('pmAvatarInput').onchange = e => {
  const f = e.target.files[0];
  const prev = document.getElementById('pmAvPrev');
  if (!f) return;
  const reader = new FileReader();
  reader.onload = r => {
    prev.src = r.target.result;
    prev.style.display = 'block';
  };
  reader.readAsDataURL(f);
};
document.getElementById('pmUsernameInput').addEventListener('input', e => {
  const inp = e.target;
  const pos = inp.selectionStart;
  const clean = inp.value.replace(/[^a-zA-Z0-9_]/g, '');
  if (clean !== inp.value) {
    inp.value = clean;
    inp.setSelectionRange(Math.min(pos, clean.length), Math.min(pos, clean.length));
  }
});
const pmAvDrop = document.getElementById('pmAvDrop');
pmAvDrop.addEventListener('dragover', e => {
  e.preventDefault();
  pmAvDrop.classList.add('drag');
});
pmAvDrop.addEventListener('dragleave', () => pmAvDrop.classList.remove('drag'));
pmAvDrop.addEventListener('drop', e => {
  e.preventDefault();
  pmAvDrop.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) {
    document.getElementById('pmAvatarInput').files = e.dataTransfer.files;
    document.getElementById('pmAvatarInput').onchange({ target: document.getElementById('pmAvatarInput') });
  }
});

document.getElementById('pmAvatarBtn').onclick = async () => {
  const f = document.getElementById('pmAvatarInput').files[0];
  if (!f) return toast('فایلی انتخاب نکردی', 'error');
  const fd = new FormData();
  fd.append('avatar', f);
  const r = await fetch('/api/avatar', { method: 'POST', body: fd }).then(x => x.json());
  if (r.ok) {
    toast('عکس آپلود شد');
    window.ME.avatar = r.avatar;
    const prev = document.getElementById('pmAvPrev');
    prev.src = r.avatar;
    prev.style.display = 'block';
    document.getElementById('pmAvClear').style.display = 'inline-flex';
    document.getElementById('pmAvatar').innerHTML = avatarInner(window.ME.display_name, r.avatar);
    refreshSideAvatar();
    refreshConvList();
    loadMyAvatarGrid();
  } else toast(r.error, 'error');
};

document.getElementById('pmAvClear').onclick = async () => {
  const fd = new FormData();
  fd.append('delete', '1');   
  const r = await fetch('/api/avatar', { method: 'POST', body: fd }).then(x => x.json());
  if (r.ok) {
    toast('عکس اصلی حذف شد');
    window.ME.avatar = r.avatar || '';
    const prev = document.getElementById('pmAvPrev');
    prev.src = window.ME.avatar;
    prev.style.display = window.ME.avatar ? 'block' : 'none';
    document.getElementById('pmAvClear').style.display = window.ME.avatar ? 'inline-flex' : 'none';
    document.getElementById('pmAvatar').innerHTML = avatarInner(window.ME.display_name, window.ME.avatar);
    refreshSideAvatar();
    refreshConvList();
    loadMyAvatarGrid();
  } else toast(r.error, 'error');
};

async function loadMyAvatarGrid() {
  const j = await fetch('/api/avatar/all').then(r => r.json()).catch(() => ({ ok: false, avatars: [] }));
  renderMyAvGrid((j.ok && j.avatars) || []);
}
function renderMyAvGrid(list) {
  const grid = document.getElementById('pmAvGrid');
  if (!grid) return;
  if (!list.length) { grid.innerHTML = '<p class="av-empty">هنوز عکسی نداری</p>'; return; }
  grid.innerHTML = list.map(a => (
    `<div class="av-cell${a.is_primary ? ' primary' : ''}" data-avid="${a.id}">`
    + `<img src="${a.url}" alt="" title="باز کردن اسلاید">`
    + (a.is_primary
        ? `<span class="av-tag">${bi('star-fill')} اصلی</span>`
        : `<button class="av-cell-btn" data-setprim="${a.id}" title="اصلی کردن">${bi('star')}</button>`)
    + `<button class="av-cell-btn av-del" data-avdel="${a.id}" title="حذف این عکس">${bi('trash')}</button>`
    + `</div>`
  )).join('');
  grid.querySelectorAll('.av-cell img').forEach(img => {
    img.onclick = () => openAvatarSlideshow('user', window.ME.id, window.ME.display_name, img.src);
  });
}
function actMyAvatar(fields) {
  fetch('/api/avatar', { method: 'POST', body: new URLSearchParams(fields) }).then(r => r.json()).then(j => {
    if (!j.ok) { toast(j.error || 'انجام نشد', 'error'); return; }
    window.ME.avatar = j.avatar || '';
    document.getElementById('pmAvatar').innerHTML = avatarInner(window.ME.display_name, window.ME.avatar);
    const prev = document.getElementById('pmAvPrev');
    prev.src = window.ME.avatar;
    prev.style.display = window.ME.avatar ? 'block' : 'none';
    document.getElementById('pmAvClear').style.display = window.ME.avatar ? 'inline-flex' : 'none';
    refreshSideAvatar();
    refreshConvList();
    loadMyAvatarGrid();
  });
}
document.getElementById('pmAvGrid').addEventListener('click', e => {
  const setp = e.target.closest('[data-setprim]');
  if (setp) { actMyAvatar({ primary: setp.dataset.setprim }); return; }
  const del = e.target.closest('[data-avdel]');
  if (del) { actMyAvatar({ remove: del.dataset.avdel }); }
});

function refreshSideAvatar() {
  const link = document.getElementById('sideProfileLink');
  if (link) {
    link.innerHTML = avatarHtml(window.ME.display_name, window.ME.avatar);
  }
}

document.getElementById('pmSave').onclick = async () => {
  const r = await api('/api/profile', {
    display_name: document.getElementById('pmDisplayName').value.trim(),
    username: document.getElementById('pmUsernameInput').value.trim(),
    bio: document.getElementById('pmBioInput').value
  });
  if (r.ok) {
    window.ME = Object.assign(window.ME, r.profile);
    document.getElementById('pmUsername').textContent = '@' + window.ME.username;
    toast('پروفایل ذخیره شد');
    document.getElementById('pmBio').textContent = window.ME.bio || 'بیویی نداری';
    document.getElementById('pmName').textContent = window.ME.display_name;
    refreshSideAvatar();
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('pmLogout').onclick = () => location.href = '/logout';

document.getElementById('pmChangePass').onclick = async () => {
  const cur = document.getElementById('pmCurPass').value;
  const nw = document.getElementById('pmNewPass').value;
  const nw2 = document.getElementById('pmNewPass2').value;
  if (!cur) return toast('رمز فعلی رو بنویس', 'error');
  if (nw.length < 6) return toast('رمز جدید حداقل ۶ کاراکتر باشه', 'error');
  if (nw !== nw2) return toast('تکرار رمز جدید یکسان نیست', 'error');
  const r = await api('/api/password', { current: cur, new: nw });
  if (r.ok) {
    document.getElementById('pmCurPass').value = '';
    document.getElementById('pmNewPass').value = '';
    document.getElementById('pmNewPass2').value = '';
    toast('رمز عبور تغییر کرد');
  } else toast(r.error, 'error');
};

document.getElementById('pmDeleteAccount').onclick = () => {
  openConfirm('حذف حساب کاربری', 'حسابت و همه‌ی پیام‌ها و گپ‌هات کامل پاک می‌شه. این کار برگشت‌پذیر نیست.', () => {
    const pass = prompt('برای تأیید، رمز عبورت رو وارد کن:');
    if (pass === null) return;
    api('/api/account/delete', { password: pass }).then(r => {
      if (r.ok) { toast('حسابت حذف شد'); setTimeout(() => location.href = '/', 800); }
      else toast(r.error, 'error');
    });
  }, 'حذف حساب');
};

async function openDmByUsername(username) {
  const r = await api('/api/user/by-username', { username });
  if (!r.ok || !r.user) {
    toast('کاربر پیدا نشد', 'error');
    return;
  }
  const dm = await api('/api/dm', { user_id: r.user.id });
  if (dm.ok) {
    refreshConvList();
    openChat(dm.chat_id);
  } else {
    location.href = '/profile/' + encodeURIComponent(username);
  }
}

const searchInput = document.getElementById('searchInput');
let searchTimer;
searchInput.oninput = () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  const box = document.getElementById('searchResults');
  if (!q) { box.classList.remove('show'); return; }
  searchTimer = setTimeout(async () => {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then(x => x.json());
    const users = (r.users || []).filter(u => u.id !== window.ME.id);
    let html = '';
    if (users.length) {
      html += '<h4>افراد</h4>' + users.map(u => `
        <div class="sr-item" data-uid="${u.id}" data-username="${esc(u.username)}">
          <span class="avatar">${avatarInner(u.display_name, u.avatar, u.status === 'online')}</span>
          <div><b>${esc(u.display_name)}</b><small>@${esc(u.username)} · ${u.status === 'online' ? 'آنلاین' : 'آفلاین'}</small></div>
        </div>`).join('');
    }
    if (r.chats.length) {
      html += '<h4>گروه‌ها و کانال‌های عمومی</h4>' + r.chats.map(c => `
        <div class="sr-item" data-chat="${c.id}">
          <span class="type-icon">${bi(c.chat_type === 'channel' ? 'megaphone' : 'people')}</span>
          <div style="flex:1; min-width:0"><b>${esc(c.name)}</b>
          <small>${c.chat_type === 'channel' ? 'کانال' : 'گروه'} ${c.is_public ? '· ' + bi('globe') + ' عمومی' : '· ' + bi('lock') + ' خصوصی'}${c.is_member ? ' · ' + bi('check-circle') + ' عضو هستی' : ''}</small></div>
          ${c.is_member ? '' : `<button class="btn sm sr-join" data-join="${c.id}">پیوستن</button>`}
        </div>`).join('');
    }
    if (!html) html = '<small style="padding:12px; color:var(--dim); display:block">چیزی پیدا نشد</small>';
    box.innerHTML = html;
    box.classList.add('show');
  }, 250);
};

document.getElementById('searchResults').addEventListener('click', e => {
  const joinBtn = e.target.closest('[data-join]');
  if (joinBtn) {
    e.stopPropagation();
    api('/api/chat/' + joinBtn.dataset.join + '/join', {}).then(j => {
      if (j.ok) {
        toast('پیوستی');
        refreshConvList();
        document.getElementById('searchResults').classList.remove('show');
        openChat(+joinBtn.dataset.join);
      } else toast(j.error, 'error');
    });
    return;
  }
  const u = e.target.closest('[data-uid]');
  if (u) {
    api('/api/dm', { user_id: +u.dataset.uid }).then(j => {
      if (j.ok) {
        document.getElementById('searchResults').classList.remove('show');
        openChat(j.chat_id);
      } else toast(j.error, 'error');
    });
    return;
  }
  const c = e.target.closest('[data-chat]');
  if (c) {
    document.getElementById('searchResults').classList.remove('show');
    openChat(c.dataset.chat);
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) document.getElementById('searchResults').classList.remove('show');
});

let ctxItems = [];

function showCtxMenu(x, y, items) {
  const menu = document.getElementById('ctxMenu');
  ctxItems = [];
  menu.innerHTML = items.filter(i => i).map(i => {
    if (i === 'sep') return '<div class="ctx-sep"></div>';
    ctxItems.push(i);
    return `<div class="ctx-item ${i.danger ? 'danger' : ''}" data-idx="${ctxItems.length - 1}"><span class="ctx-ico">${i.icon || ''}</span>${esc(i.label)}</div>`;
  }).join('');
  menu.classList.add('show');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

document.getElementById('ctxMenu').addEventListener('click', e => {
  const it = e.target.closest('.ctx-item');
  if (!it) return;
  const item = ctxItems[+it.dataset.idx];
  document.getElementById('ctxMenu').classList.remove('show');
  if (item && item.fn) item.fn();
});
document.addEventListener('click', e => {
  if (!e.target.closest('#ctxMenu')) document.getElementById('ctxMenu').classList.remove('show');
});
document.addEventListener('scroll', () => document.getElementById('ctxMenu').classList.remove('show'), true);
window.addEventListener('blur', () => document.getElementById('ctxMenu').classList.remove('show'));

function openMsgActions(mid, x, y) {
  const m = (CD.initialMessages || []).find(x => x.id === mid) || {};
  const mine = m.sender_id === window.ME.id;
  const items = [
    { label: 'واکنش بده', icon: bi('emoji-smile'), fn: () => openEmojiPicker(mid, x, y) },
    { label: 'پاسخ', icon: bi('reply'), fn: () => openReply(mid) },
    { label: 'فوروارد', icon: bi('share'), fn: () => openForward(mid) },
    m.content ? { label: 'کپی متن', icon: bi('clipboard'), fn: () => {
      copyText(m.content).then(() => toast('کپی شد')).catch(() => toast('کپی نشد', 'error'));
    } } : null,
    canPinMsg(m) ? { label: m.pinned ? 'لغو پین' : 'پین کردن', icon: bi(m.pinned ? 'pin-angle-fill' : 'pin-angle'), fn: () => {
      localSetPin(mid, !m.pinned);
      api('/api/message/pin', { message_id: mid }).then(j => {
        if (!j.ok) { loadPinned(); toast(j.error || 'پین نشد', 'error'); }
      });
    } } : null,
    { label: 'ذخیره در پیام‌های ذخیره‌شده', icon: bi('bookmark'), fn: () => {
      api('/api/message/save', { message_id: mid }).then(j => {
        if (j.ok) toast('در پیام‌های ذخیره‌شده ذخیره شد');
        else toast(j.error, 'error');
      });
    } },
    { label: 'چند پیام انتخاب کن', icon: bi('ui-checks'), fn: () => enterSelect(mid) },
    (mine && m.msg_type === 'text' && !m.poll) ? { label: 'ویرایش', icon: bi('pencil'), fn: () => {
      const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
      if (row) editMessage(mid, row);
    } } : null,
    { label: 'حذف برای من', icon: bi('eye-slash'), danger: true, fn: () => hideForMe(mid) },
    (mine || window.ME.is_admin) ? { label: 'حذف پیام', icon: bi('trash'), danger: true, fn: () => {
      localDeleteMid(mid);
      api('/api/message/delete', { message_id: mid }).then(j => {
        if (!j.ok) { renderAllMessages(); toast(j.error || 'حذف نشد', 'error'); }
      });
    } } : null,
    (!mine && m.sender_id) ? { label: 'گزارش فرستنده', icon: bi('flag'), danger: true, fn: () => {
      openReport({ id: m.sender_id, display_name: (getMember(m.sender_id) || {}).display_name }, m.id);
    } } : null,
  ];
  showCtxMenu(x, y, items);
}

function openConvActions(conv, x, y) {
  const chatId = +conv.dataset.chatId;
  const type = conv.dataset.type;
  const isDm = type === 'dm';
  const peerName = conv.dataset.peer || '';
  const peerId = +conv.dataset.peerId || null;
  const isBlocked = conv.dataset.blocked === '1';
  const isMuted = conv.dataset.muted === '1';
  const isArchived = conv.dataset.archived === '1';
  showCtxMenu(x, y, [
    { label: 'باز کردن', icon: bi('chat-dots'), fn: () => openChat(chatId) },
    { label: 'خواندن نشانه‌گذاری', icon: bi('check2'), fn: () => api('/api/mark-read', { chat_id: chatId }).then(() => {
      clearUnread(chatId);
      refreshConvList();
    }) },
    { label: isMuted ? 'باصدا کردن' : 'بی‌صدا کردن', icon: bi(isMuted ? 'bell' : 'bell-slash'), fn: () => {
      api('/api/chat/' + chatId + '/prefs', { muted: !isMuted }).then(j => {
        if (j.ok) { toast(j.muted ? 'بی‌صدا شد' : 'باصدا شد'); refreshConvList(); }
        else toast(j.error, 'error');
      });
    } },
    { label: isArchived ? 'خروج از آرشیو' : 'آرشیو کردن', icon: bi('archive'), fn: () => {
      api('/api/chat/' + chatId + '/prefs', { archived: !isArchived }).then(j => {
        if (j.ok) { toast(j.archived ? 'آرشیو شد' : 'از آرشیو درآمد'); refreshConvList(); }
        else toast(j.error, 'error');
      });
    } },
    { label: 'پاک کردن تاریخچه', icon: bi('eraser'), danger: true, fn: () => clearHistory(chatId, isDm) },
    !isDm ? { label: 'تنظیمات گپ', icon: bi('gear'), fn: () => openChat(chatId).then(openSettings) } : null,
    !isDm && CD.chat && +CD.chat.id === chatId && CD.role && CD.role !== 'owner' ? {
      label: 'ترک گروه / کانال', icon: bi('box-arrow-right'), danger: true, fn: () => {
        openConfirm('ترک گپ', 'از این گپ خارج می‌شی. برای بازگشت دوباره باید عضویت بگیری', () => {
          api('/api/chat/' + chatId + '/members', { action: 'leave' }).then(j => {
            if (j.ok) {
              toast('خارج شدی');
              if (currentChat === chatId) {
                closeChatPane();
              }
              refreshConvList();
            } else toast(j.error, 'error');
          });
        }, 'خروج');
      }
    } : null,
    isDm && peerName ? { label: 'پروفایل ' + peerName, icon: bi('person'), fn: () => openChat(chatId).then(openDmInfo) } : null,
    isDm && peerName ? { label: 'گزارش کاربر', icon: bi('flag'), danger: true, fn: () => openChat(chatId).then(() => {
      if (CD.chat && CD.chat.peer) openReport(CD.chat.peer);
    }) } : null,
    isDm && peerName ? { label: isBlocked ? 'لغو بلاک' : 'بلاک کردن', icon: bi(isBlocked ? 'check-circle' : 'slash-circle'), danger: !isBlocked, fn: () => {
      const uid = peerId || (CD.chat && CD.chat.peer && +CD.chat.id === chatId ? CD.chat.peer.id : null);
      if (!uid) return;
      api('/api/block', { user_id: uid }).then(j => {
        toast(j.blocked ? 'بلاک شد' : 'لغو بلاک شد', 'success');
        if (CD.chat && CD.chat.peer && CD.chat.peer.id === uid) CD.chat.peer.blocked = !!j.blocked;
        refreshConvList();
      });
    } } : null,
    !isDm ? { label: 'حذف گروه / کانال', icon: bi('trash'), danger: true, fn: () => {
      if (conv.dataset.owner !== String(window.ME.id) && !window.ME.is_admin) {
        toast('فقط صاحب گپ یا ادمین سایت می‌تونه حذف کنه', 'error');
        return;
      }
      const nm = conv.dataset.name || 'گپ';
      openConfirm('حذف گپ', `«${nm}» کامل حذف می‌شه؛ همه‌ی پیام‌ها و عکسا برای همه‌ی اعضا می‌ره. این کار قابل بازگشت نیست`, () => {
        api('/api/chat/' + chatId + '/delete').then(j => {
          if (j.ok) {
            toast('گپ حذف شد');
            if (currentChat === chatId) closeChatPane();
            refreshConvList();
          } else toast(j.error || 'حذف نشد', 'error');
        });
      }, 'حذف');
    } } : null,
    isDm ? { label: 'حذف گپ', icon: bi('trash'), danger: true, fn: () => {
      openConfirm('حذف گپ', `«${peerName || 'گپ'}» کامل حذف می‌شه؛ برای تو و طرف مقابل پیام‌ها می‌ره. این کار قابل بازگشت نیست`, () => {
        api('/api/chat/' + chatId + '/delete').then(j => {
          if (j.ok) {
            toast('گپ حذف شد');
            if (currentChat === chatId) closeChatPane();
            refreshConvList();
          } else toast(j.error || 'حذف نشد', 'error');
        });
      }, 'حذف');
    } } : null,
  ]);
}

document.addEventListener('contextmenu', e => {
  const memRow = e.target.closest('#csMembersList .mb-item');
  if (memRow) {
    e.preventDefault();
    const mem = memberById(+memRow.dataset.mmember);
    if (mem) openMemberMenu(mem, e.clientX, e.clientY);
    return;
  }
  const sysRow = e.target.closest('.sys-msg');
  if (sysRow) {
    e.preventDefault();
    const mid = +sysRow.dataset.mid;
    const canDel = window.ME.is_admin || CD.role === 'owner' || CD.role === 'admin';
    showCtxMenu(e.clientX, e.clientY, [
      canDel ? { label: 'حذف پیام', icon: bi('trash'), danger: true, fn: () => {
        localDeleteMid(mid);
        api('/api/message/delete', { message_id: mid }).then(j => {
          if (!j.ok) { renderAllMessages(); toast(j.error || 'حذف نشد', 'error'); }
        });
      } } : null,
      { label: 'حذف برای من', icon: bi('eye-slash'), danger: true, fn: () => hideForMe(mid) },
    ]);
    return;
  }
  const msgRow = e.target.closest('.mrow');
  if (msgRow && !msgRow.classList.contains('sel-selected')) {
    e.preventDefault();
    openMsgActions(+msgRow.dataset.mid, e.clientX, e.clientY);
    return;
  }

  const conv = e.target.closest('.conv');
  if (conv) {
    e.preventDefault();
    openConvActions(conv, e.clientX, e.clientY);
    return;
  }
});

if (CD.chat) {
  setHead();
  document.getElementById('mainEmpty').style.display = 'none';
  const initialDraft = typeof CD.draft === 'string' ? CD.draft : '';
  if (initialDraft) {
    const input = document.getElementById('msgInput');
    input.value = initialDraft;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  renderAllMessages();
  loadPinned();
  refreshConvList();
  setChatted(true);
  attachMore();
} else {
  refreshConvList();
}
initConvHeads();

let _everConnected = false;
S.on('connect', () => {
  if (_everConnected) {
    refreshConvList();
    resyncCurrentChat();
  }
  _everConnected = true;
});
S.on('auth_required', () => { toast('نشستت باطله، دوباره وارد شو', 'error'); setTimeout(() => location.href = '/login', 1500); });

async function resyncCurrentChat() {
  if (!currentChat) return;
  try {
    const r = await fetch('/api/messages/' + currentChat);
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.chat) return;
    const wasBottom = nearBottom();
    CD.initialMessages = j.messages || [];
    CD.chat = j.chat;
    CD.role = j.role;
    CD.members = j.members || [];
    CD.joined = j.joined !== false;
    setHead();
    document.getElementById('msgsBody').innerHTML = '';
    renderAllMessages();
    attachMore();
    if (wasBottom) scrollToBottom(true);
    loadPinned();
  } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshConvList();
  resyncCurrentChat();
});
window.addEventListener('focus', () => {
  refreshConvList();
  resyncCurrentChat();
});

S.on('new_message', m => {
  m.my_reaction = (m.reactions || {})[String(window.ME.id)] || null;
  if (m.sender_id === window.ME.id) {
    const row = document.querySelector(`#m${m.id}`);
    if (row) row.outerHTML = '<div id="m' + m.id + '">' + renderMsg(m) + '</div>';
    else appendMsg(m);
    updateConvPreview(m);
    return;
  }
  if (m.chat_id === currentChat) {
    appendMsg(m);
    api('/api/mark-read', { chat_id: m.chat_id });
  } else {
    updateConvPreview(m);
  }
});

S.on('reaction', d => {
  const m = (CD.initialMessages || []).find(x => x.id === d.message_id);
  if (m) { m.reactions = d.reactions || {}; m.my_reaction = d.my_reaction || null; }
  const row = document.querySelector(`.mrow[data-mid="${d.message_id}"]`);
  if (row) {
    const msgs = document.getElementById('msgs').querySelector(`[data-mid="${d.message_id}"] .reactions`);
    if (msgs) {
      const fake = { my_reaction: d.my_reaction, reactions: d.reactions };
      msgs.innerHTML = reactionChips(fake);
    }
  }
});

S.on('message_edited', d => {
  const m = (CD.initialMessages || []).find(x => x.id === d.message_id);
  if (m) { m.content = d.content; m.is_edited = true; }
  const row = document.querySelector(`.mrow[data-mid="${d.message_id}"]`);
  if (row) {
    const txt = row.querySelector('.txt');
    if (txt) {
      if (txt.classList.contains('md')) txt.innerHTML = md(d.content);
      else txt.textContent = d.content;
    }
    const meta = row.querySelector('.m-meta');
    if (meta && !meta.querySelector('.edited')) meta.insertAdjacentHTML('beforeend', '<span class="edited">ویرایش شده</span>');
  }
});

S.on('message_deleted', d => {
  const m = (CD.initialMessages || []).find(x => x.id === d.message_id);
  if (m) m.deleted = true;
  const wrapper = document.querySelector(`#m${d.message_id}`) || document.querySelector(`.mrow[data-mid="${d.message_id}"]`) || document.querySelector(`.sys-msg[data-mid="${d.message_id}"]`);
  if (wrapper) {
    const row = wrapper.classList.contains('mrow') ? wrapper : wrapper.querySelector('.mrow');
    const target = row ? row.closest('#m' + d.message_id) || row : wrapper;
    target.remove();
  }
  if ((CD.pins || []).some(p => +p.id === +d.message_id)) loadPinned();
});

S.on('chat_cleared', d => {
  if (d.chat_id === currentChat) {
    CD.initialMessages = [];
    CD.pins = [];
    renderAllMessages();
    renderPinnedBar();
  }
  refreshConvList();
});

S.on('read_recept', d => {
  if (window.ME.read_receipts === false) return;
  if (d.chat_id !== currentChat) return;
  const lastId = d.last_id || Infinity;
  document.querySelectorAll('.mrow .ticks').forEach(t => {
    const mid = +t.dataset.mid;
    if (mid <= lastId) t.innerHTML = tickIcon(true);
  });
});

S.on('typing', d => {
  if (d.chat_id !== currentChat) return;
  clearTimeout(typingTimers[d.user_id]);
  typingTimers[d.user_id] = setTimeout(() => {
    delete typingTimers[d.user_id];
    renderTyping();
  }, 1800);
  renderTyping();
});

function renderTyping() {
  const active = Object.keys(typingTimers).filter(id => +id !== window.ME.id && typingTimers[id]);
  const bar = document.getElementById('typingBar');
  if (!active.length) { bar.innerHTML = ''; return; }
  const who = active.map(id => (getMember(+id) || {}).display_name || 'فردی').join('، ');
  bar.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> ${esc(who)} داره تایپ می‌کنه…`;
}

S.on('stop_typing', d => {
  if (typingTimers[d.user_id]) { clearTimeout(typingTimers[d.user_id]); delete typingTimers[d.user_id]; renderTyping(); }
});

S.on('presence_update', d => {
  if (currentChat && CD.chat && CD.chat.chat_type === 'dm' && CD.chat.peer && d.user_id === CD.chat.peer.id) {
    CD.chat.peer.status = d.status;
    setHead();
  }
});

S.on('message_pinned', d => {
  if (!currentChat || d.chat_id !== currentChat) return;
  loadPinned();
});

S.on('chat_meta', d => {
  if (d.id === currentChat && CD.chat) {
    CD.chat = { ...CD.chat, ...d };
    setHead();
    loadMembers(currentChat);
  }
  refreshConvList();
});

S.on('poll_vote', d => {
  if (d.chat_id !== currentChat) return;
  const card = document.querySelector(`.poll-card[data-pollid="${d.poll_id}"]`);
  if (!card) return;
  const m = (CD.initialMessages || []).find(x => x.poll && x.poll.id === d.poll_id);
  if (m) {
    m.poll = {
      ...m.poll,
      counts: d.counts, total: d.total,
      voters: d.voters,
      multi: d.multi, closed: d.closed,
      question: m.poll.question, options: m.poll.options,
      expires_at: m.poll.expires_at, created_by: m.poll.created_by,
    };
    if (d.voter && d.voter.id === window.ME.id) m.poll.my_votes = d.my_votes;
  }
  card.outerHTML = (m && m.poll) ? pollHtml(m.poll) : '';
});

S.on('poll_revoke', d => {
  if (d.chat_id !== currentChat) return;
  const card = document.querySelector(`.poll-card[data-pollid="${d.poll_id}"]`);
  if (!card) return;
  const m = (CD.initialMessages || []).find(x => x.poll && x.poll.id === d.poll_id);
  if (m) {
    m.poll.counts = d.counts;
    m.poll.total = d.total;
    m.poll.voters = d.voters;
    m.poll.closed = d.closed;
    if (d.voter && d.voter.id === window.ME.id) m.poll.my_votes = [];
  }
  card.outerHTML = (m && m.poll) ? pollHtml(m.poll) : '';
});

S.on('poll_state', d => {
  if (d.chat_id !== currentChat) return;
  const card = document.querySelector(`.poll-card[data-pollid="${d.poll_id}"]`);
  if (!card) return;
  const m = (CD.initialMessages || []).find(x => x.poll && x.poll.id === d.poll_id);
  if (m) m.poll = { ...m.poll, closed: d.closed, voters: d.voters, counts: d.counts, total: d.total };
  if (m && m.poll) card.outerHTML = pollHtml(m.poll);
});

S.on('chat_deleted', d => {
  if (currentChat === d.chat_id) {
    toast('این گپ توسط صاحب حذف شد');
    closeChatPane();
  }
  refreshConvList();
});

S.on('you_were_removed', d => {
  const label = d.name || 'گپ';
  toast(d.by ? `تو توسط ${d.by} از «${label}» حذف شدی` : `تو از «${label}» حذف شدی`, 'error');
  refreshConvList();
  if (currentChat === d.chat_id) closeChatPane();
});

S.on('profile_updated', p => {
  window.ME = Object.assign(window.ME, p);
  if (p && p.theme) applyTheme(p.theme);
  refreshSideAvatar();
  const csm = document.getElementById('chatSettingsModal');
  if (csm && csm.classList.contains('show') && currentChat) loadMembers(currentChat);
  if (document.getElementById('myProfilePage').style.display === 'flex') openProfilePage();
});

S.on('account_deleted', () => {
  toast('این اکانت توسط مدیریت حذف شد', 'error');
  setTimeout(() => location.href = '/logout', 1200);
});

S.on('banned', d => {
  if (d && d.banned === false) {
    toast('مسدودیت شما رفع شد. دوباره وارد شو', 'success');
    return;
  }
  toast('اکانت شما توسط ' + ((d && d.reason) || 'ادمین') + ' مسدود شد', 'error');
  setTimeout(() => location.replace('/logout'), 1200);
});
