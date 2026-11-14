import hmac
import json
import time
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

from config import ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_DISPLAY_NAME, ADMIN_BIO

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'
    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(30), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(60), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    bio = db.Column(db.String(200), default='')
    avatar = db.Column(db.String(120), default='')
    is_admin = db.Column(db.Boolean, default=False)
    is_banned = db.Column(db.Boolean, default=False)
    is_bot = db.Column(db.Boolean, default=False, nullable=False)
    read_receipts = db.Column(db.Boolean, default=True)
    show_online = db.Column(db.Boolean, default=True, nullable=False)
    session_ver = db.Column(db.Integer, default=0, nullable=False)
    theme = db.Column(db.String(10), default='dark', nullable=False)
    status = db.Column(db.String(10), default='offline')
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    streak_days = db.Column(db.Integer, default=0)
    last_streak_day = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def is_config_admin(self):
        return self.username == ADMIN_USERNAME

    @property
    def public_name(self):
        return ADMIN_DISPLAY_NAME if self.is_config_admin else (self.display_name or '')

    @property
    def public_bio(self):
        return ADMIN_BIO if self.is_config_admin else (self.bio or '')

    def set_password(self, value):
        if self.is_config_admin:
            return
        self.password_hash = generate_password_hash(value)

    def check_password(self, value):
        if self.is_config_admin:
            return hmac.compare_digest(str(value or ''), str(ADMIN_PASSWORD))
        return check_password_hash(self.password_hash, value)

    @property
    def avatar_url(self):
        return f'/files/avatar/{self.avatar}' if self.avatar else ''

    def to_public(self, viewer=None):
        show = bool(self.show_online)
        visible = show and not (viewer is not None and not viewer.show_online)
        last_seen = None
        recently = False
        if not self.is_bot and self.status != 'online' and not visible:
            recently = True
        if visible:
            last_seen = self.last_seen.isoformat() if self.last_seen else None
        return {
            'id': self.id,
            'username': self.username,
            'display_name': self.public_name,
            'bio': self.public_bio,
            'avatar': self.avatar_url,
            'is_admin': self.is_admin,
            'is_bot': bool(self.is_bot),
            'status': 'online' if show else 'offline',
            'last_seen': last_seen,
            'recently': recently,
            'read_receipts': bool(self.read_receipts),
        }

    def to_self(self):
        data = self.to_public()
        data['is_banned'] = self.is_banned
        data['show_online'] = bool(self.show_online)
        data['theme'] = self.theme if self.theme in ('dark', 'light', 'auto') else 'dark'
        data['created_at'] = self.created_at.isoformat()
        data['streak_days'] = self.streak_days
        return data


class Chat(db.Model):
    __tablename__ = 'chats'
    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    id = db.Column(db.Integer, primary_key=True)
    chat_type = db.Column(db.String(10), nullable=False, default='dm')
    name = db.Column(db.String(60), default='')
    username = db.Column(db.String(30), unique=True, nullable=True, index=True)
    description = db.Column(db.String(200), default='')
    avatar = db.Column(db.String(120), default='')
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    is_public = db.Column(db.Boolean, default=True)
    slow_mode = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    members = db.relationship('ChatMember', backref='chat', lazy=True, cascade='all, delete-orphan')
    messages = db.relationship('Message', backref='chat', lazy=True, cascade='all, delete-orphan')

    @property
    def avatar_url(self):
        return f'/files/avatar/{self.avatar}' if self.avatar else ''

    def member_ids(self):
        return [m.user_id for m in self.members]

    def to_public(self, current_user=None):
        data = {
            'id': self.id,
            'chat_type': self.chat_type,
            'name': self.name,
            'username': self.username or '',
            'description': self.description,
            'avatar': self.avatar_url,
            'owner_id': self.owner_id,
            'is_public': bool(self.is_public),
            'slow_mode': int(self.slow_mode or 0),
        }
        if current_user:
            data['is_notes'] = bool(self.chat_type == 'dm' and self.members and all(m.user_id == getattr(current_user, 'id', 0) for m in self.members))
        if self.chat_type == 'dm' and current_user:
            uid = getattr(current_user, 'id', current_user)
            viewer = current_user if isinstance(current_user, User) else None
            other = next((m.user for m in self.members if m.user_id != uid), None)
            if other:
                peer = other.to_public(viewer=viewer)
                try:
                    from func import is_blocked
                    peer['blocked'] = is_blocked(uid, other.id)
                except Exception:
                    peer['blocked'] = False
                data['peer'] = peer
            else:
                data['peer'] = None
        return data


class ChatMember(db.Model):
    __tablename__ = 'chat_members'
    __table_args__ = (
        db.UniqueConstraint('chat_id', 'user_id'),
        db.Index('ix_chatmember_chat_muted', 'chat_id', 'muted'),
        db.Index('ix_chatmember_chat_archived', 'chat_id', 'archived'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    role = db.Column(db.String(10), default='member')
    title = db.Column(db.String(30), default='')
    permissions = db.Column(db.Text, default='')
    muted = db.Column(db.Boolean, default=False)
    archived = db.Column(db.Boolean, default=False)
    draft = db.Column(db.Text, default='')
    slow_mode_last = db.Column(db.DateTime, nullable=True)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref='memberships')

    def perm_dict(self):
        try:
            data = json.loads(self.permissions or '{}')
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def set_permissions(self, data):
        self.permissions = json.dumps(data or {})


_HIDDEN_RR = {}


def _hidden_read_users(ids):
    key = frozenset(ids)
    hit = _HIDDEN_RR.get(key)
    if hit and time.time() - hit[1] < 15:
        return hit[0]
    hidden = {
        u.id for u in User.query.filter(
            User.id.in_(list(key)), User.read_receipts.is_(False)
        ).all()
    }
    if len(_HIDDEN_RR) > 200:
        _HIDDEN_RR.clear()
    _HIDDEN_RR[key] = (hidden, time.time())
    return hidden


class Message(db.Model):
    __tablename__ = 'messages'
    __table_args__ = (
        db.Index('ix_messages_chat_created', 'chat_id', 'created_at'),
        db.Index('ix_messages_sender_created', 'sender_id', 'created_at'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    msg_type = db.Column(db.String(12), default='text')
    content = db.Column(db.Text, default='')
    file_name = db.Column(db.String(160), default='')
    file_path = db.Column(db.String(200), default='')
    reactions = db.Column(db.Text, default='{}')
    read_by = db.Column(db.Text, default='[]')
    is_edited = db.Column(db.Boolean, default=False)
    deleted = db.Column(db.Boolean, default=False)
    pinned = db.Column(db.Boolean, default=False)
    reply_to = db.Column(db.Integer, nullable=True)
    fwd_from_id = db.Column(db.Integer, nullable=True)
    fwd_from_name = db.Column(db.String(60), default='')
    buttons = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    def react_dict(self):
        try:
            return json.loads(self.reactions or '{}')
        except Exception:
            return {}

    def set_reactions(self, value):
        self.reactions = json.dumps(value)

    def buttons_list(self):
        try:
            v = json.loads(self.buttons or '[]')
            return v if isinstance(v, list) else []
        except Exception:
            return []

    def read_ids(self):
        try:
            return json.loads(self.read_by or '[]')
        except Exception:
            return []

    def visible_read_ids(self):
        ids = self.read_ids()
        if not ids:
            return []
        hidden = _hidden_read_users(ids)
        return [i for i in ids if i not in hidden]

    def set_read(self, user_id):
        ids = self.read_ids()
        if user_id not in ids:
            ids.append(user_id)
        self.read_by = json.dumps(ids)

    def to_dict(self, viewer_id=None):
        reactions = self.react_dict()
        data = {
            'id': self.id,
            'chat_id': self.chat_id,
            'sender_id': self.sender_id,
            'msg_type': self.msg_type,
            'content': self.content,
            'file_name': self.file_name,
            'file_url': f'/files/{self.file_path}' if self.file_path else '',
            'reactions': reactions,
            'my_reaction': reactions.get(str(viewer_id)),
            'is_edited': self.is_edited,
            'deleted': self.deleted,
            'pinned': self.pinned,
            'reply_to': self.reply_to,
            'fwd_from_id': self.fwd_from_id,
            'fwd_from_name': self.fwd_from_name or '',
            'read_by': self.visible_read_ids(),
            'buttons': self.buttons_list(),
            'created_at': self.created_at.isoformat(),
        }
        if self.reply_to:
            parent = Message.query.get(self.reply_to)
            if parent:
                data['reply'] = {
                    'id': parent.id,
                    'content': (parent.content or '')[:80],
                    'sender_id': parent.sender_id,
                    'msg_type': parent.msg_type,
                    'deleted': parent.deleted,
                }
        return data


class ScheduledMessage(db.Model):
    __tablename__ = 'scheduled_messages'
    __table_args__ = (
        db.Index('ix_sched_user_status', 'user_id', 'status'),
        db.Index('ix_sched_chat_sendat', 'chat_id', 'send_at'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    msg_type = db.Column(db.String(12), default='text')
    content = db.Column(db.Text, default='')
    file_path = db.Column(db.String(200), default='')
    file_name = db.Column(db.String(160), default='')
    reply_to = db.Column(db.Integer, nullable=True)
    send_at = db.Column(db.DateTime, nullable=False, index=True)
    status = db.Column(db.String(10), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'chat_id': self.chat_id,
            'msg_type': self.msg_type,
            'content': self.content or '',
            'file_path': self.file_path or '',
            'file_name': self.file_name or '',
            'preview': (self.content or self.file_name or '')[:60],
            'send_at': self.send_at.isoformat() if self.send_at else '',
            'status': self.status,
        }


class HiddenMessage(db.Model):
    __tablename__ = 'hidden_messages'
    __table_args__ = (
        db.UniqueConstraint('user_id', 'message_id'),
        db.Index('ix_hidden_user_chat', 'user_id', 'chat_id'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Block(db.Model):
    __tablename__ = 'blocks'
    __table_args__ = (
        db.UniqueConstraint('user_id', 'blocked_user_id'),
        db.Index('ix_blocks_bidirectional', 'user_id', 'blocked_user_id'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    blocked_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Report(db.Model):
    __tablename__ = 'reports'
    __table_args__ = (
        db.Index('ix_reports_status_created', 'status', 'created_at'),
        db.Index('ix_reports_reporter_status', 'reporter_id', 'status'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    reporter_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    reported_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    target_type = db.Column(db.String(10), default='user')
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=True)
    reason = db.Column(db.String(300), default='')
    status = db.Column(db.String(10), default='open')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    reporter = db.relationship('User', foreign_keys=[reporter_id])
    reported = db.relationship('User', foreign_keys=[reported_id])
    reported_chat = db.relationship('Chat', foreign_keys=[chat_id])


class Poll(db.Model):
    __tablename__ = 'polls'
    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False, index=True)
    question = db.Column(db.String(300), default='')
    options = db.Column(db.Text, default='[]')
    multi = db.Column(db.Boolean, default=False)
    closed = db.Column(db.Boolean, default=False)
    expires_at = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    chat = db.relationship('Chat')
    message = db.relationship('Message')
    votes = db.relationship('PollVote', backref='poll', cascade='all, delete-orphan', lazy=True)

    def options_list(self):
        try:
            data = json.loads(self.options or '[]')
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def set_options(self, data):
        self.options = json.dumps(data or [])

    def counts(self):
        from collections import Counter
        c = Counter(v.option_index for v in self.votes)
        return {i: c.get(i, 0) for i in range(len(self.options_list()))}

    def is_expired(self):
        return bool(self.expires_at and datetime.utcnow() > self.expires_at)

    def to_dict(self, viewer_id=None):
        counts = self.counts()
        total = sum(counts.values())
        voter_ids = {v.user_id for v in self.votes}
        my = sorted(v.option_index for v in self.votes if v.user_id == viewer_id) if viewer_id else []
        return {
            'id': self.id,
            'chat_id': self.chat_id,
            'message_id': self.message_id,
            'question': self.question,
            'options': self.options_list(),
            'multi': bool(self.multi),
            'closed': bool(self.closed or self.is_expired()),
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'counts': counts,
            'total': total,
            'voters': len(voter_ids),
            'my_votes': my,
            'created_by': self.created_by,
        }

    def voter_details(self):
        from collections import defaultdict
        picks = defaultdict(list)
        for v in self.votes:
            picks[v.user_id].append(v.option_index)
        out = []
        for uid, opts in picks.items():
            u = User.query.get(uid)
            if not u:
                continue
            out.append({
                'user': u.to_public(),
                'picks': sorted(opts),
            })
        return out


class PollVote(db.Model):
    __tablename__ = 'poll_votes'
    __table_args__ = (
        db.UniqueConstraint('poll_id', 'user_id', 'option_index', name='uq_poll_vote'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'},
    )

    id = db.Column(db.Integer, primary_key=True)
    poll_id = db.Column(db.Integer, db.ForeignKey('polls.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    option_index = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User')


class Avatar(db.Model):
    __tablename__ = 'avatars'
    __table_args__ = (
        db.UniqueConstraint('owner_type', 'owner_id', 'path', name='uq_avatar'),
        db.Index('ix_avatars_owner', 'owner_type', 'owner_id'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    owner_type = db.Column(db.String(10), nullable=False, index=True)
    owner_id = db.Column(db.Integer, nullable=False, index=True)
    path = db.Column(db.String(120), nullable=False)
    is_primary = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def url(self):
        return f'/files/avatar/{self.path}' if self.path else ''

    def to_dict(self):
        return {
            'id': self.id,
            'owner_type': self.owner_type,
            'owner_id': self.owner_id,
            'path': self.path,
            'url': self.url,
            'is_primary': bool(self.is_primary),
        }


class Gif(db.Model):
    __tablename__ = 'gifs'
    __table_args__ = ({'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'},)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    name = db.Column(db.String(160), default='')
    file_path = db.Column(db.String(200), nullable=False)
    kind = db.Column(db.String(10), default='gif', nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def url(self):
        return f'/files/{self.file_path}' if self.file_path else ''

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'url': self.url,
            'kind': self.kind,
        }


class Article(db.Model):
    __tablename__ = 'articles'
    __table_args__ = (
        db.Index('ix_articles_chat', 'chat_id', 'created_at'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    author_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    title = db.Column(db.String(120), nullable=False, default='')
    body = db.Column(db.Text, default='')
    cover = db.Column(db.String(200), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def cover_url(self):
        if not self.cover:
            return ''
        if self.cover.startswith('http://') or self.cover.startswith('https://'):
            return self.cover
        return f'/files/{self.cover}'

    def to_dict(self, full=False):
        d = {
            'id': self.id,
            'chat_id': self.chat_id,
            'author_id': self.author_id,
            'title': self.title,
            'cover': self.cover_url,
            'created_at': self.created_at.isoformat() if self.created_at else '',
            'updated_at': self.updated_at.isoformat() if self.updated_at else '',
            'preview': (self.body or '')[:180],
        }
        if full:
            d['body'] = self.body or ''
        return d


class UserSession(db.Model):
    __tablename__ = 'user_sessions'
    __table_args__ = (
        db.Index('ix_usersessions_user', 'user_id', 'last_active_at'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    key = db.Column(db.String(64), unique=True, nullable=False)
    user_agent = db.Column(db.String(300), default='')
    ip = db.Column(db.String(64), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_active_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, current_key=None):
        return {
            'key': self.key,
            'user_agent': self.user_agent or '',
            'ip': self.ip or '',
            'created_at': self.created_at.isoformat() if self.created_at else '',
            'last_active_at': self.last_active_at.isoformat() if self.last_active_at else '',
            'current': bool(current_key and self.key == current_key),
        }


class Bot(db.Model):
    __tablename__ = 'bots'
    __table_args__ = ({'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'},)

    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    token = db.Column(db.String(120), unique=True, nullable=False)
    webhook_url = db.Column(db.String(300), default='')
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, with_token=False):
        d = {
            'id': self.id,
            'user_id': self.user_id,
            'is_active': bool(self.is_active),
            'webhook_url': self.webhook_url or '',
            'created_at': self.created_at.isoformat() if self.created_at else '',
        }
        if with_token:
            d['token'] = self.token
        return d


class BotUpdate(db.Model):
    __tablename__ = 'bot_updates'
    __table_args__ = (
        db.Index('ix_botupdates_bot_consumed', 'bot_id', 'consumed'),
        {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}
    )

    id = db.Column(db.Integer, primary_key=True)
    bot_id = db.Column(db.Integer, db.ForeignKey('bots.id'), nullable=False, index=True)
    payload = db.Column(db.Text, default='{}')
    consumed = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
