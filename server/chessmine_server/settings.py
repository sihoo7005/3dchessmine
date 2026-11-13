import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get('CHESSMINE_DEBUG') == '1'
PREMIUM_TEST_ENABLED = os.environ.get('CHESSMINE_PREMIUM_TEST') == '1'
SECRET_KEY = os.environ.get('CHESSMINE_SECRET_KEY', '')
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError('CHESSMINE_SECRET_KEY is required outside development')
    SECRET_KEY = 'local-development-only-do-not-use-in-production'
ALLOWED_HOSTS = [host for host in os.environ.get('CHESSMINE_ALLOWED_HOSTS', '127.0.0.1,localhost' if DEBUG else '').split(',') if host]
if not ALLOWED_HOSTS:
    raise RuntimeError('CHESSMINE_ALLOWED_HOSTS is required')
ALLOWED_HOSTS.append('3dchessmine.pages.dev')
INSTALLED_APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions',
    'django.contrib.messages', 'django.contrib.sites',
    'allauth', 'allauth.account', 'allauth.socialaccount',
    'allauth.socialaccount.providers.google', 'records',
]
MIDDLEWARE = [
    'records.middleware.CloudflarePublicHost', 'django.middleware.security.SecurityMiddleware', 'records.middleware.GoogleOnlyAccountRoutes', 'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.contrib.messages.middleware.MessageMiddleware',
    'allauth.account.middleware.AccountMiddleware',
]
ROOT_URLCONF = 'chessmine_server.urls'
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'APP_DIRS': True,
              'OPTIONS': {'context_processors': ['django.template.context_processors.request',
                  'django.contrib.auth.context_processors.auth', 'django.contrib.messages.context_processors.messages']}}]
WSGI_APPLICATION = 'chessmine_server.wsgi.application'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3',
                         'NAME': os.environ.get('CHESSMINE_DB_PATH', str(BASE_DIR / 'db.sqlite3'))}}
SITE_ID = 1
AUTHENTICATION_BACKENDS = ['django.contrib.auth.backends.ModelBackend', 'allauth.account.auth_backends.AuthenticationBackend']
ACCOUNT_LOGIN_METHODS = {'email'}
ACCOUNT_SIGNUP_FIELDS = ['email*']
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_STORE_TOKENS = False
SOCIALACCOUNT_PROVIDERS = {'google': {'SCOPE': ['openid', 'email', 'profile'], 'OAUTH_PKCE_ENABLED': True, 'AUTH_PARAMS': {'prompt': 'select_account'},
    'APP': {'client_id': os.environ.get('GOOGLE_OAUTH_CLIENT_ID', ''),
            'secret': os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET', ''), 'key': ''}}}
if not DEBUG:
    for variable in ('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'CHESSMINE_DB_PATH'):
        if not os.environ.get(variable):
            raise RuntimeError(f'{variable} is required outside development')
LOGIN_REDIRECT_URL = '/chessmine/3d_minesweeper.html'
ACCOUNT_LOGOUT_REDIRECT_URL = LOGIN_REDIRECT_URL
LANGUAGE_CODE = 'ko'
TIME_ZONE = 'Asia/Seoul'
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
SESSION_COOKIE_NAME = 'chessmine_session'
SESSION_COOKIE_PATH = '/chessmine/'
CSRF_COOKIE_NAME = 'chessmine_csrf'
CSRF_COOKIE_PATH = '/chessmine/'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'unsafe-none'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_TRUSTED_ORIGINS = [origin for origin in os.environ.get('CHESSMINE_TRUSTED_ORIGINS', '').split(',') if origin]
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
