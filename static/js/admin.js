function buildUserActions(tr, uid, s) {
  const actions = tr.querySelector('.tbl-actions');
  actions.innerHTML = '';
  const defs = [
    ['ban', s.is_banned ? 'رفع مسدود' : 'مسدودسازی', s.is_banned ? 'primary' : 'danger'],
    ['admin', s.is_admin ? 'سلب ادمین' : 'ادمین کردن', ''],
    ['messages', bi('chat-dots') + ' پیام‌ها', ''],
    ['delete', bi('trash') + ' حذف اکانت', 'danger'],
  ];
  defs.forEach(([a, label, cls]) => {
    const b = document.createElement('button');
    b.className = 'btn sm ' + cls;
    b.dataset.act = a;
    b.innerHTML = label;
    b.onclick = () => handleUserAction(b);
    actions.appendChild(b);
  });
}

function handleUserAction(btn) {
  const tr = btn.closest('tr');
  const uid = tr.dataset.uid;
  const act = btn.dataset.act;
  if (act === 'messages') return openUserMessages(uid, tr);
  if (act === 'delete') {
    const name = tr.querySelector('.user-cell b').textContent;
    if (!confirm('اکانت «' + name + '» کامل حذف بشه؟ همه‌ی پیام‌ها و پیوی‌هاش می‌ره و این کار برگشت‌پذیر نیست.')) return;
    fetch(`/admin/user/${uid}/delete`, { method: 'GET' })
      .then(r => r.json())
      .then(j => {
        if (!j.ok) return toast(j.error, 'error');
        tr.remove();
        toast('اکانت حذف شد');
      })
      .catch(() => toast('خطا', 'error'));
    return;
  }
  fetch(`/admin/user/${uid}/${act}`, { method: 'GET' })
    .then(r => r.json())
    .then(j => {
      if (!j.ok) return toast(j.error, 'error');
      const s = j.state;
      let badge = '';
      if (s.is_admin) badge += '<span class="badge red">ادمین</span>';
      if (s.is_banned) badge += '<span class="badge">مسدود</span>';
      if (!s.is_admin && !s.is_banned) badge += '<span class="badge green">فعال</span>';
      tr.children[1].innerHTML = badge;
      buildUserActions(tr, uid, s);
      toast('انجام شد');
    })
    .catch(() => toast('خطا', 'error'));
}

function openMsgModal(title, sub) {
  document.getElementById('msgTitle').textContent = title;
  document.getElementById('msgSub').textContent = sub || '';
  document.getElementById('msgList').innerHTML = '';
  document.getElementById('msgModal').classList.add('show');
}

function renderMsgs(list, showSender) {
  const box = document.getElementById('msgList');
  if (!list.length) {
    box.innerHTML = '<p style="color:var(--dim); font-size:13px">پیامی نیست.</p>';
    return;
  }
  box.innerHTML = list.map(m => `
    <div class="msg-item${m.deleted ? ' del' : ''}">
      <div class="mi-top">
        ${showSender ? '<b>' + esc(m.sender || '') + '</b>' + (m.sender_username ? '<small>@' + esc(m.sender_username) + '</small>' : '') : ''}
        <span class="mi-chat">${esc(m.chat || '')}</span>
        <span class="mi-time">${esc(m.created_at || '')}</span>
      </div>
      <div class="mi-body">${m.msg_type === 'text' ? esc(m.content || '') : bi('paperclip') + ' ' + esc(m.file_name || m.msg_type)}</div>
    </div>`).join('');
  box.scrollTop = 0;
}

function openUserMessages(uid, tr) {
  const name = tr.querySelector('.user-cell b').textContent;
  openMsgModal('پیام‌های ' + name, 'در حال بارگذاری…');
  fetch(`/admin/user/${uid}/messages`)
    .then(r => r.json())
    .then(j => {
      if (!j.ok) return toast(j.error, 'error');
      document.getElementById('msgSub').textContent = j.messages.length + ' پیام آخر';
      renderMsgs(j.messages, false);
    })
    .catch(() => toast('خطا', 'error'));
}

document.getElementById('msgClose').onclick = () => document.getElementById('msgModal').classList.remove('show');
document.getElementById('msgX').onclick = () => document.getElementById('msgModal').classList.remove('show');
document.getElementById('msgModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('msgModal').classList.remove('show');
});

function openReportConversation(rid) {
  openMsgModal('گفتگوی گزارش‌شده', 'در حال بارگذاری…');
  fetch(`/admin/report/${rid}/conversation`)
    .then(r => r.json())
    .then(j => {
      if (!j.ok) return toast(j.error, 'error');
      document.getElementById('msgSub').textContent =
        (j.reporter || '') + ' ' + bi('arrow-left-right') + ' ' + (j.reported || '') + ' · ' + j.messages.length + ' پیام';
      renderMsgs(j.messages, true);
    })
    .catch(() => toast('خطا', 'error'));
}

function handleReportAction(btn) {
  const item = btn.closest('.report-item');
  const rid = item.dataset.rid;
  const act = btn.dataset.act;
  if (act === 'view') return openReportConversation(rid);
  fetch(`/admin/report/${rid}/${act}`, { method: 'GET' })
    .then(r => r.json())
    .then(j => {
      if (j.ok) {
        const badge = item.querySelector('.badge');
        badge.textContent = act === 'dismiss' ? 'رد شده' : 'حل شد';
        badge.classList.remove('red');
        badge.classList.add(act === 'dismiss' ? 'green' : 'gold');
        item.querySelectorAll('[data-act]').forEach(b => b.remove());
        toast('انجام شد');
      } else toast(j.error, 'error');
    })
    .catch(() => toast('خطا', 'error'));
}

document.querySelectorAll('.tbl-actions [data-act]').forEach(btn => {
  btn.onclick = () => handleUserAction(btn);
});

document.querySelectorAll('.report-item [data-act]').forEach(btn => {
  btn.onclick = () => handleReportAction(btn);
});

document.querySelectorAll('.admin-side a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelectorAll('.admin-side a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
  });
});
