const S = io({ transports: ['websocket', 'polling'] });
const CD = window.CHAT_DATA || {};
CD.joined = window.JOINED !== false;
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🙏', '👏', '😍', '🤔', '👌'];
const EMOJI_SETS = [
  { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'] },
  { icon: '👋', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐','🖖','👋','🤝','🙏','✊','👊','🤛','🤜','👏','🙌','👐','🤲','💪','🦾','🖕','✍️','💅','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','🔥','✨','⭐','🌟','💫','💥','💯','🎉','🎊','🎈','🎁'] },
  { icon: '🍔', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🥞','🧇','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🍜','🍝','🍣','🍱','🍛','🍚','🍙','🍘','🍥','🥠','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧋','🥤','🍺','🍻','🥂','🍷','🍸','🍹'] },
  { icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥊','🥋','⛳','⛸','🎿','🛷','🥌','🎯','🪃','🏹','🎣','🤿','🥊','🎽','🛹','🛼','🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍','✈️','🚀','🛸','🚁','⛵','🚤','🛥','🚢'] },
  { icon: '💡', emojis: ['⌚','📱','💻','⌨️','🖥','🖨','🖱','💽','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📟','📠','📺','📻','🧭','⏱','⏰','🕰','⌛','⏳','🔋','🔌','💡','🔦','🕯','🧯','🛢','💸','💵','💴','💶','💷','💰','💳','💎','⚖️','🧰','🔧','🔨','⚒','🛠','⛏','🔩','⚙️','🧱','⛓','🧲','🔫','💣','🧨','🪓','🔪','🗡','⚔️','🛡','🚬','⚰️','🏺','🔮','📿','🧿','💊','💉','🩸','🔬','🔭','📡','💈','⚗️','🧪','🧫','🧬','🩹','🩺','📖','📚','📝','✏️','🖊','🖋','✒️','🖌','🖍','📌','📍','📎','🖇','📐','📏','🧮','📊','📈','📉','🗂','📁','📂','🗞','📰','📓','📔','📒','📕','📗','📘','📙','📃','📄','📑','🔖','🔗','📅','📆','🗓','📇','🗃','🗄','📋','📁'] },
];
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
    `<span class="${e === mine ? 'mine' : ''}" data-emoji="${e}" data-mid="${m.id}">${e} ${n}</span>`
  ).join('');
}

function canPinMsg(m) {
  return (m.sender_id === window.ME.id) || window.ME.is_admin || ['owner', 'admin'].includes(myRole());
}

function lastSenderOf(mid) {
  const msgs = (CD.initialMessages || []).filter(x => !x.deleted);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].id === mid) return i > 0 ? msgs[i - 1].sender_id : null;
  }
  return null;
}

function nextSenderOf(mid) {
  const msgs = (CD.initialMessages || []).filter(x => !x.deleted);
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

function renderMsg(m) {
  if (m.deleted) return '';
  let body = '';
  if (m.msg_type === 'image') {
    body = `<img class="img" src="${m.file_url}" alt="${esc(m.file_name)}" loading="lazy">`;
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'file') {
    body = `<div class="file-card"><div class="fi">📄</div><div><b>${esc(m.file_name)}</b><small>فایل</small></div></div>`;
    if (m.file_url) body += `<a class="btn sm" style="margin-top:6px" href="${m.file_url}" download>⬇ دریافت</a>`;
  } else {
    body = `<div class="txt md">${md(m.content)}</div>`;
  }

  const sender = m.sender_id ? getMember(m.sender_id) : { display_name: 'سیستم', avatar: '' };
  const mine = m.sender_id === window.ME.id;
  const isText = m.msg_type === 'text';
  const hasImg = m.msg_type === 'image';
  const imgOnly = hasImg && !m.content;
  const newGroup = String(m.sender_id) !== String(lastSenderOf(m.id));
  const groupTail = String(nextSenderOf(m.id)) !== String(m.sender_id);
  const reply = m.reply && !m.reply.deleted
    ? `<div class="reply-ref" data-goto="${m.reply.id}"><b>${esc((getMember(m.reply.sender_id) || {}).display_name || 'کاربر')}</b> ${esc(m.reply.content || '(تصویر/فایل)')}</div>`
    : '';
  const pinTag = m.pinned ? '<span class="pin-tag">📌 پین شده</span>' : '';
  const title = (!mine && sender.title) ? ` <span class="member-title" title="لقب در این گروه">${esc(sender.title)}</span>` : '';
  const unameLink = (!mine && sender.username) ? ` <a class="u-link" data-u="${esc(sender.username)}" title="پیوی با ${esc(sender.display_name)}">@${esc(sender.username)}</a>` : '';
  const html = `
    <div class="mrow ${mine ? 'mine-row' : ''} ${newGroup ? 'who' : ''}" data-mid="${m.id}">
      ${mine ? '' : (groupTail ? avBox(sender.display_name, sender.avatar, sender.status === 'online', 'sm') : '<div class="avatar sm ghost"></div>')}
      <div class="bubble ${mine ? 'me' : ''} ${hasImg ? 'has-img' : ''} ${imgOnly ? 'img-only' : ''} ${m.pinned ? 'pinned' : ''} ${!newGroup ? 'compact' : ''}">
        ${mine ? '' : (newGroup ? `<div class="sender-line">${esc(sender.display_name)}${sender.is_verified ? ' ✔' : ''}${title}</div>` : '')}
        ${reply}${body}
        <div class="m-meta">
          ${pinTag}
          ${unameLink}
          <span>${fmtTime(m.created_at)}</span>
          ${m.is_edited ? '<span class="edited">ویرایش شده</span>' : ''}
          ${mine && (isText || hasImg) ? `<span class="ticks" data-mid="${m.id}">✓</span>` : ''}
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
    body.innerHTML = '<div class="empty-msgs">اینجا جای پیام‌هاست. اولین پیام رو تو بفرست 🚀</div>';
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

function appendMsg(m) {
  const body = document.getElementById('msgsBody');
  if (document.getElementById('m' + m.id)) { registerMessage(m); return; }
  registerMessage(m);
  ensureDaySep(m.created_at);
  const own = m.sender_id === window.ME.id;
  body.insertAdjacentHTML('beforeend', `<div id="m${m.id}">${renderMsg(m)}</div>`);
  scrollToBottom(own);
  refreshConvList();
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
  let displayName, subText, av = '';
  const c = CD.chat;
  joinBtn.style.display = 'none';
  repBtn.style.display = 'none';
  peerBtn.style.display = 'none';
  if (c.chat_type === 'dm') {
    const p = c.peer || {};
    displayName = p.display_name || c.name || 'کاربر';
    subText = p.username ? ('@' + p.username + (p.status === 'online' ? ' · آنلاین' : ' · آفلاین')) : '';
    av = p.avatar || '';
    if (p.id) repBtn.style.display = 'grid';
  } else {
    displayName = c.name || (c.chat_type === 'channel' ? 'کانال' : 'گروه');
    const vis = c.is_public ? '🌐 عمومی' : '🔒 خصوصی';
    subText = (c.chat_type === 'channel' ? 'کانال' : 'گروه') + ' · ' + vis + ' · ' + ((c.members || (CD.members || [])).length) + ' عضو';
    av = c.avatar;
    const isMember = CD.role !== null && CD.role !== undefined;
    if (!isMember && !window.ME.is_admin) {
      if (c.is_public) joinBtn.style.display = 'grid';
      else subText += ' · برای ورود دعوت شو';
    }
  }
  headAv.innerHTML = (av ? '<img src="' + av + '" alt="">' : (displayName || '؟').charAt(0));
  name.textContent = displayName;
  sub.textContent = subText;
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
    x.textContent = '✕';
    x.onclick = () => mod.classList.remove('show');
    box.prepend(x);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.show, .report-modal.show').forEach(m => m.classList.remove('show'));
    hidePicker();
    cancelSelect();
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
  const lock = (it.chat_type !== 'dm' && it.is_public === false) ? ' 🔒' : '';
  const av = it.avatar
    ? `<div class="avatar conv-av" style="border-radius:14px"><img src="${it.avatar}" alt=""></div>`
    : `<div class="avatar conv-av" style="border-radius:14px">${esc((it.name || '؟').charAt(0))}</div>`;
  return `
    <div class="conv ${it.chat_id === currentChat ? 'active' : ''}" data-chat-id="${it.chat_id}" data-type="${it.chat_type}" data-name="${esc(it.name || '')}" data-peer="${esc(it.peer_username || '')}" data-owner="${it.owner_id || ''}">
      ${av}
      <div class="body">
        <div class="row1"><b>${esc(it.name)}${lock}</b><time>${fmtTime(it.last_at)}</time></div>
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
    const byCat = { dm: [], group: [], channel: [] };
    j.conversations.forEach(it => {
      byCat[it.chat_type] = byCat[it.chat_type] || [];
      byCat[it.chat_type].push(it);
    });
    for (const cat of ['dm', 'group', 'channel']) {
      const list = document.getElementById('convList' + cat.charAt(0).toUpperCase() + cat.slice(1));
      list.innerHTML = byCat[cat].map(renderConvItem).join('')
        || '<div class="conv-empty">—</div>';
      const head = document.querySelector(`.conv-section-head[data-cat="${cat}"] span`);
      if (head) {
        if (!head.dataset.base) head.dataset.base = head.textContent;
        head.textContent = head.dataset.base + ' (' + byCat[cat].length + ')';
      }
    }
    setActiveConv(currentChat);
  });
}

function initConvHeads() {
  document.querySelectorAll('.conv-section-head span').forEach(s => {
    s.dataset.base = s.textContent;
  });
}

document.addEventListener('click', e => {
  const conv = e.target.closest('.conv');
  if (conv) {
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
  const input = document.createElement('input');
  input.className = 'input edit-input';
  input.value = original;
  input.style.width = '100%';
  txt.replaceWith(input);
  input.focus();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== original) {
      api('/api/message/edit', { message_id: mid, content: v }).then(j => {
        if (j.ok) {
          if (m) m.content = v;
          txt.innerHTML = md(v);
        } else {
          txt.innerHTML = md(original);
          toast(j.error, 'error');
        }
      });
    } else if (v !== original) {
      txt.innerHTML = md(original);
    }
    input.replaceWith(txt);
  };
  input.onkeydown = ev => {
    if (ev.key === 'Enter') finish();
    if (ev.key === 'Escape') { done = true; input.replaceWith(txt); }
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
  p.style.display = 'flex';
  const bw = EMOJIS.length * 34 + 20, bh = 46;
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

function buildEmojiPanel() {
  const tabs = document.getElementById('epTabs');
  const body = document.getElementById('epBody');
  tabs.innerHTML = EMOJI_SETS.map((s, i) =>
    `<button type="button" data-tab="${i}" class="${i === 0 ? 'on' : ''}" title="دسته ${i + 1}">${s.icon}</button>`).join('');
  const renderSet = i => {
    const set = EMOJI_SETS[i];
    body.innerHTML = set.emojis.map(e => `<button type="button" data-em="${e}">${e}</button>`).join('');
    body.scrollTop = 0;
  };
  tabs.querySelectorAll('button').forEach(b => b.onclick = () => {
    tabs.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    renderSet(+b.dataset.tab);
  });
  renderSet(0);
}

function hideEmojiPanel() {
  const p = document.getElementById('emojiPanel');
  if (p) p.style.display = 'none';
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
    if (_lpJustEntered) { _lpJustEntered = false; return; }
    const row = e.target.closest('.mrow');
    if (row && !e.target.closest('a, .reply-ref, .reactions')) {
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
    body.msg_type = pendingFile.kind;
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
  pv.innerHTML = `<span>↩ پاسخ به <b>${esc(pendingReply.name)}</b>: ${esc(pendingReply.preview)}</span><button data-cancels>✕</button>`;
  pv.style.display = 'flex';
  document.getElementById('msgInput').focus();
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-cancels]')) {
    document.getElementById('replyPreview').style.display = 'none';
    pendingReply = null;
  }
});

function toggleSelect(mid) {
  if (selectedIds.has(mid)) selectedIds.delete(mid);
  else selectedIds.add(mid);
  syncSelection();
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
let _lpJustEntered = false;
document.getElementById('msgs').addEventListener('touchstart', e => {
  const row = e.target.closest('.mrow');
  if (!row || selecting) return;
  const mid = +row.dataset.mid;
  _lpTimer = setTimeout(() => {
    _lpTimer = null;
    _lpJustEntered = true;
    if (navigator.vibrate) navigator.vibrate(15);
    enterSelect(mid);
  }, 420);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
  document.getElementById('msgs').addEventListener(ev, () => {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  }, { passive: true }));

function selectAllMine() {
  selectedIds.clear();
  (CD.initialMessages || []).forEach(m => {
    if (!m.deleted && m.sender_id === window.ME.id) selectedIds.add(m.id);
  });
  syncSelection();
}

function localDeleteMid(mid) {
  const m = (CD.initialMessages || []).find(x => x.id === mid);
  if (m) m.deleted = true;
  const row = document.querySelector(`#m${mid}`) || document.querySelector(`.mrow[data-mid="${mid}"]`);
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
  const preview = j.pinned.content || (j.pinned.msg_type === 'image' ? '(تصویر)' : j.pinned.msg_type === 'file' ? '(فایل)' : '(پیام)');
  bar.innerHTML = `<span class="pin-bar-icon">📌</span><span class="pin-bar-text"><b>${esc((j.sender || {}).display_name || 'کاربر')}</b> ${esc(preview).slice(0, 80)}</span><button class="pin-unpin" data-unpin="${j.pinned.id}" title="لغو پین">✕</button>`;
  bar.style.display = 'flex';
  bar.querySelector('.pin-bar-text').onclick = () => {
    const t = document.querySelector(`.mrow[data-mid="${j.pinned.id}"]`);
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

document.getElementById('btnAttach').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  const r = await fetch('/api/upload', { method: 'POST', body: fd }).then(x => x.json());
  if (!r.ok) { toast(r.error, 'error'); e.target.value = ''; return; }
  pendingFile = { path: r.file_path, name: r.file_name, kind: r.kind, url: r.file_url };
  const pv = document.getElementById('attachPreview');
  pv.innerHTML = r.kind === 'image'
    ? `<img src="${r.file_url}"><span class="fname">${esc(f.name)}</span>`
    : `<span class="fname">📄 ${esc(f.name)}</span>`;
  pv.insertAdjacentHTML('beforeend', '<button data-clearattach>✕</button>');
  pv.classList.add('show');
};
document.addEventListener('click', e => {
  if (e.target.closest('[data-clearattach]')) {
    pendingFile = null;
    document.getElementById('attachPreview').classList.remove('show');
    document.getElementById('attachPreview').innerHTML = '';
  }
});

async function loadMembers(chatId) {
  const r = await fetch('/api/chat/' + chatId + '/members').then(x => x.json());
  renderMembers(r.members);
}

function renderMembers(members) {
  CD.members = members;
  const role = myRole();
  const canManage = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';
  const isDm = CD.chat && CD.chat.chat_type === 'dm';
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
    const canTitle = (isOwner || role === 'admin' || isMe) && !isDm;
    return `
    <div class="mb-item" data-mmember="${m.id}">
      <span class="avatar sm">${avatarInner(m.display_name, m.avatar, m.status === 'online')}</span>
      <div class="mb-info">
        <b>${esc(m.display_name)}${m.title ? ` <span class="member-title">${esc(m.title)}</span>` : ''}</b>
        <small>@${esc(m.username)}${m.role === 'owner' ? ' · 👑 صاحب' : m.role === 'admin' ? ' · ⭐ ادمین' : ''}</small>
      </div>
      <div class="mb-actions">
        ${canTitle ? `<button class="btn sm ghost" data-title="${m.id}" title="ویرایش لقب">لقب</button>` : ''}
        ${isOwner && !isMe && m.role !== 'owner' ? `<button class="btn sm" data-promote="${m.id}">${m.role === 'admin' ? 'عضو کن' : '⭐ ادمین'}</button>` : ''}
        ${isOwner && !isMe && m.role !== 'owner' ? `<button class="btn sm ghost" data-transfer="${m.id}" title="انتقال مالکیت">👑</button>` : ''}
        ${canManage && !isMe && m.role !== 'owner' ? `<button class="btn sm danger" data-kick="${m.id}">اخراج</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<div class="mb-empty">عضوی نیست</div>');

  list.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => {
    openConfirm('اخراج عضو', 'این عضو از گپ اخراج می‌شه و دسترسی‌اش قطع می‌شه', () => {
      api(`/api/chat/${currentChat}/members`, { action: 'kick', user_id: +b.dataset.kick }).then(j => j.ok ? loadMembers(currentChat) : toast(j.error, 'error'));
    }, 'اخراج');
  });
  list.querySelectorAll('[data-promote]').forEach(b => b.onclick = () => {
    api(`/api/chat/${currentChat}/members`, { action: 'promote', user_id: +b.dataset.promote }).then(j => j.ok ? (toast('نقش تغییر کرد'), loadMembers(currentChat)) : toast(j.error, 'error'));
  });
  list.querySelectorAll('[data-transfer]').forEach(b => b.onclick = () => {
    openConfirm('انتقال مالکیت', 'مالکیت گروه به این عضو منتقل می‌شه. تو ادمین می‌مونی', () => {
      api(`/api/chat/${currentChat}/members`, { action: 'transfer', user_id: +b.dataset.transfer })
        .then(j => j.ok ? (toast('مالکیت منتقل شد'), loadMembers(currentChat)) : toast(j.error, 'error'));
    }, 'انتقال');
  });
  list.querySelectorAll('[data-title]').forEach(b => b.onclick = () => openTitleGlobal(b.dataset.title));
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
  document.getElementById(prefix + 'Label').textContent = '📷 انتخاب عکس…';
  const prev = document.getElementById(prefix + 'Prev');
  prev.src = '';
  prev.style.display = 'none';
}
['groupAv', 'channelAv'].forEach(p => {
  const inp = document.getElementById(p + 'Input');
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    if (!f) return resetAvPick(p);
    document.getElementById(p + 'Label').textContent = '✓ ' + f.name;
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

document.getElementById('btnNewGroup').onclick = async () => {
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
};
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

document.getElementById('btnNewChannel').onclick = () => {
  document.getElementById('newChannelModal').classList.add('show');
  segSelect(document.getElementById('channelVis'), 'public');
  document.getElementById('channelName').value = '';
  document.getElementById('channelDesc').value = '';
  resetAvPick('channelAv');
};
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
  document.getElementById('dmStatus').textContent = p.status === 'online' ? '🟢 آنلاین' : '⚪ آفلاین';
  document.getElementById('dmBio').textContent = p.bio || 'بیویی نداره';
  document.getElementById('dmFull').href = '/profile/' + encodeURIComponent(p.username || '');
  document.getElementById('dmBlock').textContent = p.blocked ? '✅ لغو بلاک' : '🚫 بلاک';
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
    toast(j.blocked ? 'بلاک شد' : 'بلاک لغو شد', 'success');
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
  const unameInp = document.getElementById('csUsernameInput');
  nameInp.value = c.name;
  descInp.value = c.description || '';
  unameInp.value = c.username || '';
  nameInp.disabled = !canEdit;
  descInp.disabled = !canEdit;
  unameInp.disabled = !canEdit;
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
  document.getElementById('csAvLabel').textContent = c.avatar ? '🖼 آواتار فعلی — برای تغییر عکس جدید انتخاب کن' : '📷 انتخاب عکس…';
  document.getElementById('csAvInput').value = '';
  const csPrev = document.getElementById('csAvPrev');
  if (csPrev) csPrev.style.display = 'none';
  document.getElementById('csAvUpload').style.display = canEdit ? 'inline-flex' : 'none';
  document.getElementById('csAvClear').style.display = (canEdit && c.avatar) ? 'inline-flex' : 'none';
  document.getElementById('csInviteLink').textContent = location.origin + '/chat/' + (c.username || c.id);
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
    document.getElementById('csAvLabel').textContent = '🖼 آواتار جدید ثبت شد';
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
    document.getElementById('csAvLabel').textContent = '📷 انتخاب عکس…';
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
        username: document.getElementById('csUsernameInput').value.trim().toLowerCase(),
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
  document.getElementById('myProfilePage').style.display = 'grid';
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
          <div><b>${esc(u.display_name)}${u.is_verified ? ' ✔' : ''}</b><small>@${esc(u.username)} · ${u.status === 'online' ? 'آنلاین' : 'آفلاین'}</small></div>
        </div>`).join('');
    }
    if (r.chats.length) {
      html += '<h4>گروه‌ها و کانال‌های عمومی</h4>' + r.chats.map(c => `
        <div class="sr-item" data-chat="${c.id}">
          <span class="type-icon"><img src="/static/icons/${c.chat_type === 'channel' ? 'channel' : 'group'}.svg" alt=""></span>
          <div style="flex:1; min-width:0"><b>${esc(c.name)}</b>
          <small>${c.chat_type === 'channel' ? 'کانال' : 'گروه'}${c.username ? ` · @${esc(c.username)}` : ''} ${c.is_public ? '· 🌐 عمومی' : '· 🔒 خصوصی'}${c.is_member ? ' · ✅ عضو هستی' : ''}</small></div>
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

document.addEventListener('contextmenu', e => {
  const msgRow = e.target.closest('.mrow');
  if (msgRow && !msgRow.classList.contains('sel-selected')) {
    e.preventDefault();
    const mid = +msgRow.dataset.mid;
    const m = (CD.initialMessages || []).find(x => x.id === mid) || {};
    const mine = m.sender_id === window.ME.id;
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'واکنش بده', icon: '🙂', fn: () => openEmojiPicker(mid, e.clientX, e.clientY) },
      { label: 'پاسخ', icon: '↩', fn: () => openReply(mid) },
      m.content ? { label: 'کپی متن', icon: '📋', fn: () => {
        copyText(m.content).then(() => toast('کپی شد')).catch(() => toast('کپی نشد', 'error'));
      } } : null,
      canPinMsg(m) ? { label: m.pinned ? 'لغو پین' : 'پین کردن', icon: m.pinned ? '📌' : '📍', fn: () => {
        const next = !m.pinned;
        localSetPin(mid, next);
        api('/api/message/pin', { message_id: mid }).then(j => {
          if (!j.ok) { localSetPin(mid, !next); toast(j.error || 'پین نشد', 'error'); }
        });
      } } : null,
      { label: selecting ? 'خروج از حالت انتخاب' : 'انتخاب و حذف گروهی', icon: '☑', fn: () => (selecting ? cancelSelect() : enterSelect(mid)) },
      (mine && m.msg_type === 'text') ? { label: 'ویرایش', icon: '✎', fn: () => {
        const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
        if (row) editMessage(mid, row);
      } } : null,
      (mine || window.ME.is_admin) ? { label: 'حذف پیام', icon: '🗑', danger: true, fn: () => {
        localDeleteMid(mid);
        api('/api/message/delete', { message_id: mid }).then(j => {
          if (!j.ok) { renderAllMessages(); toast(j.error || 'حذف نشد', 'error'); }
        });
      } } : null,
      (!mine && m.sender_id) ? { label: 'گزارش فرستنده', icon: '🚨', danger: true, fn: () => {
        openReport({ id: m.sender_id, display_name: (getMember(m.sender_id) || {}).display_name }, m.id);
      } } : null,
    ]);
    return;
  }

  const conv = e.target.closest('.conv');
  if (conv) {
    e.preventDefault();
    const chatId = +conv.dataset.chatId;
    const type = conv.dataset.type;
    const isDm = type === 'dm';
    const peerName = conv.dataset.peer || '';
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'باز کردن', icon: '💬', fn: () => openChat(chatId) },
      { label: 'خواندن نشانه‌گذاری', icon: '✓', fn: () => api('/api/mark-read', { chat_id: chatId }).then(() => {
        clearUnread(chatId);
        refreshConvList();
      }) },
      !isDm ? { label: 'تنظیمات گپ', icon: '⚙', fn: () => openChat(chatId).then(openSettings) } : null,
      !isDm && CD.chat && +CD.chat.id === chatId && CD.role && CD.role !== 'owner' ? {
        label: 'ترک گروه / کانال', icon: '🚪', danger: true, fn: () => {
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
      isDm && peerName ? { label: 'پروفایل ' + peerName, icon: '👤', fn: () => openChat(chatId).then(openDmInfo) } : null,
      isDm && peerName ? { label: 'گزارش کاربر', icon: '🚨', danger: true, fn: () => openChat(chatId).then(() => {
        if (CD.chat && CD.chat.peer) openReport(CD.chat.peer);
      }) } : null,
      isDm && peerName ? { label: 'بلاک کردن', icon: '🚫', danger: true, fn: () => openChat(chatId).then(() => {
        const p = CD.chat && CD.chat.peer;
        if (!p) return;
        api('/api/block', { user_id: p.id }).then(j => toast(j.blocked ? 'بلاک شد' : 'بلاک لغو شد', 'success'));
      }) } : null,
      !isDm ? { label: 'حذف گروه / کانال', icon: '🗑', danger: true, fn: () => {
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
      isDm ? { label: 'حذف گپ', icon: '🗑', danger: true, fn: () => {
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
});

if (CD.chat) {
  setHead();
  renderAllMessages();
  loadPinned();
  refreshConvList();
  setChatted(true);
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
    refreshConvList();
    return;
  }
  if (m.chat_id === currentChat) {
    appendMsg(m);
    api('/api/mark-read', { chat_id: m.chat_id });
  } else {
    refreshConvList();
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
  const wrapper = document.querySelector(`#m${d.message_id}`) || document.querySelector(`.mrow[data-mid="${d.message_id}"]`);
  if (wrapper) {
    const row = wrapper.classList.contains('mrow') ? wrapper : wrapper.querySelector('.mrow');
    const target = row ? row.closest('#m' + d.message_id) || row : wrapper;
    target.remove();
  }
});

S.on('read_recept', d => {
  if (d.chat_id !== currentChat) return;
  document.querySelectorAll('.mrow .ticks').forEach(t => t.textContent = '✓✓');
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
