import json
import time
import urllib.error
import urllib.parse
import urllib.request


class NakheyrBotError(Exception):
    pass


class NakheyrBot:
    def __init__(self, token, base_url='http://127.0.0.1:5000', timeout=15):
        self.token = token
        self.base = base_url.rstrip('/')
        self.timeout = timeout
        self._session_id = None

    def _req(self, method, path, body=None, params=None):
        url = f'{self.base}/bot/api/{self.token}/{path}'
        if params:
            qs = urllib.parse.urlencode(params)
            sep = '&' if '?' in url else '?'
            url = url + sep + qs
        data = None
        headers = {'Accept': 'application/json'}
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode('utf-8')
                status = resp.getcode()
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace')
            status = e.code
        except Exception as e:
            raise NakheyrBotError(f'network error: {e}')
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {'ok': False, 'error': 'bad_response'}
        if status >= 400:
            raise NakheyrBotError(
                f'api error {status}: {payload.get("error") or payload}'
            )
        return payload

    def get_me(self):
        j = self._req('GET', 'getMe')
        if not j.get('ok'):
            raise NakheyrBotError(j.get('error', 'unknown'))
        return j['me']

    def send_message(self, text, chat_id=None, user_id=None, reply_to=None, retries=3):
        body = {'text': text}
        if chat_id is not None:
            body['chat_id'] = chat_id
        if user_id is not None:
            body['user_id'] = user_id
        if reply_to is not None:
            body['reply_to'] = reply_to
        last = None
        for i in range(retries):
            try:
                j = self._req('POST', 'sendMessage', body=body)
                if not j.get('ok'):
                    raise NakheyrBotError(j.get('error', 'unknown'))
                return j['message']
            except NakheyrBotError as e:
                last = e
                if 'rate_limited' in str(e) and i < retries - 1:
                    time.sleep(1.2 * (i + 1))
                    continue
                break
        if last is None:
            raise NakheyrBotError('unknown')
        raise last

    def get_updates(self, offset=0, limit=100):
        j = self._req('GET', 'getUpdates', params={'offset': offset, 'limit': limit})
        if not j.get('ok'):
            raise NakheyrBotError(j.get('error', 'unknown'))
        return {'updates': j['updates'], 'next_offset': j['next_offset']}

    def set_webhook(self, url):
        j = self._req('POST', 'setWebhook', body={'url': url})
        if not j.get('ok'):
            raise NakheyrBotError(j.get('error', 'unknown'))
        return j['webhook_url']

    def delete_webhook(self):
        j = self._req('POST', 'deleteWebhook')
        if not j.get('ok'):
            raise NakheyrBotError(j.get('error', 'unknown'))
        return True

    def run_forever(self, handler, poll_interval=2.0):
        offset = 0
        while True:
            try:
                res = self.get_updates(offset=offset)
                for update in res['updates']:
                    handler(update)
                if res['next_offset']:
                    offset = res['next_offset']
                time.sleep(poll_interval)
            except NakheyrBotError:
                time.sleep(5)
            except KeyboardInterrupt:
                break
