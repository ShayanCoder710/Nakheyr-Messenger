function handleUserAction(btn) {
  const tr = btn.closest('tr');
  const uid = tr.dataset.uid;
  const act = btn.dataset.act;
  fetch(`/admin/user/${uid}/${act}`, { method: 'GET' })
    .then(r => r.json())
    .then(j => {
      if (!j.ok) return toast(j.error, 'error');
      const s = j.state;
      let badge = '';
      if (s.is_admin) badge += '<span class="badge red">ادمین</span>';
      if (s.is_verified) badge += '<span class="badge gold">✔</span>';
      if (s.is_banned) badge += '<span class="badge">مسدود</span>';
      if (!s.is_admin && !s.is_verified && !s.is_banned) badge += '<span class="badge green">فعال</span>';
      tr.children[1].innerHTML = badge;
      const actions = tr.querySelector('.tbl-actions');
      actions.innerHTML = '';
      const defs = [
        ['ban', s.is_banned ? 'رفع مسدود' : 'مسدودسازی', s.is_banned ? 'primary' : 'danger'],
        ['admin', s.is_admin ? 'سلب ادمین' : 'ادمین کردن', ''],
        ['verify', s.is_verified ? 'سلب ✔' : 'اعتمادسنجی', ''],
      ];
      defs.forEach(([a, label, cls]) => {
        const b = document.createElement('button');
        b.className = 'btn sm ' + cls;
        b.dataset.act = a;
        b.textContent = label;
        b.onclick = () => handleUserAction(b);
        actions.appendChild(b);
      });
      toast('انجام شد');
    })
    .catch(() => toast('خطا', 'error'));
}

function handleReportAction(btn) {
  const item = btn.closest('.report-item');
  const rid = item.dataset.rid;
  const act = btn.dataset.act;
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
