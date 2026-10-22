# Nakheyr

RTL Persian web messenger built with Flask, Socket.IO, and MySQL. Dark Telegram-style UI, fully responsive.

## Features

- Realtime messaging (Socket.IO) — send, reply, forward, edit, delete, pin, react
- DMs, groups, and channels with owner / admin / member permissions
- Polls (single/multi, auto-expiry, voters list)
- Media (image, video, audio, files up to 50 MB)
- Slow mode, drafts, archive, mute, block, report
- Telegram-style admin panel with user search, filters, pagination, stats
- CSRF-protected admin actions, secure avatar upload

## Stack

- Python 3.10+, Flask 3, Flask-SocketIO, Flask-SQLAlchemy
- MySQL 8 (utf8mb4)
- Gunicorn + gevent for production

## Project layout

```
app.py            Flask routes + Socket.IO events
func.py           helpers (auth, uploads, permissions, unread counts)
models/models.py  SQLAlchemy models
templates/        Jinja (base, chat, admin, login, register, profile)
static/
  css/style.css   all UI
  js/chat.js      chat logic
  js/admin.js     admin panel
  icons/          bootstrap-icons sprite
  fonts/          Vazirmatn + JetBrains Mono
wsgi.py           entry point
```

## Setup

```sql
CREATE DATABASE nakheyr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Create `config.py` (never commit it):

```python
MYSQL_CONFIG = "mysql+mysqlconnector://USER:PASS@HOST:PORT/nakheyr?charset=utf8mb4"
SECRET_KEY = "long-random-string"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "..."
ADMIN_DISPLAY_NAME = "Admin"
ADMIN_BIO = "Nakheyr admin"
```

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
# dev
python wsgi.py

# production (Socket.IO needs gevent)
pip install gevent geventwebsocket
gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 --bind 0.0.0.0:5000 "wsgi:app"
```

## License

GNU General Public License v3 (GPL-3.0). See `LICENSE`.
