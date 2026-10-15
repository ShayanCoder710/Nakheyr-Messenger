const S = io({ transports: ['websocket', 'polling'] });
const CD = window.CHAT_DATA || {};
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎯', '🙌'];
const SWATCHES = ['#e11d48', '#f43f5e', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#64748b'];

let currentChat = window.CURRENT_CHAT;
let pendingFile = null;
let pendingReply = null;
let selectedIds = new Set();
let typingTimers = {};
let typingSent = false;

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

function renderMsg(m) {
  let body = '';
  if (m.deleted) {
    body = '<span class="msg-deleted">پیام حذف شده</span>';
  } else if (m.msg_type === 'image') {
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
  const reply = m.reply && !m.reply.deleted
    ? `<div class="reply-ref" data-goto="${m.reply.id}"><b>${esc((getMember(m.reply.sender_id) || {}).display_name || 'کاربر')}</b> ${esc(m.reply.content || '(تصویر/فایل)')}</div>`
    : '';
  const pinTag = m.pinned ? '<span class="pin-tag">📌 پین شده</span>' : '';
  const title = (!mine && sender.title) ? ` <span class="member-title" title="لقب در این گروه">${esc(sender.title)}</span>` : '';
  const unameLink = (!mine && sender.username) ? ` <a class="u-link" data-u="${esc(sender.username)}" title="پیوی با ${esc(sender.display_name)}">@${esc(sender.username)}</a>` : '';
  const actions = `
    <div class="m-actions">
      <button data-reactopen="${m.id}" title="واکنش">🙂</button>
      <button data-reply="${m.id}" title="پاسخ">↩</button>
      ${canPinMsg(m) ? `<button data-pin="${m.id}" title="پین">${m.pinned ? '📌' : '📍'}</button>` : ''}
      <button data-copy="${m.id}" title="کپی متن">📋</button>
      <button data-sel="${m.id}" title="انتخاب">☑</button>
      ${mine ? `<button data-edit="${m.id}" title="ویرایش">✎</button>` : ''}
      ${(mine || window.ME.is_admin) ? `<button data-del="${m.id}" title="حذف">🗑</button>` : ''}
      ${!mine && m.sender_id ? `<button data-report-sender="${m.sender_id}" title="گزارش فرستنده">🚨</button>` : ''}
    </div>
    <div class="emoji-pick" data-pick="${m.id}">${EMOJIS.slice(0, 6).map(e => `<button data-react="${m.id}" data-emoji="${e}">${e}</button>`).join('')}</div>`;
  const html = `
    <div class="mrow ${mine ? 'mine-row' : ''}" data-mid="${m.id}">
      ${mine ? '' : `<div class="avatar sm">${avatarHtml(sender.display_name, sender.avatar, sender.status === 'online')}</div>`}
      <div class="bubble ${mine ? 'me' : ''} ${m.pinned ? 'pinned' : ''}">
        ${mine ? '' : `<div class="sender-line">${esc(sender.display_name)}${sender.is_verified ? ' ✔' : ''}${title}</div>`}
        ${reply}${body}
        <div class="m-meta">
          ${pinTag}
          ${unameLink}
          <span>${fmtTime(m.created_at)}</span>
          ${m.is_edited ? '<span class="edited">ویرایش شده</span>' : ''}
          ${mine && m.msg_type === 'text' ? `<span class="ticks" data-mid="${m.id}">✓</span>` : ''}
        </div>
        <div class="reactions" data-mid="${m.id}">${reactionChips(m)}</div>
        ${actions}
      </div>
    </div>`;
  return html;
}

function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  return d.toDateString();
}

function lastDayKey() {
  const seps = document.querySelectorAll('#msgsBody .day-sep');
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
  if (CD.initialMessages && CD.initialMessages.length) {
    let lastRaw = null;
    CD.initialMessages.forEach(m => {
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
}

function registerMessage(m) {
  if (!CD.initialMessages) CD.initialMessages = [];
  if (!CD.initialMessages.find(x => x.id === m.id)) CD.initialMessages.push(m);
}

function appendMsg(m) {
  const body = document.getElementById('msgs');
  if (document.getElementById('m' + m.id)) { registerMessage(m); return; }
  registerMessage(m);
  ensureDaySep(m.created_at);
  const own = m.sender_id === window.ME.id;
  body.insertAdjacentHTML('beforeend', `<div id="m${m.id}">${renderMsg(m)}</div>`);
  scrollToBottom(own);
  refreshConvList();
}

function setHead() {
  const headAv = document.getElementById('chatHeadAvatar');
  const name = document.getElementById('chatHeadName');
  const sub = document.getElementById('chatHeadSub');
  const strip = document.getElementById('membersStrip');
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
    const p = c.peer;
    displayName = p.display_name;
    subText = '@' + p.username + (p.status === 'online' ? ' · آنلاین' : ' · آفلاین');
    av = p.avatar;
    strip.style.display = 'none';
    repBtn.style.display = 'grid';
  } else {
    displayName = c.name;
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
  if (c.chat_type !== 'dm' && (CD.members || []).length > 1) {
    strip.style.display = 'flex';
    strip.innerHTML = (CD.members || []).map(m =>
      `<span class="chip" data-member="${m.id}" title="راست کلیک برای گزینه‌ها"><span class="avatar sm">${avatarHtml(m.display_name, m.avatar, m.status === 'online')}</span>${esc(m.display_name)}${m.role === 'owner' ? ' <span class="crown">👑</span>' : m.role === 'admin' ? ' <span class="crown">⭐</span>' : ''}${m.title ? ` <span class="member-title">${esc(m.title)}</span>` : ''}</span>`
    ).join('');
  } else if (c.chat_type !== 'dm') {
    strip.style.display = 'none';
  }
  if (isPeer()) {
    const p = c.peer;
    peerBtn.style.display = 'grid';
    peerBtn.href = '/profile/' + p.username;
    repBtn.dataset.target = p.id;
    repBtn.dataset.name = p.display_name;
    repBtn.style.display = 'grid';
  }
}

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

let _titleTarget = null;
function openTitleGlobal(userId) {
  const m = (CD.members || []).find(x => x.id === +userId);
  if (!m) return;
  _titleTarget = +userId;
  document.getElementById('tmAvatar').innerHTML = avatarHtml(m.display_name, m.avatar, m.status === 'online');
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
document.getElementById('titleModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('titleModal').classList.remove('show');
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

async function openChat(id) {
  currentChat = +id;
  const r = await fetch('/api/messages/' + id);
  let j;
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok || !j.chat) {
    CD.chat = null;
    CD.role = null;
    CD.members = [];
    document.getElementById('msgsPane').classList.remove('open');
    document.getElementById('mainEmpty').style.display = 'grid';
    currentChat = null;
    toast('دسترسی به این گپ نداری', 'error');
    refreshConvList();
    return;
  }
  CD.initialMessages = j.messages || [];
  if (j.chat) {
    CD.chat = j.chat;
    CD.role = j.role;
    CD.members = j.members;
  } else {
    CD.chat = null;
    CD.role = null;
    CD.members = [];
    document.getElementById('msgsPane').classList.remove('open');
    document.getElementById('mainEmpty').style.display = 'grid';
    currentChat = null;
    toast('دسترسی به این گپ نداری', 'error');
    refreshConvList();
    return;
  }
  setHead();
  document.getElementById('mainEmpty').style.display = 'none';
  document.getElementById('msgsPane').classList.add('open');
  document.getElementById('msgsBody').innerHTML = '';
  selectedIds.clear();
  document.getElementById('bulkBar').style.display = 'none';
  pendingReply = null;
  document.getElementById('replyPreview').style.display = 'none';
  renderAllMessages();
  api('/api/mark-read', { chat_id: currentChat });
  clearUnread(id);
  setActiveConv(id);
  S.emit('stop_typing', { chat_id: currentChat });
  typingSent = false;
  loadPinned();
}

function renderConvItem(it) {
  const lock = (it.chat_type !== 'dm' && it.is_public === false) ? ' 🔒' : '';
  const av = it.avatar
    ? `<div class="avatar conv-av" style="border-radius:14px"><img src="${it.avatar}" alt=""></div>`
    : `<div class="avatar conv-av" style="border-radius:14px">${esc((it.name || '؟').charAt(0))}</div>`;
  return `
    <div class="conv ${it.chat_id === currentChat ? 'active' : ''}" data-chat-id="${it.chat_id}" data-type="${it.chat_type}" data-name="${esc(it.name || '')}" data-peer="${esc(it.peer_username || '')}">
      ${av}
      <div class="body">
        <div class="row1"><b>${esc(it.name)}${lock}</b><time>${fmtTime(it.last_at)}</time></div>
        <div class="row2"><span>${esc(it.last)}</span>${it.unread ? `<span class="unread-pill">${it.unread}</span>` : ''}</div>
      </div>
    </div>`;
}

function refreshConvList() {
  fetch('/api/conversations').then(r => r.json()).then(j => {
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
  const input = document.createElement('input');
  input.className = 'input edit-input';
  input.value = txt.textContent;
  input.style.width = '100%';
  txt.replaceWith(input);
  input.focus();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== txt.textContent) {
      api('/api/message/edit', { message_id: mid, content: v }).then(j => {
        if (j.ok) txt.innerHTML = md(v);
        else { txt.innerHTML = md(txt.textContent); toast(j.error, 'error'); }
      });
    }
    input.replaceWith(txt);
  };
  input.onkeydown = ev => {
    if (ev.key === 'Enter') finish();
    if (ev.key === 'Escape') { done = true; input.replaceWith(txt); }
  };
  input.onblur = finish;
}

function closeAllPickers() {
  document.querySelectorAll('.emoji-pick').forEach(p => p.style.display = 'none');
}

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

  const pick = e.target.closest('[data-pick] button');
  if (pick) {
    const mi = +pick.closest('.mrow').dataset.mid;
    doReact(mi, pick.dataset.emoji);
    closeAllPickers();
    return;
  }

  const reactOpen = e.target.closest('[data-reactopen]');
  if (reactOpen) {
    const row = reactOpen.closest('.mrow');
    const picker = row.querySelector('.emoji-pick');
    document.querySelectorAll('.emoji-pick').forEach(p => p.style.display = 'none');
    picker.style.display = 'flex';
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

  const reactBtn = e.target.closest('[data-react]');
  if (reactBtn) {
    doReact(+reactBtn.dataset.mid, reactBtn.dataset.emoji);
    return;
  }

  const replyBtn = e.target.closest('[data-reply]');
  if (replyBtn) {
    openReply(+replyBtn.dataset.reply);
    return;
  }

  const pinBtn = e.target.closest('[data-pin]');
  if (pinBtn) {
    const mid = +pinBtn.dataset.pin;
    const m = (CD.initialMessages || []).find(x => x.id === mid) || {};
    const next = !m.pinned;
    localSetPin(mid, next);
    api('/api/message/pin', { message_id: mid }).then(j => {
      if (!j.ok) { localSetPin(mid, !next); toast(j.error || 'پین نشد', 'error'); }
    });
    return;
  }

  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const m = (CD.initialMessages || []).find(x => x.id === +copyBtn.dataset.copy);
    if (m && m.content) {
      navigator.clipboard.writeText(m.content).then(() => toast('کپی شد'))
        .catch(() => toast('کپی نشد', 'error'));
    }
    return;
  }

  const selBtn = e.target.closest('[data-sel]');
  if (selBtn) {
    toggleSelect(+selBtn.dataset.sel);
    return;
  }

  const del = e.target.closest('[data-del]');
  if (del && del.dataset.del) {
    if (confirm('پیام حذف بشه؟')) {
      const mid = +del.dataset.del;
      localDeleteMid(mid);
      api('/api/message/delete', { message_id: mid }).then(j => {
        if (!j.ok) { renderAllMessages(); toast(j.error || 'حذف نشد', 'error'); }
      });
    }
    return;
  }

  const repSender = e.target.closest('[data-report-sender]');
  if (repSender) {
    const uid = +repSender.dataset.reportSender;
    const u = getMember(uid);
    openReport({ id: uid, display_name: u.display_name });
    return;
  }
});

let sending = false;
async function sendText() {
  if (sending) return;
  const input = document.getElementById('msgInput');
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
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    e.stopPropagation();
    editMessage(ed.dataset.edit, ed.closest('.mrow'));
  }
});

function toggleSelect(mid) {
  if (selectedIds.has(mid)) selectedIds.delete(mid);
  else selectedIds.add(mid);
  document.querySelectorAll('.mrow').forEach(r => r.classList.toggle('sel-selected', selectedIds.has(+r.dataset.mid)));
  document.getElementById('bulkBar').style.display = selectedIds.size ? 'flex' : 'none';
  document.getElementById('bulkCount').textContent = selectedIds.size + ' پیام انتخاب شده';
}

function localDeleteMid(mid) {
  const m = (CD.initialMessages || []).find(x => x.id === mid);
  if (m) { m.deleted = true; m.content = ''; }
  const row = document.querySelector(`#m${mid}`) || document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (row) {
    const inner = row.classList.contains('mrow') ? row : row.querySelector('.mrow');
    const wrap = inner.closest('#m' + mid) || inner;
    wrap.outerHTML = `<div class="mrow" data-mid="${mid}"><div class="bubble"><span class="msg-deleted">پیام حذف شده</span></div></div>`;
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
    selectedIds.clear();
    document.querySelectorAll('.mrow').forEach(x => x.classList.remove('sel-selected'));
    document.getElementById('bulkBar').style.display = 'none';
    const rr = await fetch('/api/messages/' + currentChat);
    CD.initialMessages = (await rr.json()).messages;
    document.getElementById('msgsBody').innerHTML = '';
    renderAllMessages();
  } else toast(r.error, 'error');
}

document.getElementById('bulkDelete').onclick = bulkDelete;
document.getElementById('bulkCancel').onclick = () => {
  selectedIds.clear();
  document.querySelectorAll('.mrow').forEach(x => x.classList.remove('sel-selected'));
  document.getElementById('bulkBar').style.display = 'none';
};

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
});

document.getElementById('btnAttach').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = async e => {
  const f = e.target.files[0];
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
  const ml = document.getElementById('memberList');
  const role = myRole();
  const canManage = role === 'owner' || role === 'admin';
  ml.innerHTML = `
    <div class="ml-head">
      <b>اعضا (${members.length})</b>
      ${canManage ? `
        <div class="ml-add">
          <input class="input ml-add-input" id="mlAddInput" placeholder="نام کاربری برای دعوت">
          <button class="btn sm" id="mlAddBtn">+</button>
        </div>` : ''}
    </div>
    <div class="ml-list">` + members.map(m => {
      const canTitle = (role === 'owner' || role === 'admin' || m.id === window.ME.id) && CD.chat && CD.chat.chat_type !== 'dm';
      return `
      <div class="item" data-mmember="${m.id}">
        <span class="avatar sm">${avatarHtml(m.display_name, m.avatar, m.status === 'online')}</span>
        <div style="flex:1"><b style="font-size:13px">${esc(m.display_name)}</b>
          ${m.title ? `<span class="member-title" title="لقب">${esc(m.title)}</span>` : ''}
          <small style="display:block">@${esc(m.username)}${m.role === 'owner' ? ' · 👑 صاحب' : m.role === 'admin' ? ' · ⭐ ادمین' : ''}</small>
        </div>
        ${canTitle ? `<button class="btn sm ghost" data-title="${m.id}" data-cur="${esc(m.title)}">لقب</button>` : ''}
        ${role === 'owner' && m.id !== window.ME.id ? `<button class="btn sm" data-kick="${m.id}">اخراج</button>` : ''}
        ${role === 'owner' && m.role !== 'owner' ? `<button class="btn sm" data-promote="${m.id}">${m.role === 'admin' ? 'عضو' : '⭐'}</button>` : ''}
        ${role === 'owner' && m.role !== 'owner' ? `<button class="btn sm ghost" data-transfer="${m.id}" title="انتقال مالکیت">👑</button>` : ''}
      </div>`;
    }).join('') + `</div>`;

  ml.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => {
    if (confirm('این عضو اخراج بشه؟'))
      api(`/api/chat/${currentChat}/members`, { action: 'kick', user_id: +b.dataset.kick }).then(j => j.ok ? loadMembers(currentChat) : toast(j.error, 'error'));
  });
  ml.querySelectorAll('[data-promote]').forEach(b => b.onclick = () => {
    api(`/api/chat/${currentChat}/members`, { action: 'promote', user_id: +b.dataset.promote }).then(j => j.ok ? loadMembers(currentChat) : toast(j.error, 'error'));
  });
  ml.querySelectorAll('[data-transfer]').forEach(b => b.onclick = () => {
    if (confirm('مالکیت گروه به این عضو منتقل بشه؟ تو ادمین می‌مونی.'))
      api(`/api/chat/${currentChat}/members`, { action: 'transfer', user_id: +b.dataset.transfer })
        .then(j => j.ok ? (toast('مالکیت منتقل شد'), loadMembers(currentChat)) : toast(j.error, 'error'));
  });
  ml.querySelectorAll('[data-title]').forEach(b => b.onclick = () => openTitleGlobal(b.dataset.title));
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

document.getElementById('btnMembers').onclick = async function () {
  if (!currentChat) return;
  const ml = document.getElementById('memberList');
  if (ml.classList.contains('show')) { ml.classList.remove('show'); return; }
  await loadMembers(currentChat);
  ml.classList.add('show');
};
document.addEventListener('click', e => {
  if (!e.target.closest('#memberList') && !e.target.closest('#btnMembers')) {
    document.getElementById('memberList').classList.remove('show');
  }
}, true);

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

document.getElementById('btnNewGroup').onclick = async () => {
  const modal = document.getElementById('newGroupModal');
  modal.classList.add('show');
  segSelect(document.getElementById('groupVis'), 'public');
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
  const r = await fetch('/api/search?q=').then(x => x.json());
  document.getElementById('groupMemberPick').innerHTML = r.users.filter(u => !u.is_banned).map(u =>
    `<label><input type="checkbox" value="${u.id}"><span class="avatar sm">${avatarHtml(u.display_name, u.avatar)}</span>${esc(u.display_name)}</label>`
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
    document.getElementById('newGroupModal').classList.remove('show');
    toast('گروه ساخته شد');
    openChat(r.chat_id);
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('btnNewChannel').onclick = () => {
  document.getElementById('newChannelModal').classList.add('show');
  segSelect(document.getElementById('channelVis'), 'public');
  document.getElementById('channelName').value = '';
  document.getElementById('channelDesc').value = '';
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
    document.getElementById('newChannelModal').classList.remove('show');
    toast('کانال ساخته شد');
    openChat(r.chat_id);
    refreshConvList();
  } else toast(r.error, 'error');
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
    if (!vis.dataset.note) vis.insertAdjacentHTML('beforeend', `<small class="cs-note">تغییرات فقط برای صاحب و ادمین گپ</small>`);
    else vis.querySelector('.cs-note').style.display = 'block';
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
  document.getElementById('csInviteLink').textContent = location.origin + '/chat/' + c.id;
  renderSettingsMembers(c);
  const leave = document.getElementById('csLeave');
  leave.style.display = (c.chat_type !== 'dm' && role && role !== 'owner') ? 'inline-flex' : 'none';
  document.getElementById('chatSettingsModal').classList.add('show');
}

function renderSettingsMembers(c) {
  const members = CD.members || [];
  document.getElementById('csMembersHead').textContent = 'اعضا (' + members.length + ')';
  document.getElementById('csMembersList').innerHTML = members.map(m => `
    <div class="mb-item">
      <span class="avatar sm">${avatarHtml(m.display_name, m.avatar, m.status === 'online')}</span>
      <div style="flex:1; min-width:0">
        <b>${esc(m.display_name)}${m.title ? ` <span class="member-title">${esc(m.title)}</span>` : ''}</b>
        <small>@${esc(m.username)}${m.role === 'owner' ? ' · 👑 صاحب' : m.role === 'admin' ? ' · ⭐ ادمین' : ''}</small>
      </div>
    </div>`).join('') || '<div style="padding:10px; font-size:12px; color:var(--dim)">عضویی نیست</div>';
}

document.getElementById('chatHeadId').onclick = openSettings;
document.getElementById('csClose').onclick = () => document.getElementById('chatSettingsModal').classList.remove('show');
document.querySelectorAll('#csVis button').forEach(b => b.onclick = () => segSelect(document.getElementById('csVis'), b.dataset.val));

document.getElementById('csCopyInvite').onclick = () => {
  const link = document.getElementById('csInviteLink').textContent;
  navigator.clipboard.writeText(link).then(() => toast('لینک کپی شد')).catch(() => toast('کپی نشد', 'error'));
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

document.getElementById('csLeave').onclick = async () => {
  const r = await api('/api/chat/' + currentChat + '/members', { action: 'leave' });
  if (r.ok) {
    toast('از گپ خارج شدی');
    document.getElementById('chatSettingsModal').classList.remove('show');
    currentChat = null;
    document.getElementById('msgsPane').classList.remove('open');
    document.getElementById('mainEmpty').style.display = 'grid';
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('sideProfileLink').addEventListener('click', e => {
  e.preventDefault();
  openProfilePage();
});

function openProfilePage() {
  document.querySelector('.chat-layout').style.display = 'none';
  document.getElementById('myProfilePage').style.display = 'grid';
  const av = document.getElementById('pmAvatar');
  av.innerHTML = avatarHtml(window.ME.display_name, window.ME.avatar).replace('<div class="avatar', '<div class="avatar lg"');
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
    document.getElementById('pmAvatar').innerHTML = avatarHtml(window.ME.display_name, r.avatar).replace('<div class="avatar"', '<div class="avatar lg"');
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
    document.getElementById('pmAvatar').innerHTML = avatarHtml(window.ME.display_name, '').replace('<div class="avatar', '<div class="avatar lg"');
    refreshSideAvatar();
    refreshConvList();
  } else toast(r.error, 'error');
};

function refreshSideAvatar() {
  const side = document.querySelector('.side-head .avatar, #sideProfileLink');
  if (side) {
    side.innerHTML = avatarHtml(window.ME.display_name, window.ME.avatar);
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
    let html = '';
    if (r.users.length) {
      html += '<h4>افراد</h4>' + r.users.map(u => `
        <div class="sr-item" data-uid="${u.id}" data-username="${esc(u.username)}">
          <span class="avatar">${avatarHtml(u.display_name, u.avatar, u.status === 'online')}</span>
          <div><b>${esc(u.display_name)}${u.is_verified ? ' ✔' : ''}</b><small>@${esc(u.username)} · ${u.status === 'online' ? 'آنلاین' : 'آفلاین'}</small></div>
        </div>`).join('');
    }
    if (r.chats.length) {
      html += '<h4>گروه‌ها و کانال‌های عمومی</h4>' + r.chats.map(c => `
        <div class="sr-item" data-chat="${c.id}">
          <span class="type-icon">${c.chat_type === 'channel' ? '📢' : '👥'}</span>
          <div style="flex:1; min-width:0"><b>${esc(c.name)}</b>
          <small>${c.chat_type === 'channel' ? 'کانال' : 'گروه'} ${c.is_public ? '· 🌐 عمومی' : '· 🔒 خصوصی'}${c.is_member ? ' · ✅ عضو هستی' : ''}</small></div>
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
      { label: 'واکنش بده', icon: '🙂', fn: () => {
          const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
          if (!row) return;
          document.querySelectorAll('.emoji-pick').forEach(p => p.style.display = 'none');
          row.querySelector('.emoji-pick').style.display = 'flex';
        }
      },
      { label: 'پاسخ', icon: '↩', fn: () => openReply(mid) },
      m.content ? { label: 'کپی متن', icon: '📋', fn: () => {
        navigator.clipboard.writeText(m.content).then(() => toast('کپی شد')).catch(() => toast('کپی نشد', 'error'));
      } } : null,
      canPinMsg(m) ? { label: m.pinned ? 'لغو پین' : 'پین کردن', icon: m.pinned ? '📌' : '📍', fn: () => {
        const next = !m.pinned;
        localSetPin(mid, next);
        api('/api/message/pin', { message_id: mid }).then(j => {
          if (!j.ok) { localSetPin(mid, !next); toast(j.error || 'پین نشد', 'error'); }
        });
      } } : null,
      { label: 'انتخاب (حذف گروهی)', icon: '☑', fn: () => toggleSelect(mid) },
      (mine || window.ME.is_admin) ? { label: 'حذف پیام', icon: '🗑', danger: true, fn: () => {
        if (confirm('پیام حذف بشه؟')) {
          localDeleteMid(mid);
          api('/api/message/delete', { message_id: mid }).then(j => {
            if (!j.ok) { renderAllMessages(); toast(j.error || 'حذف نشد', 'error'); }
          });
        }
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
          if (confirm('از این گپ خارج بشی؟')) api('/api/chat/' + chatId + '/members', { action: 'leave' }).then(j => {
            if (j.ok) { toast('خارج شدی'); refreshConvList(); }
            else toast(j.error, 'error');
          });
        }
      } : null,
      isDm && peerName ? { label: 'پروفایل ' + peerName, icon: '👤', fn: () => openChat(chatId).then(() => {
        const p = CD.chat && CD.chat.peer;
        if (p) location.href = '/profile/' + p.username;
      }) } : null,
      isDm && peerName ? { label: 'گزارش کاربر', icon: '🚨', danger: true, fn: () => openChat(chatId).then(() => {
        if (CD.chat && CD.chat.peer) openReport(CD.chat.peer);
      }) } : null,
      isDm && peerName ? { label: 'بلاک کردن', icon: '🚫', danger: true, fn: () => openChat(chatId).then(() => {
        const p = CD.chat && CD.chat.peer;
        if (!p) return;
        api('/api/block', { user_id: p.id }).then(j => toast(j.blocked ? 'بلاک شد' : 'بلاک لغو شد', 'success'));
      }) } : null,
    ]);
  }
});

if (CD.chat) {
  setHead();
  renderAllMessages();
  loadPinned();
  refreshConvList();
} else {
  refreshConvList();
}
initConvHeads();

S.on('connect', () => {});
S.on('auth_required', () => { toast('نشستت باطله، دوباره وارد شو', 'error'); setTimeout(() => location.href = '/login', 1500); });

S.on('new_message', m => {
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
  const wrapper = document.querySelector(`#m${d.message_id}`) || document.querySelector(`.mrow[data-mid="${d.message_id}"]`);
  if (wrapper) {
    const row = wrapper.classList.contains('mrow') ? wrapper : wrapper.querySelector('.mrow');
    if (row) row.outerHTML = `<div class="mrow" data-mid="${d.message_id}"><div class="bubble"><span class="msg-deleted">پیام حذف شده</span></div></div>`;
    else wrapper.remove();
  }
});

S.on('read_recept', d => {
  if (d.chat_id !== currentChat) return;
  document.querySelectorAll('.mrow .ticks').forEach(t => t.textContent = '✓✓');
});

S.on('typing', d => {
  if (d.chat_id !== currentChat) return;
  typingTimers[d.user_id] = setTimeout(() => renderTyping(), 1800);
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
  if (typingTimers[d.user_id]) { clearTimeout(typingTimers[d.user_id]); typingTimers[d.user_id] = null; renderTyping(); }
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

S.on('profile_updated', p => {
  window.ME = Object.assign(window.ME, p);
  const ml = document.getElementById('memberList');
  if (ml.classList.contains('show') && currentChat) loadMembers(currentChat);
  if (document.getElementById('myProfilePage').style.display === 'grid') openProfilePage();
});
