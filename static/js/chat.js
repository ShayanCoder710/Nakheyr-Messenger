const S = io({ transports: ['websocket', 'polling'] });
const CD = window.CHAT_DATA || {};
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const SWATCHES = ['#e11d48', '#f43f5e', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#64748b'];

let currentChat = window.CURRENT_CHAT;
let pendingFile = null;
let pendingReply = null;
let selectedIds = new Set();
let selectMode = false;
let ephemeralMode = false;
let hangman = CD.game ? JSON.parse(JSON.stringify(CD.game)) : null;
let typingTimers = {};

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
    `<span class="${e === mine ? 'mine' : ''}" data-emoji="${e}">${e} ${n}</span>`
  ).join('');
}

function renderMsg(m) {
  let body = '';
  if (m.deleted) {
    body = '<span class="msg-deleted">پیام حذف شده</span>';
  } else if (m.msg_type === 'image') {
    body = `<img class="img" src="${m.file_url}" alt="${esc(m.file_name)}" loading="lazy">`;
    if (m.content) body += `<div class="txt">${esc(m.content)}</div>`;
  } else if (m.msg_type === 'file') {
    body = `<div class="file-card"><div class="fi">📄</div><div><b>${esc(m.file_name)}</b><small>دانلود</small></div></div>`;
    if (m.file_url) body += `<a class="btn sm" style="margin-top:6px" href="${m.file_url}" download>⬇ دریافت</a>`;
  } else if (m.msg_type === 'ephemeral') {
    const viewed = (m.viewed_by || []).includes(String(window.ME.id));
    body = viewed
      ? `<span class="ephemeral-tag">🕒 سوخته</span> <div class="txt">${esc(m.content)}</div>
         <small style="color:var(--dim); font-size:10.5px">دیدید</small>`
      : `<span class="ephemeral-tag" data-open-ephemeral="${m.id}" style="cursor:pointer">🕒 سوخته — برای دیدن بزن</span>`;
  } else if (m.msg_type === 'game') {
    body = '<div class="file-card"><div class="fi">🎮</div><div><b>بازی آویزان</b><small>در همین گپ بازی کن</small></div></div>';
  } else {
    body = `<div class="txt md">${md(m.content)}</div>`;
  }

  const sender = m.sender_id ? getMember(m.sender_id) : { display_name: 'سیستم', avatar: '' };
  const mine = m.sender_id === window.ME.id;
  const reply = m.reply && !m.reply.deleted
    ? `<div class="reply-ref" data-goto="${m.reply.id}"><b>${esc((getMember(m.reply.sender_id) || {}).display_name || 'کاربر')}</b> ${esc(m.reply.content || '(تصویر/فایل)')}</div>`
    : '';
  const pinTag = m.pinned ? '<span class="pin-tag">📌 پین شده</span>' : '';
  const html = `
    <div class="mrow ${mine ? 'mine-row' : ''}" data-mid="${m.id}">
      ${mine ? '' : `<div class="avatar sm">${avatarHtml(sender.display_name, sender.avatar, sender.status === 'online')}</div>`}
      <div class="bubble ${mine ? 'me' : ''} ${m.pinned ? 'pinned' : ''}">
        ${mine ? '' : `<div style="font-size:11px; font-weight:800; color:var(--red-3); margin-bottom:2px">${esc(sender.display_name)}${sender.is_verified ? ' ✔' : ''}${sender.title ? ` <span class="member-title" title="لقب در این گروه">${esc(sender.title)}</span>` : ''}</div>`}
        ${reply}${body}
        <div class="m-meta">
          ${pinTag}
          <span>${fmtTime(m.created_at)}</span>
          ${m.is_edited ? '<span class="edited">ویرایش شده</span>' : ''}
          ${mine && m.msg_type === 'text' ? `<span class="ticks" data-mid="${m.id}">✓</span>` : ''}
        </div>
        <div class="reactions" data-mid="${m.id}">${reactionChips(m)}</div>
        <div class="m-actions">
          ${EMOJIS.slice(0, 3).map(e => `<button data-react="${e}" data-mid="${m.id}">${e}</button>`).join('')}
          <button data-reply="${m.id}" title="پاسخ">↩</button>
          ${((mine || window.ME.is_admin) || ['owner','admin'].includes(myRole())) ? `<button data-pin="${m.id}" title="پین">${m.pinned ? '📌' : '📍'}</button>` : ''}
          <button data-sel="${m.id}" title="انتخاب">☑</button>
          ${mine ? `<button data-edit="${m.id}">✎</button>` : ''}
          ${(mine || window.ME.is_admin) ? `<button data-del="${m.id}">🗑</button>` : ''}
        </div>
      </div>
    </div>`;
  return html;
}

function renderAllMessages() {
  const body = document.getElementById('msgsBody');
  body.innerHTML = '';
  if (CD.initialMessages && CD.initialMessages.length) {
    let lastDay = null;
    CD.initialMessages.forEach((m, i) => {
      const day = fmtDay(m.created_at);
      if (day !== lastDay) {
        body.insertAdjacentHTML('beforeend', `<div class="day-sep"><span>${day}</span></div>`);
        lastDay = day;
      }
      body.insertAdjacentHTML('beforeend', renderMsg(m));
    });
  } else if (currentChat) {
    body.innerHTML = '<div style="text-align:center; color:var(--dim); padding:30px">اینجا جای پیام‌هاست. اولین پیام رو تو بفرست 🚀</div>';
  }
  document.getElementById('msgs').scrollTop = 1e9;
}

document.getElementById('btnJoin').onclick = async () => {
  const r = await api(`/api/chat/${currentChat}/join`, {});
  if (r.ok) {
    toast('پیوستی');
    document.getElementById('btnJoin').style.display = 'none';
    refreshConvList();
  } else toast(r.error, 'error');
};

function setHead() {
  const headAv = document.getElementById('chatHeadAvatar');
  const name = document.getElementById('chatHeadName');
  const sub = document.getElementById('chatHeadSub');
  const strip = document.getElementById('membersStrip');
  const repBtn = document.getElementById('btnReportUser');
  const joinBtn = document.getElementById('btnJoin');
  if (!CD.chat) return;
  joinBtn.style.display = (CD.chat.chat_type !== 'dm' && !CD.role && !window.ME.is_admin) ? 'grid' : 'none';
  let displayName, subText, av = '';
  if (CD.chat.chat_type === 'dm') {
    const p = CD.chat.peer;
    displayName = p.display_name;
    subText = '@' + p.username + (p.status === 'online' ? ' · آنلاین' : '');
    av = p.avatar;
    strip.style.display = 'none';
    repBtn.style.display = 'grid';
  } else {
    displayName = CD.chat.name;
    subText = (CD.chat.chat_type === 'channel' ? 'کانال' : 'گروه') + ' · ' + (CD.members || []).length + ' عضو';
    av = CD.chat.avatar;
    repBtn.style.display = 'none';
  }
  headAv.innerHTML = (av ? '<img src="' + av + '" alt="">' : (displayName || '؟').charAt(0));
  name.textContent = displayName;
  sub.textContent = subText;
  if (CD.chat.chat_type !== 'dm' && CD.members && CD.members.length > 1) {
    strip.style.display = 'flex';
    strip.innerHTML = CD.members.map(m =>
      `<span class="chip"><span class="avatar sm">${avatarHtml(m.display_name, m.avatar)}</span>${esc(m.display_name)}${m.role === 'owner' ? ' <span class="crown">👑</span>' : ''}${m.role === 'admin' ? ' <span class="crown">⭐</span>' : ''}</span>`
    ).join('');
  }
  if (isPeer()) {
    document.getElementById('btnPeerProfile').href = '/profile/' + CD.chat.peer.username;
    document.getElementById('btnReportUser').onclick = () => openReport(CD.chat.peer);
  }
}

document.getElementById('btnReportUser').onclick = () => {
  document.getElementById('reportReason').value = '';
  document.getElementById('reportModal').classList.add('show');
};

function setActiveConv(id) {
  document.querySelectorAll('.conv').forEach(c => c.classList.toggle('active', String(c.dataset.chatId) === String(id)));
}

function clearUnread(id) {
  const el = document.querySelector(`.conv[data-chat-id="${id}"] .unread-pill`);
  if (el) el.remove();
}

async function openChat(id) {
  currentChat = id;
  const r = await fetch('/api/messages/' + id);
  const j = await r.json();
  CD.initialMessages = j.messages;
  if (j.chat) {
    CD.chat = j.chat;
    CD.role = j.role;
    CD.members = j.members;
    setHead();
  }
  document.getElementById('mainEmpty').style.display = 'none';
  document.getElementById('msgsPane').classList.add('open');
  document.getElementById('msgsBody').innerHTML = '';
  renderAllMessages();
  api('/api/mark-read', { chat_id: id });
  clearUnread(id);
  setActiveConv(id);
  S.emit('stop_typing', { chat_id: id });
  typingSent = false;
  updateHangmanView();
  loadPinned();
}

function refreshConvList() {
  fetch('/api/conversations').then(r => r.json()).then(j => {
    const list = document.getElementById('convList');
    list.innerHTML = j.conversations.map(it => `
      <div class="conv ${it.chat_id === currentChat ? 'active' : ''}" data-chat-id="${it.chat_id}" data-type="${it.chat_type}">
        <div class="avatar" style="border-radius:14px">${esc((it.name || '؟').charAt(0))}</div>
        <div class="body">
          <div class="row1"><b>${esc(it.name)}</b><time>${fmtTime(it.last_at)}</time></div>
          <div class="row2"><span>${esc(it.last)}</span>${it.unread ? `<span class="unread-pill">${it.unread}</span>` : ''}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('.conv').forEach(c => c.onclick = () => openChat(c.dataset.chatId));
  });
}

function appendMsg(m) {
  const body = document.getElementById('msgs');
  const lastDay = fmtDay(m.created_at);
  body.insertAdjacentHTML('beforeend', `<div class="day-sep"><span>${lastDay}</span></div><div id="m${m.id}">${renderMsg(m)}</div>`);
  body.scrollTop = 1e9;
  if (m.chat_id !== currentChat) return;
  refreshConvList();
}

function updateHangmanView() {
  const box = document.getElementById('hangmanBox');
  if (!hangman) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const known = hangman.word && (window.ME.id === hangman.host_id || !hangman.active);
  document.getElementById('hmWord').innerHTML = known && hangman.word
    ? esc(hangman.word).split('').map(c => c.trim() ? c : '&nbsp;').join(' ')
    : esc(hangman.display || '').split('').map(c => c === '•' ? '•' : c).join(' ');
  document.getElementById('hmLives').textContent = `دفعات نادرست: ${hangman.wrong || 0} از 7`;
  document.getElementById('hmResult').textContent = !hangman.active && hangman.result
    ? (hangman.result === 'won' ? '🎉 بردی! کلمه بود: ' + hangman.word : '💀 باختی! کلمه بود: ' + hangman.word)
    : '';
  const keys = document.getElementById('hmKeys');
  const used = hangman.guessed || [];
  keys.innerHTML = 'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی'.split('').map(k =>
    `<button data-letter="${k}" class="${used.includes(k) ? (hangman.word && hangman.word.includes(k) ? 'used-h' : 'used-x') : ''}" ${hangman.active ? '' : 'disabled'}>${k}</button>`
  ).join('');
  keys.querySelectorAll('button').forEach(b => b.onclick = () => guess(b.dataset.letter));
}

async function guess(letter) {
  const r = await api('/api/hangman/guess', { game_id: hangman.id, letter });
  if (r.ok) {
    hangman = r.game;
    updateHangmanView();
  } else toast(r.error, 'error');
}

document.addEventListener('click', e => {
  const eph = e.target.closest('[data-open-ephemeral]');
  if (eph) {
    api('/api/message/ephemeral/view', { message_id: +eph.dataset.openEphemeral });
    return;
  }
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    const target = document.querySelector(`.mrow[data-mid="${goto.dataset.goto}"]`);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1200); }
    return;
  }
  const reactBtn = e.target.closest('[data-react]');
  if (reactBtn) {
    api('/api/message/react', { message_id: +reactBtn.dataset.mid, emoji: reactBtn.dataset.react });
    return;
  }
  const chip = e.target.closest('.reactions [data-emoji]');
  if (chip) {
    api('/api/message/react', { message_id: +chip.closest('.reactions').dataset.mid, emoji: chip.dataset.emoji });
    return;
  }
  const replyBtn = e.target.closest('[data-reply]');
  if (replyBtn) {
    openReply(+replyBtn.dataset.reply);
    return;
  }
  const pinBtn = e.target.closest('[data-pin]');
  if (pinBtn) {
    api('/api/message/pin', { message_id: +pinBtn.dataset.pin });
    return;
  }
  const selBtn = e.target.closest('[data-sel]');
  if (selBtn) {
    toggleSelect(+selBtn.dataset.sel);
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del && del.dataset.del) {
    if (confirm('پیام حذف بشه؟')) api('/api/message/delete', { message_id: +del.dataset.del });
    return;
  }
});

async function editMessage(mid, bubbleEl) {
  const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
  const txt = row.querySelector('.txt');
  if (!txt) return;
  const old = txt.textContent;
  const input = document.createElement('input');
  input.className = 'input';
  input.value = old;
  txt.replaceWith(input);
  input.focus();
  const commit = async () => {
    const v = input.value.trim();
    if (v && v !== old) api('/api/message/edit', { message_id: mid, content: v });
    else txt.replaceWith(input);
  };
  input.onkeydown = ev => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') txt.replaceWith(input);
  };
  input.onblur = commit;
}

document.addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    e.stopPropagation();
    const row = ed.closest('.mrow');
    editMessage(ed.dataset.edit, row);
  }
});

async function sendText() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text && !pendingFile) return;
  const body = { chat_id: currentChat, content: text };
  if (pendingFile) {
    body.msg_type = pendingFile.kind;
    body.file_path = pendingFile.path;
    body.file_name = pendingFile.name;
  } else {
    body.msg_type = ephemeralMode ? 'ephemeral' : 'text';
  }
  if (pendingReply) body.reply_to = pendingReply.id;
  const r = await api('/api/message/send', body);
  if (r.ok) {
    appendMsg(r.message);
    input.value = '';
    ephemeralMode = false;
    pendingFile = null;
    pendingReply = null;
    document.getElementById('attachPreview').classList.remove('show');
    document.getElementById('attachPreview').innerHTML = '';
    document.getElementById('replyPreview').style.display = 'none';
    document.getElementById('btnEphemeral').classList.remove('active');
    refreshConvList();
  } else toast(r.error, 'error');
}

function openReply(mid) {
  const row = document.querySelector(`.mrow[data-mid="${mid}"]`);
  if (!row) return;
  const m = (CD.initialMessages || []).find(x => x.id === mid) || {};
  const sender = getMember(m.sender_id);
  const raw = m.msg_type === 'image' ? 'تصویر' : m.msg_type === 'file' ? 'فایل' : m.msg_type === 'ephemeral' ? 'پیام سوخته' : (m.content || '');
  const label = String(raw).replace(/\n/g, ' ').slice(0, 60);
  pendingReply = { id: mid, name: sender.display_name || 'کاربر', preview: label || 'پیام' };
  const pv = document.getElementById('replyPreview');
  pv.innerHTML = `<span>↩ پاسخ به <b>${esc(pendingReply.name)}</b>: ${esc(pendingReply.preview)}</span><button onclick="this.parentElement.style.display='none'; pendingReply=null">✕</button>`;
  pv.style.display = 'flex';
  document.getElementById('msgInput').focus();
}

function toggleSelect(mid) {
  selectMode = true;
  if (selectedIds.has(mid)) selectedIds.delete(mid);
  else selectedIds.add(mid);
  document.querySelectorAll('.mrow').forEach(r => r.classList.toggle('sel-selected', selectedIds.has(+r.dataset.mid)));
  document.getElementById('bulkBar').style.display = selectedIds.size ? 'flex' : 'none';
  document.getElementById('bulkCount').textContent = selectedIds.size + ' پیام انتخاب شده';
}

async function bulkDelete() {
  const ids = [...selectedIds];
  const r = await api('/api/message/bulk-delete', { ids });
  if (r.ok) {
    toast(r.deleted + ' پیام حذف شد');
    selectedIds.clear();
    selectMode = false;
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
  selectMode = false;
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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
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
  pv.innerHTML += '<button onclick="pendingFile=null; this.parentElement.classList.remove(\'show\'); this.parentElement.innerHTML=\'\'">✕</button>';
  pv.classList.add('show');
};

document.getElementById('btnEphemeral').onclick = function () {
  ephemeralMode = !ephemeralMode;
  this.classList.toggle('active', ephemeralMode);
  document.getElementById('msgInput').placeholder = ephemeralMode ? '🕒 پیام سوخته: بعد از دیدن، برمی‌گرده' : 'پیام بنویس…';
};

async function loadMembers(chatId) {
  const r = await fetch('/api/chat/' + chatId + '/members').then(x => x.json());
  renderMembers(r.members);
}

function renderMembers(members) {
  CD.members = members;
  CD.chat = { ...(CD.chat || {}), name: CD.chat ? CD.chat.name : '' };
  const ml = document.getElementById('memberList');
  ml.innerHTML = members.map(m => {
    const canTitle = (myRole() === 'owner' || myRole() === 'admin' || m.id === window.ME.id) && CD.chat && CD.chat.chat_type !== 'dm';
    return `
    <div class="item">
      <span class="avatar sm">${avatarHtml(m.display_name, m.avatar, m.status === 'online')}</span>
      <div style="flex:1"><b style="font-size:13px">${esc(m.display_name)}</b>
        ${m.title ? `<span class="member-title" title="لقب">${esc(m.title)}</span>` : ''}
        <small style="display:block">@${esc(m.username)}${m.role === 'owner' ? ' · 👑 صاحب' : m.role === 'admin' ? ' · ⭐ ادمین' : ''}</small>
      </div>
      ${canTitle ? `<button class="btn sm ghost" data-title="${m.id}" data-cur="${esc(m.title)}">لقب</button>` : ''}
      ${myRole() === 'owner' && m.id !== window.ME.id ? `<button class="btn sm" data-kick="${m.id}">اخراج</button>` : ''}
      ${myRole() === 'owner' && m.role !== 'owner' ? `<button class="btn sm" data-promote="${m.id}">${m.role === 'admin' ? 'عضو' : '⭐'}</button>` : ''}
    </div>`;
  }).join('');
  ml.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => {
    api(`/api/chat/${currentChat}/members`, { action: 'kick', user_id: +b.dataset.kick }).then(j => j.ok ? loadMembers(currentChat) : toast(j.error, 'error'));
  });
  ml.querySelectorAll('[data-promote]').forEach(b => b.onclick = () => {
    api(`/api/chat/${currentChat}/members`, { action: 'promote', user_id: +b.dataset.promote }).then(j => j.ok ? loadMembers(currentChat) : toast(j.error, 'error'));
  });
  ml.querySelectorAll('[data-title]').forEach(b => b.onclick = () => {
    const v = prompt('لقب جدید (حداکثر ۳۰ حرف):', b.dataset.cur || '');
    if (v === null) return;
    api(`/api/chat/${currentChat}/members`, { action: 'title', user_id: +b.dataset.title, title: v.trim() })
      .then(j => j.ok ? (toast('لقب ثبت شد'), loadMembers(currentChat), renderAllMessages()) : toast(j.error, 'error'));
  });
}

function myRole() { return CD.role || null; }

document.getElementById('btnMembers').onclick = async function () {
  if (!currentChat) return;
  const ml = document.getElementById('memberList');
  if (ml.classList.contains('show')) { ml.classList.remove('show'); return; }
  await loadMembers(currentChat);
  ml.classList.add('show');
};

document.getElementById('btnMembers') && (document.addEventListener('click', e => {
  if (!e.target.closest('#memberList') && !e.target.closest('#btnMembers')) {
    document.getElementById('memberList').classList.remove('show');
  }
}, true));

document.getElementById('btnNewGroup').onclick = async () => {
  const modal = document.getElementById('newGroupModal');
  modal.classList.add('show');
  const r = await fetch('/api/search?q=').then(x => x.json());
  document.getElementById('groupMemberPick').innerHTML = r.users.map(u =>
    `<label><input type="checkbox" value="${u.id}"><span class="avatar sm">${avatarHtml(u.display_name, u.avatar)}</span>${esc(u.display_name)}</label>`
  ).join('') || '<small style="color:var(--dim)">کاربری برای دعوت پیدا نشد</small>';
};

document.getElementById('btnCreateGroup').onclick = async () => {
  const name = document.getElementById('groupName').value.trim();
  const members = [...document.querySelectorAll('#groupMemberPick input:checked')].map(x => +x.value);
  const r = await api('/api/group/create', { name, members });
  if (r.ok) {
    document.getElementById('newGroupModal').classList.remove('show');
    toast('گروه ساخته شد');
    openChat(r.chat_id);
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('btnNewChannel').onclick = () => document.getElementById('newChannelModal').classList.add('show');

document.getElementById('btnCreateChannel').onclick = async () => {
  const r = await api('/api/channel/create', { name: document.getElementById('channelName').value.trim(), description: document.getElementById('channelDesc').value.trim() });
  if (r.ok) {
    document.getElementById('newChannelModal').classList.remove('show');
    toast('کانال ساخته شد');
    openChat(r.chat_id);
    refreshConvList();
  } else toast(r.error, 'error');
};

document.getElementById('btnHangman').onclick = async () => {
  if (hangman && hangman.active) { updateHangmanView(); return; }
  const r = await api('/api/hangman/start', { chat_id: currentChat });
  if (r.ok) {
    hangman = r.game;
    updateHangmanView();
    const m = await api('/api/message/send', { chat_id: currentChat, msg_type: 'game', content: 'بازی آویزان شروع شد! 🎮' });
    if (m.ok) appendMsg(m.message);
  } else toast(r.error, 'error');
};

document.getElementById('hangmanClose').onclick = () => {
  hangman = null;
  document.getElementById('hangmanBox').style.display = 'none';
};

document.getElementById('btnProfile').onclick = () => {
  document.getElementById('chatLayoutRoot') && 0;
  document.querySelector('.chat-layout').style.display = 'none';
  document.getElementById('myProfilePage').style.display = 'grid';
  const av = document.getElementById('pmAvatar');
  av.innerHTML = avatarHtml(window.ME.display_name, window.ME.avatar).replace('<div class="avatar', '<div class="avatar lg"');
  document.getElementById('pmName').textContent = window.ME.display_name;
  document.getElementById('pmUsername').textContent = '@' + window.ME.username;
  document.getElementById('pmBio').textContent = window.ME.bio || 'بیویی نداری';
  document.getElementById('pmDisplayName').value = window.ME.display_name;
  document.getElementById('pmBioInput').value = window.ME.bio || '';
  const sw = document.getElementById('pmSwatches');
  sw.innerHTML = SWATCHES.map(c => `<button data-c="${c}" style="background:${c}" class="${c === window.ME.accent ? 'sel' : ''}"></button>`).join('');
  sw.querySelectorAll('button').forEach(b => b.onclick = () => {
    sw.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  });
};

document.getElementById('pmAvatarBtn').onclick = async () => {
  const f = document.getElementById('pmAvatarInput').files[0];
  if (!f) return toast('فایلی انتخاب نکردی', 'error');
  const fd = new FormData();
  fd.append('avatar', f);
  const r = await fetch('/api/avatar', { method: 'POST', body: fd }).then(x => x.json());
  if (r.ok) toast('عکس آپلود شد');
  else toast(r.error, 'error');
};

document.getElementById('pmSave').onclick = async () => {
  const sel = document.querySelector('#pmSwatches .sel');
  const r = await api('/api/profile', {
    display_name: document.getElementById('pmDisplayName').value.trim(),
    bio: document.getElementById('pmBioInput').value,
    accent: sel ? sel.dataset.c : ''
  });
  if (r.ok) {
    window.ME = Object.assign(window.ME, r.profile);
    toast('پروفایل ذخیره شد');
    setTimeout(() => location.reload(), 500);
  } else toast(r.error, 'error');
};

document.getElementById('pmLogout').onclick = () => location.href = '/logout';

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
      html += '<h4>گروه‌ها و کانال‌ها</h4>' + r.chats.map(c => `
        <div class="sr-item" data-chat="${c.id}" data-type="${c.chat_type}">
          <span class="type-icon">${c.chat_type === 'channel' ? '📢' : '👥'}</span>
          <div><b>${esc(c.name)}</b><small>${c.chat_type === 'channel' ? 'کانال' : 'گروه'}</small></div>
        </div>`).join('');
    }
    if (!html) html = '<small style="padding:12px; color:var(--dim); display:block">چیزی پیدا نشد</small>';
    box.innerHTML = html;
    box.classList.add('show');
  }, 250);
};

document.getElementById('searchResults').addEventListener('click', e => {
  const u = e.target.closest('[data-uid]');
  if (u) {
    api('/api/dm', { user_id: +u.dataset.uid }).then(j => {
      if (j.ok) openChat(j.chat_id);
      else toast(j.error, 'error');
    });
    return;
  }
  const c = e.target.closest('[data-chat]');
  if (c) openChat(c.dataset.chat);
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) document.getElementById('searchResults').classList.remove('show');
});

document.querySelectorAll('#convList .conv').forEach(c => {
  c.onclick = () => openChat(c.dataset.chatId);
});

document.getElementById('btnSendReport').onclick = async () => {
  const targetId = document.getElementById('btnReportUser').dataset.target;
  const reason = document.getElementById('reportReason').value.trim();
  if (!reason) return toast('دلیل رو بنویس', 'error');
  const r = await api('/api/report', { user_id: +targetId, reason });
  document.getElementById('reportModal').classList.remove('show');
  toast(r.ok ? 'گزارشت ثبت شد' : r.error, r.ok ? 'success' : 'error');
};

if (CD.chat) {
  setHead();
  renderAllMessages();
  refreshConvList();
} else {
  refreshConvList();
}

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
  const row = document.querySelector(`.mrow[data-mid="${d.message_id}"]`);
  if (row) row.outerHTML = `<div class="mrow" data-mid="${d.message_id}"><div class="bubble"><span class="msg-deleted">پیام حذف شده</span></div></div>`;
});

S.on('ephemeral_viewed', d => {
  document.querySelectorAll(`[data-mid="${d.message_id}"] [data-open-ephemeral]`).forEach(t => t.remove());
  const row = document.querySelector(`.mrow[data-mid="${d.message_id}"] .bubble`);
  if (row) row.insertAdjacentHTML('beforeend', '<small style="color:var(--dim); font-size:10.5px; display:block; margin-top:4px">دیدید ✓</small>');
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

S.on('hangman_started', g => {
  hangman = g;
  updateHangmanView();
});

S.on('hangman_state', g => {
  hangman = g;
  updateHangmanView();
});

S.on('profile_updated', p => {
  window.ME = Object.assign(window.ME, p);
  const ml = document.getElementById('memberList');
  if (ml.classList.contains('show')) loadMembers(currentChat);
});

let typingSent = false;
document.getElementById('msgInput').addEventListener('input', () => {
  if (!currentChat) return;
  if (!typingSent) { S.emit('typing', { chat_id: currentChat }); typingSent = true; }
});

document.getElementById('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    typingSent = false;
    S.emit('stop_typing', { chat_id: currentChat });
  }
});

S.on('connect', () => {});
