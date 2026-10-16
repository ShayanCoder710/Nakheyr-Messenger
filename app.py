import os
import re
from datetime import datetime

from flask import (
    Flask, render_template, request, redirect, url_for, session,
    flash, abort, jsonify, send_from_directory
)
from flask_socketio import SocketIO, emit, join_room
from sqlalchemy.orm import joinedload

from config import MYSQL_CONFIG, SECRET_KEY
from models.models import db, User, Chat, ChatMember, Message, Report, Block
from func import (
    init_db, current_user, require_auth, require_admin, save_avatar, save_upload_file,
    is_blocked, get_or_create_dm, create_group, create_channel, chat_display_name,
    user_chats, unread_counts, admin_stats, bump_online, avatar_html, save_chat_avatar,
    username_taken, generate_chat_username, CHAT_USERNAME_RE, RESERVED_USERNAMES,
    get_or_create_notes
)

BASE = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE, 'uploads')
AVATAR_DIR = os.path.join(UPLOAD_DIR, 'avatar')

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = SECRET_KEY
app.config['SQLALCHEMY_DATABASE_URI'] = MYSQL_CONFIG
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024
app.config['UPLOAD_DIR'] = UPLOAD_DIR
app.config['AVATAR_DIR'] = AVATAR_DIR
app.config['TEMPLATES_AUTO_RELOAD'] = True

db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins='*')

with app.app_context():
    init_db()


@app.before_request
def touch_online():
    if request.endpoint == 'static':
        return
    user = current_user()
    if not user or user.is_banned:
        return
    now = datetime.utcnow()
    if user.status == 'online' and user.last_seen and (now - user.last_seen).total_seconds() < 20:
        return
    user.status = 'online'
    user.last_seen = now
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()


def can_view_chat(user, chat):
    if user.is_admin:
        return True
    member = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first() is not None
    if member:
        return True
    if chat.chat_type in ('group', 'channel'):
        return bool(chat.is_public)
    return False


def chat_member_ids(chat_id):
    return [m.user_id for m in ChatMember.query.filter_by(chat_id=chat_id)]


def chat_users(chat):
    return [m.user for m in chat.members if m.user]


def my_role_in(user, chat):
    m = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
    return m.role if m else None


@app.route('/')
@require_auth
def home():
    user = current_user()
    return render_template('chat.html', chat=None, user=user,
                           messages=[], members=[], role=None)


@app.route('/login', methods=['GET', 'POST'])
def login():
    def safe_next(target):
        return target if target and target.startswith('/') and not target.startswith('//') else None
    if current_user():
        return redirect(safe_next(request.args.get('next')) or url_for('home'))
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip().lower()
        password = request.form.get('password') or ''
        user = User.query.filter_by(username=username).first()
        if not user or not user.check_password(password):
            flash('نام کاربری یا پسورد اشتباهه.', 'error')
            return render_template('login.html', next=safe_next(request.form.get('next')) or '')
        if user.is_banned:
            flash('حساب شما مسدود شده. با ادمین تماس بگیر.', 'error')
            return render_template('login.html', next=safe_next(request.form.get('next')) or '')
        session['user_id'] = user.id
        bump_online(user)
        flash(f'خوش برگشتی {user.display_name}!', 'success')
        return redirect(safe_next(request.form.get('next')) or url_for('home'))
    return render_template('login.html', next=safe_next(request.args.get('next')) or '')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user():
        return redirect(url_for('home'))
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip().lower()
        display = (request.form.get('display_name') or '').strip()
        password = request.form.get('password') or ''
        if not re.match(r'^[a-z0-9_]{3,30}$', username):
            flash('نام کاربری: ۳ تا ۳۰ حرف انگلیسی، عدد یا _', 'error')
            return render_template('register.html')
        if len(display) < 2:
            flash('نام نمایشی باید حداقل ۲ حرف باشد.', 'error')
            return render_template('register.html')
        if len(password) < 6:
            flash('پسورد حداقل ۶ کاراکتر باشد.', 'error')
            return render_template('register.html')
        if username in RESERVED_USERNAMES or username_taken(username):
            flash('این نام کاربری قبلا گرفته شده.', 'error')
            return render_template('register.html')
        user = User(username=username, display_name=display)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        bump_online(user)
        flash(f'خوش اومدی {display}!', 'success')
        return redirect(url_for('home'))
    return render_template('register.html')


@app.route('/logout', methods=['GET', 'POST'])
def logout():
    user = current_user()
    if user:
        user.status = 'offline'
        user.last_seen = datetime.utcnow()
        db.session.commit()
    session.clear()
    return redirect(url_for('login'))


@app.route('/chat/<int:chat_id>')
@require_auth
def chat_page(chat_id):
    user = current_user()
    chat = db.session.execute(
        db.select(Chat).where(Chat.id == chat_id)
        .options(joinedload(Chat.members).joinedload(ChatMember.user))
    ).scalars().first()
    if not chat or not can_view_chat(user, chat):
        abort(404)
    msgs = []
    for m in Message.query.filter_by(chat_id=chat.id, deleted=False).order_by(Message.id.desc()).limit(50).all()[::-1]:
        msgs.append(m.to_dict(user.id))
    members = [m.user.to_public() for m in chat.members if m.user]
    return render_template('chat.html', chat=chat, user=user, messages=msgs,
                           members=members, role=my_role_in(user, chat))


@app.route('/chat/<username>')
@require_auth
def chat_page_by_username(username):
    user = current_user()
    chat = Chat.query.filter(db.func.lower(Chat.username) == username.lower()).first()
    if not chat or chat.chat_type == 'dm':
        abort(404)
    if not can_view_chat(user, chat):
        flash('این گپ خصوصیه. برای ورود باید دعوت بشی.', 'error')
        return redirect(url_for('home'))
    return redirect(url_for('chat_page', chat_id=chat.id))


@app.route('/api/search')
@require_auth
def api_search():
    user = current_user()
    q = (request.args.get('q') or '').strip().lower()
    users = []
    chats = []
    if q:
        users = User.query.filter(
            db.or_(
                db.func.lower(User.username).like(f'%{q}%'),
                db.func.lower(User.display_name).like(f'%{q}%'),
            ),
        ).limit(8).all()
        public_q = Chat.query.filter(
            Chat.chat_type.in_(['group', 'channel']),
            Chat.is_public.is_(True),
            db.or_(
                db.func.lower(Chat.name).like(f'%{q}%'),
                db.func.lower(Chat.username).like(f'%{q}%'),
                db.func.lower(Chat.description).like(f'%{q}%'),
            ),
        ).limit(8).all()
        known = Chat.query.filter(
            Chat.chat_type.in_(['group', 'channel']),
            db.or_(
                db.func.lower(Chat.name).like(f'%{q}%'),
                db.func.lower(Chat.username).like(f'%{q}%'),
            ),
            Chat.members.any(ChatMember.user_id == user.id),
        ).limit(8).all()
        seen = set()
        for c in list(public_q) + list(known):
            if c.id in seen:
                continue
            if not can_view_chat(user, c):
                continue
            seen.add(c.id)
            chats.append(c)
    return jsonify({
        'users': [u.to_public() for u in users if not u.is_banned],
        'chats': [{
            'id': c.id,
            'chat_type': c.chat_type,
            'name': c.name,
            'username': c.username or '',
            'is_public': bool(c.is_public),
            'is_member': (ChatMember.query.filter_by(chat_id=c.id, user_id=user.id).first() is not None) or user.is_admin,
        } for c in chats],
    })


@app.route('/api/user/by-username', methods=['POST'])
@require_auth
def api_user_by_username():
    user = current_user()
    data = request.get_json(silent=True) or {}
    uname = (data.get('username') or '').strip().lower()
    target = User.query.filter_by(username=uname).first()
    if not target or target.id == user.id:
        return jsonify(ok=False, error='کاربر پیدا نشد')
    if target.is_banned:
        return jsonify(ok=False, error='کاربر مسدود شده')
    if is_blocked(user.id, target.id):
        return jsonify(ok=False, error='کاربر رو بلاک کرده، نمی‌تونی DM بزنی')
    return jsonify(ok=True, user=target.to_public())


@app.route('/api/dm', methods=['POST'])
@require_auth
def api_dm():
    user = current_user()
    data = request.get_json(silent=True) or {}
    peer = User.query.get(int(data.get('user_id') or 0))
    if not peer:
        return jsonify(ok=False, error='کاربر پیدا نشد')
    if peer.id == user.id:
        return jsonify(ok=False, error='با خودت چی می‌خوای گپ بزنی؟')
    if is_blocked(user.id, peer.id):
        return jsonify(ok=False, error='تو یا کاربر مقابل، همدیگه رو بلاک کرده.')
    chat, created = get_or_create_dm(user, peer)
    return jsonify(ok=True, chat_id=chat.id, created=created)


@app.route('/api/notes', methods=['POST'])
@require_auth
def api_notes():
    user = current_user()
    chat, created = get_or_create_notes(user)
    return jsonify(ok=True, chat_id=chat.id, created=created)


@app.route('/api/group/create', methods=['POST'])
@require_auth
def api_group_create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if len(name) < 2:
        return jsonify(ok=False, error='نام گروه حداقل ۲ حرف')
    member_ids = [int(x) for x in data.get('members', []) if int(x) != user.id]
    is_public = data.get('is_public', True)
    g = create_group(user, name, data.get('description', ''), member_ids, is_public)
    return jsonify(ok=True, chat_id=g.id, is_public=is_public)


@app.route('/api/channel/create', methods=['POST'])
@require_auth
def api_channel_create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if len(name) < 2:
        return jsonify(ok=False, error='نام کانال حداقل ۲ حرف')
    is_public = data.get('is_public', True)
    c = create_channel(user, name, data.get('description', ''), is_public)
    return jsonify(ok=True, chat_id=c.id, is_public=is_public)


@app.route('/api/chat/<int:chat_id>/settings', methods=['POST'])
@require_auth
def api_chat_settings(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or chat.chat_type == 'dm':
        return jsonify(ok=False, error='این گپ قابل تغییر نیست')
    role = my_role_in(user, chat)
    data = request.get_json(silent=True) or {}
    wants_visibility = 'is_public' in data
    wants_edit = any(k in data for k in ('name', 'description', 'username'))
    if wants_visibility and role not in ('owner', 'admin') and not user.is_admin:
        return jsonify(ok=False, error='تغییر نوع گپ فقط برای صاحب و ادمین گپ')
    if wants_edit and role not in ('owner', 'admin') and not user.is_admin:
        return jsonify(ok=False, error='تغییر نام و توضیح فقط برای صاحب و ادمین گپ')
    changed = False
    if 'name' in data:
        new_name = (data.get('name') or '').strip()
        if len(new_name) < 2:
            return jsonify(ok=False, error='نام حداقل ۲ حرف')
        chat.name = new_name[:60]
        changed = True
    if 'username' in data:
        new_uname = (data.get('username') or '').strip().lower()
        if new_uname != (chat.username or ''):
            if not CHAT_USERNAME_RE.match(new_uname):
                return jsonify(ok=False, error='نام کاربری گپ: با حرف انگلیسی شروع بشه، ۳ تا ۳۰ حرف/عدد/_')
            if new_uname in RESERVED_USERNAMES or username_taken(new_uname, chat_id=chat.id):
                return jsonify(ok=False, error='این نام کاربری گرفته شده')
            chat.username = new_uname
            changed = True
    if 'description' in data:
        chat.description = (data.get('description') or '').strip()[:200]
        changed = True
    if wants_visibility:
        chat.is_public = bool(data.get('is_public'))
        changed = True
    if changed:
        db.session.commit()
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
    return jsonify(ok=True, chat=chat.to_public(user), role=role)


@app.route('/api/chat/<int:chat_id>/members', methods=['GET', 'POST'])
@require_auth
def api_members(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or not can_view_chat(user, chat):
        abort(404)
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        action = data.get('action')
        target = int(data.get('user_id') or 0)
        role = my_role_in(user, chat)
        if action == 'kick':
            if role not in ('owner', 'admin') or target == user.id:
                return jsonify(ok=False, error='دسترسی نداری')
            if chat.owner_id == target:
                return jsonify(ok=False, error='صاحب گروه قابل اخراج نیست')
            ChatMember.query.filter_by(chat_id=chat.id, user_id=target).delete()
            db.session.commit()
            return jsonify(ok=True)
        if action == 'leave':
            if chat.owner_id == user.id:
                return jsonify(ok=False, error='صاحب نمی‌تونه گروه رو ترک کنه. اول مالکیت رو منتقل کن.')
            ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).delete()
            db.session.commit()
            return jsonify(ok=True)
        if action == 'promote':
            if role != 'owner':
                return jsonify(ok=False, error='فقط صاحب گروه')
            if target == chat.owner_id:
                return jsonify(ok=False, error='صاحب گروه قابل تغییر نقش نیست. اول مالکیت رو منتقل کن')
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not m:
                return jsonify(ok=False, error='عضو نیست')
            m.role = 'admin' if m.role != 'admin' else 'member'
            db.session.commit()
            return jsonify(ok=True, role=m.role)
        if action == 'title':
            allowed = role in ('owner', 'admin') or target == user.id
            if not allowed:
                return jsonify(ok=False, error='فقط می‌تونی خودت یا (به‌عنوان ادمین) بقیه رو لقب بدی')
            new_title = (data.get('title') or '').strip()[:30]
            if len(new_title) > 30:
                return jsonify(ok=False, error='لقب حداکثر ۳۰ حرفه')
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not m:
                return jsonify(ok=False, error='عضو نیست')
            m.title = new_title
            db.session.commit()
            return jsonify(ok=True, title=m.title)
        if action == 'add':
            if role not in ('owner', 'admin'):
                return jsonify(ok=False, error='دسترسی نداری')
            if not ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first():
                db.session.add(ChatMember(chat_id=chat.id, user_id=target, role='member'))
                db.session.commit()
            return jsonify(ok=True)
        if action == 'transfer':
            if role != 'owner':
                return jsonify(ok=False, error='فقط صاحب گروه')
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
            m.role = 'admin'
            t = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not t:
                return jsonify(ok=False, error='هدف عضو نیست')
            t.role = 'owner'
            chat.owner_id = target
            db.session.commit()
            return jsonify(ok=True)
        return jsonify(ok=False, error='عملیات نامعتبر')
    return jsonify(members=[
        {**m.user.to_public(), 'role': m.role, 'title': m.title or ''}
        for m in chat.members if m.user
    ])


@app.route('/api/chat/<int:chat_id>/avatar', methods=['POST'])
@require_auth
def api_chat_avatar(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or chat.chat_type == 'dm':
        return jsonify(ok=False, error='این گپ قابل تغییر نیست')
    role = my_role_in(user, chat)
    if role not in ('owner', 'admin') and not user.is_admin:
        return jsonify(ok=False, error='دسترسی نداری')
    if request.form.get('delete') == '1':
        if chat.avatar:
            old = os.path.join(app.config['AVATAR_DIR'], chat.avatar)
            if os.path.exists(old):
                os.remove(old)
        chat.avatar = ''
        db.session.commit()
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
        return jsonify(ok=True, avatar='')
    f = request.files.get('avatar')
    if not f or not f.filename:
        return jsonify(ok=False, error='فایلی دریافت نشد')
    fname = save_chat_avatar(user, f.filename)
    if not fname:
        return jsonify(ok=False, error='فرمت عکس مجاز نیست')
    if chat.avatar:
        old = os.path.join(app.config['AVATAR_DIR'], chat.avatar)
        if os.path.exists(old):
            os.remove(old)
    chat.avatar = fname
    db.session.commit()
    for mid in chat_member_ids(chat.id):
        socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
    return jsonify(ok=True, avatar=chat.avatar_url)


@app.route('/api/chat/<int:chat_id>/delete', methods=['POST'])
@require_auth
def api_chat_delete(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify(ok=False, error='گپ پیدا نشد')
    if chat.chat_type == 'dm':
        is_member = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first() is not None
        if not is_member and not user.is_admin:
            return jsonify(ok=False, error='دسترسی نداری')
    else:
        role = my_role_in(user, chat)
        if role != 'owner' and not user.is_admin:
            return jsonify(ok=False, error='فقط صاحب گروه / کانال می‌تونه حذفش کنه')
    for m in chat.messages:
        Report.query.filter_by(message_id=m.id).update({'message_id': None})
        if m.file_path:
            p = os.path.join(app.config['UPLOAD_DIR'], m.file_path)
            if os.path.exists(p):
                os.remove(p)
    if chat.avatar:
        p = os.path.join(app.config['AVATAR_DIR'], chat.avatar)
        if os.path.exists(p):
            os.remove(p)
    member_ids = chat_member_ids(chat.id)
    db.session.delete(chat)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify(ok=False, error='حذف کامل نشد')
    for mid in member_ids:
        socketio.emit('chat_deleted', {'chat_id': chat.id}, room=f'user:{mid}')
    return jsonify(ok=True)


@app.route('/api/message/send', methods=['POST'])
@require_auth
def api_send_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    chat = Chat.query.get(int(data.get('chat_id') or 0))
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری')
    if chat.chat_type != 'dm' and not user.is_admin:
        if not ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first():
            if chat.is_public:
                db.session.add(ChatMember(chat_id=chat.id, user_id=user.id, role='member'))
                db.session.flush()
            else:
                return jsonify(ok=False, error='دسترسی نداری')
    if chat.chat_type == 'dm':
        peer = next((m.user for m in chat.members if m.user_id != user.id), None)
        if peer and is_blocked(user.id, peer.id):
            return jsonify(ok=False, error='کاربر رو بلاک کردی — تا وقتی باز نکنی نمی‌تونی پیام بدی')
    if chat.chat_type == 'channel':
        role = my_role_in(user, chat)
        if chat.owner_id != user.id and role != 'admin':
            return jsonify(ok=False, error='در کانال فقط ادمین‌ها پیام می‌فرستن')
    msg_type = data.get('msg_type', 'text')
    content = (data.get('content') or '').strip()
    file_path = data.get('file_path') or ''
    file_name = data.get('file_name') or ''
    if msg_type == 'text' and not content:
        return jsonify(ok=False, error='پیام خالی')
    if msg_type in ('image', 'file') and not file_path:
        return jsonify(ok=False, error='فایلی آتچ نشده')
    m = Message(chat_id=chat.id, sender_id=user.id, msg_type=msg_type,
                content=content, file_name=file_name, file_path=file_path,
                reply_to=data.get('reply_to') or None)
    db.session.add(m)
    db.session.commit()
    payload = m.to_dict(user.id)
    socketio.emit('new_message', payload, room=f'user:{user.id}')
    for mid in chat_member_ids(chat.id):
        if mid != user.id:
            socketio.emit('new_message', payload, room=f'user:{mid}')
    return jsonify(ok=True, message=payload)


@app.route('/api/message/react', methods=['POST'])
@require_auth
def api_react():
    user = current_user()
    data = request.get_json(silent=True) or {}
    m = Message.query.get(int(data.get('message_id') or 0))
    if not m:
        abort(404)
    emoji = data.get('emoji')
    if not emoji:
        return jsonify(ok=False, error='ایموجی بی‌مورد')
    current = m.react_dict()
    key = str(user.id)
    if current.get(key) == emoji:
        current.pop(key)
    else:
        current[key] = emoji
    m.set_reactions(current)
    db.session.commit()
    for mid in chat_member_ids(m.chat_id):
        socketio.emit('reaction', {
            'message_id': m.id,
            'reactions': m.react_dict(),
            'my_reaction': m.react_dict().get(str(mid)),
        }, room=f'user:{mid}')
    return jsonify(ok=True, reactions=m.react_dict())


@app.route('/api/message/edit', methods=['POST'])
@require_auth
def api_edit_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    m = Message.query.get(int(data.get('message_id') or 0))
    if not m or m.sender_id != user.id:
        return jsonify(ok=False, error='دسترسی نداری')
    m.content = (data.get('content') or '').strip()
    m.is_edited = True
    db.session.commit()
    for mid in chat_member_ids(m.chat_id):
        socketio.emit('message_edited', {'message_id': m.id, 'content': m.content},
                      room=f'user:{mid}')
    return jsonify(ok=True, content=m.content)


@app.route('/api/message/delete', methods=['POST'])
@require_auth
def api_delete_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    m = Message.query.get(int(data.get('message_id') or 0))
    if not m:
        abort(404)
    if m.sender_id != user.id and not user.is_admin:
        return jsonify(ok=False, error='دسترسی نداری')
    m.deleted = True
    m.content = ''
    db.session.commit()
    for mid in chat_member_ids(m.chat_id):
        socketio.emit('message_deleted', {'message_id': m.id}, room=f'user:{mid}')
    return jsonify(ok=True)


@app.route('/api/mark-read', methods=['POST'])
@require_auth
def api_mark_read():
    user = current_user()
    data = request.get_json(silent=True) or {}
    chat = Chat.query.get(int(data.get('chat_id') or 0))
    if not chat or not can_view_chat(user, chat):
        abort(404)
    msgs = Message.query.filter(
        Message.chat_id == chat.id, Message.deleted.is_(False), Message.sender_id != user.id
    ).all()
    changed = False
    for m in msgs:
        if user.id not in m.read_ids():
            m.set_read(user.id)
            changed = True
    if changed:
        db.session.commit()
        for mid in chat_member_ids(chat.id):
            if mid != user.id:
                socketio.emit('read_recept', {'chat_id': chat.id, 'user_id': user.id},
                              room=f'user:{mid}')
    return jsonify(ok=True)


@app.route('/api/upload', methods=['POST'])
@require_auth
def api_upload():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify(ok=False, error='فایلی آپلود نشد')
    path = save_upload_file(f)
    if not path:
        return jsonify(ok=False, error='فرمت یا حجم فایل مجاز نیست (حداکثر ۲۵ مگ).')
    kind = 'image' if f.mimetype.startswith('image/') else 'file'
    return jsonify(ok=True, file_path=path, file_name=f.filename, kind=kind,
                   file_url=f'/files/{path}')


@app.route('/api/block', methods=['POST'])
@require_auth
def api_block():
    user = current_user()
    data = request.get_json(silent=True) or {}
    target = int(data.get('user_id') or 0)
    if target == user.id:
        return jsonify(ok=False, error='خودت رو نمی‌تونی بلاک کنی')
    existing = Block.query.filter_by(user_id=user.id, blocked_user_id=target).first()
    if existing:
        Block.query.filter_by(user_id=user.id, blocked_user_id=target).delete()
        db.session.commit()
        return jsonify(ok=True, blocked=False)
    db.session.add(Block(user_id=user.id, blocked_user_id=target))
    db.session.commit()
    return jsonify(ok=True, blocked=True)


@app.route('/api/report', methods=['POST'])
@require_auth
def api_report():
    user = current_user()
    data = request.get_json(silent=True) or {}
    target = int(data.get('user_id') or 0)
    reason = (data.get('reason') or '').strip()
    if not target or not reason:
        return jsonify(ok=False, error='دلیل رو بنویس')
    db.session.add(Report(reporter_id=user.id, reported_id=target,
                          message_id=data.get('message_id') or None, reason=reason))
    db.session.commit()
    flash('گزارشتت ثبت شد. ادمین‌ها بررسی می‌کنن.', 'success')
    return jsonify(ok=True)


@app.route('/api/profile', methods=['POST'])
@require_auth
def api_profile():
    user = current_user()
    data = request.get_json(silent=True) or {}
    if data.get('display_name'):
        user.display_name = data['display_name'].strip()[:60]
    if 'bio' in data:
        user.bio = (data['bio'] or '').strip()[:200]
    if data.get('accent') and re.match(r'^#[0-9a-fA-F]{6}$', data['accent']):
        user.accent = data['accent']
    if 'username' in data:
        new_username = (data.get('username') or '').strip().lower()
        if not re.match(r'^[a-z0-9_]{3,30}$', new_username):
            return jsonify(ok=False, error='نام کاربری: ۳ تا ۳۰ حرف انگلیسی، عدد یا _')
        if new_username != user.username:
            if new_username in RESERVED_USERNAMES and not user.is_admin:
                return jsonify(ok=False, error='این نام کاربری رزرو شده')
            if username_taken(new_username, user_id=user.id):
                return jsonify(ok=False, error='این نام کاربری قبلا گرفته شده')
            user.username = new_username
    db.session.commit()
    socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
    return jsonify(ok=True, profile=user.to_public())


@app.route('/api/avatar', methods=['POST'])
@require_auth
def api_avatar():
    user = current_user()
    if request.form.get('delete') == '1':
        if user.avatar:
            old = os.path.join(app.config['AVATAR_DIR'], user.avatar)
            if os.path.exists(old):
                os.remove(old)
        user.avatar = ''
        db.session.commit()
        socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
        return jsonify(ok=True, avatar='')
    f = request.files.get('avatar')
    if not f or not f.filename:
        return jsonify(ok=False, error='فایلی دریافت نشد')
    fname = save_avatar(f.filename)
    if not fname:
        return jsonify(ok=False, error='فرمت عکس مجاز نیست')
    if user.avatar:
        old = os.path.join(app.config['AVATAR_DIR'], user.avatar)
        if os.path.exists(old):
            os.remove(old)
    user.avatar = fname
    db.session.commit()
    socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
    return jsonify(ok=True, avatar=user.avatar_url)


@app.route('/files/avatar/<path:fname>')
def static_avatar(fname):
    return send_from_directory(app.config['AVATAR_DIR'], fname, max_age=31536000)


@app.route('/files/<path:fname>')
def static_files(fname):
    user = current_user()
    base = os.path.abspath(app.config['UPLOAD_DIR'])
    target = os.path.abspath(os.path.join(base, fname))
    if not target.startswith(base + os.sep):
        abort(404)
    if not os.path.exists(target):
        abort(404)
    uid_part = fname.split('/')[0]
    if not user:
        abort(403)
    if not (uid_part.isdigit() and int(uid_part) == user.id) and not user.is_admin:
        abort(403)
    return send_from_directory(app.config['UPLOAD_DIR'], fname, max_age=31536000)


@app.route('/api/message/pin', methods=['POST'])
@require_auth
def api_pin_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    m = Message.query.get(int(data.get('message_id') or 0))
    if not m:
        abort(404)
    if m.deleted:
        return jsonify(ok=False, error='پیام حذف شده پین نمی‌شه')
    role = my_role_in(user, Chat.query.get(m.chat_id))
    allowed = user.is_admin or role in ('owner', 'admin') or m.sender_id == user.id
    if not allowed:
        return jsonify(ok=False, error='دسترسی نداری')
    m.pinned = not m.pinned
    db.session.commit()
    for mid in chat_member_ids(m.chat_id):
        socketio.emit('message_pinned', {'message_id': m.id, 'pinned': m.pinned}, room=f'user:{mid}')
    return jsonify(ok=True, pinned=m.pinned)


@app.route('/api/message/bulk-delete', methods=['POST'])
@require_auth
def api_bulk_delete():
    user = current_user()
    data = request.get_json(silent=True) or {}
    ids = [int(x) for x in data.get('ids', [])]
    if not ids:
        return jsonify(ok=False, error='پیامی انتخاب نشده')
    if len(ids) > 50:
        return jsonify(ok=False, error='حداکثر ۵۰ پیام در یک بار')
    q = Message.query.filter(Message.id.in_(ids), Message.sender_id == user.id)
    changed = 0
    for m in q.all():
        m.deleted = True
        m.content = ''
        changed += 1
        for mid in chat_member_ids(m.chat_id):
            socketio.emit('message_deleted', {'message_id': m.id}, room=f'user:{mid}')
    db.session.commit()
    return jsonify(ok=True, deleted=changed)


@app.route('/api/chat/<int:chat_id>/pinned')
@require_auth
def api_pinned(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or not can_view_chat(user, chat):
        abort(404)
    m = Message.query.filter_by(chat_id=chat.id, pinned=True, deleted=False).order_by(Message.id.desc()).first()
    if not m:
        return jsonify(pinned=None)
    sender = next((x for x in chat_users(chat) if x.id == m.sender_id), None)
    return jsonify(pinned=m.to_dict(user.id), sender=(sender.to_public() if sender else None))


@app.route('/api/chat/<int:chat_id>/join', methods=['POST'])
@require_auth
def api_join_chat(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or chat.chat_type == 'dm':
        return jsonify(ok=False, error='دسترسی نداری')
    if not chat.is_public and user.id != chat.owner_id and not user.is_admin:
        existing = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
        if existing is None:
            return jsonify(ok=False, error='این گپ خصوصی است. منتظر دعوت صاحب بمان.')
    if not ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first():
        db.session.add(ChatMember(chat_id=chat.id, user_id=user.id, role='member'))
        db.session.commit()
        return jsonify(ok=True, joined=True)
    return jsonify(ok=True, joined=False)


@app.route('/api/conversations')
@require_auth
def api_conversations():
    user = current_user()
    return jsonify(conversations=unread_counts(user))


@app.route('/profile/<username>')
@require_auth
def profile(username):
    user = current_user()
    target = User.query.filter_by(username=username).first()
    if not target or target.id == user.id:
        abort(404)
    blocked = is_blocked(user.id, target.id)
    my_blocks = [str(b.blocked_user_id) for b in Block.query.filter_by(user_id=user.id).all()]
    return render_template('profile.html', target=target.to_public(), me=user,
                           blocked=blocked, my_blocks=my_blocks)


@app.route('/api/messages/<int:chat_id>')
@require_auth
def api_messages(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or not can_view_chat(user, chat):
        abort(404)
    before = request.args.get('before', type=int)
    q = Message.query.filter_by(chat_id=chat.id, deleted=False)
    if before:
        q = q.filter(Message.id < before)
    msgs = q.order_by(Message.id.desc()).limit(50).all()[::-1]
    members = [{**m.user.to_public(), 'role': m.role, 'title': m.title or ''} for m in chat.members if m.user]
    joined = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first() is not None or user.is_admin
    return jsonify(
        messages=[m.to_dict(user.id) for m in msgs],
        chat=chat.to_public(user),
        role=my_role_in(user, chat),
        members=members,
        joined=joined,
    )


@app.route('/admin')
@require_admin
def admin_panel():
    stats = admin_stats()
    users = User.query.order_by(User.id.desc()).all()
    reports = Report.query.order_by(Report.id.desc()).all()
    return render_template('admin.html', stats=stats, users=users,
                           reports=reports, me=current_user())


@app.route('/admin/user/<int:uid>/<action>')
@require_admin
def admin_action(uid, action):
    me = current_user()
    target = User.query.get(uid)
    if not target:
        abort(404)
    if uid == me.id:
        return jsonify(ok=False, error='روی خودت اقدام نمی‌تونی')
    if action == 'ban':
        target.is_banned = not target.is_banned
        if target.is_banned:
            target.status = 'offline'
    elif action == 'admin':
        target.is_admin = not target.is_admin
    elif action == 'verify':
        target.is_verified = not target.is_verified
    else:
        return jsonify(ok=False, error='غیرمجاز')
    db.session.commit()
    socketio.emit('profile_updated', target.to_public(), room=f'user:{uid}')
    return jsonify(ok=True, user=target.to_public(),
                   state={'is_admin': bool(target.is_admin), 'is_verified': bool(target.is_verified),
                          'is_banned': bool(target.is_banned)})


@app.route('/admin/report/<int:rid>/<action>')
@require_admin
def admin_report(rid, action):
    r = Report.query.get(rid)
    if not r:
        abort(404)
    if action == 'dismiss':
        r.status = 'dismissed'
        db.session.commit()
        return jsonify(ok=True)
    if action == 'resolve':
        r.status = 'resolved'
        target = User.query.get(r.reported_id)
        target.is_banned = True
        target.status = 'offline'
        db.session.commit()
        return jsonify(ok=True)
    abort(404)


@socketio.on('connect')
def on_connect():
    user = current_user()
    if not user:
        emit('auth_required')
        return
    bump_online(user)
    join_room(f'user:{user.id}')
    for c in user_chats(user.id):
        join_room(f'chat:{c.id}')


@socketio.on('disconnect')
def on_disconnect():
    user = current_user()
    if user:
        user.status = 'offline'
        user.last_seen = datetime.utcnow()
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
        seen = set()
        for c in user_chats(user.id):
            for mid in chat_member_ids(c.id):
                if mid != user.id and mid not in seen:
                    seen.add(mid)
                    emit('presence_update', {'user_id': user.id, 'status': 'offline',
                                              'last_seen': user.last_seen.isoformat()},
                         room=f'user:{mid}')


@socketio.on('typing')
def on_typing(data):
    user = current_user()
    chat_id = data.get('chat_id')
    if not user or not chat_id:
        return
    for mid in chat_member_ids(chat_id):
        if mid != user.id:
            emit('typing', {'chat_id': chat_id, 'user_id': user.id,
                            'name': user.display_name}, room=f'user:{mid}')


@socketio.on('stop_typing')
def on_stop_typing(data):
    user = current_user()
    chat_id = data.get('chat_id')
    if not user or not chat_id:
        return
    for mid in chat_member_ids(chat_id):
        if mid != user.id:
            emit('stop_typing', {'chat_id': chat_id, 'user_id': user.id}, room=f'user:{mid}')


@app.context_processor
def inject_globals():
    user = current_user()
    return {'me': user, 'is_admin': bool(user and user.is_admin), 'avatar_html': avatar_html}


def _to_fa_time(dt):
    if not dt:
        return ''
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    if dt.tzinfo is None:
        dt = dt.timestamp()
        return datetime.fromtimestamp(dt).astimezone().strftime('%H:%M')
    return dt.astimezone().strftime('%H:%M')


def _to_fa_day(dt):
    if not dt:
        return ''
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    if dt.tzinfo is None:
        dt = datetime.fromtimestamp(dt.timestamp()).astimezone()
    now = datetime.now()
    if dt.date() == now.date():
        return 'امروز'
    if dt.date() == (now - __import__('datetime').timedelta(days=1)).date():
        return 'دیروز'
    return dt.strftime('%d/%m')


app.jinja_env.filters['fmt_time'] = _to_fa_time
app.jinja_env.filters['fmt_day'] = _to_fa_day


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False,
                 allow_unsafe_werkzeug=True)
