import json
import os
import re
import secrets
import threading
from datetime import datetime, date, timedelta
from functools import wraps

from flask import session, redirect, url_for, current_app, flash, abort, request
from models.models import db, User, Chat, ChatMember, Message, Report, Block, HiddenMessage
from config import ADMIN_USERNAME
from sqlalchemy.orm import joinedload

IMAGE_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'}
ALLOWED_EXT = IMAGE_EXT | {
    'pdf', 'mp3', 'wav', 'mp4', 'mov', 'webm', 'txt', 'zip', 'rar', '7z',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'json',
}
MAX_FILE_MB = 25


def init_db():
    _ensure_utf8mb4()
    db.create_all()
    _ensure_columns()
    _ensure_chat_usernames()
    _migrate_accent_colors()
    admin = User.query.filter_by(username=ADMIN_USERNAME).first()
    if not admin:
        admin = User(
            username=ADMIN_USERNAME,
            display_name='',
            bio='',
            password_hash='',
            accent='#e5393b',
            is_admin=True,
            is_verified=True,
        )
        db.session.add(admin)
        db.session.commit()
    elif admin.display_name or admin.bio or admin.password_hash:
        admin.display_name = ''
        admin.bio = ''
        admin.password_hash = ''
        db.session.commit()


def _ensure_utf8mb4():
    from sqlalchemy import text
    with db.engine.begin() as conn:
        db_name = conn.execute(text("SELECT DATABASE()")).scalar()
        conn.execute(text(
            f"ALTER DATABASE `{db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        ))
        stale = conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_collation NOT LIKE 'utf8mb4%'"
        )).scalars().all()
        for table in stale:
            conn.execute(text(
                f"ALTER TABLE `{table}` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            ))


def _ensure_columns():
    from sqlalchemy import text
    spec = [
        ('chat_members', 'title', "VARCHAR(30) NOT NULL DEFAULT ''"),
        ('messages', 'pinned', "BOOLEAN NOT NULL DEFAULT 0"),
        ('messages', 'reply_to', "INTEGER NULL"),
        ('chats', 'is_public', "BOOLEAN NOT NULL DEFAULT 1"),
        ('chats', 'username', "VARCHAR(30) NULL"),
        ('chat_members', 'muted', "BOOLEAN NOT NULL DEFAULT 0"),
        ('chat_members', 'archived', "BOOLEAN NOT NULL DEFAULT 0"),
        ('messages', 'fwd_from_id', "INTEGER NULL"),
        ('messages', 'fwd_from_name', "VARCHAR(60) NOT NULL DEFAULT ''"),
        ('users', 'read_receipts', "BOOLEAN NOT NULL DEFAULT 1"),
        ('users', 'show_online', "BOOLEAN NOT NULL DEFAULT 1"),
    ]
    with db.engine.connect() as conn:
        for table, col, coldef in spec:
            exists = conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
                ),
                {"t": table, "c": col},
            ).scalar()
            if not exists:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {coldef}"))
        conn.commit()


CHAT_USERNAME_RE = re.compile(r'^[a-z][a-z0-9_]{2,29}$')
RESERVED_USERNAMES = {
    'admin', 'nakheyr', 'nakhir', 'support', 'group', 'channel', 'settings',
    'login', 'register', 'logout', 'profile', 'api', 'files', 'static', 'chat',
}


def username_taken(name, user_id=None, chat_id=None):
    """True if `name` is already used by another user OR another chat."""
    name = (name or '').lower()
    if not name:
        return False
    u = User.query.filter(db.func.lower(User.username) == name).first()
    if u and (user_id is None or u.id != user_id):
        return True
    c = Chat.query.filter(db.func.lower(Chat.username) == name).first()
    if c and (chat_id is None or c.id != chat_id):
        return True
    return False


def _slugify(name):
    return re.sub(r'[^a-z0-9_]', '', (name or '').lower())


def generate_chat_username(name, chat_type):
    base = _slugify(name)[:26]
    if not base or not base[0].isalpha():
        base = ('g' if chat_type == 'group' else 'c') + base
    base = base[:28]
    candidate = base
    while len(candidate) < 3 or username_taken(candidate):
        candidate = base[:24] + secrets.token_hex(2)
    return candidate


def _ensure_chat_usernames():
    from sqlalchemy import text
    with db.engine.connect() as conn:
        indexed = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = 'chats' "
            "AND index_name = 'ix_chats_username' AND non_unique = 0"
        )).scalar()
    missing = Chat.query.filter(
        Chat.chat_type.in_(['group', 'channel']), Chat.username.is_(None)
    ).all()
    if missing:
        for chat in missing:
            chat.username = generate_chat_username(chat.name, chat.chat_type)
        db.session.commit()
    if not indexed:
        with db.engine.begin() as conn:
            try:
                conn.execute(text("CREATE UNIQUE INDEX ix_chats_username ON chats (username)"))
            except Exception:
                pass


def _migrate_accent_colors():
    """Move the old rose default to the new true-red palette."""
    from sqlalchemy import text
    with db.engine.begin() as conn:
        conn.execute(text(
            "UPDATE users SET accent = '#e5393b' "
            "WHERE LOWER(accent) IN ('#e11d48', '#e5193b', '#f43f5e')"
        ))


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
            nxt = request.path
            if request.query_string:
                nxt += '?' + request.query_string.decode()
            return redirect(url_for('login', next=nxt))
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


def create_group(owner, name, description, member_ids, is_public=True):
    chat = Chat(chat_type='group', name=name, description=description, owner_id=owner.id,
                is_public=is_public, username=generate_chat_username(name, 'group'))
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=owner.id, role='owner'))
    for uid in set(member_ids):
        if uid != owner.id:
            db.session.add(ChatMember(chat_id=chat.id, user_id=uid, role='member'))
    db.session.commit()
    return chat


def create_channel(owner, name, description, is_public=True):
    chat = Chat(chat_type='channel', name=name, description=description, owner_id=owner.id,
                is_public=is_public, username=generate_chat_username(name, 'channel'))
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=owner.id, role='owner'))
    db.session.commit()
    return chat


def save_chat_avatar(owner, filename):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in IMAGE_EXT:
        return ''
    fname = f'chat_{owner.id}_{secrets.token_hex(4)}.{ext}'
    target = current_app.config['AVATAR_DIR']
    os.makedirs(target, exist_ok=True)
    request.files['avatar'].save(os.path.join(target, fname))
    return fname


def chat_display_name(chat, viewer, members=None):
    if chat.chat_type == 'dm':
        ms = chat.members if members is None else members
        other = next((m.user for m in ms if m.user_id != viewer.id), None)
        return other.public_name if other else 'ذخیره‌شده‌ها'
    return chat.name or 'گروه'


def get_or_create_notes(user):
    chat = Chat.query.filter(
        Chat.chat_type == 'dm',
        Chat.members.any(ChatMember.user_id == user.id),
        ~Chat.members.any(ChatMember.user_id != user.id),
    ).first()
    if chat:
        return chat, False
    with _DM_LOCKS.setdefault(f'notes:{user.id}', threading.Lock()):
        chat = Chat.query.filter(
            Chat.chat_type == 'dm',
            Chat.members.any(ChatMember.user_id == user.id),
            ~Chat.members.any(ChatMember.user_id != user.id),
        ).first()
        if chat:
            return chat, False
        chat = Chat(chat_type='dm')
        db.session.add(chat)
        db.session.flush()
        db.session.add(ChatMember(chat_id=chat.id, user_id=user.id))
        db.session.commit()
        return chat, True


def snippet(content, msg_type='text'):
    if msg_type == 'image':
        return 'تصویر'
    if msg_type == 'file':
        return 'فایل'
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
    chats = user_chats(user.id)
    if not chats:
        return []
    uid = user.id
    chat_ids = [c.id for c in chats]
    hidden_ids = {row[0] for row in db.session.execute(
        db.select(HiddenMessage.message_id).filter_by(user_id=uid)
    ).all()}
    unread_by_chat = {}
    for row in db.session.execute(
        db.select(Message.id, Message.chat_id, Message.read_by).filter(
            Message.chat_id.in_(chat_ids),
            Message.deleted.is_(False),
            Message.sender_id != uid,
        )
    ).all():
        if row.id in hidden_ids:
            continue
        try:
            read_ids = json.loads(row.read_by or '[]')
        except Exception:
            read_ids = []
        if uid not in read_ids:
            unread_by_chat[row.chat_id] = unread_by_chat.get(row.chat_id, 0) + 1
    members_by_chat = {}
    my_member = {}
    mem_rows = db.session.execute(
        db.select(ChatMember)
        .where(ChatMember.chat_id.in_(chat_ids))
        .options(joinedload(ChatMember.user))
    ).scalars().all()
    for m in mem_rows:
        members_by_chat.setdefault(m.chat_id, []).append(m)
        if m.user_id == user.id:
            my_member[m.chat_id] = m
    last_q = db.select(db.func.max(Message.id)).filter(
        Message.chat_id.in_(chat_ids),
        Message.deleted.is_(False),
    )
    if hidden_ids:
        last_q = last_q.filter(~Message.id.in_(hidden_ids))
    max_ids = [row[0] for row in db.session.execute(
        last_q.group_by(Message.chat_id)
    ).all()]
    lasts = {}
    if max_ids:
        for m in Message.query.filter(Message.id.in_(max_ids)).all():
            lasts[m.chat_id] = m
    out = []
    for chat in chats:
        members = members_by_chat.get(chat.id, [])
        last = lasts.get(chat.id)
        last_text = ''
        if last:
            sender = next((m.user for m in members if m.user_id == last.sender_id), None)
            prefix = (f'{sender.public_name} · ' if sender and chat.chat_type != 'dm' else '')
            last_text = prefix + snippet(last.content, last.msg_type)
        peer_username = ''
        is_notes = chat.chat_type == 'dm' and all(m.user_id == uid for m in members)
        if chat.chat_type == 'dm' and not is_notes:
            other = next((m.user for m in members if m.user_id != uid), None)
            peer_username = other.username if other else ''
        out.append({
            'chat_id': chat.id,
            'chat_type': chat.chat_type,
            'name': chat_display_name(chat, user, members),
            'peer_username': peer_username,
            'is_notes': is_notes,
            'avatar': chat.avatar_url,
            'is_public': bool(chat.is_public),
            'owner_id': chat.owner_id,
            'last': last_text,
            'last_at': last.created_at.isoformat() if last else '',
            'unread': unread_by_chat.get(chat.id, 0),
            'muted': bool(my_member.get(chat.id) and my_member[chat.id].muted),
            'archived': bool(my_member.get(chat.id) and my_member[chat.id].archived),
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
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()


def avatar_html(user, size=''):
    cls = f'avatar {size}'.strip()
    if isinstance(user, dict):
        av = user.get('avatar', '')
        initial = (user.get('display_name') or '?').strip()[:1]
        inner = f'<img src="{av}" alt="">' if av else initial
        return f'<div class="{cls}">{inner}</div>'
    inner = f'<img src="{user.avatar_url}" alt="">' if user.avatar else (user.public_name or '?').strip()[:1]
    return f'<div class="{cls}">{inner}</div>'


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


def delete_user_account(uid, reassign_to=None):
    """Permanently remove a user and their data. DMs are deleted entirely,
    the user's messages elsewhere are removed, and owned chats are reassigned."""
    chat_ids = [cid for (cid,) in db.session.query(ChatMember.chat_id).filter_by(user_id=uid).all()]
    dm_chat_ids = []
    if chat_ids:
        dm_chat_ids = [cid for (cid,) in db.session.query(Chat.id).filter(
            Chat.id.in_(chat_ids), Chat.chat_type == 'dm').all()]
    msg_q = Message.query.filter(Message.sender_id == uid)
    if dm_chat_ids:
        msg_q = Message.query.filter(db.or_(Message.sender_id == uid, Message.chat_id.in_(dm_chat_ids)))
    msg_ids = [mid for (mid,) in msg_q.with_entities(Message.id).all()]
    if msg_ids:
        Report.query.filter(Report.message_id.in_(msg_ids)).update(
            {'message_id': None}, synchronize_session=False)
        HiddenMessage.query.filter(HiddenMessage.message_id.in_(msg_ids)).delete(
            synchronize_session=False)
    if dm_chat_ids:
        HiddenMessage.query.filter(HiddenMessage.chat_id.in_(dm_chat_ids)).delete(
            synchronize_session=False)
    HiddenMessage.query.filter_by(user_id=uid).delete(synchronize_session=False)
    Chat.query.filter_by(owner_id=uid).update({'owner_id': reassign_to}, synchronize_session=False)
    if dm_chat_ids:
        for c in Chat.query.filter(Chat.id.in_(dm_chat_ids)).all():
            db.session.delete(c)
        db.session.flush()
    Message.query.filter_by(sender_id=uid).delete(synchronize_session=False)
    ChatMember.query.filter_by(user_id=uid).delete(synchronize_session=False)
    Block.query.filter(db.or_(Block.user_id == uid, Block.blocked_user_id == uid)).delete(
        synchronize_session=False)
    Report.query.filter(db.or_(Report.reporter_id == uid, Report.reported_id == uid)).delete(
        synchronize_session=False)
    u = User.query.get(uid)
    if u:
        db.session.delete(u)
    db.session.commit()


def chat_label(chat, viewer_id=None):
    if not chat:
        return ''
    if chat.chat_type == 'dm':
        other = next((m.user for m in chat.members if m.user_id != viewer_id), None)
        return other.public_name if other else 'پیوی'
    return chat.name or ('گروه' if chat.chat_type == 'group' else 'کانال')
