const S = io({ transports: ['websocket', 'polling'] });

document.querySelectorAll('.tbl-actions [data-act]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tr = btn.closest('tr');
    const uid = tr.dataset.uid;
    const act = btn.dataset.act;
    const r = await fetch(`/admin/user/${uid}/${act}`, { method: 'GET' });
    const j = await r.json();
    if (j.ok) location.reload();
    else toast(j.error, 'error');
  });
});

document.querySelectorAll('.report-item [data-act]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const item = btn.closest('.report-item');
    const rid = item.dataset.rid;
    const act = btn.dataset.act;
    const r = await fetch(`/admin/report/${rid}/${act}`, { method: 'GET' });
    const j = await r.json();
    if (j.ok) {
      item.querySelector('.badge').textContent = act === 'dismiss' ? 'رد شده' : 'حل شد';
      item.querySelector('.badge').classList.remove('red');
      btn.remove();
      toast('انجام شد');
    } else toast(j.error, 'error');
  });
});

document.querySelectorAll('.admin-side a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelectorAll('.admin-side a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
  });
});
