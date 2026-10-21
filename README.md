# نخیر (Nakheyr)

پیام‌رسان وب فارسی، ساخته‌شده با Flask + Socket.IO + MySQL — با رابط کاربری کاملاً راست‌به‌چپ.

## ویژگی‌ها

- **پیام‌رسان بلادرنگ** — Socket.IO برای ارسال/دریاب پیام، تایپ، حضور آنلاین، خوانده‌شدن
- **گپ‌های شخصی (DM)، گروه و کانال** — با مجوزهای مدیریتی (owner / admin / member)
- **نظرسنجی (Poll)** — single/multi، انقضای خودکار، نمایش رأی‌دهندگان
- **پیام‌های رسانه‌ای** — عکس، ویدیو، صوت، فایل (با آپلود تا ۵۰ مگابایت)
- **فوروارد، پاسخ، ویرایش، حذف، پین، واکنش (emoji)**
- **بلاک، گزارش، آرشیو، بی‌صدا کردن، مخفی‌کردن پیام**
- **پنل ادمین** — مدیریت کاربران (بن/رفع بن/حذف/ادمین)، گزارش‌ها، آمار
- **CSRF protection** برای تمام درخواست‌های POST
- **RTL کامل** + فونت فارسی (Vazirmatn) + Bootstrap Icons (SVG sprite)

## ساختار پروژه

```
├── app.py          # Flask app، همه routeها، socket eventها، admin endpoints
├── config.py       # تنظیمات DB، SECRET_KEY، ادمین (track شده در repo)
├── func.py         # توابع کمکی: احراز هویت، آپلود، permissions، unread count
├── models/
│   └── models.py   # SQLAlchemy models: User, Chat, ChatMember, Message, Poll, ...
├── static/
│   ├── css/style.css          # CSS کل رابط کاربری
│   ├── js/chat.js            # منطق اصلی چت (بزرگ‌ترین فایل JS)
│   ├── js/admin.js           # پنل ادمین
│   ├── js/emoji-data.js      # داده ایموجی‌ها
│   ├── js/eggy.js            # toast نوتیفیکیشن
│   ├── icons/                # SVG sprite bootstrap-icons + آیکون‌های سفارشی
│   ├── fonts/                # Vazirmatn + JetBrains Mono
│   ├── images/               # لوگو
│   └── vendor/               # socket.io, marked, dompurify
├── templates/
│   ├── base.html             # base template (CSRF, js helpers, markdown)
│   ├── chat.html             # صفحه اصلی چت + تمام مودال‌ها
│   ├── admin.html            # پنل ادمین
│   ├── login.html / register.html / profile.html
│   └── _bi_sprite.html       # SVG sprite bootstrap-icons
└── wsgi.py                   # entry point برای Gunicorn/uWSGI
```

## نصب و اجرا

### ۱. پیش‌نیازها

- Python 3.10+
- MySQL 8.x (با charset `utf8mb4`)

### ۲. ایجاد database

```sql
CREATE DATABASE nakheyr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### ۳. تنظیم `config.py`

```python
MYSQL_CONFIG = "mysql+mysqlconnector://USER:PASSWORD@HOST:PORT/nakheyr?charset=utf8mb4"
SECRET_KEY = "یک-رندوم-بلند-قوی"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "پسورد-ادمین"
ADMIN_DISPLAY_NAME = "مدیر"
ADMIN_BIO = "اکانت رسمی مدیریت"
```

### ۴. نصب dependency‌ها

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### ۵. اجرا

```bash
python wsgi.py          # dev server روی port 5000
# یا با Gunicorn برای production:
gunicorn -w 2 --bind 0.0.0.0:5000 "wsgi:app"
```

> **نکته:** برای `gunicorn` با Socket.IO، حتماً از `gevent` + `geventwebsocket` استفاده کن:
> ```bash
> pip install gevent geventwebsocket
> gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 --bind 0.0.0.0:5000 "wsgi:app"
> ```

## feature list (API endpoints)

| Method | Endpoint | توضیح |
|--------|----------|-------|
| `GET/POST` | `/login` | ورود |
| `GET/POST` | `/register` | ثبت‌نام |
| `GET` | `/` | صفحه اصلی چت |
| `GET` | `/chat/<id>` | بازکردن گپ |
| `POST` | `/api/dm` | ساخت DM |
| `POST` | `/api/group/create` | ساخت گروه |
| `POST` | `/api/channel/create` | ساخت کانال |
| `POST` | `/api/message/send` | ارسال پیام |
| `POST` | `/api/message/react` | واکنش |
| `POST` | `/api/message/edit` | ویرایش |
| `POST` | `/api/message/delete` | حذف |
| `POST` | `/api/message/forward` | فوروارد |
| `POST` | `/api/message/pin` | پین |
| `POST` | `/api/poll/create` | ساخت نظرسنجی |
| `POST` | `/api/poll/<id>/vote` | رأی |
| `POST` | `/api/chat/<id>/prefs` | mute/archive |
| `GET` | `/api/conversations` | لیست گفتگوها |
| `GET` | `/api/search` | جستجو |
| `GET` | `/admin` | پنل ادمین |
| `GET/POST` | `/admin/user/<id>/<action>` | ban / admin / delete |
| `GET/POST` | `/admin/report/<id>/<action>` | dismiss / resolve |
