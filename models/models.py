import hmac
import json
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
    accent = db.Column(db.String(20), default='#e5393b')
    is_admin = db.Column(db.Boolean, default=False)
    is_banned = db.Column(db.Boolean, default=False)
    read_receipts = db.Column(db.Boolean, default=True)
    show_online = db.Column(db.Boolean, default=True, nullable=False)
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

    def to_public(self):
        return {
            'id': self.id,
            'username': self.username,
            'display_name': self.public_name,
            'bio': self.public_bio,
            'avatar': self.avatar_url,
            'accent': self.accent,
            'is_admin': self.is_admin,
            'status': self.status if self.show_online else 'offline',
            'read_receipts': bool(self.read_receipts),
        }

    def to_self(self):
        data = self.to_public()
        data['is_banned'] = self.is_banned
        data['show_online'] = bool(self.show_online)
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
    slow_mode = db.Column(db.Integer, default=0)  # seconds between messages (0 = off)
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
            other = next((m.user for m in self.members if m.user_id != uid), None)
            if other:
                peer = other.to_public()
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
    __table_args__ = (db.UniqueConstraint('chat_id', 'user_id'), {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'})

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


class Message(db.Model):
    __tablename__ = 'messages'
    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    def react_dict(self):
        try:
            return json.loads(self.reactions or '{}')
        except Exception:
            return {}

    def set_reactions(self, value):
        self.reactions = json.dumps(value)

    def read_ids(self):
        try:
            return json.loads(self.read_by or '[]')
        except Exception:
            return []

    def visible_read_ids(self):
        ids = self.read_ids()
        if not ids:
            return []
        hidden = {
            u.id for u in User.query.filter(
                User.id.in_(ids), User.read_receipts.is_(False)
            ).all()
        }
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


class HiddenMessage(db.Model):
    __tablename__ = 'hidden_messages'
    __table_args__ = (db.UniqueConstraint('user_id', 'message_id'), {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'})

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Block(db.Model):
    __tablename__ = 'blocks'
    __table_args__ = (db.UniqueConstraint('user_id', 'blocked_user_id'), {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'})

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    blocked_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Report(db.Model):
    __tablename__ = 'reports'
    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    id = db.Column(db.Integer, primary_key=True)
    reporter_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    reported_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=True)
    reason = db.Column(db.String(300), default='')
    status = db.Column(db.String(10), default='open')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    reporter = db.relationship('User', foreign_keys=[reporter_id])
    reported = db.relationship('User', foreign_keys=[reported_id])


class Poll(db.Model):
    """A poll attached to a message. The poll is a separate row so that
    votes can be tallied and re-voted without touching the message row."""
    __tablename__ = 'polls'
    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=False, index=True)
    question = db.Column(db.String(300), default='')
    options = db.Column(db.Text, default='[]')   # JSON: ["label1", "label2", ...]
    multi = db.Column(db.Boolean, default=False)  # allow multiple answers
    closed = db.Column(db.Boolean, default=False)
    expires_at = db.Column(db.DateTime, nullable=True)  # auto-close at this time (None = never)
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
        """Return {option_index: vote_count} for every option."""
        from collections import Counter
        c = Counter(v.option_index for v in self.votes)
        return {i: c.get(i, 0) for i in range(len(self.options_list()))}

    def is_expired(self):
        return bool(self.expires_at and datetime.utcnow() > self.expires_at)

    def to_dict(self, viewer_id=None):
        counts = self.counts()
        total = sum(counts.values())
        # Number of unique people who voted (not total selections)
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
        """List of {user, picks} for each user who voted (for group view)."""
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
