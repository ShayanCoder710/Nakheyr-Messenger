import json
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

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
    accent = db.Column(db.String(20), default='#e11d48')
    is_admin = db.Column(db.Boolean, default=False)
    is_banned = db.Column(db.Boolean, default=False)
    is_verified = db.Column(db.Boolean, default=False)
    status = db.Column(db.String(10), default='offline')
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    streak_days = db.Column(db.Integer, default=0)
    last_streak_day = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, value):
        self.password_hash = generate_password_hash(value)

    def check_password(self, value):
        return check_password_hash(self.password_hash, value)

    @property
    def avatar_url(self):
        return f'/files/avatar/{self.avatar}' if self.avatar else ''

    def to_public(self):
        return {
            'id': self.id,
            'username': self.username,
            'display_name': self.display_name,
            'bio': self.bio,
            'avatar': self.avatar_url,
            'accent': self.accent,
            'is_admin': self.is_admin,
            'is_verified': self.is_verified,
            'status': self.status,
        }

    def to_self(self):
        data = self.to_public()
        data['is_banned'] = self.is_banned
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
        }
        if self.chat_type == 'dm' and current_user:
            uid = getattr(current_user, 'id', current_user)
            other = next((m.user for m in self.members if m.user_id != uid), None)
            data['peer'] = other.to_public() if other else None
        return data


class ChatMember(db.Model):
    __tablename__ = 'chat_members'
    __table_args__ = (db.UniqueConstraint('chat_id', 'user_id'), {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'})

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    role = db.Column(db.String(10), default='member')
    title = db.Column(db.String(30), default='')
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref='memberships')


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
            'read_by': self.read_ids(),
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
