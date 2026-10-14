import os
import re
import random
import secrets
import threading
from datetime import datetime, date, timedelta
from functools import wraps

from flask import session, redirect, url_for, current_app, flash, abort, request
from models.models import db, User, Chat, ChatMember, Message, Report, HangmanGame, Block

HANGMAN_WORDS = [
    'فلکس', 'فلاش', 'کد', 'سرور', 'پایتون', 'جافا', 'گیت', 'نود', 'رایانه', 'پردازنده',
    'الگوریتم', 'دیتابیس', 'اینترنت', 'برنامه', 'توسعه', 'شبکه', 'امنیت', 'کوانتوم',
    'رباتیک', 'لایه', 'کانتینر', 'پروکسی', 'کش', 'فریمورک', 'میکروسرویس',
]
IMAGE_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'}
ALLOWED_EXT = IMAGE_EXT | {
    'pdf', 'mp3', 'wav', 'mp4', 'mov', 'webm', 'txt', 'zip', 'rar', '7z',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'json',
}
MAX_FILE_MB = 25


def init_db():
    db.create_all()
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(
            username='admin',
            display_name='مدیر نخیر',
            bio='اکانت رسمی مدیریت پیامرسان نخیر',
            accent='#e11d48',
            is_admin=True,
            is_verified=True,
        )
        admin.set_password('Nakheyr#2026')
        db.session.add(admin)
        db.session.commit()


def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    user = User.query.get(uid)
    if not user:
        session.pop('user_id', None)
        return None
    return user


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return redirect(url_for('login'))
        if user.is_banned:
            flash('حساب شما مسدود شده است.', 'error')
            return redirect(url_for('login'))
        return fn(*args, **kwargs)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or not user.is_admin:
            abort(403)
        return fn(*args, **kwargs)
    return wrapper


def save_avatar(filename):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in IMAGE_EXT:
        return ''
    user = current_user()
    fname = f'{user.id}_{secrets.token_hex(4)}.{ext}'
    target = current_app.config['AVATAR_DIR']
    os.makedirs(target, exist_ok=True)
    request.files['avatar'].save(os.path.join(target, fname))
    return fname


def save_upload_file(file):
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in ALLOWED_EXT or file.mimetype.startswith('text/html'):
        return None
    if file.content_length and file.content_length > MAX_FILE_MB * 1024 * 1024:
        return None
    user = current_user()
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)[:60]
    fname = f'{secrets.token_hex(4)}_{safe_name}'
    target = os.path.join(current_app.config['UPLOAD_DIR'], str(user.id))
    os.makedirs(target, exist_ok=True)
    file.save(os.path.join(target, fname))
    return f'{user.id}/{fname}'


def is_blocked(a, b):
    return (Block.query.filter_by(user_id=a, blocked_user_id=b).first() is not None or
            Block.query.filter_by(user_id=b, blocked_user_id=a).first() is not None)


def get_or_create_dm(user_a, user_b):
    chat = Chat.query.filter(
        Chat.chat_type == 'dm',
        Chat.members.any(ChatMember.user_id == user_a.id),
        Chat.members.any(ChatMember.user_id == user_b.id),
    ).first()
    if chat:
        return chat, False
    lock_key = f'dm:{min(user_a.id, user_b.id)}:{max(user_a.id, user_b.id)}'
    with _DM_LOCKS.setdefault(lock_key, __import__('threading').Lock()):
        chat = Chat.query.filter(
            Chat.chat_type == 'dm',
            Chat.members.any(ChatMember.user_id == user_a.id),
            Chat.members.any(ChatMember.user_id == user_b.id),
        ).first()
        if chat:
            return chat, False
        chat = Chat(chat_type='dm')
        db.session.add(chat)
        db.session.flush()
        db.session.add_all([
            ChatMember(chat_id=chat.id, user_id=user_a.id),
            ChatMember(chat_id=chat.id, user_id=user_b.id),
        ])
        db.session.commit()
        return chat, True


_DM_LOCKS = {}


def create_group(owner, name, description, member_ids):
    chat = Chat(chat_type='group', name=name, description=description, owner_id=owner.id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=owner.id, role='owner'))
    for uid in set(member_ids):
        if uid != owner.id:
            db.session.add(ChatMember(chat_id=chat.id, user_id=uid, role='member'))
    db.session.commit()
    return chat


def create_channel(owner, name, description):
    chat = Chat(chat_type='channel', name=name, description=description, owner_id=owner.id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=owner.id, role='owner'))
    db.session.commit()
    return chat


def chat_display_name(chat, viewer):
    if chat.chat_type == 'dm':
        other = next((m.user for m in chat.members if m.user_id != viewer.id), None)
        return other.display_name if other else 'گپ'
    return chat.name or 'گروه'


def snippet(content, msg_type='text'):
    if msg_type == 'image':
        return 'تصویر'
    if msg_type == 'file':
        return 'فایل'
    if msg_type == 'ephemeral':
        return 'پیام سوخته'
    if msg_type == 'game':
        return 'بازی آویزان'
    text = (content or '').replace('\n', ' ')
    return text[:40] + ('…' if len(text) > 40 else '')


def user_chats(user_id):
    q = Chat.query.filter(
        Chat.chat_type == 'dm',
        Chat.members.any(ChatMember.user_id == user_id),
    ).all()
    owned = Chat.query.filter(
        Chat.chat_type.in_(['group', 'channel']),
        db.or_(
            Chat.owner_id == user_id,
            Chat.members.any(ChatMember.user_id == user_id),
        ),
    ).all()
    seen = {c.id for c in q}
    q += [c for c in owned if c.id not in seen]
    return q


def unread_counts(user):
    out = []
    for chat in user_chats(user.id):
        msgs = Message.query.filter(
            Message.chat_id == chat.id,
            Message.deleted.is_(False),
            Message.sender_id != user.id,
        ).all()
        unread = sum(1 for m in msgs if user.id not in m.read_ids())
        last = Message.query.filter(
            Message.chat_id == chat.id, Message.deleted.is_(False)
        ).order_by(Message.id.desc()).first()
        last_text = ''
        if last:
            last_text = (f'{last.sender_id} · ' if last.sender_id else '') + snippet(last.content, last.msg_type)
        out.append({
            'chat_id': chat.id,
            'chat_type': chat.chat_type,
            'name': chat_display_name(chat, user),
            'avatar': chat.avatar_url,
            'owner_id': chat.owner_id,
            'last': last_text,
            'last_at': last.created_at.isoformat() if last else '',
            'unread': unread,
        })
    out.sort(key=lambda x: x['last_at'], reverse=True)
    return out


def update_streak(user):
    today = date.today()
    last = user.last_streak_day.date() if user.last_streak_day else None
    if last == today:
        return
    if last == today - timedelta(days=1):
        user.streak_days += 1
    else:
        user.streak_days = 1
    user.last_streak_day = datetime.utcnow()


def bump_online(user):
    user.status = 'online'
    user.last_seen = datetime.utcnow()
    update_streak(user)
    db.session.commit()


def pick_word():
    return random.choice(HANGMAN_WORDS)


def avatar_html(user, size=''):
    cls = f'avatar {size}'.strip()
    if isinstance(user, dict):
        img = f'<img src="{user.get("avatar", "")}" alt="">' if user.get('avatar') else ''
        initial = (user.get('display_name') or '?').strip()[:1]
        return f'<div class="{cls}">{img}{initial}</div>'
    img = f'<img src="{user.avatar_url}" alt="">' if user.avatar else ''
    initial = (user.display_name or '?').strip()[:1]
    return f'<div class="{cls}">{img}{initial}</div>'


def admin_stats():
    start = datetime.combine(date.today(), datetime.min.time())
    return {
        'users': User.query.count(),
        'messages': Message.query.count(),
        'groups': Chat.query.filter_by(chat_type='group').count(),
        'channels': Chat.query.filter_by(chat_type='channel').count(),
        'reports': Report.query.filter_by(status='open').count(),
        'banned': User.query.filter_by(is_banned=True).count(),
        'today_msgs': Message.query.filter(Message.created_at >= start).count(),
    }
