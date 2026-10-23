import json
import os
import re
import secrets
import threading
from datetime import datetime, date, timedelta
from functools import wraps

from flask import session, redirect, url_for, current_app, flash, abort, request
from models.models import db, User, Chat, ChatMember, Message, Report, Block, HiddenMessage, Avatar
from config import ADMIN_USERNAME
from sqlalchemy.orm import joinedload

IMAGE_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif', 'tiff'}
VIDEO_EXT = {'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'mpeg', 'mpg', 'ogv'}
AUDIO_EXT = {'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba', 'wma', 'amr'}
DOC_EXT = {'pdf', 'txt', 'md', 'csv', 'json', 'xml', 'log', 'rtf', 'doc', 'docx', 'odt',
           'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'epub'}
ARCHIVE_EXT = {'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso', 'jar', 'war'}
CODE_EXT = {
    # وب
    'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'vue', 'svelte', 'astro',
    'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'jsonc', 'json5', 'webmanifest',
    # اسکریپتی
    'py', 'pyw', 'pyi', 'rb', 'rbw', 'php', 'phtml', 'pl', 'pm', 'lua', 'r', 'rmd', 'jl',
    'tcl', 'awk', 'sed', 'vbs', 'vba', 'ps1', 'psm1',
    # کامپایل‌شده
    'c', 'h', 'cc', 'cpp', 'cxx', 'c++', 'hh', 'hpp', 'hxx', 'cs', 'go', 'rs', 'java',
    'kt', 'kts', 'scala', 'sc', 'swift', 'm', 'mm', 'dart', 'nim', 'zig', 'v', 'd',
    'f', 'f90', 'f95', 'for', 'pas', 'pp', 'groovy', 'gradle', 'clj', 'cljs', 'cljc',
    'el', 'lisp', 'scm', 'rkt', 'ml', 'mli', 'hs', 'lhs', 'erl', 'hrl', 'ex', 'exs', 'eex', 'heex',
    'fs', 'fsx', 'fsi', 'asm', 's', 'sol', 'mat', 'stan', 'pde', 'ino', 'qml', 'vala', 'vapi',
    'hx', 'glsl', 'hlsl', 'wgsl', 'frag', 'vert', 'jsp', 'asp', 'aspx', 'cfm', 'ejs', 'hbs',
    'pug', 'jade', 'njk', 'liquid', 'twig', 'mustache', 'haml', 'slim', 'erb', 'astro',
    # شل و ابزارها
    'sh', 'bash', 'zsh', 'fish', 'ksh', 'csh', 'bat', 'cmd', 'mk', 'cmake',
    'tf', 'tfvars', 'hcl', 'bicep', 'nginx',
    # کانفیگ و داده
    'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'json', 'xml', 'env',
    'sql', 'graphql', 'gql', 'proto', 'prisma', 'avsc',
    # مستندات متنی
    'tex', 'bib', 'rst', 'adoc', 'asciidoc', 'org', 'ipynb', 'gitignore', 'gitattributes',
    'editorconfig', 'dockerignore',
}
# فایل‌های معروف بدون پسوند
CODE_NAMES = {'makefile', 'dockerfile', 'jenkinsfile', 'rakefile', 'gemfile', 'procfile',
              'vagrantfile', 'justfile', 'brewfile', 'cmakelists', 'license', 'readme',
              'changelog', 'authors', 'notice', 'todo'}
ALLOWED_EXT = IMAGE_EXT | VIDEO_EXT | AUDIO_EXT | DOC_EXT | ARCHIVE_EXT | CODE_EXT
# فرمت‌هایی که نباید مستقیم (same-origin) اجرا شوند → به‌صورت دانلود فرستاده می‌شوند
INLINE_UNSAFE_EXT = {'html', 'htm', 'xhtml', 'svg', 'js', 'mjs', 'cjs', 'xml'}
AVATAR_EXT = IMAGE_EXT - {'svg'}
MAX_FILE_MB = 50


def allowed_upload(filename):
    name = (filename or '').strip()
    if not name:
        return False
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    return ext in ALLOWED_EXT or name.lower() in CODE_NAMES



def kind_for(filename, mimetype=''):
    ext = filename.rsplit('.', 1)[-1].lower() if filename and '.' in filename else ''
    if ext in IMAGE_EXT or (mimetype or '').startswith('image/'):
        return 'image'
    if ext in VIDEO_EXT or (mimetype or '').startswith('video/'):
        return 'video'
    if ext in AUDIO_EXT or (mimetype or '').startswith('audio/'):
        return 'audio'
    return 'file'



def init_db():
    _ensure_utf8mb4()
    db.create_all()
    _ensure_columns()
    _ensure_chat_usernames()
    _ensure_poll_tables()
    _backfill_avatars()
    admin = User.query.filter_by(username=ADMIN_USERNAME).first()
    if not admin:
        admin = User(
            username=ADMIN_USERNAME,
            display_name='',
            bio='',
            password_hash='',
            is_admin=True,
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
        ('chat_members', 'permissions', "TEXT NULL"),
        ('chat_members', 'draft', "TEXT NULL"),
        ('chat_members', 'slow_mode_last', "DATETIME NULL"),
        ('chats', 'slow_mode', "INTEGER NOT NULL DEFAULT 0"),
        ('messages', 'fwd_from_id', "INTEGER NULL"),
        ('messages', 'fwd_from_name', "VARCHAR(60) NOT NULL DEFAULT ''"),
        ('users', 'read_receipts', "BOOLEAN NOT NULL DEFAULT 1"),
        ('users', 'show_online', "BOOLEAN NOT NULL DEFAULT 1"),
        ('users', 'theme', "VARCHAR(10) NOT NULL DEFAULT 'dark'"),
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
    if not indexed:
        with db.engine.begin() as conn:
            try:
                conn.execute(text("CREATE UNIQUE INDEX ix_chats_username ON chats (username)"))
            except Exception:
                pass


def _ensure_poll_tables():
    """Create poll tables if they do not exist (manual DDL mirror of the ORM)."""
    from sqlalchemy import text
    with db.engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS polls (
              id INT AUTO_INCREMENT PRIMARY KEY,
              chat_id INT NOT NULL,
              message_id INT NOT NULL,
              question VARCHAR(300) NOT NULL DEFAULT '',
              options TEXT NOT NULL,
              multi BOOLEAN NOT NULL DEFAULT 0,
              closed BOOLEAN NOT NULL DEFAULT 0,
              created_by INT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              INDEX ix_polls_chat_id (chat_id),
              INDEX ix_polls_message_id (message_id)
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS poll_votes (
              id INT AUTO_INCREMENT PRIMARY KEY,
              poll_id INT NOT NULL,
              user_id INT NOT NULL,
              option_index INT NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uq_poll_vote (poll_id, user_id, option_index),
              INDEX ix_poll_votes_poll_id (poll_id),
              INDEX ix_poll_votes_user_id (user_id)
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))
        # Column added after initial deploy: auto-close time
        has_col = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'polls' AND column_name = 'expires_at'"
        )).scalar()
        if not has_col:
            conn.execute(text(
                "ALTER TABLE polls ADD COLUMN expires_at DATETIME NULL AFTER closed"
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
    # SVG is allowed as a chat file, but never as an avatar: it is served
    # from our origin and can carry script when opened directly.
    if ext not in AVATAR_EXT:
        return ''
    user = current_user()
    fname = f'{user.id}_{secrets.token_hex(4)}.{ext}'
    target = current_app.config['AVATAR_DIR']
    os.makedirs(target, exist_ok=True)
    request.files['avatar'].save(os.path.join(target, fname))
    return fname


def save_upload_file(file):
    if not allowed_upload(file.filename):
        return None
    if file.content_length and file.content_length > MAX_FILE_MB * 1024 * 1024:
        return None
    user = current_user()
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename)[:60]
    fname = f'{secrets.token_hex(4)}_{safe_name}'
    target = os.path.join(current_app.config['UPLOAD_DIR'], str(user.id))
    os.makedirs(target, exist_ok=True)
    dest = os.path.join(target, fname)
    file.save(dest)
    if os.path.getsize(dest) > MAX_FILE_MB * 1024 * 1024:
        try:
            os.remove(dest)
        except OSError:
            pass
        return None
    return f'{user.id}/{fname}'


def is_blocked(a, b):
    return (Block.query.filter_by(user_id=a, blocked_user_id=b).first() is not None or
            Block.query.filter_by(user_id=b, blocked_user_id=a).first() is not None)


PERMISSION_KEYS = [
    'send_messages',
    'send_media',
    'add_members',
    'pin_messages',
    'delete_messages',
    'manage_members',
]

PERMISSION_LABELS = {
    'send_messages': 'ارسال پیام',
    'send_media': 'ارسال عکس و فایل',
    'add_members': 'افزودن عضو',
    'pin_messages': 'پین کردن پیام',
    'delete_messages': 'حذف پیام دیگران',
    'manage_members': 'مدیریت اعضا',
}


def default_perms(role):
    if role in ('owner', 'admin'):
        return {k: True for k in PERMISSION_KEYS}
    return {
        'send_messages': True,
        'send_media': True,
        'add_members': False,
        'pin_messages': False,
        'delete_messages': False,
        'manage_members': False,
    }


def member_perms(member):
    if not member:
        return default_perms('member')
    base = default_perms(member.role)
    if member.role == 'owner':
        return base
    for k, v in member.perm_dict().items():
        if k in PERMISSION_KEYS:
            base[k] = bool(v)
    return base


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
                is_public=is_public)
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
                is_public=is_public)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=owner.id, role='owner'))
    db.session.commit()
    return chat


def save_chat_avatar(owner, filename):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in AVATAR_EXT:
        return ''
    fname = f'chat_{owner.id}_{secrets.token_hex(4)}.{ext}'
    target = current_app.config['AVATAR_DIR']
    os.makedirs(target, exist_ok=True)
    request.files['avatar'].save(os.path.join(target, fname))
    return fname


def list_owner_avatars(owner_type, owner_id):
    """Newest-first list of an owner's avatar gallery rows."""
    return (Avatar.query
            .filter_by(owner_type=owner_type, owner_id=owner_id)
            .order_by(Avatar.created_at.desc(), Avatar.id.desc())
            .all())


def recompute_owner_primary(owner_type, owner_id):
    """Point the owner's `.avatar` column at the current primary avatar
    (falling back to the newest), or '' when it has none. Keeps every
    existing renderer in sync without touching them."""
    avs = list_owner_avatars(owner_type, owner_id)
    prim = next((a.path for a in avs if a.is_primary), None)
    if prim is None:
        prim = avs[0].path if avs else ''
        if avs:
            for a in avs:
                a.is_primary = (a.path == prim)
    target = User.query.get(owner_id) if owner_type == 'user' else Chat.query.get(owner_id)
    if target is not None:
        target.avatar = prim
    db.session.commit()


def add_owner_avatar(owner_type, owner_id, filename):
    """Register a freshly-saved avatar file and make it the new primary."""
    a = Avatar(owner_type=owner_type, owner_id=owner_id, path=filename,
               is_primary=True, created_at=datetime.utcnow())
    db.session.add(a)
    db.session.flush()
    Avatar.query.filter(Avatar.owner_type == owner_type, Avatar.owner_id == owner_id,
                       Avatar.id != a.id).update({'is_primary': False})
    db.session.commit()
    recompute_owner_primary(owner_type, owner_id)
    return a


def set_owner_avatar_primary(owner_type, owner_id, avatar_id):
    """Mark one of the owner's avatars as the primary (mirrored to .avatar)."""
    Avatar.query.filter(Avatar.owner_type == owner_type, Avatar.owner_id == owner_id,
                       Avatar.is_primary.is_(True)).update({'is_primary': False})
    a = Avatar.query.get(avatar_id)
    if a and a.owner_type == owner_type and a.owner_id == owner_id:
        a.is_primary = True
    db.session.flush()
    recompute_owner_primary(owner_type, owner_id)
    return a


def delete_owner_avatar(owner_type, owner_id, avatar_id):
    """Remove one avatar (file + row). If it was primary, the newest
    remaining becomes primary. Returns True on success."""
    a = Avatar.query.get(avatar_id)
    if not a or a.owner_type != owner_type or a.owner_id != owner_id:
        return False
    path = a.path
    db.session.delete(a)
    db.session.flush()
    recompute_owner_primary(owner_type, owner_id)
    target_file = os.path.join(current_app.config['AVATAR_DIR'], path)
    if os.path.exists(target_file):
        try:
            os.remove(target_file)
        except OSError:
            pass
    return True


def owner_avatar_gallery(owner_type, owner_id):
    """Newest-first JSON-serializable gallery for the owner."""
    return [a.to_dict() for a in list_owner_avatars(owner_type, owner_id)]


def _backfill_avatars():
    """Give existing users/chats an Avatar row for the single primary they
    already have, so it shows up in the gallery too. Idempotent."""
    for u in User.query.filter(User.avatar.isnot(None), User.avatar != '').all():
        if not Avatar.query.filter_by(owner_type='user', owner_id=u.id, path=u.avatar).first():
            db.session.add(Avatar(owner_type='user', owner_id=u.id, path=u.avatar,
                                  is_primary=True, created_at=datetime.utcnow()))
    for c in Chat.query.filter(Chat.avatar.isnot(None), Chat.avatar != '').all():
        if not Avatar.query.filter_by(owner_type='chat', owner_id=c.id, path=c.avatar).first():
            db.session.add(Avatar(owner_type='chat', owner_id=c.id, path=c.avatar,
                                  is_primary=True, created_at=datetime.utcnow()))
    db.session.commit()


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
    if msg_type == 'video':
        return 'ویدیو'
    if msg_type == 'audio':
        return 'پیام صوتی'
    if msg_type == 'file':
        return 'فایل'
    text = (content or '').replace('\n', ' ')
    if msg_type == 'system':
        return text[:60] + ('…' if len(text) > 60 else '')
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
            Message.msg_type != 'system',
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
            if last.msg_type == 'system':
                prefix = ''
            elif last.sender_id == uid:
                prefix = 'شما · ' if chat.chat_type != 'dm' else ''
            elif sender and chat.chat_type != 'dm':
                prefix = f'{sender.public_name} · '
            else:
                prefix = ''
            last_text = prefix + snippet(last.content, last.msg_type)
        peer_username = ''
        peer_id = None
        blocked = False
        is_notes = chat.chat_type == 'dm' and all(m.user_id == uid for m in members)
        if chat.chat_type == 'dm' and not is_notes:
            other = next((m.user for m in members if m.user_id != uid), None)
            peer_username = other.username if other else ''
            peer_id = other.id if other else None
            blocked = bool(other and is_blocked(uid, other.id))
        out.append({
            'chat_id': chat.id,
            'chat_type': chat.chat_type,
            'name': chat_display_name(chat, user, members),
            'peer_username': peer_username,
            'peer_id': peer_id,
            'blocked': blocked,
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
    from markupsafe import escape
    cls = f'avatar {size}'.strip()
    if isinstance(user, dict):
        av = user.get('avatar', '')
        initial = escape((user.get('display_name') or '?').strip()[:1])
        inner = f'<img src="{escape(av)}" alt="">' if av else initial
        return f'<div class="{cls}">{inner}</div>'
    inner = f'<img src="{escape(user.avatar_url)}" alt="">' if user.avatar else escape((user.public_name or '?').strip()[:1])
    return f'<div class="{cls}">{inner}</div>'


def admin_stats():
    start = datetime.combine(date.today(), datetime.min.time())
    active = User.query.filter(User.is_banned.is_(False), User.is_admin.is_(False)).count()
    return {
        'users': User.query.count(),
        'active': active,
        'admins': User.query.filter_by(is_admin=True).count(),
        'messages': Message.query.count(),
        'groups': Chat.query.filter_by(chat_type='group').count(),
        'channels': Chat.query.filter_by(chat_type='channel').count(),
        'reports': Report.query.filter_by(status='open').count(),
        'reports_all': Report.query.count(),
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
