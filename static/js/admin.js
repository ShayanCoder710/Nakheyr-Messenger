function userBadges(s) {
  let b = '';
  if (s.is_admin) b += '<span class="badge red">ادمین</span>';
  if (s.is_banned) b += '<span class="badge">مسدود</span>';
  if (!s.is_admin && !s.is_banned) b += '<span class="badge green">فعال</span>';
  if (!b) b = '<span class="badge">فعال</span>';
  return b;
}

function refreshUserRow(row, s) {
  row.dataset.banned = s.is_banned ? '1' : '0';
  row.dataset.admin = s.is_admin ? '1' : '0';
  const badgeBox = row.querySelector('.au-badges');
  if (badgeBox) badgeBox.innerHTML = userBadges(s);
  const banBtn = row.querySelector('[data-act="ban"]');
  if (banBtn) {
    banBtn.className = 'btn sm ' + (s.is_banned ? 'primary' : 'danger');
    banBtn.innerHTML = bi(s.is_banned ? 'person-check' : 'person-x')
      + '<span>' + (s.is_banned ? 'رفع مسدود' : 'مسدودسازی') + '</span>';
    banBtn.title = s.is_banned ? 'رفع مسدود' : 'مسدودسازی';
  }
  const adminBtn = row.querySelector('[data-act="admin"]');
  if (adminBtn) {
    adminBtn.innerHTML = bi(s.is_admin ? 'shield-check' : 'shield')
      + '<span>' + (s.is_admin ? 'سلب ادمین' : 'ادمین') + '</span>';
    adminBtn.title = s.is_admin ? 'سلب ادمین' : 'ادمین کردن';
  }
}

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(r => r.json());
}

function handleUserAction(btn) {
  const row = btn.closest('.au-row');
  if (!row) return;
  const uid = row.dataset.uid;
  const act = btn.dataset.act;
  const nameEl = row.querySelector('.au-name b');
  const name = nameEl ? nameEl.textContent : 'کاربر';

  if (act === 'messages') {
    openUserMessages(uid, name);
    return;
  }

  if (act === 'delete') {
    adminConfirm({
      title: 'حذف اکانت',
      text: 'اکانت «' + name + '» و همه پیام‌ها/پیوی‌هایش برای همیشه پاک می‌شود. این کار برگشت‌پذیر نیست.',
      ok: 'حذف اکانت'
    }).then(go => {
      if (!go) return;
      postJson(`/admin/user/${uid}/delete`)
        .then(j => {
          if (!j.ok) return toast(j.error || 'حذف نشد', 'error');
          bumpStat('statUsers', -1);
          row.classList.add('removing');
          setTimeout(() => row.remove(), 220);
          toast('اکانت حذف شد');
        }).catch(() => toast('خطا', 'error'));
    });
    return;
  }

  if (act === 'ban' || act === 'admin') {
    const banned = row.dataset.banned === '1';
    const isAdmin = row.dataset.admin === '1';
    const will = act === 'ban' ? !banned : !isAdmin;
    const title = act === 'ban' ? (will ? 'مسدودسازی کاربر' : 'رفع مسدود') : (will ? 'ادمین کردن' : 'سلب ادمین');
    const text = act === 'ban'
      ? (will ? '«' + name + '» تا زمان رفع مسدود وارد نشود.' : 'دسترسی «' + name + '» باز می‌شود.')
      : (will ? '«' + name + '» ادمین گروه‌ها می‌شود.' : 'دسترسی ادمینی «' + name + '» حذف می‌شود.');
    adminConfirm({ title, text, ok: act === 'ban' ? (will ? 'مسدودسازی' : 'رفع مسدود') : (will ? 'ادمین کردن' : 'سلب ادمین'), danger: act === 'ban' && will })
      .then(go => {
        if (!go) return;
        postJson(`/admin/user/${uid}/${act}`)
          .then(j => {
            if (!j.ok) return toast(j.error || 'انجام نشد', 'error');
            if (j.state) refreshUserRow(row, j.state);
            toast(act === 'ban' ? (will ? 'مسدود شد' : 'مسدودیت رفع شد') : (will ? 'ادمین شد' : 'ادمینیت گرفته شد'));
          }).catch(() => toast('خطا', 'error'));
      });
    return;
  }
}

function handleReportAction(btn) {
  const item = btn.closest('.report-item');
  if (!item) return;
  const rid = item.dataset.rid;
  const act = btn.dataset.act;
  const open = document.getElementById('reports');
  const isAll = open && open.dataset.rstatus === 'all';

  if (act === 'view') {
    openReportConversation(rid);
    return;
  }
  if (act !== 'dismiss' && act !== 'resolve') return;

  const target = item.querySelector('.report-top b').textContent.trim();
  adminConfirm({
    title: act === 'dismiss' ? 'رد گزارش' : 'حل گزارش با مسدودسازی',
    text: act === 'dismiss'
      ? 'این گزارش به‌عنوان ردشده علامت می‌خورد.'
      : 'کاربر «' + target + '» مسدود و گزارش حل می‌شود.',
    ok: act === 'dismiss' ? 'رد' : 'مسدودسازی',
    danger: true
  }).then(go => {
    if (!go) return;
    postJson(`/admin/report/${rid}/${act}`)
      .then(j => {
        if (!j.ok) return toast(j.error || 'انجام نشد', 'error');
        if (isAll) {
          const badge = item.querySelector('.report-status');
          if (badge) {
            badge.textContent = act === 'dismiss' ? 'رد شده' : 'حل شده';
            badge.classList.remove('st-open');
            badge.classList.add('st-closed');
          }
          const acts = item.querySelector('.report-actions');
          if (acts) {
            acts.querySelectorAll('[data-act]').forEach(b => {
              if (b.dataset.act !== 'view') b.remove();
            });
          }
        } else {
          bumpStat('statReports', -1);
          bumpStat('navReportsCount', -1);
          item.classList.add('removing');
          setTimeout(() => {
            item.remove();
            const list = document.getElementById('reportList');
            if (list && !list.querySelector('.report-item')) {
              let empty = document.getElementById('reportsEmpty');
              if (!empty) {
                empty = document.createElement('div');
                empty.className = 'admin-empty';
                empty.id = 'reportsEmpty';
                empty.innerHTML = '<div class="admin-empty-ic">' + bi('flag') + '</div><b>گزارشی در این فهرست نیست</b><span>همه‌چیز مرتبه</span>';
                list.appendChild(empty);
              }
              empty.style.display = '';
            }
          }, 220);
        }
        if (act === 'resolve') {
          const uid = item.dataset.uid;
          if (uid) {
            const row = document.querySelector('.au-row[data-uid="' + uid + '"]');
            if (row) refreshUserRow(row, { is_admin: row.dataset.admin === '1', is_banned: true });
            bumpStat('statBanned', 1);
          }
        }
        toast('انجام شد');
      }).catch(() => toast('خطا', 'error'));
  });
}

function bumpStat(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = (parseInt(el.textContent, 10) || 0) + delta;
  el.textContent = n < 0 ? 0 : n;
}

let _acResolve = null;
function adminConfirm(opts) {
  const modal = document.getElementById('adminConfirmModal');
  document.getElementById('acTitle').textContent = opts.title || '';
  document.getElementById('acText').textContent = opts.text || '';
  const ok = document.getElementById('acOk');
  ok.textContent = opts.ok || 'تأیید';
  ok.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
  document.getElementById('acIcon').innerHTML = bi(opts.danger ? 'exclamation-triangle' : 'info-circle');
  modal.classList.add('show');
  return new Promise(res => {
    _acResolve = res;
  });
}
document.getElementById('acCancel').onclick = () => {
  document.getElementById('adminConfirmModal').classList.remove('show');
  if (_acResolve) { _acResolve(false); _acResolve = null; }
};
document.getElementById('acOk').onclick = () => {
  document.getElementById('adminConfirmModal').classList.remove('show');
  if (_acResolve) { _acResolve(true); _acResolve = null; }
};
document.getElementById('adminConfirmModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('show');
    if (_acResolve) { _acResolve(false); _acResolve = null; }
  }
});

function openMsgModal(title, sub) {
  document.getElementById('msgTitle').textContent = title;
  document.getElementById('msgSub').textContent = sub || '';
  document.getElementById('msgList').innerHTML = '';
  document.getElementById('msgModal').classList.add('show');
}

function renderMsgs(list, showSender) {
  const box = document.getElementById('msgList');
  if (!list.length) {
    box.innerHTML = '<p style="color:var(--dim); font-size:13px;text-align:center;padding:10px 0">پیامی نیست.</p>';
    return;
  }
  box.innerHTML = list.map(m => `
    <div class="msg-item${m.deleted ? ' del' : ''}">
      <div class="mi-top">
        ${showSender ? '<b>' + esc(m.sender || '') + '</b>' : ''}
        <span class="mi-chat">${esc(m.chat || '')}</span>
        <span class="mi-time">${esc(m.created_at || '')}</span>
      </div>
      <div class="mi-body">${m.msg_type === 'text' ? (esc(m.content || '') || '<span style="color:var(--dim)">(متن خالی)</span>') : bi('paperclip') + ' ' + esc(m.file_name || m.msg_type)}</div>
    </div>`).join('');
  box.scrollTop = 0;
}

function openUserMessages(uid, name) {
  openMsgModal('پیام‌های ' + name, 'در حال بارگذاری…');
  fetch(`/admin/user/${uid}/messages`)
    .then(r => r.json())
    .then(j => {
      if (!j.ok) return toast(j.error || 'خطا', 'error');
      document.getElementById('msgSub').textContent = j.messages.length + ' پیام آخر';
      renderMsgs(j.messages, false);
    })
    .catch(() => toast('خطا', 'error'));
}

function openReportConversation(rid) {
  openMsgModal('گفتگوی گزارش‌شده', 'در حال بارگذاری…');
  fetch(`/admin/report/${rid}/conversation`)
    .then(r => r.json())
    .then(j => {
      if (!j.ok) return toast(j.error || 'خطا', 'error');
      document.getElementById('msgSub').textContent =
        esc(j.reporter || 'کاربر') + ' ' + bi('arrow-left-right') + ' ' + esc(j.reported || 'کاربر') + ' · ' + j.messages.length + ' پیام';
      renderMsgs(j.messages, true);
    })
    .catch(() => toast('خطا', 'error'));
}

document.getElementById('msgClose').onclick = () => document.getElementById('msgModal').classList.remove('show');
document.getElementById('msgX').onclick = () => document.getElementById('msgModal').classList.remove('show');
document.getElementById('msgModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});

document.addEventListener('click', e => {
  if (e.target.closest('[data-clear-q]')) {
    e.preventDefault();
    const inp = e.target.closest('form.admin-search').querySelector('input[name="q"]');
    if (inp) inp.value = '';
    e.target.closest('form.admin-search').submit();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  if (btn.closest('.au-row')) handleUserAction(btn);
  else if (btn.closest('.report-item')) handleReportAction(btn);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('msgModal').classList.remove('show');
    document.getElementById('adminConfirmModal').classList.remove('show');
    if (_acResolve) { _acResolve(false); _acResolve = null; }
  }
});

// scroll-spy for side nav + bottom tabs
const navLinks = Array.from(document.querySelectorAll('.admin-nav a[href^="#"]'));
const tabLinks = Array.from(document.querySelectorAll('.admin-tab'));
const sections = navLinks.map(a => document.getElementById(a.getAttribute('href').slice(1)));
function setActiveNav(hash) {
  const cur = hash || '#stats';
  navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === cur));
  tabLinks.forEach(a => a.classList.toggle('active', a.dataset.tab === cur.slice(1)));
}
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) setActiveNav('#' + en.target.id);
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  sections.forEach(s => s && io.observe(s));
  window.addEventListener('scroll', () => {
    if (!location.hash) setActiveNav(document.getElementById('stats') ? '#stats' : '');
  }, { passive: true });
} else {
  document.querySelectorAll('.admin-nav a, .admin-tab').forEach(a => {
    a.addEventListener('click', () => setActiveNav(a.getAttribute('href') || ('#' + a.dataset.tab)));
  });
  window.addEventListener('hashchange', () => setActiveNav(location.hash));
}
