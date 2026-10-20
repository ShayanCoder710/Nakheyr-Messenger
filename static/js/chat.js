const S = io({ transports: ['websocket', 'polling'] });
const CD = window.CHAT_DATA || {};
CD.joined = window.JOINED !== false;
const SWATCHES = ['#e5393b', '#c62828', '#8e1c1c', '#ff5252', '#b71c1c', '#d84315', '#e5484d', '#4a4a4a'];

function applyAccent(color) {
  if (/^#[0-9a-fA-F]{6}$/.test(color || '')) {
    document.documentElement.style.setProperty('--me-accent', color);
  }
}
applyAccent(window.ME && window.ME.accent);

let currentChat = window.CURRENT_CHAT;
let pendingFile = null;
let pendingReply = null;
let selectedIds = new Set();
let selecting = false;
let typingTimers = {};
let typingSent = false;
let typingSelfTimer = null;

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

function getMember(id) {
  if (CD.members && id !== undefined) {
    const m = CD.members.find(x => x.id === id);
    if (m) return m;
  }
  return { display_name: id, username: '', avatar: '', status: 'offline' };
}

function avBox(name, avatar, online, size) {
  const cls = ('avatar' + (size ? ' ' + size : '')).trim();
  const init = (name || '?').trim().charAt(0);
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
  return Object.entries(agg).map(([e, n]) =>
    `<span class="${e === mine ? 'mine' : ''}" data-emoji="${e}" data-mid="${m.id}"><span class="rx-e">${e}</span>${n}</span>`
  ).join('');
}

function canPinMsg(m) {
  return (m.sender_id === window.ME.id) || window.ME.is_admin || ['owner', 'admin'].includes(myRole());
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
  const id = seen ? 'bi-Seen' : 'bi-Sent';
  const label = seen ? 'Seen-icon' : 'Sent-icon';
  return `<svg width="14" height="14" viewBox="0 0 18 18" role="img" aria-label="${label}" style="--bi-color: var(--chat-icon-color);"><use href="#${id}"></use></svg>`;
}

function pollHtml(p) {
  const total = p.total || 0;
  const voters = (p.voters !== undefined && p.voters !== null) ? p.voters : 0;
  const multi = !!p.multi;
  const closed = !!p.closed;
  const myVotes = p.my_votes || [];
  const opts = (p.options || []).map((label, i) => {
    const c = (p.counts && p.counts[i]) || 0;
    const pct = total ? Math.round(c / total * 100) : 0;
    const sel = myVotes.includes(i);
    const input = closed
      ? `<input type="${multi ? 'checkbox' : 'radio'}" disabled>`
      : `<input type="${multi ? 'checkbox' : 'radio'}" data-pollvote="${p.id}" value="${i}" ${sel ? 'checked' : ''} name="pv${p.id}">`;
    return `<label class="poll-opt ${sel ? 'selected' : ''}">
      <span class="opt-bar" style="width:${closed ? pct : 0}%"></span>
      ${input}<span class="opt-ic">${sel ? bi('check-circle-fill') : (multi ? bi('collection') : bi('circle'))}</span>
      <span class="opt-label">${esc(label)}</span>
      ${closed ? `<span class="opt-count"><b>${c}</b> · ${pct}%</span>` : ''}
    </label>`;
  }).join('');
  const isGroup = CD.chat && CD.chat.chat_type === 'group';
  const canSeeVoters = closed && isGroup && (window.ME.is_admin || (CD.role && ['owner', 'admin'].includes(CD.role)));
  const canClose = !closed && (p.created_by === window.ME.id || window.ME.is_admin || (CD.role && ['owner', 'admin'].includes(CD.role)));
  const expTag = closed ? (p.expires_at ? `<span class="poll-tag exp">${bi('hourglass-split')} انقضاشده</span>` : `<span class="poll-tag">${bi('lock')} بسته</span>`) : '';
  const foot = `<div class="poll-foot">
    <span class="poll-total">${bi('people')} ${voters} نفر شرکت${multi ? ' · چندگزینه‌ای' : ''}</span>
    <span class="poll-foot-acts">
      ${canSeeVoters ? `<button class="poll-close-btn" data-pollvoters="${p.id}" title="مشاهده رأی‌دهندگان">${bi('eye')}</button>` : ''}
      ${canClose ? `<button class="poll-close-btn" data-pollclose="${p.id}" title="بستن">${bi('lock')}</button>` : ''}
    </span>
  </div>`;
  return `<div class="poll-card ${closed ? 'poll-locked' : ''}" data-pollid="${p.id}">
    <div class="poll-head"><span class="poll-head-ic">${bi('bar-chart')}</span><b>نظرسنجی</b>${expTag}</div>
    <div class="poll-q">${esc(p.question)}</div>
    <div class="poll-opts">${opts}</div>
    ${pollResultsBar(p)}
    ${foot}
  </div>`;
}

/* Pretty percentage result bars shown when the poll is closed */
function pollResultsBar(p) {
  if (!p.closed || !p.total) return '';
  const total = p.total;
  return `<div class="poll-results-strip">${(p.options || []).map((label, i) => {
    const c = (p.counts && p.counts[i]) || 0;
    const pct = total ? Math.round(c / total * 100) : 0;
    return `<div class="res-col" title="${esc(label)}">
      <div class="res-val">${pct}%</div>
      <div class="res-bar"><span style="width:${pct}%"></span></div>
      <div class="res-label">${esc(label)}</div>
    </div>`;
  }).join('')}</div>`;
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
  } else if (m.msg_type === 'video') {
    body = `<div class="vid-wrap"><video class="vid" src="${url}" controls preload="metadata" playsinline></video>`
      + `<button class="vid-expand" title="نمایش بزرگ" data-media="video" data-src="${m.file_url || ''}" data-name="${fname}">${bi('arrows-angle-expand')}</button></div>`;
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'audio') {
    body = `<div class="audio-card"><div class="fi">${bi('headphones')}</div><div class="ac-body"><b>${fname}</b>`
      + `<audio class="aud" src="${url}" controls preload="metadata"></audio></div></div>`;
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'file') {
    body = `<div class="file-card"><div class="fi">${bi(fileIcon(m.file_name))}</div><div class="fc-meta"><b>${fname}</b><small>فایل</small></div></div>`;
    if (m.file_url) {
      body += `<div class="file-actions"><a class="btn sm" href="${url}" download="${fname}">${bi('download')} دریافت</a>`
        + `<a class="btn sm ghost" href="${url}" target="_blank" rel="noopener">${bi('box-arrow-up-right')} باز کردن</a></div>`;
    }
  } else {
    // A poll message: show the question as text + the interactive card
    if (m.poll) {
      body = `${pollHtml(m.poll)}`;
    } else {
      body = `<div class="txt md">${md(m.content)}</div>`;
    }
  }

  const sender = m.sender_id ? getMember(m.sender_id) : { display_name: 'سیستم', avatar: '' };
  const mine = m.sender_id === window.ME.id;
  const hasImg = m.msg_type === 'image';
  const isMedia = hasImg || m.msg_type === 'video';
  const imgOnly = hasImg && !m.content;
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
      const raw = dayKey(m.created_at);
      if (raw !== lastRaw) {
        body.insertAdjacentHTML('beforeend',
          `<div class="day-sep" data-day="${esc(raw)}"><span>${fmtDay(m.created_at)}</span></div>`);
        lastRaw = raw;
      }
      body.insertAdjacentHTML('beforeend', renderMsg(m));
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
        el.scrollTop = el.scrollHeight - prevH + keep;
      }
      loadingOlder = false;
    }).catch(() => { loadingOlder = false; });
  });
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
  joinBtn.style.display = 'none';
  repBtn.style.display = 'none';
  peerBtn.style.display = 'none';
  if (c.is_notes) {
    displayName = 'فضای شخصی';
    subText = 'یادداشت‌ها و پیام‌های خودت';
    headAv.innerHTML = '<img src="/static/icons/notes.svg" alt="">';
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

/* ── Polls ────────────────────────────────────────────────────── */
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
  // In a DM (private chat), a poll cannot be created — it can only be
  // forwarded into the DM. Show a hint instead of opening the modal.
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
// auto-expiry segmented control
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

/* Poll vote / close clicks (event delegation) */
document.addEventListener('click', e => {
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

/* Poll voters modal (groups only, closed polls, admins/owner/creator) */
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
document.addEventListener('change', e => {
  const inp = e.target.closest('[data-pollvote]');
  if (!inp) return;
  const pid = +inp.dataset.pollvote;
  const card = inp.closest('.poll-card');
  const multi = inp.type === 'checkbox';
  let pick;
  if (multi) {
    pick = [...card.querySelectorAll('[data-pollvote]:checked')].map(x => +x.value);
  } else {
    pick = +inp.value;
  }
  api('/api/poll/' + pid + '/vote', { options: multi ? pick : [pick] }).then(j => {
    if (!j.ok) { toast(j.error || 'رای ثبت نشد', 'error'); inp.checked = false; }
  });
});

// Poll modal: ESC to close
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
  document.getElementById('msgsPane').classList.remove('open');
  document.getElementById('mainEmpty').style.display = 'grid';
  currentChat = null;
  document.querySelector('.chat-layout').classList.remove('chatted');
  document.querySelectorAll('.conv.active').forEach(c => c.classList.remove('active'));
  if (syncUrl !== false && location.pathname !== '/') history.pushState({}, '', '/');
}

function setChatted(on) {
  document.querySelector('.chat-layout').classList.toggle('chatted', on);
}

document.getElementById('btnBackChat').onclick = () => closeChatPane();

async function openChat(id, opts) {
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
  document.getElementById('channelHint').style.display = canPost ? 'none' : 'flex';
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
    av = `<div class="avatar conv-av" style="border-radius:14px"><img src="/static/icons/notes.svg" alt=""></div>`;
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
                 <span class="avatar conv-av" style="border-radius:14px"><img src="/static/icons/notes.svg" alt=""></span>
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
    void conv.offsetWidth; // restart animation
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
    const set = EMOJI_SETS[i];
    body.innerHTML = set.emojis.map(e => `<button type="button" data-em="${e}">${e}</button>`).join('');
    body.scrollTop = 0;
  };
  const runSearch = () => {
    const q = (search.value || '').trim().toLowerCase();
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
    renderSet(+b.dataset.tab);
  });
  search.oninput = runSearch;
  search.onkeydown = ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const first = body.querySelector('[data-em]');
      if (first) insertEmoji(first.dataset.em);
    }
  };
  renderSet(0);
}

function hideEmojiPanel() {
  const p = document.getElementById('emojiPanel');
  if (p) p.style.display = 'none';
  const s = document.getElementById('epSearch');
  if (s) s.value = '';
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
  const b = e.target.closest('[data-em]');
  if (b) { insertEmoji(b.dataset.em); return; }
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
async function sendText() {
  if (sending || !currentChat) return;
  const input = document.getElementById('msgInput');
  if (input.disabled) return;
  const text = input.value.trim();
  if (!text && !pendingFile) return;
  sending = true;
  const body = { chat_id: currentChat, content: text };
  if (pendingFile) {
    // User can force-send images/videos as a plain downloadable file.
    body.msg_type = pendingFile.asFile ? 'file' : pendingFile.kind;
    body.file_path = pendingFile.path;
    body.file_name = pendingFile.name;
  } else {
    body.msg_type = 'text';
  }
  if (pendingReply) body.reply_to = pendingReply.id;
  try {
    const r = await api('/api/message/send', body);
    if (r.ok) {
      appendMsg(r.message);
      input.value = '';
      input.style.height = 'auto';
      pendingFile = null;
      pendingReply = null;
      document.getElementById('attachPreview').classList.remove('show');
      document.getElementById('attachPreview').innerHTML = '';
      document.getElementById('replyPreview').style.display = 'none';
      refreshConvList();
      // Keep the composer focused so the mobile keyboard stays up between
      // messages (Telegram behavior). Refocusing right after a user gesture
      // is within the activation window, so iOS/Android keep it open.
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(0, 0); } catch (_) {}
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
  const raw = m.msg_type === 'image' ? 'تصویر' : m.msg_type === 'file' ? 'فایل' : (m.content || '');
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

function removeMsgRow(mid) {
  const wrapper = document.querySelector('#m' + mid) || document.querySelector(`.mrow[data-mid="${mid}"]`) || document.querySelector(`.sys-msg[data-mid="${mid}"]`);
  if (!wrapper) return;
  const target = wrapper.classList.contains('mrow') ? wrapper : (wrapper.querySelector('.mrow') || wrapper);
  target.remove();
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
      renderAllMessages();
      document.getElementById('pinnedBar').style.display = 'none';
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

/* Long-press on a conversation item (mobile) → same menu as right-click. */
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
}

function localSetPin(mid, pinned) {
  const m = (CD.initialMessages || []).find(x => x.id === mid);
  if (m) m.pinned = pinned;
  const row = document.querySelector(`.mrow[data-mid="${mid}"] .bubble`);
  if (row) row.classList.toggle('pinned', pinned);
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
    : m.msg_type === 'image' ? '[تصویر]' : '[فایل]').join('\n');
  if (!text) return toast('چیزی برای کپی نیست', 'error');
  try { await copyText(text); toast(msgs.length + ' پیام کپی شد'); }
  catch (e) { toast('کپی نشد', 'error'); }
}

document.getElementById('bulkDelete').onclick = bulkDelete;
document.getElementById('bulkCancel').onclick = cancelSelect;
document.getElementById('bulkAllMine').onclick = selectAllMine;
document.getElementById('bulkCopy').onclick = bulkCopy;

async function loadPinned() {
  if (!currentChat) return;
  const r = await fetch('/api/chat/' + currentChat + '/pinned');
  const j = await r.json();
  const bar = document.getElementById('pinnedBar');
  if (!j.pinned) { bar.style.display = 'none'; return; }
  const p = j.pinned;
  let thumb = '';
  let label = p.content || 'پیام';
  if (p.msg_type === 'image' && p.file_url) {
    thumb = `<img class="pin-thumb" src="${p.file_url}" alt="">`;
    label = p.content || 'تصویر';
  } else if (p.msg_type === 'video' && p.file_url) {
    thumb = `<span class="pin-vid">${bi('camera-reels')}</span>`;
    label = p.content || 'ویدیو';
  } else if (p.msg_type === 'audio') {
    label = p.content || 'پیام صوتی';
  } else if (p.msg_type === 'file') {
    label = p.file_name || 'فایل';
  }
  bar.innerHTML = `<span class="pin-bar-icon">${bi('pin-angle-fill')}</span>${thumb}<span class="pin-bar-text"><b>${esc((j.sender || {}).display_name || 'کاربر')}</b><span>${esc(label)}</span></span><button class="pin-unpin" data-unpin="${p.id}" title="لغو پین">${bi('x-lg')}</button>`;
  bar.style.display = 'flex';
  bar.querySelector('.pin-bar-text').onclick = () => {
    const t = document.querySelector(`.mrow[data-mid="${p.id}"]`);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  bar.querySelector('[data-unpin]').onclick = () => {
    api('/api/message/pin', { message_id: +document.querySelector('#pinnedBar [data-unpin]').dataset.unpin }).then(loadPinned);
  };
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
    // CSS centers it (left:50% + translateX); we only pick the vertical spot
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

function renderAttachPreview() {
  const pv = document.getElementById('attachPreview');
  if (!pendingFile) {
    pv.classList.remove('show');
    pv.innerHTML = '';
    return;
  }
  const icon = pendingFile.kind === 'image' ? '' : pendingFile.kind === 'video' ? bi('camera-reels')
    : pendingFile.kind === 'audio' ? bi('headphones') : bi(fileIcon(pendingFile.name));
  const thumb = pendingFile.kind === 'image'
    ? `<img src="${esc(pendingFile.url)}" alt="">`
    : `<span class="ap-ic">${icon}</span>`;
  const size = pendingFile.size ? `<small>${fmtSize(pendingFile.size)}</small>` : '';
  // For images/videos the user can choose to send it as a plain downloadable file.
  const asFileBtn = (pendingFile.kind === 'image' || pendingFile.kind === 'video')
    ? `<button class="${pendingFile.asFile ? 'on' : ''}" data-asfile title="ارسال به‌عنوان فایل (دانلود)">${bi('download')} فایل</button>`
    : '';
  pv.innerHTML = `${thumb}<span class="fname">${esc(pendingFile.name)}${size}</span>${asFileBtn}<button data-clearattach>${bi('x-lg')}</button>`;
  pv.classList.add('show');
}

let uploading = false;
async function handleFiles(file) {
  if (!file || uploading) return;
  uploading = true;
  const pv = document.getElementById('attachPreview');
  pv.innerHTML = `<span class="ap-ic">${bi('hourglass-split')}</span><span class="fname">در حال آپلود…</span>`;
  pv.classList.add('show');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/upload', { method: 'POST', body: fd }).then(x => x.json());
    if (!r.ok) { toast(r.error, 'error'); uploading = false; renderAttachPreview(); return; }
    pendingFile = { path: r.file_path, name: r.file_name, kind: r.kind, url: r.file_url, size: file.size, asFile: false };
    renderAttachPreview();
    document.getElementById('msgInput').focus();
  } catch (err) {
    toast('آپلود ناموفق بود', 'error');
    renderAttachPreview();
  } finally {
    uploading = false;
  }
}

document.getElementById('fileInput').onchange = e => {
  const f = e.target.files[0];
  e.target.value = '';
  handleFiles(f);
};
document.addEventListener('click', e => {
  if (e.target.closest('[data-clearattach]')) {
    pendingFile = null;
    renderAttachPreview();
  }
  if (e.target.closest('[data-asfile]') && pendingFile) {
    pendingFile.asFile = !pendingFile.asFile;
    e.target.closest('[data-asfile]').classList.toggle('on');
  }
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
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  e.preventDefault();
  handleFiles(f);
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

function openMediaViewer(src, kind, name) {
  if (!src) return;
  const v = document.getElementById('mediaViewer');
  const stage = document.getElementById('mvStage');
  stage.innerHTML = kind === 'video'
    ? `<video src="${esc(src)}" controls autoplay playsinline></video>`
    : `<img src="${esc(src)}" alt="${esc(name || '')}">`;
  document.getElementById('mvName').textContent = name || '';
  const dl = document.getElementById('mvDownload');
  dl.href = src;
  dl.setAttribute('download', name || '');
  const op = document.getElementById('mvOpen');
  op.href = src;
  op.style.display = kind === 'video' ? 'none' : '';
  v.classList.add('show');
}
function closeMediaViewer() {
  const v = document.getElementById('mediaViewer');
  if (!v.classList.contains('show')) return;
  v.classList.remove('show');
  document.getElementById('mvStage').innerHTML = '';
}
document.addEventListener('click', e => {
  const media = e.target.closest('[data-media]');
  if (media) {
    e.preventDefault();
    openMediaViewer(media.dataset.src, media.dataset.media, media.dataset.name);
    return;
  }
  if (e.target.id === 'mvClose' || e.target.id === 'mediaViewer' || e.target.id === 'mvStage') closeMediaViewer();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMediaViewer();
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
  document.getElementById('dmAvatar').innerHTML = avatarInner(p.display_name, p.avatar, p.status === 'online');
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
  document.getElementById('csAvatar').innerHTML = c.avatar
    ? '<img src="' + c.avatar + '" alt="">'
    : c.name.charAt(0);
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
  document.getElementById('csAvLabel').innerHTML = c.avatar ? bi('image') + ' آواتار فعلی — برای تغییر عکس جدید انتخاب کن' : bi('camera') + ' انتخاب عکس…';
  document.getElementById('csAvInput').value = '';
  const csPrev = document.getElementById('csAvPrev');
  if (csPrev) csPrev.style.display = 'none';
  document.getElementById('csAvUpload').style.display = canEdit ? 'inline-flex' : 'none';
  document.getElementById('csAvClear').style.display = (canEdit && c.avatar) ? 'inline-flex' : 'none';
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

document.getElementById('chatHeadId').onclick = () => {
  if (CD.chat && CD.chat.chat_type === 'dm' && CD.chat.peer) {
    openDmInfo();
    return;
  }
  openSettings();
};

let _srchMatches = [], _srchIdx = -1;
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
function runChatSearch() {
  const q = document.getElementById('chatSearchInput').value.trim().toLowerCase();
  clearChatSearchMarks();
  _srchMatches = []; _srchIdx = -1;
  const cnt = document.getElementById('chatSearchCount');
  if (!q) { cnt.textContent = ''; return; }
  _srchMatches = (CD.initialMessages || []).filter(m => (m.content || '').toLowerCase().includes(q));
  _srchMatches.forEach(m => {
    const row = document.querySelector(`.mrow[data-mid="${m.id}"]`);
    if (row) row.classList.add('search-hit');
  });
  if (!_srchMatches.length) { cnt.textContent = 'پیدا نشد'; return; }
  goToMatch(0);
}
function goToMatch(i) {
  if (!_srchMatches.length) return;
  _srchIdx = (i + _srchMatches.length) % _srchMatches.length;
  document.querySelectorAll('.mrow.search-cur').forEach(r => r.classList.remove('search-cur'));
  const row = document.querySelector(`.mrow[data-mid="${_srchMatches[_srchIdx].id}"]`);
  if (row) { row.classList.add('search-cur'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  document.getElementById('chatSearchCount').textContent = (_srchIdx + 1) + '/' + _srchMatches.length;
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
    toast('آواتار گپ حذف شد');
    CD.chat.avatar = '';
    document.getElementById('csAvatar').innerHTML = document.getElementById('csName').textContent.charAt(0);
    document.getElementById('csAvLabel').innerHTML = bi('camera') + ' انتخاب عکس…';
    const prev = document.getElementById('csAvPrev');
    if (prev) { prev.style.display = 'none'; prev.src = ''; }
    document.getElementById('csAvInput').value = '';
    document.getElementById('csAvClear').style.display = 'none';
    setHead();
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('csSave').onclick = async () => {
  const role = myRole();
  const canEdit = role === 'owner' || role === 'admin' || window.ME.is_admin;
  const visVal = document.getElementById('csVis').dataset.value;
  const payload = canEdit
    ? {
        name: document.getElementById('csNameInput').value.trim(),
        description: document.getElementById('csDescInput').value.trim(),
        is_public: visVal === 'public'
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
  const sw = document.getElementById('pmSwatches');
  sw.innerHTML = SWATCHES.map(c => `<button data-c="${c}" style="background:${c}" class="${c === window.ME.accent ? 'sel' : ''}"></button>`).join('');
  sw.querySelectorAll('button').forEach(b => b.onclick = () => {
    sw.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    applyAccent(b.dataset.c);
  });
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
  const ad = document.getElementById('pmAdmin');
  if (ad) ad.style.display = window.ME.is_admin ? 'inline-flex' : 'none';
  loadBlocks();
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
    document.getElementById('pmAvatar').innerHTML = avatarInner(window.ME.display_name, r.avatar);
    refreshSideAvatar();
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('pmAvClear').onclick = async () => {
  const fd = new FormData();
  fd.append('delete', '1');
  const r = await fetch('/api/avatar', { method: 'POST', body: fd }).then(x => x.json());
  if (r.ok) {
    toast('عکس حذف شد');
    window.ME.avatar = '';
    document.getElementById('pmAvPrev').style.display = 'none';
    document.getElementById('pmAvClear').style.display = 'none';
    document.getElementById('pmAvatar').innerHTML = avatarInner(window.ME.display_name, '');
    refreshSideAvatar();
    refreshConvList();
  } else toast(r.error, 'error');
};

function refreshSideAvatar() {
  const link = document.getElementById('sideProfileLink');
  if (link) {
    link.innerHTML = avatarHtml(window.ME.display_name, window.ME.avatar);
  }
}

document.getElementById('pmSave').onclick = async () => {
  const sel = document.querySelector('#pmSwatches .sel');
  const r = await api('/api/profile', {
    display_name: document.getElementById('pmDisplayName').value.trim(),
    username: document.getElementById('pmUsernameInput').value.trim(),
    bio: document.getElementById('pmBioInput').value,
    accent: sel ? sel.dataset.c : ''
  });
  if (r.ok) {
    window.ME = Object.assign(window.ME, r.profile);
    applyAccent(window.ME.accent);
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
          <span class="type-icon"><img src="/static/icons/${c.chat_type === 'channel' ? 'channel' : 'group'}.svg" alt=""></span>
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

/* Telegram-style single-message action menu (shared by right-click and
   long-press). Multi-select is a deliberate item inside the menu. */
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
      const next = !m.pinned;
      localSetPin(mid, next);
      api('/api/message/pin', { message_id: mid }).then(j => {
        if (!j.ok) { localSetPin(mid, !next); toast(j.error || 'پین نشد', 'error'); }
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

/* Chat-list context menu (shared by right-click and long-press on mobile).
   Extracted so touch users get the exact same actions as mouse users. */
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
});

S.on('chat_cleared', d => {
  if (d.chat_id === currentChat) {
    CD.initialMessages = [];
    renderAllMessages();
    document.getElementById('pinnedBar').style.display = 'none';
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
  if (currentChat && CD.chat && CD.chat.chat_type === 'dm' && d.user_id === CD.chat.peer.id) {
    CD.chat.peer.status = d.status;
    setHead();
  }
});

S.on('message_pinned', d => {
  loadPinned();
  const row = document.querySelector(`.mrow[data-mid="${d.message_id}"]`);
  if (row) row.querySelector('.bubble').classList.toggle('pinned', d.pinned);
});

S.on('chat_meta', d => {
  if (d.id === currentChat && CD.chat) {
    CD.chat = { ...CD.chat, ...d };
    setHead();
  }
  refreshConvList();
});

S.on('poll_vote', d => {
  if (d.chat_id !== currentChat) return;
  const card = document.querySelector(`.poll-card[data-pollid="${d.poll_id}"]`);
  if (!card) return;
  // Re-render the poll card from the fresh data
  const m = (CD.initialMessages || []).find(x => x.poll && x.poll.id === d.poll_id);
  if (m) {
    m.poll = {
      ...m.poll,
      counts: d.counts, total: d.total,
      voters: d.voters,
      my_votes: d.my_votes, multi: d.multi, closed: d.closed,
      question: m.poll.question, options: m.poll.options,
      expires_at: m.poll.expires_at, created_by: m.poll.created_by,
    };
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

S.on('profile_updated', p => {
  window.ME = Object.assign(window.ME, p);
  refreshSideAvatar();
  const csm = document.getElementById('chatSettingsModal');
  if (csm && csm.classList.contains('show') && currentChat) loadMembers(currentChat);
  if (document.getElementById('myProfilePage').style.display === 'grid') openProfilePage();
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
