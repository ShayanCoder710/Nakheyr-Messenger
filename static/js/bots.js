(function () {
  'use strict';
  var created = document.getElementById('bfCreated');
  var form = document.getElementById('bfCreate');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('bfName').value.trim();
      if (!name) return;
      fetch('/api/bot/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
        body: JSON.stringify({ name: name }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) {
          toast(j.error || 'خطا در ساخت ربات');
          return;
        }
        document.getElementById('bfToken').value = j.bot.token;
        document.getElementById('bfCreatedName').textContent = j.user.display_name;
        document.getElementById('bfCreatedUser').textContent = '@' + j.user.username;
        created.hidden = false;
        toast('ربات ساخته شد');
      }).catch(function () { toast('خطا در ارتباط با سرور'); });
    });
  }

  var copyBtn = document.getElementById('bfCopy');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      copyText(document.getElementById('bfToken').value);
    });
  }

  document.querySelectorAll('.bf-card').forEach(function (card) {
    var id = card.dataset.bot;
    var tokenInput = card.querySelector('.bf-card-token');
    card.querySelectorAll('.bf-act').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.action;
        if (action === 'copy') {
          copyText(tokenInput.value);
        } else if (action === 'regenerate') {
          post(id, '/token').then(function (j) {
            if (j.ok) {
              tokenInput.value = j.token;
              copyText(j.token);
            } else toast(j.error || 'خطا');
          });
        } else if (action === 'toggle') {
          post(id, '/toggle').then(function (j) {
            if (!j.ok) { toast(j.error || 'خطا'); return; }
            var state = card.querySelector('[data-state]');
            var txt = card.querySelector('[data-toggle-txt]');
            state.textContent = j.is_active ? 'فعال' : 'غیرفعال';
            state.classList.toggle('on', j.is_active);
            state.classList.toggle('off', !j.is_active);
            txt.textContent = j.is_active ? 'غیرفعال کردن' : 'فعال کردن';
          });
        } else if (action === 'webhook') {
          var wh = card.querySelector('.bf-webhook-in input').value.trim();
          post(id, '/webhook', { url: wh }).then(function (j) {
            if (j.ok) toast('وب‌هوک ذخیره شد'); else toast(j.error || 'خطا');
          });
        } else if (action === 'clear-webhook') {
          post(id, '/webhook', { url: '' }).then(function (j) {
            if (j.ok) location.reload(); else toast(j.error || 'خطا');
          });
        } else if (action === 'save-profile') {
          post(id, '/profile', {
            name: card.querySelector('.bf-name').value.trim(),
            bio: card.querySelector('.bf-bio').value.trim(),
          }).then(function (j) {
            if (j.ok) {
              toast('ذخیره شد');
              setTimeout(function () { location.reload(); }, 600);
            } else toast(j.error || 'خطا');
          });
        } else if (action === 'delete-avatar') {
          postForm(id, '/avatar', 'delete=1').then(function (j) {
            if (j.ok) {
              toast('تصویر حذف شد');
              setTimeout(function () { location.reload(); }, 600);
            } else toast(j.error || 'خطا');
          });
        } else if (action === 'delete') {
          if (!confirm('این ربات و همه پیام‌هایش حذف می‌شود. مطمئن‌ای؟')) return;
          post(id, '/delete').then(function (j) {
            if (j.ok) location.reload(); else toast(j.error || 'خطا');
          });
        }
      });
    });
  });

  function post(bid, ep, data) {
    var payload = data !== undefined ? data : {};
    return fetch('/api/bot/' + bid + '/' + ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); });
  }

  function postForm(bid, ep, body) {
    return fetch('/api/bot/' + bid + '/' + ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
      body: body,
    }).then(function (r) { return r.json(); });
  }

  document.querySelectorAll('.bf-avatar-row input[type="file"]').forEach(function (fileInput) {
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0];
      if (!f) return;
      var card = fileInput.closest('.bf-card');
      var id = card.dataset.bot;
      var fd = new FormData();
      fd.append('avatar', f);
      fetch('/api/bot/' + id + '/avatar', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '' },
        body: fd,
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) {
          toast('تصویر ربات ذخیره شد');
          setTimeout(function () { location.reload(); }, 800);
        } else toast(j.error || 'خطا');
      }).catch(function () { toast('خطا در آپلود تصویر'); });
    });
  });

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('کپی شد'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('کپی شد');
    }
  }

  function toast(msg) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }
})();
