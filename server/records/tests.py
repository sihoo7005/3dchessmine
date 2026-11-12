import json
import uuid
from urllib.parse import parse_qs, urlparse
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from .models import GameRecord

class SetupTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.state = str(uuid.uuid4())

    def test_cookie_scope_and_google_login(self):
        response = self.client.get('/chessmine/auth/start', {'state': self.state})
        self.assertEqual(settings.SESSION_COOKIE_PATH, '/chessmine/')
        self.assertEqual(self.client.cookies['chessmine_csrf']['path'], '/chessmine/')
        self.assertContains(response, '/chessmine/accounts/google/login/')
        token = self.client.cookies['chessmine_csrf'].value
        response = self.client.post('/chessmine/accounts/google/login/', {'csrfmiddlewaretoken': token})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith('https://accounts.google.com/'))

    def test_only_public_pages_are_served(self):
        self.assertEqual(self.client.get('/chessmine/').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/privacy.html').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/3d_minesweeper.html').status_code, 404)
        self.assertEqual(self.client.get('/chessmine/accounts/signup/').status_code, 404)

    @override_settings(ALLOWED_HOSTS=['jsaur.duckdns.org'])
    def test_google_callback_uses_https_game_path(self):
        self.client.get('/chessmine/auth/start', {'state': self.state}, secure=True, HTTP_HOST='jsaur.duckdns.org')
        token = self.client.cookies['chessmine_csrf'].value
        response = self.client.post('/chessmine/accounts/google/login/', {'csrfmiddlewaretoken': token}, secure=True, HTTP_HOST='jsaur.duckdns.org', HTTP_ORIGIN='https://jsaur.duckdns.org')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(parse_qs(urlparse(response['Location']).query)['redirect_uri'], ['https://jsaur.duckdns.org/chessmine/accounts/google/login/callback/'])

class CrossOriginTests(TestCase):
    origin = 'https://sihoo7005.github.io'
    def setUp(self):
        self.alice = get_user_model().objects.create_user(username='alice')
        self.bob = get_user_model().objects.create_user(username='bob')
        self.client = Client(enforce_csrf_checks=True)
        self.state = str(uuid.uuid4())
        self.payload = {'clientId': str(uuid.uuid4()), 'mode': 'no-guess', 'size': 3, 'mines': 2,
                        'weights': {'K': 7, 'R': 1, 'B': 1, 'Q': 1, 'N': 1}, 'result': 'lost', 'durationMs': 1234}

    def issue_token(self, user):
        import re
        self.client.force_login(user)
        response = self.client.get('/chessmine/auth/bridge', {'state': self.state})
        self.assertEqual(response.status_code, 200)
        match = re.search(r'"code": "([A-Za-z0-9_-]+)"', response.content.decode())
        self.assertIsNotNone(match)
        code = match.group(1)
        response = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': code}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 200)
        repeated = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': code}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(repeated.status_code, 401, 'A login ticket may be used only once')
        return response.json()['token']

    def test_cors_and_cookie_cannot_authorize(self):
        self.client.force_login(self.alice)
        response = self.client.get('/chessmine/api/cross/session', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 401, 'A browser cookie must not authenticate the cross-origin API')
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(self.client.options('/chessmine/api/cross/records', HTTP_ORIGIN='https://attacker.example').status_code, 403)
        self.assertEqual(self.client.options('/chessmine/api/cross/records', HTTP_ORIGIN=self.origin).status_code, 204)

    def test_token_authentication_isolation_and_revocation(self):
        alice_token = self.issue_token(self.alice)
        response = self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {alice_token}')
        self.assertEqual(response.status_code, 201)
        self.assertIn('no-store', response['Cache-Control'])
        bob_token = self.issue_token(self.bob)
        response = self.client.get('/chessmine/api/cross/records', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {bob_token}')
        self.assertEqual(response.json()['records'], [])
        self.assertEqual(self.client.post('/chessmine/api/cross/logout', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {alice_token}').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/api/cross/session', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {alice_token}').status_code, 401)

    def test_invalid_record_and_account_deletion(self):
        token = self.issue_token(self.alice)
        auth = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': f'Bearer {token}'}
        for field, value in [('mode', 'unknown'), ('size', 11), ('mines', 27), ('durationMs', -1), ('result', 'pending'), ('clientId', 'bad'), ('weights', {'K': 0}), ('weights', {'K': 10**1000, 'R': 1, 'B': 1, 'Q': 1, 'N': 1})]:
            self.assertEqual(self.client.post('/chessmine/api/cross/records', json.dumps(dict(self.payload, **{field: value})), content_type='application/json', **auth).status_code, 400, field)
        self.assertEqual(self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', **auth).status_code, 201)
        bob_token = self.issue_token(self.bob)
        bob_auth = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': f'Bearer {bob_token}'}
        self.assertEqual(self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', **bob_auth).status_code, 201)
        self.assertEqual(self.client.post('/chessmine/api/cross/delete', **auth).status_code, 200)
        self.assertFalse(get_user_model().objects.filter(pk=self.alice.pk).exists())
        self.assertTrue(get_user_model().objects.filter(pk=self.bob.pk).exists())
        self.assertEqual(GameRecord.objects.count(), 1)
        self.assertEqual(len(self.client.get('/chessmine/api/cross/records', **bob_auth).json()['records']), 1)
        self.assertEqual(self.client.get('/chessmine/api/cross/session', **auth).status_code, 401)

    def test_invalid_and_expired_ticket(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import LoginTicket
        from .views import token_digest
        code = 'a' * 43
        LoginTicket.objects.create(digest=token_digest(code), user=self.alice, expires_at=timezone.now()-timedelta(seconds=1))
        response = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': code}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.get('/chessmine/auth/start', {'state': 'bad'}).status_code, 400)

    def test_oauth_callback_returns_to_original_popup_state(self):
        from unittest.mock import patch
        self.client.get('/chessmine/auth/start', {'state': self.state})
        csrf = self.client.cookies['chessmine_csrf'].value
        response = self.client.post('/chessmine/accounts/google/login/', {
            'csrfmiddlewaretoken': csrf, 'next': '/chessmine/auth/bridge?state=' + self.state,
        })
        google_state = parse_qs(urlparse(response['Location']).query)['state'][0]
        profile = {'id': 'google-test-user', 'email': 'test@example.invalid', 'verified_email': True,
                   'name': 'Test User', 'given_name': 'Test', 'family_name': 'User'}
        with patch('allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter.get_access_token_data', return_value={'access_token': 'test'}), \
             patch('allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter._fetch_user_info', return_value=profile):
            callback = self.client.get('/chessmine/accounts/google/login/callback/', {'state': google_state, 'code': 'test'})
        self.assertEqual(callback.status_code, 302)
        self.assertEqual(callback['Location'], '/chessmine/auth/bridge?state=' + self.state)
        bridge = self.client.get(callback['Location'])
        self.assertEqual(bridge.status_code, 200)
        self.assertContains(bridge, self.state)
        self.assertContains(bridge, self.origin)
        self.assertNotIn('_auth_user_id', self.client.session, 'Popup session must end after issuing the ticket')
        import re
        ticket = re.search(r'"code": "([A-Za-z0-9_-]+)"', bridge.content.decode()).group(1)
        exchanged = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': ticket}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(exchanged.status_code, 200)
        token = exchanged.json()['token']
        saved = self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION='Bearer ' + token)
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(GameRecord.objects.count(), 1)
