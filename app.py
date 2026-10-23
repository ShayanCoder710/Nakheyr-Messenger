import os
import re
import hmac
import secrets
from datetime import datetime

from flask import (
    Flask, render_template, request, redirect, url_for, session,
    flash, abort, jsonify, send_from_directory
)
from flask_socketio import SocketIO, emit, join_room
from sqlalchemy.orm import joinedload

from config import MYSQL_CONFIG, SECRET_KEY, ADMIN_USERNAME, ADMIN_DISPLAY_NAME
from models.models import (
    db, User, Chat, ChatMember, Message, Report, Block, HiddenMessage, Poll, PollVote, Avatar
)
from func import (
    init_db, current_user, require_auth, require_admin, save_avatar, save_upload_file,
    kind_for, INLINE_UNSAFE_EXT,
    is_blocked, get_or_create_dm, create_group, create_channel, chat_display_name,
    user_chats, unread_counts, admin_stats, bump_online, avatar_html, save_chat_avatar,
    username_taken, RESERVED_USERNAMES,
    get_or_create_notes, delete_user_account, chat_label,
    member_perms, default_perms, PERMISSION_KEYS, PERMISSION_LABELS,
    add_owner_avatar, set_owner_avatar_primary, delete_owner_avatar, owner_avatar_gallery,
)

BASE = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE, 'uploads')
AVATAR_DIR = os.path.join(UPLOAD_DIR, 'avatar')

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = SECRET_KEY
app.config['SQLALCHEMY_DATABASE_URI'] = MYSQL_CONFIG
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 60 * 1024 * 1024
app.config['UPLOAD_DIR'] = UPLOAD_DIR
app.config['AVATAR_DIR'] = AVATAR_DIR
app.config['TEMPLATES_AUTO_RELOAD'] = True

db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins='*')

with app.app_context():
    init_db()


# ── CSRF protection ─────────────────────────────────────────────
def ensure_csrf_token():
    """Generate the per-session CSRF token and expose it to templates."""
    if '_csrf' not in session:
        session['_csrf'] = secrets.token_urlsafe(32)
    return session['_csrf']


@app.before_request
def csrf_guard():
    ensure_csrf_token()  # make sure a token exists for this session
    if request.method != 'POST':
        return
    ep = request.endpoint or ''
    if ep.startswith('socketio') or request.path.startswith('/socket.io'):
        return  # socket.io polling uses its own session handshake
    token = request.headers.get('X-CSRF-Token')
    if token is None:
        token = request.form.get('csrf_token')
    if token is None:
        try:
            token = (request.get_json(silent=True) or {}).get('csrf_token')
        except Exception:
            token = None
    if not hmac.compare_digest(token or '', session.get('_csrf') or ''):
        if (ep or '').startswith('api_') or (ep or '').startswith('admin_'):
            return jsonify(ok=False, error='توکن CSRF نامعتبره. صفحه رو رفرش کن'), 403
        abort(403)


@app.context_processor
def inject_csrf():
    return {'csrf_token': ensure_csrf_token()}


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
            flash('اکانت شما توسط ادمین مسدود شده است.', 'error')
            return render_template('login.html', next=safe_next(request.form.get('next')) or '')
        session['user_id'] = user.id
        bump_online(user)
        flash(f'خوش برگشتی {user.public_name}!', 'success')
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
    _attach_polls_to_messages(msgs, user)
    members = [{**m.user.to_public(), 'role': m.role, 'title': m.title or ''} for m in chat.members if m.user]
    membership = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
    return render_template('chat.html', chat=chat, user=user, messages=msgs,
                           members=members, role=my_role_in(user, chat),
                           draft=(membership.draft if membership else '') or '')


@app.route('/chat/<username>')
@require_auth
def chat_page_by_username(username):
    user = current_user()
    if username.isdigit():
        chat = Chat.query.get(int(username))
    else:
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
        if q in ADMIN_DISPLAY_NAME.lower() or q in ADMIN_USERNAME:
            admin = User.query.filter_by(username=ADMIN_USERNAME).first()
            if admin and admin not in users:
                users.insert(0, admin)
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


@app.route('/api/draft', methods=['POST'])
@require_auth
def api_draft():
    user = current_user()
    data = request.get_json(silent=True) or {}
    try:
        chat_id = int(data.get('chat_id') or 0)
    except (TypeError, ValueError):
        return jsonify(ok=False, error='گپ معتبر نیست')
    text = str(data.get('text') or '')[:2000]
    m = ChatMember.query.filter_by(chat_id=chat_id, user_id=user.id).first()
    if not m:
        return jsonify(ok=False, error='عضو این گپ نیستی')
    m.draft = text
    db.session.commit()
    return jsonify(ok=True, draft=text)


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
    wants_edit = any(k in data for k in ('name', 'description'))
    wants_slow = 'slow_mode' in data
    if wants_visibility and role not in ('owner', 'admin') and not user.is_admin:
        return jsonify(ok=False, error='تغییر نوع گپ فقط برای صاحب و ادمین گپ')
    if wants_edit and role not in ('owner', 'admin') and not user.is_admin:
        return jsonify(ok=False, error='تغییر نام و توضیح فقط برای صاحب و ادمین گپ')
    if wants_slow and role not in ('owner', 'admin') and not user.is_admin:
        return jsonify(ok=False, error='تغییر حالت آهسته فقط برای صاحب و ادمین گپ')
    noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
    old_name = chat.name
    old_desc = chat.description or ''
    old_public = bool(chat.is_public)
    changed = False
    if 'name' in data:
        new_name = (data.get('name') or '').strip()
        if len(new_name) < 2:
            return jsonify(ok=False, error='نام حداقل ۲ حرف')
        chat.name = new_name[:60]
        changed = True
    if 'description' in data:
        chat.description = (data.get('description') or '').strip()[:200]
        changed = True
    if wants_visibility:
        chat.is_public = bool(data.get('is_public'))
        changed = True
    if 'slow_mode' in data:
        try:
            chat.slow_mode = max(0, min(3600, int(data.get('slow_mode') or 0)))
        except (TypeError, ValueError):
            return jsonify(ok=False, error='مقدار حالت آهسته معتبر نیست')
        changed = True
        if not chat.slow_mode:
            # Re-enabling later should not inherit an old cooldown.
            ChatMember.query.filter_by(chat_id=chat.id).update({'slow_mode_last': None})
    if changed:
        db.session.commit()
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
        if chat.name != old_name:
            post_system_message(chat, user, f'نام {noun} از «{old_name}» به «{chat.name}» تغییر کرد')
        if (chat.description or '') != old_desc:
            post_system_message(chat, user, f'توضیحات {noun} تغییر کرد')
        if bool(chat.is_public) != old_public:
            state = 'عمومی' if chat.is_public else 'خصوصی'
            post_system_message(chat, user, f'{noun} {state} شد')
    return jsonify(ok=True, chat=chat.to_public(user), role=role)


def post_system_message(chat, actor, text):
    m = Message(chat_id=chat.id, sender_id=actor.id, msg_type='system', content=text)
    db.session.add(m)
    db.session.commit()
    payload = m.to_dict(actor.id)
    socketio.emit('new_message', payload, room=f'user:{actor.id}')
    for mid in chat_member_ids(chat.id):
        if mid != actor.id:
            socketio.emit('new_message', payload, room=f'user:{mid}')
    return payload


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
            tuser = User.query.get(target)
            tname = tuser.public_name if tuser else 'کاربر'
            ChatMember.query.filter_by(chat_id=chat.id, user_id=target).delete()
            db.session.commit()
            noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
            post_system_message(chat, user, f'«{tname}» توسط «{user.public_name}» از {noun} حذف شد')
            return jsonify(ok=True)
        if action == 'leave':
            if chat.owner_id == user.id:
                return jsonify(ok=False, error='صاحب نمی‌تونه گروه رو ترک کنه. اول مالکیت رو منتقل کن.')
            ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).delete()
            db.session.commit()
            noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
            post_system_message(chat, user, f'«{user.public_name}» از {noun} خارج شد')
            return jsonify(ok=True)
        if action == 'promote':
            if role != 'owner':
                return jsonify(ok=False, error='فقط صاحب گروه')
            if target == chat.owner_id:
                return jsonify(ok=False, error='صاحب گروه قابل تغییر نقش نیست. اول مالکیت رو منتقل کن')
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not m:
                return jsonify(ok=False, error='عضو نیست')
            m.role = 'admin'
            m.set_permissions({})
            db.session.commit()
            return jsonify(ok=True, role=m.role)
        if action == 'demote':
            if role != 'owner':
                return jsonify(ok=False, error='فقط صاحب گروه')
            if target == chat.owner_id:
                return jsonify(ok=False, error='این عضو مالک گروهه')
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not m or m.role != 'admin':
                return jsonify(ok=False, error='این عضو مدیر نیست')
            m.role = 'member'
            m.set_permissions({})
            db.session.commit()
            return jsonify(ok=True, role=m.role)
        if action == 'title':
            if role not in ('owner', 'admin'):
                return jsonify(ok=False, error='فقط صاحب و ادمین می‌تونن لقب بذارن')
            new_title = (data.get('title') or '').strip()[:30]
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not m:
                return jsonify(ok=False, error='عضو نیست')
            m.title = new_title
            db.session.commit()
            return jsonify(ok=True, title=m.title)
        if action == 'permissions':
            if target == user.id:
                return jsonify(ok=False, error='مجوزهای خودت رو نمی‌تونی تغییر بدی')
            if role not in ('owner', 'admin'):
                return jsonify(ok=False, error='دسترسی نداری')
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not m:
                return jsonify(ok=False, error='عضو نیست')
            if m.role == 'owner':
                return jsonify(ok=False, error='مجوزهای مالک قابل تغییر نیست')
            if role == 'admin' and m.role != 'member':
                return jsonify(ok=False, error='فقط می‌تونی اعضای عادی رو مدیریت کنی')
            if 'title' in data:
                m.title = (data.get('title') or '').strip()[:30]
            perms = data.get('permissions')
            if isinstance(perms, dict):
                if role == 'owner':
                    allowed_keys = set(PERMISSION_KEYS)
                else:
                    me_member = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
                    myp = member_perms(me_member)
                    allowed_keys = {k for k in PERMISSION_KEYS if myp.get(k)}
                cur = m.perm_dict()
                for k, v in perms.items():
                    if k not in PERMISSION_KEYS:
                        continue
                    if k not in allowed_keys:
                        return jsonify(ok=False, error='این مجوز رو خودت نداری که بدی')
                    cur[k] = bool(v)
                m.set_permissions(cur)
            db.session.commit()
            return jsonify(ok=True, title=m.title, permissions=member_perms(m))
        if action == 'add':
            if role not in ('owner', 'admin'):
                return jsonify(ok=False, error='دسترسی نداری')
            if not ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first():
                tuser = User.query.get(target)
                tname = tuser.public_name if tuser else 'کاربر'
                db.session.add(ChatMember(chat_id=chat.id, user_id=target, role='member'))
                db.session.commit()
                noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
                post_system_message(chat, user, f'«{tname}» توسط «{user.public_name}» به {noun} اضافه شد')
            return jsonify(ok=True)
        if action == 'transfer':
            if role != 'owner':
                return jsonify(ok=False, error='فقط صاحب گروه')
            tuser = User.query.get(target)
            tname = tuser.public_name if tuser else 'کاربر'
            m = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
            m.role = 'admin'
            t = ChatMember.query.filter_by(chat_id=chat.id, user_id=target).first()
            if not t:
                return jsonify(ok=False, error='هدف عضو نیست')
            t.role = 'owner'
            chat.owner_id = target
            db.session.commit()
            noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
            post_system_message(chat, user, f'مالکیت {noun} به «{tname}» منتقل شد')
            return jsonify(ok=True)
        return jsonify(ok=False, error='عملیات نامعتبر')
    return jsonify(members=[
        {**m.user.to_public(), 'role': m.role, 'title': m.title or '',
         'permissions': member_perms(m)}
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
    noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
    remove_id = request.form.get('remove')
    primary_id = request.form.get('primary')
    if remove_id:
        ok = delete_owner_avatar('chat', chat.id, int(remove_id))
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
        return jsonify(ok=ok, avatar=chat.avatar_url)
    if primary_id:
        ok = set_owner_avatar_primary('chat', chat.id, int(primary_id)) is not None
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
        return jsonify(ok=ok, avatar=chat.avatar_url)
    if request.form.get('delete') == '1':
        prim = Avatar.query.filter_by(owner_type='chat', owner_id=chat.id, is_primary=True).first()
        if prim:
            delete_owner_avatar('chat', chat.id, prim.id)
        else:
            chat.avatar = ''
            db.session.commit()
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
        post_system_message(chat, user, f'عکس {noun} حذف شد')
        return jsonify(ok=True, avatar=chat.avatar_url)
    f = request.files.get('avatar')
    if not f or not f.filename:
        return jsonify(ok=False, error='فایلی دریافت نشد')
    fname = save_chat_avatar(user, f.filename)
    if not fname:
        return jsonify(ok=False, error='فرمت عکس مجاز نیست')
    add_owner_avatar('chat', chat.id, fname)   # becomes primary; gallery is kept
    for mid in chat_member_ids(chat.id):
        socketio.emit('chat_meta', chat.to_public(user), room=f'user:{mid}')
    post_system_message(chat, user, f'عکس {noun} تغییر کرد')
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
    HiddenMessage.query.filter_by(chat_id=chat.id).delete()
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
    member = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
    role = member.role if member else None
    if chat.chat_type == 'dm':
        peer = next((m.user for m in chat.members if m.user_id != user.id), None)
        if peer and is_blocked(user.id, peer.id):
            return jsonify(ok=False, error='کاربر رو بلاک کردی — تا وقتی باز نکنی نمی‌تونی پیام بدی')
    if chat.chat_type == 'channel':
        if chat.owner_id != user.id and role != 'admin':
            return jsonify(ok=False, error='در کانال فقط ادمین‌ها پیام می‌فرستن')
    # Slow mode: per-member cooldown (owners/admins/site admins exempt)
    if chat.slow_mode and not user.is_admin and chat.owner_id != user.id and role != 'admin':
        if member and member.slow_mode_last:
            wait = (datetime.utcnow() - member.slow_mode_last).total_seconds()
            remain = chat.slow_mode - wait
            if remain > 0:
                secs = int(remain)
                if secs >= 60:
                    mins, sec = secs // 60, secs % 60
                    wait_txt = (f'{mins} دقیقه و {sec} ثانیه' if sec else f'{mins} دقیقه')
                else:
                    wait_txt = f'{secs} ثانیه'
                return jsonify(ok=False, error=f'حالت آهسته فعاله — {wait_txt} صبر کن')
    msg_type = data.get('msg_type', 'text')
    if msg_type not in ('text', 'image', 'video', 'audio', 'file'):
        msg_type = 'file'
    if chat.chat_type == 'group' and not user.is_admin:
        if member and role not in ('owner', 'admin'):
            p = member_perms(member)
            need = 'send_media' if msg_type != 'text' else 'send_messages'
            if not p.get(need, False):
                return jsonify(ok=False, error='اجازهٔ ارسال پیام در این گروه رو نداری')
    content = (data.get('content') or '').strip()
    file_path = data.get('file_path') or ''
    file_name = (data.get('file_name') or '')[:160]
    if msg_type == 'text' and not content:
        return jsonify(ok=False, error='پیام خالی')
    if msg_type != 'text':
        if not file_path:
            return jsonify(ok=False, error='فایلی آتچ نشده')
        if not re.match(r'^\d+/[A-Za-z0-9._\-]+$', file_path):
            return jsonify(ok=False, error='مسیر فایل نامعتبره')
        if not os.path.isfile(os.path.join(app.config['UPLOAD_DIR'], file_path)):
            return jsonify(ok=False, error='فایل پیدا نشد')
    m = Message(chat_id=chat.id, sender_id=user.id, msg_type=msg_type,
                content=content, file_name=file_name, file_path=file_path,
                reply_to=data.get('reply_to') or None)
    db.session.add(m)
    # Start this member's slow-mode cooldown
    if chat.slow_mode and member and not user.is_admin and role not in ('owner', 'admin'):
        member.slow_mode_last = datetime.utcnow()
    db.session.commit()
    payload = m.to_dict(user.id)
    _attach_polls_to_messages([payload], user)
    socketio.emit('new_message', payload, room=f'user:{user.id}')
    for mid in chat_member_ids(chat.id):
        if mid != user.id:
            socketio.emit('new_message', payload, room=f'user:{mid}')
    return jsonify(ok=True, message=payload)


def _clean_reaction(value):
    """Reactions are rendered inside HTML on the client; only allow short
    plain emoji strings so they can never smuggle markup."""
    if not isinstance(value, str):
        return ''
    value = value.strip()
    if not value or len(value) > 24:
        return ''
    if any(ch in value for ch in '<>&"\'`'):
        return ''
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        return ''
    return value


@app.route('/api/message/react', methods=['POST'])
@require_auth
def api_react():
    user = current_user()
    data = request.get_json(silent=True) or {}
    m = Message.query.get(int(data.get('message_id') or 0))
    if not m:
        abort(404)
    chat = Chat.query.get(m.chat_id)
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری'), 403
    if chat.chat_type != 'dm' and not user.is_admin:
        if not ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first():
            return jsonify(ok=False, error='عضو این گپ نیستی'), 403
    emoji = _clean_reaction(data.get('emoji'))
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
    allowed = m.sender_id == user.id or user.is_admin
    if not allowed and m.msg_type == 'system':
        schat = Chat.query.get(m.chat_id)
        allowed = bool(schat) and (schat.owner_id == user.id or my_role_in(user, schat) == 'admin')
    if not allowed:
        return jsonify(ok=False, error='دسترسی نداری')
    m.deleted = True
    m.content = ''
    db.session.commit()
    for mid in chat_member_ids(m.chat_id):
        socketio.emit('message_deleted', {'message_id': m.id}, room=f'user:{mid}')
    return jsonify(ok=True)


def _emit_new_message(m):
    # m.sender_id is an int; to_dict handles an int viewer fine, and
    # _attach_polls_to_messages also accepts a bare user id.
    payload = m.to_dict(m.sender_id)
    _attach_polls_to_messages([payload], m.sender_id)
    socketio.emit('new_message', payload, room=f'user:{m.sender_id}')
    for mid in chat_member_ids(m.chat_id):
        if mid != m.sender_id:
            socketio.emit('new_message', payload, room=f'user:{mid}')
    return payload


def _can_write_chat(user, chat):
    if user.is_admin:
        return True
    if chat.chat_type == 'dm':
        return True
    if not ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first() and not chat.is_public:
        return False
    if chat.chat_type == 'channel':
        role = my_role_in(user, chat)
        return chat.owner_id == user.id or role == 'admin'
    return True


@app.route('/api/message/forward', methods=['POST'])
@require_auth
def api_forward_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    src = Message.query.get(int(data.get('message_id') or 0))
    if not src or src.deleted:
        return jsonify(ok=False, error='پیام پیدا نشد')
    src_chat = Chat.query.get(src.chat_id)
    if not src_chat or not can_view_chat(user, src_chat):
        return jsonify(ok=False, error='دسترسی نداری')
    target = Chat.query.get(int(data.get('chat_id') or 0))
    if not target or not can_view_chat(user, target):
        return jsonify(ok=False, error='گپ مقصد پیدا نشد')
    if not _can_write_chat(user, target):
        return jsonify(ok=False, error='دسترسی برای ارسال در مقصد نداری')
    if target.chat_type == 'dm':
        peer = next((m.user for m in target.members if m.user_id != user.id), None)
        if peer and is_blocked(user.id, peer.id):
            return jsonify(ok=False, error='کاربر رو بلاک کردی — اول بازش کن')
    if target.chat_type != 'dm' and not ChatMember.query.filter_by(chat_id=target.id, user_id=user.id).first():
        db.session.add(ChatMember(chat_id=target.id, user_id=user.id, role='member'))
        db.session.flush()
    sender = User.query.get(src.sender_id) if src.sender_id else None
    m = Message(chat_id=target.id, sender_id=user.id, msg_type=src.msg_type,
                content=src.content, file_name=src.file_name, file_path=src.file_path,
                fwd_from_id=src.sender_id, fwd_from_name=(sender.public_name if sender else ''))
    db.session.add(m)
    db.session.flush()
    # If the source message carries a poll, duplicate it onto the new message
    # so the forwarded copy is votable in the target chat.
    src_poll = _find_poll_for_message(src.chat_id, src.id)
    if src_poll:
        new_poll = Poll(chat_id=target.id, message_id=m.id, question=src_poll.question,
                        options=src_poll.options_list(), multi=bool(src_poll.multi),
                        closed=bool(src_poll.closed), created_by=user.id,
                        expires_at=src_poll.expires_at)
        new_poll.set_options(src_poll.options_list())
        db.session.add(new_poll)
    db.session.commit()
    payload = _emit_new_message(m)
    return jsonify(ok=True, message=payload, chat_id=target.id)


@app.route('/api/message/save', methods=['POST'])
@require_auth
def api_save_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    src = Message.query.get(int(data.get('message_id') or 0))
    if not src or src.deleted:
        return jsonify(ok=False, error='پیام پیدا نشد')
    src_chat = Chat.query.get(src.chat_id)
    if not src_chat or not can_view_chat(user, src_chat):
        return jsonify(ok=False, error='دسترسی نداری')
    chat, _ = get_or_create_notes(user)
    sender = User.query.get(src.sender_id) if src.sender_id else None
    m = Message(chat_id=chat.id, sender_id=user.id, msg_type=src.msg_type,
                content=src.content, file_name=src.file_name, file_path=src.file_path,
                fwd_from_id=src.sender_id, fwd_from_name=(sender.public_name if sender else ''))
    db.session.add(m)
    db.session.commit()
    return jsonify(ok=True, chat_id=chat.id, message=m.to_dict(user.id))


@app.route('/api/message/hide', methods=['POST'])
@require_auth
def api_hide_message():
    user = current_user()
    data = request.get_json(silent=True) or {}
    m = Message.query.get(int(data.get('message_id') or 0))
    if not m:
        abort(404)
    if not HiddenMessage.query.filter_by(user_id=user.id, message_id=m.id).first():
        db.session.add(HiddenMessage(user_id=user.id, chat_id=m.chat_id, message_id=m.id))
        db.session.commit()
    return jsonify(ok=True)


@app.route('/api/chat/<int:chat_id>/clear', methods=['POST'])
@require_auth
def api_clear_history(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or not can_view_chat(user, chat):
        abort(404)
    data = request.get_json(silent=True) or {}
    everyone = bool(data.get('for_everyone'))
    role = my_role_in(user, chat)
    if everyone:
        allowed = user.is_admin or role in ('owner', 'admin') or chat.chat_type == 'dm'
        if not allowed:
            return jsonify(ok=False, error='فقط مدیر گپ می‌تونه برای همه پاک کنه')
        msgs = Message.query.filter_by(chat_id=chat.id, deleted=False).all()
        for m in msgs:
            m.deleted = True
            m.content = ''
        db.session.commit()
        for mid in chat_member_ids(chat.id):
            socketio.emit('chat_cleared', {'chat_id': chat.id}, room=f'user:{mid}')
        return jsonify(ok=True, for_everyone=True, count=len(msgs))
    existing = {row[0] for row in db.session.execute(
        db.select(HiddenMessage.message_id).filter_by(user_id=user.id)
    ).all()}
    added = 0
    for m in Message.query.filter_by(chat_id=chat.id, deleted=False).all():
        if m.id not in existing:
            db.session.add(HiddenMessage(user_id=user.id, chat_id=chat.id, message_id=m.id))
            added += 1
    db.session.commit()
    return jsonify(ok=True, for_everyone=False, count=added)


@app.route('/api/chat/<int:chat_id>/prefs', methods=['POST'])
@require_auth
def api_chat_prefs(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or not can_view_chat(user, chat):
        abort(404)
    m = ChatMember.query.filter_by(chat_id=chat_id, user_id=user.id).first()
    if not m:
        return jsonify(ok=False, error='عضو این گپ نیستی')
    data = request.get_json(silent=True) or {}
    if 'muted' in data:
        m.muted = bool(data['muted'])
    if 'archived' in data:
        m.archived = bool(data['archived'])
    db.session.commit()
    return jsonify(ok=True, muted=bool(m.muted), archived=bool(m.archived))


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
    last_read_id = max((m.id for m in msgs), default=0)
    if changed and user.read_receipts:
        db.session.commit()
        for mid in chat_member_ids(chat.id):
            if mid != user.id:
                socketio.emit('read_recept', {'chat_id': chat.id, 'user_id': user.id,
                                              'last_id': last_read_id},
                              room=f'user:{mid}')
    elif changed:
        db.session.commit()
    return jsonify(ok=True)


@app.route('/api/upload', methods=['POST'])
@require_auth
def api_upload():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify(ok=False, error='فایلی آپلود نشد')
    path = save_upload_file(f)
    if not path:
        return jsonify(ok=False, error='فرمت یا حجم فایل مجاز نیست (حداکثر ۵۰ مگ).')
    kind = kind_for(f.filename, f.mimetype)
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


@app.route('/api/blocks', methods=['GET'])
@require_auth
def api_blocks():
    user = current_user()
    ids = [b.blocked_user_id for b in Block.query.filter_by(user_id=user.id).all()]
    users = User.query.filter(User.id.in_(ids)).all() if ids else []
    return jsonify(ok=True, users=[u.to_public() for u in users])


@app.route('/api/report', methods=['POST'])
@require_auth
def api_report():
    user = current_user()
    data = request.get_json(silent=True) or {}
    try:
        target = int(data.get('user_id') or 0)
    except (TypeError, ValueError):
        target = 0
    reason = (data.get('reason') or '').strip()[:300]
    reported = User.query.get(target)
    if not target or not reported or reported.id == user.id:
        return jsonify(ok=False, error='کاربر معتبر نیست')
    if not reason:
        return jsonify(ok=False, error='دلیل رو بنویس')
    message_id = data.get('message_id') or None
    if message_id:
        try:
            msg = Message.query.get(int(message_id))
        except (TypeError, ValueError):
            msg = None
        msg_chat = Chat.query.get(msg.chat_id) if msg else None
        if not msg or msg.sender_id != reported.id or not msg_chat or not can_view_chat(user, msg_chat):
            return jsonify(ok=False, error='پیام گزارش معتبر نیست')
        message_id = msg.id
    db.session.add(Report(reporter_id=user.id, reported_id=target,
                          message_id=message_id, reason=reason))
    db.session.commit()
    flash('گزارشتت ثبت شد. ادمین‌ها بررسی می‌کنن.', 'success')
    return jsonify(ok=True)


@app.route('/api/profile', methods=['POST'])
@require_auth
def api_profile():
    user = current_user()
    data = request.get_json(silent=True) or {}
    if data.get('display_name') and not user.is_config_admin:
        user.display_name = data['display_name'].strip()[:60]
    if 'bio' in data and not user.is_config_admin:
        user.bio = (data['bio'] or '').strip()[:200]
    if 'read_receipts' in data:
        user.read_receipts = bool(data['read_receipts'])
    if 'show_online' in data:
        user.show_online = bool(data['show_online'])
    if 'theme' in data:
        t = str(data.get('theme') or 'dark')
        user.theme = t if t in ('dark', 'light', 'auto') else 'dark'
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
    if 'show_online' in data and not user.show_online:
        seen = set()
        for c in user_chats(user.id):
            for mid in chat_member_ids(c.id):
                if mid != user.id and mid not in seen:
                    seen.add(mid)
                    socketio.emit('presence_update', {'user_id': user.id, 'status': 'offline'},
                                  room=f'user:{mid}')
    socketio.emit('profile_updated', user.to_self(), room=f'user:{user.id}')
    return jsonify(ok=True, profile=user.to_self())


@app.route('/api/password', methods=['POST'])
@require_auth
def api_password():
    user = current_user()
    data = request.get_json(silent=True) or {}
    current = data.get('current') or ''
    new = data.get('new') or ''
    if user.is_config_admin:
        return jsonify(ok=False, error='رمز ادمین از config.py خونده می‌شه و از اینجا قابل تغییر نیست')
    if not user.check_password(current):
        return jsonify(ok=False, error='رمز فعلی اشتباهه')
    if len(new) < 6:
        return jsonify(ok=False, error='رمز جدید باید حداقل ۶ کاراکتر باشه')
    if new == current:
        return jsonify(ok=False, error='رمز جدید باید با رمز فعلی فرق کنه')
    user.set_password(new)
    db.session.commit()
    return jsonify(ok=True)


@app.route('/api/account/delete', methods=['POST'])
@require_auth
def api_account_delete():
    user = current_user()
    data = request.get_json(silent=True) or {}
    if user.is_config_admin:
        return jsonify(ok=False, error='اکانت ادمین اصلی قابل حذف نیست')
    if not user.check_password(data.get('password') or ''):
        return jsonify(ok=False, error='رمز اشتباهه')
    uid = user.id
    session.pop('user_id', None)
    delete_user_account(uid)
    return jsonify(ok=True)


@app.route('/api/avatar', methods=['POST'])
@require_auth
def api_avatar():
    user = current_user()
    remove_id = request.form.get('remove')
    primary_id = request.form.get('primary')
    if remove_id:
        ok = delete_owner_avatar('user', user.id, int(remove_id))
        socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
        return jsonify(ok=ok, avatar=user.avatar_url)
    if primary_id:
        ok = set_owner_avatar_primary('user', user.id, int(primary_id)) is not None
        socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
        return jsonify(ok=ok, avatar=user.avatar_url)
    if request.form.get('delete') == '1':
        # legacy "clear": remove the current primary, keep the rest of the gallery
        prim = Avatar.query.filter_by(owner_type='user', owner_id=user.id, is_primary=True).first()
        if prim:
            delete_owner_avatar('user', user.id, prim.id)
        else:
            user.avatar = ''
            db.session.commit()
        socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
        return jsonify(ok=True, avatar=user.avatar_url)
    f = request.files.get('avatar')
    if not f or not f.filename:
        return jsonify(ok=False, error='فایلی دریافت نشد')
    fname = save_avatar(f.filename)
    if not fname:
        return jsonify(ok=False, error='فرمت عکس مجاز نیست')
    add_owner_avatar('user', user.id, fname)   # becomes primary; gallery is kept
    socketio.emit('profile_updated', user.to_public(), room=f'user:{user.id}')
    return jsonify(ok=True, avatar=user.avatar_url)


@app.route('/api/avatar/all')
@require_auth
def api_avatar_all():
    user = current_user()
    return jsonify(ok=True, avatars=owner_avatar_gallery('user', user.id))


@app.route('/api/user/<int:uid>/avatars')
@require_auth
def api_user_avatars(uid):
    target = User.query.get(uid)
    if not target:
        return jsonify(ok=False, error='کاربر پیدا نشد')
    return jsonify(ok=True, avatars=owner_avatar_gallery('user', uid))


@app.route('/api/chat/<int:chat_id>/avatars')
@require_auth
def api_chat_avatars(chat_id):
    user = current_user()
    chat = Chat.query.get(chat_id)
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری')
    return jsonify(ok=True, avatars=owner_avatar_gallery('chat', chat.id))


@app.route('/files/avatar/<path:fname>')
def static_avatar(fname):
    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
    if ext in INLINE_UNSAFE_EXT:
        abort(404)
    resp = send_from_directory(app.config['AVATAR_DIR'], fname, max_age=0)
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp


@app.route('/files/<path:fname>')
def static_files(fname):
    user = current_user()
    if not user:
        abort(403)
    base = os.path.abspath(app.config['UPLOAD_DIR'])
    target = os.path.abspath(os.path.join(base, fname))
    if not target.startswith(base + os.sep) or not os.path.isfile(target):
        abort(404)
    uid_part = fname.split('/')[0]
    allowed = user.is_admin or (uid_part.isdigit() and int(uid_part) == user.id)
    if not allowed:
        msg = Message.query.filter_by(file_path=fname).first()
        allowed = bool(msg and can_view_chat(user, msg.chat))
    if not allowed:
        abort(403)
    resp = send_from_directory(app.config['UPLOAD_DIR'], fname, max_age=0)
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.cache_control.public = False
    resp.cache_control.private = True
    resp.cache_control.max_age = 0
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
    if ext in INLINE_UNSAFE_EXT:
        resp.headers['Content-Disposition'] = 'attachment'
    return resp


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
    chat = Chat.query.get(m.chat_id)
    role = my_role_in(user, chat)
    if chat.chat_type == 'dm':
        allowed = can_view_chat(user, chat)
    else:
        allowed = user.is_admin or role in ('owner', 'admin') or m.sender_id == user.id
    if not allowed:
        return jsonify(ok=False, error='دسترسی نداری')
    new_pin = not m.pinned
    if new_pin:
        # one active pin per chat: a new pin replaces the previous one
        Message.query.filter(Message.chat_id == m.chat_id,
                             Message.pinned.is_(True)).update(
            {'pinned': False}, synchronize_session=False)
    m.pinned = new_pin
    db.session.commit()
    for mid in chat_member_ids(m.chat_id):
        socketio.emit('message_pinned', {'message_id': m.id, 'pinned': m.pinned, 'chat_id': m.chat_id}, room=f'user:{mid}')
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
    q = Message.query.filter_by(chat_id=chat.id, pinned=True, deleted=False)
    hidden = [row[0] for row in db.session.execute(
        db.select(HiddenMessage.message_id).filter_by(user_id=user.id)
    ).all()]
    if hidden:
        q = q.filter(~Message.id.in_(hidden))
    m = q.order_by(Message.id.desc()).first()
    if not m:
        return jsonify(pinned=None)
    sender = next((x for x in chat_users(chat) if x.id == m.sender_id), None)
    return jsonify(pinned=m.to_dict(user.id), sender=(sender.to_public() if sender else None))


# ── Polls ────────────────────────────────────────────────────────
def _find_poll_for_message(chat_id, message_id):
    return Poll.query.filter_by(chat_id=chat_id, message_id=message_id).first()


def _attach_polls_to_messages(messages, user):
    """For each message in a chat, look up any attached poll and embed it
    as `poll` so the client can render it inline.
    `user` may be a User object or a bare user id int."""
    if not messages:
        return
    viewer_id = getattr(user, 'id', user)  # works for both User and int
    ids = [m['id'] for m in messages]
    polls = Poll.query.filter(
        Poll.chat_id.in_([messages[0]['chat_id']]),
        Poll.message_id.in_(ids),
    ).all()
    by_msg = {}
    for p in polls:
        by_msg[p.message_id] = p.to_dict(viewer_id)
    for m in messages:
        m['poll'] = by_msg.get(m['id'])


def _poll_vote_payload(poll, voter_id):
    d = poll.to_dict(voter_id)
    return {
        'poll_id': poll.id,
        'chat_id': poll.chat_id,
        'message_id': poll.message_id,
        'question': d['question'],
        'options': d['options'],
        'multi': d['multi'],
        'closed': d['closed'],
        'counts': d['counts'],
        'total': d['total'],
        'voters': d['voters'],
        'my_votes': d['my_votes'],
    }


@app.route('/api/poll/create', methods=['POST'])
@require_auth
def api_poll_create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    chat = Chat.query.get(int(data.get('chat_id') or 0))
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری')
    # Polls cannot be posted directly in a DM (only via forward). Channels and
    # groups are fine (channels admin-only, groups per send permission).
    if chat.chat_type == 'dm':
        return jsonify(ok=False, error='نظرسنجی در پیوی نمی‌شه بفرستی. اول بفرست یه گپ یا گروه، بعد فوروارد کن')
    # In a group, only members with send permission can post a poll
    if chat.chat_type == 'group' and not user.is_admin:
        member = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
        if member and member.role not in ('owner', 'admin'):
            p = member_perms(member)
            if not p.get('send_messages', False):
                return jsonify(ok=False, error='اجازهٔ ارسال پیام در این گروه رو نداری')
    if chat.chat_type == 'channel':
        role = my_role_in(user, chat)
        if chat.owner_id != user.id and role != 'admin':
            return jsonify(ok=False, error='در کانال فقط ادمین‌ها می‌تونن نظرسنجی بسازن')

    question = (data.get('question') or '').strip()
    if len(question) < 2:
        return jsonify(ok=False, error='سوال حداقل ۲ حرف')
    raw_opts = data.get('options') or []
    opts = []
    for o in raw_opts:
        o = str(o or '').strip()
        if o and o not in opts:
            opts.append(o[:80])
    if len(opts) < 2 or len(opts) > 6:
        return jsonify(ok=False, error='بین ۲ تا ۶ گزینه لازم داری')
    multi = bool(data.get('multi'))

    # Auto-close after a chosen period
    expires = data.get('expires')
    expires_at = None
    if expires in ('1d', '3d', '1w'):
        from datetime import timedelta
        days = {'1d': 1, '3d': 3, '1w': 7}[expires]
        expires_at = datetime.utcnow() + timedelta(days=days)

    # Create the poll message (text content carries the question)
    m = Message(chat_id=chat.id, sender_id=user.id, msg_type='text', content=question)
    db.session.add(m)
    db.session.commit()

    poll = Poll(chat_id=chat.id, message_id=m.id, question=question,
                options=opts, multi=multi, created_by=user.id, expires_at=expires_at)
    poll.set_options(opts)
    db.session.add(poll)
    db.session.commit()

    payload = m.to_dict(user.id)
    payload['poll'] = poll.to_dict(user.id)
    socketio.emit('new_message', payload, room=f'user:{user.id}')
    for mid in chat_member_ids(chat.id):
        if mid != user.id:
            socketio.emit('new_message', payload, room=f'user:{mid}')
    return jsonify(ok=True, message=payload, poll=poll.to_dict(user.id))


@app.route('/api/poll/<int:poll_id>/vote', methods=['POST'])
@require_auth
def api_poll_vote(poll_id):
    user = current_user()
    data = request.get_json(silent=True) or {}
    poll = Poll.query.get(poll_id)
    if not poll:
        return jsonify(ok=False, error='نظرسنجی پیدا نشد')
    if poll.closed or poll.is_expired():
        return jsonify(ok=False, error='این نظرسنجی بسته شده')
    # Must be a member of the chat (admins can vote in any chat they can view)
    chat = Chat.query.get(poll.chat_id)
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری')
    if not user.is_admin and not ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first():
        return jsonify(ok=False, error='عضو این گپ نیستی')

    opts = poll.options_list()
    incoming = data.get('options')
    # Accept both a list [0,1] and a bare int "0"
    if isinstance(incoming, (int, str)):
        incoming = [incoming]
    if not isinstance(incoming, list):
        return jsonify(ok=False, error='گزینهٔ معتبر نیست')
    try:
        picks = [int(x) for x in incoming]
    except (ValueError, TypeError):
        return jsonify(ok=False, error='گزینهٔ معتبر نیست')
    picks = sorted(set(p for p in picks if 0 <= p < len(opts)))
    if not picks:
        return jsonify(ok=False, error='گزینهٔ معتبر نیست')
    if not poll.multi:
        picks = picks[:1]

    existing = {v.option_index for v in PollVote.query.filter_by(poll_id=poll.id, user_id=user.id).all()}
    if poll.multi:
        for idx in picks:
            if idx not in existing:
                db.session.add(PollVote(poll_id=poll.id, user_id=user.id, option_index=idx))
        # Remove unselected picks
        for v in list(PollVote.query.filter_by(poll_id=poll.id, user_id=user.id).all()):
            if v.option_index not in picks:
                db.session.delete(v)
    else:
        pick = picks[0]
        PollVote.query.filter_by(poll_id=poll.id, user_id=user.id).delete()
        db.session.add(PollVote(poll_id=poll.id, user_id=user.id, option_index=pick))
    db.session.commit()

    payload = _poll_vote_payload(poll, user.id)
    payload['voter'] = user.to_public()
    for mid in chat_member_ids(poll.chat_id):
        socketio.emit('poll_vote', payload, room=f'user:{mid}')
    return jsonify(ok=True, **payload)


@app.route('/api/poll/<int:poll_id>/revoke', methods=['POST'])
@require_auth
def api_poll_revoke(poll_id):
    """Undo the current user's vote(s) on a poll. Idempotent: removes every
    PollVote row for (poll, user) and re-broadcasts the tallied state."""
    user = current_user()
    poll = Poll.query.get(poll_id)
    if not poll:
        return jsonify(ok=False, error='نظرسنجی پیدا نشد')
    if poll.closed or poll.is_expired():
        return jsonify(ok=False, error='این نظرسنجی بسته شده')
    chat = Chat.query.get(poll.chat_id)
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری')
    if not user.is_admin and not ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first():
        return jsonify(ok=False, error='عضو این گپ نیستی')
    PollVote.query.filter_by(poll_id=poll.id, user_id=user.id).delete(synchronize_session=False)
    db.session.commit()
    payload = _poll_vote_payload(poll, user.id)
    payload['voter'] = user.to_public()
    for mid in chat_member_ids(poll.chat_id):
        socketio.emit('poll_revoke', payload, room=f'user:{mid}')
    return jsonify(ok=True, **payload)


@app.route('/api/poll/<int:poll_id>/close', methods=['POST'])
@require_auth
def api_poll_close(poll_id):
    user = current_user()
    poll = Poll.query.get(poll_id)
    if not poll:
        return jsonify(ok=False, error='نظرسنجی پیدا نشد')
    chat = Chat.query.get(poll.chat_id)
    role = my_role_in(user, chat)
    allowed = user.is_admin or role in ('owner', 'admin') or poll.created_by == user.id
    if not allowed:
        return jsonify(ok=False, error='دسترسی نداری')
    poll.closed = not poll.closed
    db.session.commit()
    payload = _poll_vote_payload(poll, user.id)
    for mid in chat_member_ids(poll.chat_id):
        socketio.emit('poll_state', payload, room=f'user:{mid}')
    return jsonify(ok=True, **payload)


@app.route('/api/poll/<int:poll_id>/voters')
@require_auth
def api_poll_voters(poll_id):
    """List who voted on each option. Groups only (channels hide the voters
    feature; DMs can't host polls at all)."""
    user = current_user()
    poll = Poll.query.get(poll_id)
    if not poll:
        return jsonify(ok=False, error='نظرسنجی پیدا نشد')
    chat = Chat.query.get(poll.chat_id)
    if not chat or not can_view_chat(user, chat):
        return jsonify(ok=False, error='دسترسی نداری')
    # The "who voted" list is only exposed for groups
    if chat.chat_type != 'group':
        return jsonify(ok=False, error='نمایش رأی‌دهندگان فقط برای گروه‌هاست')
    voters = poll.voter_details()
    return jsonify(ok=True, poll_id=poll.id, voters=voters)


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
        noun = 'کانال' if chat.chat_type == 'channel' else 'گروه'
        post_system_message(chat, user, f'«{user.public_name}» به {noun} پیوست')
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
    hidden = [row[0] for row in db.session.execute(
        db.select(HiddenMessage.message_id).filter_by(user_id=user.id)
    ).all()]
    q = Message.query.filter_by(chat_id=chat.id, deleted=False)
    if hidden:
        q = q.filter(~Message.id.in_(hidden))
    if before:
        q = q.filter(Message.id < before)
    msgs = q.order_by(Message.id.desc()).limit(50).all()[::-1]
    members = [{**m.user.to_public(), 'role': m.role, 'title': m.title or ''} for m in chat.members if m.user]
    membership = ChatMember.query.filter_by(chat_id=chat.id, user_id=user.id).first()
    joined = membership is not None or user.is_admin
    out_msgs = [m.to_dict(user.id) for m in msgs]
    _attach_polls_to_messages(out_msgs, user)
    return jsonify(
        messages=out_msgs,
        chat=chat.to_public(user),
        role=my_role_in(user, chat),
        members=members,
        joined=joined,
        draft=(membership.draft if membership else '') or '',
    )


ADMIN_PAGE_SIZE = 25
ADMIN_USER_FILTERS = {'all', 'active', 'admin', 'banned'}


@app.route('/admin')
@require_admin
def admin_panel():
    stats = admin_stats()
    q = (request.args.get('q') or '').strip()
    ufilter = request.args.get('filter') or 'all'
    if ufilter not in ADMIN_USER_FILTERS:
        ufilter = 'all'
    try:
        page = max(1, int(request.args.get('page') or 1))
    except (TypeError, ValueError):
        page = 1
    rstatus = request.args.get('rstatus')
    if rstatus not in ('open', 'all'):
        rstatus = 'open'

    uq = User.query
    if q:
        like = f'%{q.lower()}%'
        uq = uq.filter(db.or_(
            db.func.lower(User.username).like(like),
            db.func.lower(User.display_name).like(like),
        ))
    if ufilter == 'active':
        uq = uq.filter(User.is_banned.is_(False), User.is_admin.is_(False))
    elif ufilter == 'admin':
        uq = uq.filter(User.is_admin.is_(True))
    elif ufilter == 'banned':
        uq = uq.filter(User.is_banned.is_(True))

    total_users = uq.count()
    pages = max(1, (total_users + ADMIN_PAGE_SIZE - 1) // ADMIN_PAGE_SIZE)
    page = min(page, pages)
    users = uq.order_by(User.id.desc()).offset((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).all()

    rqc = Report.query.options(joinedload(Report.reporter), joinedload(Report.reported)).order_by(Report.id.desc())
    if rstatus == 'open':
        rqc = rqc.filter_by(status='open')
    reports = rqc.limit(100).all()

    return render_template(
        'admin.html', stats=stats, users=users, reports=reports, me=current_user(),
        total_users=total_users, pages=pages, page=page, q=q,
        ufilter=ufilter, rstatus=rstatus,
    )


@app.route('/admin/user/<int:uid>/<action>', methods=['POST'])
@require_admin
def admin_action(uid, action):
    me = current_user()
    target = User.query.get(uid)
    if not target:
        abort(404)
    if uid == me.id:
        return jsonify(ok=False, error='روی خودت اقدام نمی‌تونی')
    if target.is_config_admin:
        return jsonify(ok=False, error='اکانت ادمین اصلی از config.py مدیریت می‌شه')
    if action == 'delete':
        delete_user_account(uid, reassign_to=me.id)
        socketio.emit('account_deleted', {'id': uid}, room=f'user:{uid}')
        return jsonify(ok=True, deleted=True)
    if action == 'ban':
        target.is_banned = not target.is_banned
        if target.is_banned:
            target.status = 'offline'
    elif action == 'admin':
        # Prevent removing the last non-config admin (lockout).
        if target.is_admin:
            # is_config_admin is a @property, not a column — filter on username.
            remaining = User.query.filter(
                User.is_admin.is_(True),
                User.username != ADMIN_USERNAME,
                User.id != target.id,
            ).count()
            if remaining == 0:
                return jsonify(ok=False, error='آخرین ادمین اصلی قابل حذف ادمینی نیست')
        target.is_admin = not target.is_admin
    else:
        return jsonify(ok=False, error='غیرمجاز')
    db.session.commit()
    if action == 'ban':
        socketio.emit('banned', {'reason': 'ادمین', 'banned': bool(target.is_banned)}, room=f'user:{uid}')
    socketio.emit('profile_updated', target.to_public(), room=f'user:{uid}')
    return jsonify(ok=True, user=target.to_public(),
                   state={'is_admin': bool(target.is_admin),
                          'is_banned': bool(target.is_banned)})


@app.route('/admin/user/<int:uid>/messages')
@require_admin
def admin_user_messages(uid):
    u = User.query.get(uid)
    if not u:
        abort(404)
    msgs = Message.query.options(
        joinedload(Message.chat).joinedload(Chat.members).joinedload(ChatMember.user)
    ).filter_by(sender_id=uid).order_by(Message.id.desc()).limit(150).all()
    out = []
    for m in msgs:
        out.append({
            'id': m.id,
            'content': m.content,
            'msg_type': m.msg_type,
            'file_name': m.file_name,
            'deleted': bool(m.deleted),
            'created_at': m.created_at.strftime('%Y-%m-%d %H:%M'),
            'chat': chat_label(m.chat, uid),
        })
    return jsonify(ok=True, user=u.to_public(), messages=out)


@app.route('/admin/report/<int:rid>/conversation')
@require_admin
def admin_report_conversation(rid):
    r = Report.query.get(rid)
    if not r:
        abort(404)
    chat = Chat.query.filter(
        Chat.chat_type == 'dm',
        Chat.members.any(ChatMember.user_id == r.reporter_id),
        Chat.members.any(ChatMember.user_id == r.reported_id),
    ).first()
    reporter = User.query.get(r.reporter_id)
    reported = User.query.get(r.reported_id)
    names = {
        r.reporter_id: reporter.public_name if reporter else 'کاربر حذف‌شده',
        r.reported_id: reported.public_name if reported else 'کاربر حذف‌شده',
    }
    out = []
    if chat:
        msgs = Message.query.filter_by(chat_id=chat.id) \
            .order_by(Message.id.desc()).limit(200).all()
        for m in msgs:
            out.append({
                'id': m.id,
                'content': m.content,
                'msg_type': m.msg_type,
                'file_name': m.file_name,
                'deleted': bool(m.deleted),
                'created_at': m.created_at.strftime('%Y-%m-%d %H:%M'),
                'sender': names.get(m.sender_id, 'کاربر'),
            })
    return jsonify(ok=True, messages=out,
                   reporter=reporter.public_name if reporter else '',
                   reported=reported.public_name if reported else '')


@app.route('/admin/report/<int:rid>/<action>', methods=['POST'])
@require_admin
def admin_report(rid, action):
    r = Report.query.get(rid)
    if not r:
        abort(404)
    if action == 'dismiss':
        r.status = 'dismissed'
        db.session.commit()
        return jsonify(ok=True, status='dismissed')
    if action == 'resolve':
        r.status = 'resolved'
        target = User.query.get(r.reported_id)
        if target and not target.is_config_admin:
            target.is_banned = True
            target.status = 'offline'
            db.session.commit()
            socketio.emit('banned', {'reason': 'گزارش', 'banned': True}, room=f'user:{target.id}')
        else:
            db.session.commit()
        return jsonify(ok=True, status='resolved')
    return jsonify(ok=False, error='عملیات نامعتبر')


@socketio.on('connect')
def on_connect():
    user = current_user()
    if not user:
        emit('auth_required')
        return
    bump_online(user)
    join_room(f'user:{user.id}')
    seen = set()
    for c in user_chats(user.id):
        join_room(f'chat:{c.id}')
        if not user.show_online:
            continue
        for mid in chat_member_ids(c.id):
            if mid != user.id and mid not in seen:
                seen.add(mid)
                emit('presence_update', {'user_id': user.id, 'status': 'online'},
                     room=f'user:{mid}')


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
    try:
        chat_id = int(chat_id)
    except (TypeError, ValueError):
        return
    if not user.is_admin and not ChatMember.query.filter_by(chat_id=chat_id, user_id=user.id).first():
        return
    for mid in chat_member_ids(chat_id):
        if mid != user.id:
            emit('typing', {'chat_id': chat_id, 'user_id': user.id,
                            'name': user.public_name}, room=f'user:{mid}')


@socketio.on('stop_typing')
def on_stop_typing(data):
    user = current_user()
    chat_id = data.get('chat_id')
    if not user or not chat_id:
        return
    try:
        chat_id = int(chat_id)
    except (TypeError, ValueError):
        return
    if not user.is_admin and not ChatMember.query.filter_by(chat_id=chat_id, user_id=user.id).first():
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


def _bi_icon(name, cls=''):
    from markupsafe import Markup
    return Markup(f'<svg class="bi-ic {cls}" aria-hidden="true" focusable="false"><use href="#{name}"></use></svg>')


app.jinja_env.globals['bi'] = _bi_icon


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False,
                 allow_unsafe_werkzeug=True)
